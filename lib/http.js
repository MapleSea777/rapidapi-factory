'use strict';

/**
 * Small HTTP helpers shared by every API module.
 * Zero external dependencies — uses only Node built-ins.
 */

function sendJSON(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, message, extra = {}) {
  sendJSON(res, status, { error: { status, message, ...extra } });
}

/** Read and parse the request body (JSON or form). Caps at 1MB. */
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = (req.headers['content-type'] || '').toLowerCase();
      try {
        if (ct.includes('application/json')) return resolve(JSON.parse(raw));
        if (ct.includes('application/x-www-form-urlencoded')) {
          return resolve(Object.fromEntries(new URLSearchParams(raw)));
        }
        // Try JSON, fall back to raw string.
        try {
          return resolve(JSON.parse(raw));
        } catch {
          return resolve({ raw });
        }
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Merge query params and (for POST) body params into a single flat object. */
function collectParams(req, query, body) {
  const out = {};
  for (const [k, v] of query.entries()) out[k] = v;
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) out[k] = v;
  }
  return out;
}

/** Validate required params are present & non-empty. Returns error string or null. */
function requireParams(params, required) {
  for (const key of required) {
    const v = params[key];
    if (v === undefined || v === null || v === '') {
      return `Missing required parameter: "${key}"`;
    }
  }
  return null;
}

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = { sendJSON, sendError, readBody, collectParams, requireParams, toNumber };
