'use strict';

/**
 * IBAN Suite — validation (ISO 13616 mod-97 via BigInt), formatting,
 * bank-code extraction and check-digit generation.
 */

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

// Country -> total IBAN length.
const COUNTRY_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22,
  BH: 22, BR: 29, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18,
  DO: 28, EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22,
  GI: 23, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30,
  NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24,
  RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TN: 24, TR: 26,
  VG: 24,
};

// Country -> [startIndex, length] of the bank code within the IBAN
// (0-based, after the 2 letter country code + 2 check digits).
const BANK_CODE_RULES = {
  DE: [4, 8], GB: [4, 4], FR: [4, 5], ES: [4, 4], IT: [5, 5],
  NL: [4, 4], BE: [4, 3], AT: [4, 5], CH: [4, 5], PL: [4, 8],
  SE: [4, 3], NO: [4, 4], DK: [4, 4], FI: [4, 3], PT: [4, 4],
  IE: [4, 4], LU: [4, 3], GR: [4, 7], CZ: [4, 4], HU: [4, 3],
  SK: [4, 4], SI: [4, 5], HR: [4, 7], RO: [4, 4], BG: [4, 4],
  EE: [4, 2], LV: [4, 4], LT: [4, 5], MT: [4, 4], CY: [4, 8],
  TR: [4, 5], IS: [4, 4], LI: [4, 5], MC: [4, 5], SM: [5, 5],
  AD: [4, 4], AL: [4, 8], AZ: [4, 4], BA: [4, 3], BH: [4, 4],
  BR: [4, 8], CR: [4, 4], DO: [4, 4], GE: [4, 2], GI: [4, 4],
  GT: [4, 4], IL: [4, 3], JO: [4, 4], KW: [4, 4], KZ: [4, 3],
  LB: [4, 4], ME: [4, 3], MK: [4, 3], MR: [4, 5], MU: [4, 6],
  PK: [4, 4], PS: [4, 4], QA: [4, 4], RS: [4, 3], SA: [4, 2],
  TN: [4, 2], VG: [4, 4],
};

function normalizeIban(raw) {
  return String(raw || '').replace(/[\s-]+/g, '').toUpperCase();
}

function ibanToDigits(iban) {
  // Move first 4 chars to end, then map letters A=10..Z=35.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let digits = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') digits += ch;
    else digits += String(ch.charCodeAt(0) - 55);
  }
  return digits;
}

function mod97(digits) {
  return Number(BigInt(digits) % 97n);
}

function validate(params) {
  need(params, ['iban']);
  const iban = normalizeIban(params.iban);

  if (!/^[A-Z0-9]+$/.test(iban)) {
    return { iban, valid: false, country: null, expected_length: null, checksum_ok: false, bank_code: null, error: 'IBAN contains invalid characters' };
  }
  if (iban.length < 5) {
    return { iban, valid: false, country: null, expected_length: null, checksum_ok: false, bank_code: null, error: 'IBAN too short' };
  }

  const country = iban.slice(0, 2);
  const expectedLength = COUNTRY_LENGTHS[country] || null;

  if (!expectedLength) {
    return { iban, valid: false, country, expected_length: null, checksum_ok: false, bank_code: null, error: `Unknown or unsupported country code: ${country}` };
  }
  if (iban.length !== expectedLength) {
    return { iban, valid: false, country, expected_length: expectedLength, checksum_ok: false, bank_code: null, error: `Invalid length: expected ${expectedLength}, got ${iban.length}` };
  }

  const checksumOk = mod97(ibanToDigits(iban)) === 1;

  let bankCode = null;
  const rule = BANK_CODE_RULES[country];
  if (rule) bankCode = iban.slice(rule[0], rule[0] + rule[1]);

  return {
    iban,
    valid: checksumOk,
    country,
    expected_length: expectedLength,
    checksum_ok: checksumOk,
    bank_code: bankCode,
    error: checksumOk ? null : 'Checksum verification failed (mod-97)',
  };
}

function format(params) {
  need(params, ['iban']);
  const iban = normalizeIban(params.iban);
  if (!/^[A-Z0-9]+$/.test(iban)) {
    badRequest('IBAN contains invalid characters');
  }
  const formatted = iban.match(/.{1,4}/g).join(' ');
  return { iban, formatted, length: iban.length };
}

function generate(params) {
  need(params, ['country', 'bban']);
  const country = String(params.country).toUpperCase().trim();
  const bban = String(params.bban).replace(/[\s-]+/g, '').toUpperCase();

  if (!/^[A-Z]{2}$/.test(country)) {
    badRequest('Parameter "country" must be a 2-letter ISO country code');
  }
  const expectedLength = COUNTRY_LENGTHS[country];
  if (!expectedLength) {
    badRequest(`Unknown country code: ${country}. Supported: ${Object.keys(COUNTRY_LENGTHS).join(', ')}`);
  }
  if (!/^[A-Z0-9]+$/.test(bban)) {
    badRequest('Parameter "bban" must be alphanumeric');
  }
  if (bban.length !== expectedLength - 4) {
    badRequest(`BBAN for ${country} must be ${expectedLength - 4} characters, got ${bban.length}`);
  }

  // check digits = 98 - mod97(bban + country + '00')
  const pseudo = ibanToDigits(country + '00' + bban);
  const checkDigits = String(98 - mod97(pseudo)).padStart(2, '0');
  const iban = country + checkDigits + bban;

  return {
    iban,
    formatted: iban.match(/.{1,4}/g).join(' '),
    country,
    check_digits: checkDigits,
    bban,
    length: iban.length,
  };
}

module.exports = {
  prefix: '/iban/v1',
  name: 'IBAN Suite',
  tagline: 'Validate, format, generate and parse IBANs for 60+ countries.',
  description:
    'IBAN Suite validates International Bank Account Numbers using the ISO 13616 mod-97 algorithm (BigInt precision), checks country-specific lengths for 60+ countries, extracts bank codes, formats IBANs into 4-character blocks, and generates valid IBANs from a BBAN by computing correct check digits. Built for payments, invoicing and fintech integrations.',
  freeTier: 30,
  endpoints: [
    {
      path: '/validate',
      method: 'GET',
      summary: 'Validate an IBAN',
      operationId: 'validateIban',
      params: [
        { name: 'iban', type: 'string', required: true, description: 'IBAN to validate', example: 'DE89370400440532013000' },
      ],
      handler: validate,
    },
    {
      path: '/format',
      method: 'GET',
      summary: 'Format an IBAN in 4-character blocks',
      operationId: 'formatIban',
      params: [
        { name: 'iban', type: 'string', required: true, description: 'IBAN to format', example: 'DE89370400440532013000' },
      ],
      handler: format,
    },
    {
      path: '/generate',
      method: 'GET',
      summary: 'Generate an IBAN from country + BBAN',
      operationId: 'generateIban',
      params: [
        { name: 'country', type: 'string', required: true, description: '2-letter ISO country code', example: 'DE' },
        { name: 'bban', type: 'string', required: true, description: 'Basic Bank Account Number (without country/check digits)', example: '370400440532013000' },
      ],
      handler: generate,
    },
  ],
};
