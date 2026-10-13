'use strict';

/**
 * Email Verifier Pro — syntax check, disposable/role detection, typo
 * correction and live DNS MX verification with a hard timeout.
 */

const dns = require('dns');
const { requireParams } = require('../lib/http');

function need(params, keys) {
  const msg = requireParams(params, keys);
  if (msg) {
    const e = new Error(msg);
    e.status = 400;
    throw e;
  }
}

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.de', 'guerrillamailblock.com', 'sharklasers.com', 'grr.la',
  'guerrillamail.info', 'pokemail.net', 'spam4.me', 'bccto.me',
  '10minutemail.com', '10minutemail.net', '10minutemail.org', '10minutemail.de',
  'minutemail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.com',
  'tempmailaddress.com', 'tempinbox.com', 'throwaway.email', 'throwawaymail.com',
  'getnada.com', 'nada.email', 'trashmail.com', 'trashmail.net', 'trashmail.me',
  'trash-mail.com', 'fakeinbox.com', 'mailnesia.com', 'maildrop.cc',
  'discard.email', 'spamgourmet.com', 'mytemp.email', 'mohmal.com',
  'dispostable.com', 'mailcatch.com', 'mintemail.com', 'fakemail.net',
  'emailondeck.com', 'getairmail.com', 'yopmail.com', 'yopmail.net',
  'cool.fr.nf', 'jetable.fr.nf', 'courriel.fr.nf', 'moncourrier.fr.nf',
]);

const ROLE_LOCALS = new Set([
  'admin', 'administrator', 'info', 'support', 'sales', 'contact', 'help',
  'billing', 'noreply', 'no-reply', 'webmaster', 'postmaster', 'hostmaster',
  'abuse', 'security', 'root', 'office', 'hello', 'team', 'feedback',
  'marketing', 'press', 'media', 'careers', 'jobs', 'hr', 'legal', 'privacy',
]);

// Common typo corrections for popular providers.
const TYPO_DOMAINS = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gimail.com': 'gmail.com', 'gmali.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmaill.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com', 'hotmail.cm': 'hotmail.com', 'hotamil.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloook.com': 'outlook.com', 'outlook.co': 'outlook.com',
  'outllok.com': 'outlook.com', 'outlool.com': 'outlook.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhaoo.com': 'yahoo.com',
  'yhoo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yaoo.com': 'yahoo.com',
  'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'icloud.co': 'icloud.com',
};

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function resolveMxWithTimeout(domain, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, reason: 'timeout', records: [] });
      }
    }, timeoutMs);
    dns.promises
      .resolveMx(domain)
      .then((records) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ ok: true, reason: null, records });
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ ok: false, reason: err.code || err.message, records: [] });
        }
      });
  });
}

async function verify(params) {
  need(params, ['email']);
  const email = String(params.email).trim();

  const at = email.lastIndexOf('@');
  const localPart = at > 0 ? email.slice(0, at) : null;
  const domain = at > 0 && at < email.length - 1 ? email.slice(at + 1).toLowerCase() : null;

  const validSyntax = EMAIL_RE.test(email) && email.length <= 254;
  const isDisposable = domain !== null && DISPOSABLE_DOMAINS.has(domain);
  const isRole = localPart !== null && ROLE_LOCALS.has(localPart.toLowerCase());
  const suggestedCorrection = domain !== null && TYPO_DOMAINS[domain] ? `${localPart}@${TYPO_DOMAINS[domain]}` : null;

  let mxFound = false;
  let mxHosts = [];
  let mxError = null;
  if (validSyntax && domain) {
    const result = await resolveMxWithTimeout(domain, 3000);
    if (result.ok) {
      mxFound = result.records.length > 0;
      mxHosts = result.records
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.exchange);
    } else {
      mxError = result.reason;
    }
  }

  const deliverable = validSyntax && mxFound && !isDisposable;

  let score = 0;
  if (validSyntax) score += 30;
  if (mxFound) score += 40;
  if (!isDisposable) score += 15;
  if (!isRole) score += 10;
  if (validSyntax && domain && domain.split('.').length >= 2) score += 5;
  score = Math.max(0, Math.min(100, score));

  const quality = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';

  return {
    email,
    valid_syntax: validSyntax,
    local_part: localPart,
    domain,
    is_disposable: isDisposable,
    is_role: isRole,
    suggested_correction: suggestedCorrection,
    mx_found: mxFound,
    mx_hosts: mxHosts,
    mx_error: mxError,
    deliverable,
    quality,
    score,
  };
}

async function mx(params) {
  need(params, ['domain']);
  const domain = String(params.domain).trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    const e = new Error('Parameter "domain" must be a valid domain name');
    e.status = 400;
    throw e;
  }
  const result = await resolveMxWithTimeout(domain, 3000);
  const records = result.records
    .sort((a, b) => a.priority - b.priority)
    .map((r) => ({ exchange: r.exchange, priority: r.priority }));
  return {
    domain,
    found: result.ok && records.length > 0,
    count: records.length,
    records,
    ...(result.ok ? {} : { error: result.reason }),
  };
}

module.exports = {
  prefix: '/email-verify/v1',
  name: 'Email Verifier Pro',
  tagline: 'Syntax, disposable, role and live MX verification for any email address.',
  description:
    'Email Verifier Pro validates email addresses end to end: RFC-pragmatic syntax checks, 40+ disposable-domain detections, role-address flagging, typo correction for popular providers (gmial.com → gmail.com), and live DNS MX lookups with a strict timeout. Returns a deliverability verdict and 0-100 quality score. Perfect for signup forms and list hygiene.',
  freeTier: 30,
  endpoints: [
    {
      path: '/verify',
      method: 'GET',
      summary: 'Verify an email address',
      operationId: 'verifyEmail',
      params: [
        { name: 'email', type: 'string', required: true, description: 'Email address to verify', example: 'user@example.com' },
      ],
      handler: verify,
    },
    {
      path: '/mx',
      method: 'GET',
      summary: 'Look up MX records for a domain',
      operationId: 'mxLookup',
      params: [
        { name: 'domain', type: 'string', required: true, description: 'Domain to query', example: 'example.com' },
      ],
      handler: mx,
    },
  ],
};
