'use strict';

/**
 * Domain Intel — full DNS record lookups, RDAP whois and availability
 * inference. Zero dependencies (dns + https built-ins only).
 */

const dns = require('dns');
const https = require('https');
const { requireParams } = require('../lib/http');

function need(params, keys) {
  const msg = requireParams(params, keys);
  if (msg) {
    const e = new Error(msg);
    e.status = 400;
    throw e;
  }
}

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  throw e;
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function assertDomain(domain) {
  if (!DOMAIN_RE.test(domain)) {
    badRequest(`Invalid domain name: "${domain}"`);
  }
}

async function tryResolve(fn) {
  try {
    return await fn();
  } catch {
    return [];
  }
}

async function dnsRecords(params) {
  need(params, ['domain']);
  const domain = String(params.domain).trim().toLowerCase();
  assertDomain(domain);

  const [a, aaaa, mx, ns, txt, cname, soa] = await Promise.all([
    tryResolve(() => dns.promises.resolve4(domain)),
    tryResolve(() => dns.promises.resolve6(domain)),
    tryResolve(() => dns.promises.resolveMx(domain)),
    tryResolve(() => dns.promises.resolveNs(domain)),
    tryResolve(() => dns.promises.resolveTxt(domain)),
    tryResolve(() => dns.promises.resolveCname(domain)),
    tryResolve(() => dns.promises.resolveSoa(domain)),
  ]);

  return {
    domain,
    a,
    aaaa,
    mx: mx.map((r) => ({ exchange: r.exchange, priority: r.priority })),
    ns,
    txt: txt.map((entry) => (Array.isArray(entry) ? entry.join('') : entry)),
    cname,
    soa: soa.length ? soa[0] : null,
    resolved: a.length > 0 || aaaa.length > 0 || cname.length > 0,
  };
}

// Minimal HTTPS GET with redirect-following (one hop) and a timeout.
function httpsGetJson(url, timeoutMs, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': 'rapidapi-domain-intel/1.0' } }, (res) => {
      const status = res.statusCode;
      if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(httpsGetJson(next, timeoutMs, redirectsLeft - 1));
        return;
      }
      if (status === 404) {
        res.resume();
        resolve({ status: 404, body: null });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        resolve({ status, body: null });
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 2 * 1024 * 1024) {
          req.destroy();
          reject(new Error('RDAP response too large'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        try {
          resolve({ status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch {
          resolve({ status, body: null });
        }
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('RDAP request timed out'));
    });
    req.on('error', reject);
  });
}

function extractRegistrar(body) {
  if (!body || !Array.isArray(body.entities)) return null;
  for (const entity of body.entities) {
    const roles = entity.roles || [];
    if (roles.includes('registrar')) {
      const vcard = entity.vcardArray && entity.vcardArray[1];
      if (Array.isArray(vcard)) {
        const fn = vcard.find((row) => row[0] === 'fn');
        if (fn && fn[3]) return String(fn[3]);
      }
      if (entity.handle) return String(entity.handle);
    }
  }
  return null;
}

async function rdapFetch(domain) {
  const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  try {
    return await httpsGetJson(url, 5000, 1);
  } catch (err) {
    // Network failure is reported in-band so callers still get a 200 shape.
    return { status: 0, body: null, network_error: err.message };
  }
}

async function whois(params) {
  need(params, ['domain']);
  const domain = String(params.domain).trim().toLowerCase();
  assertDomain(domain);

  const { status, body, network_error } = await rdapFetch(domain);

  if (status === 404 || !body) {
    return {
      domain,
      registered: false,
      registrar: null,
      status: [],
      events: [],
      nameservers: [],
      handle: null,
      rdap_status_code: status,
      ...(network_error ? { network_error } : {}),
    };
  }

  return {
    domain,
    registered: true,
    registrar: extractRegistrar(body),
    handle: body.handle || null,
    status: Array.isArray(body.status) ? body.status : [],
    events: Array.isArray(body.events)
      ? body.events.map((ev) => ({ action: ev.eventAction, date: ev.eventDate }))
      : [],
    nameservers: Array.isArray(body.nameservers)
      ? body.nameservers.map((ns) => (ns.ldhName || '').toLowerCase()).filter(Boolean)
      : [],
    rdap_status_code: status,
  };
}

async function availability(params) {
  need(params, ['domain']);
  const domain = String(params.domain).trim().toLowerCase();
  assertDomain(domain);

  const { status, body, network_error } = await rdapFetch(domain);
  const available = status === 404;

  return {
    domain,
    available,
    registered: status === 200 && !!body,
    inferred_from: 'rdap',
    rdap_status_code: status,
    ...(network_error ? { network_error } : {}),
  };
}

module.exports = {
  prefix: '/domain-intel/v1',
  name: 'Domain Intel',
  tagline: 'DNS records, RDAP whois and availability checks for any domain.',
  description:
    'Domain Intel provides complete domain reconnaissance: A/AAAA/MX/NS/TXT/CNAME/SOA DNS lookups, RDAP-based whois (registrar, status, events, nameservers) with redirect handling and strict timeouts, and availability inference. Zero third-party dependencies. Ideal for security tools, registrars and monitoring.',
  freeTier: 30,
  endpoints: [
    {
      path: '/dns',
      method: 'GET',
      summary: 'Look up all DNS records',
      operationId: 'dnsLookup',
      params: [
        { name: 'domain', type: 'string', required: true, description: 'Domain to query', example: 'example.com' },
      ],
      handler: dnsRecords,
    },
    {
      path: '/whois',
      method: 'GET',
      summary: 'RDAP whois lookup',
      operationId: 'rdapWhois',
      params: [
        { name: 'domain', type: 'string', required: true, description: 'Domain to query', example: 'example.com' },
      ],
      handler: whois,
    },
    {
      path: '/availability',
      method: 'GET',
      summary: 'Check domain availability',
      operationId: 'domainAvailability',
      params: [
        { name: 'domain', type: 'string', required: true, description: 'Domain to check', example: 'example.com' },
      ],
      handler: availability,
    },
  ],
};
