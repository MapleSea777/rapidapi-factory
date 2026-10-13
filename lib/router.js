'use strict';

const { sendError, readBody, collectParams } = require('./http');
const { rateLimit } = require('./ratelimit');

/**
 * Prefix-based router. Each API product registers under its own prefix,
 * e.g. "/password-audit/v1/..." so one server can back many RapidAPI listings.
 */
class Router {
  constructor() {
    this.routes = []; // { prefix, method, handler, meta }
    this.products = new Map(); // prefix -> product meta (name, tagline, pricing)
  }

  registerProduct(product) {
    // product: { prefix, name, tagline, description, freeTier, proTier, endpoints: [...] }
    this.products.set(product.prefix, product);
    for (const ep of product.endpoints) {
      this.routes.push({
        prefix: product.prefix + ep.path,
        method: (ep.method || 'GET').toUpperCase(),
        handler: ep.handler,
        meta: ep,
        product,
      });
    }
  }

  /** Longest-prefix match so nested paths resolve to the most specific route. */
  match(method, pathname) {
    let best = null;
    for (const route of this.routes) {
      if (pathname === route.prefix || pathname.startsWith(route.prefix + '/')) {
        if (!best || route.prefix.length > best.prefix.length) best = route;
      }
    }
    if (!best) return null;
    if (best.method !== method && !(best.method === 'GET' && method === 'HEAD')) return null;
    return best;
  }

  async handle(req, res, url) {
    const route = this.match(req.method, url.pathname);
    if (!route) {
      return sendError(res, 404, `No route for ${req.method} ${url.pathname}`);
    }

    // Rate limiting: key from RapidAPI header, else client IP.
    const key =
      req.headers['x-rapidapi-key'] ||
      req.headers['x-api-key'] ||
      req.socket.remoteAddress ||
      'anonymous';
    const limit = rateLimit(`${route.product.prefix}:${key}`, route.product.freeTier || 100);
    if (!limit.allowed) {
      return sendError(res, 429, 'Rate limit exceeded. Upgrade your plan for more requests.', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    let params;
    try {
      const query = url.searchParams;
      const body = req.method === 'POST' ? await readBody(req) : {};
      params = collectParams(req, query, body);
    } catch (e) {
      return sendError(res, e.status || 400, e.message);
    }

    try {
      const result = await route.handler(params, req);
      if (result && result.__raw) {
        // Handler took full control (already wrote response).
        return;
      }
      const { sendJSON } = require('./http');
      return sendJSON(res, 200, result);
    } catch (e) {
      const status = e.status || 500;
      return sendError(res, status, e.message);
    }
  }
}

module.exports = { Router };
