'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Router } = require('./lib/router');
const { sendJSON, sendError } = require('./lib/http');
const { buildSpec } = require('./lib/openapi');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

// ---- Load every API product in ./apis -----------------------------------
const router = new Router();
const apisDir = path.join(__dirname, 'apis');
for (const file of fs.readdirSync(apisDir)) {
  if (!file.endsWith('.js')) continue;
  const product = require(path.join(apisDir, file));
  if (product && product.prefix && Array.isArray(product.endpoints)) {
    router.registerProduct(product);
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return sendError(res, 400, 'Malformed URL');
  }

  // CORS preflight.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    return res.end();
  }

  // Root: product catalog (useful for the RapidAPI listing description too).
  if (url.pathname === '/' || url.pathname === '/health') {
    return sendJSON(res, 200, {
      status: 'ok',
      products: [...router.products.values()].map((p) => ({
        name: p.name,
        prefix: p.prefix,
        tagline: p.tagline,
        endpoints: p.endpoints.map((e) => `${e.method || 'GET'} ${p.prefix}${e.path}`),
      })),
    });
  }

  // OpenAPI spec per product: /spec/<prefix-name>
  if (url.pathname.startsWith('/spec/')) {
    const name = url.pathname.slice('/spec/'.length);
    const product = [...router.products.values()].find(
      (p) =>
        p.prefix.split('/').filter(Boolean)[0] === name ||
        p.name.toLowerCase().replace(/\s+/g, '-') === name
    );
    if (!product) return sendError(res, 404, 'Unknown spec. See / for product list.');
    const base = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || `localhost:${PORT}`}`;
    return sendJSON(res, 200, buildSpec(product, base + product.prefix));
  }

  return router.handle(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`[rapidapi-factory] listening on http://${HOST}:${PORT}`);
  console.log(`[rapidapi-factory] ${router.products.size} API products loaded:`);
  for (const p of router.products.values()) console.log(`  - ${p.name} (${p.prefix})`);
});
