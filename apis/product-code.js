'use strict';

/**
 * Product Identifier Suite — validates and converts the retail / publishing
 * identifier family (GTIN-8/12/13/14, UPC-E, ISBN-10/13, ISSN, ISMN, ISRC)
 * using the published check-digit algorithms.
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

// ---- Check-digit algorithms ---------------------------------------------

/**
 * Generic GS1 GTIN check digit. Digits are numbered from the right (the check
 * digit is position 1); even positions are weighted ×3. This single rule
 * covers EAN-8, UPC-A, EAN-13, GTIN-14, ISBN-13 and ISMN.
 */
function gtinCheckDigit(data) {
  const total = data.length + 1;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const position = total - i; // 1-based from the right
    const weight = position % 2 === 0 ? 3 : 1;
    sum += Number(data[i]) * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

/** ISBN-10 check digit over 9 digits, weights 10..2 (mod 11). 10 -> 'X'. */
function isbn10CheckDigit(data) {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(data[i]) * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return c === 10 ? 'X' : String(c);
}

/** ISSN check digit over 7 digits, weights 8..2 (mod 11). 10 -> 'X'. */
function issnCheckDigit(data) {
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(data[i]) * weights[i];
  const c = (11 - (sum % 11)) % 11;
  return c === 10 ? 'X' : String(c);
}

/** Expand a UPC-E code to its 11 UPC-A data digits (without check digit). */
function upceToUpcaData(c) {
  const ns = c[0];
  const d = c.slice(1, 7);
  const d6 = d[5];
  let manufacturer;
  let product;
  if (d6 >= '0' && d6 <= '2') {
    manufacturer = d[0] + d[1] + d6 + '00';
    product = '00' + d[2] + d[3] + d[4];
  } else if (d6 === '3') {
    manufacturer = d[0] + d[1] + d[2] + '00';
    product = '000' + d[3] + d[4];
  } else if (d6 === '4') {
    manufacturer = d[0] + d[1] + d[2] + d[3] + '0';
    product = '0000' + d[4];
  } else {
    manufacturer = d[0] + d[1] + d[2] + d[3] + d[4];
    product = '0000' + d6;
  }
  return ns + manufacturer + product;
}

/**
 * Compress a 12-digit UPC-A to UPC-E (inverse of the expansion table), or
 * return null when the code cannot be represented as UPC-E.
 */
function upcaToUpce(upca) {
  const ns = upca[0];
  if (ns !== '0' && ns !== '1') return null;
  const m = upca.slice(1, 6);
  const p = upca.slice(6, 11);
  const check = upca[11];
  let d = null;
  if (m[2] <= '2' && m[3] === '0' && m[4] === '0' && p[0] === '0' && p[1] === '0') {
    d = m[0] + m[1] + p[2] + p[3] + p[4] + m[2];
  } else if (m[3] === '0' && m[4] === '0' && p[0] === '0' && p[1] === '0' && p[2] === '0') {
    d = m[0] + m[1] + m[2] + p[3] + p[4] + '3';
  } else if (m[4] === '0' && p[0] === '0' && p[1] === '0' && p[2] === '0' && p[3] === '0') {
    d = m[0] + m[1] + m[2] + m[3] + p[4] + '4';
  } else if (p[0] === '0' && p[1] === '0' && p[2] === '0' && p[3] === '0' && p[4] >= '5') {
    d = m[0] + m[1] + m[2] + m[3] + m[4] + p[4];
  }
  if (!d) return null;
  return ns + d + check;
}

// ---- Type detection ------------------------------------------------------

/**
 * 8-digit codes are ambiguous (EAN-8 vs UPC-E vs ISSN). Resolve by trying each
 * published algorithm; ISSN is preferred only when it is the unique match.
 */
function detect8(c) {
  const check = c[7];
  const data7 = c.slice(0, 7);
  const issnOk = issnCheckDigit(data7) === check;
  const ean8Ok = gtinCheckDigit(data7) === check;
  let upceOk = false;
  if (c[0] === '0' || c[0] === '1') {
    upceOk = gtinCheckDigit(upceToUpcaData(c)) === check;
  }
  if (issnOk && !ean8Ok) return 'ISSN';
  if (ean8Ok) return 'EAN-8';
  if (upceOk) return 'UPC-E';
  if (issnOk) return 'ISSN';
  return 'EAN-8';
}

function detect(raw) {
  const upper = String(raw).trim().toUpperCase();
  const compact = upper.replace(/[\s-]/g, '');

  if (compact.length === 12 && /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/.test(compact)) {
    return { type: 'ISRC', compact };
  }
  if (/^\d{9}[\dX]$/.test(compact)) return { type: 'ISBN-10', compact };
  if (/^\d{7}X$/.test(compact)) return { type: 'ISSN', compact };
  if (!/^\d+$/.test(compact)) return { type: 'UNKNOWN', compact };
  switch (compact.length) {
    case 8:
      return { type: detect8(compact), compact };
    case 12:
      return { type: 'UPC-A', compact };
    case 13:
      if (compact.startsWith('9790')) return { type: 'ISMN', compact };
      if (compact.startsWith('978') || compact.startsWith('979')) return { type: 'ISBN-13', compact };
      return { type: 'EAN-13', compact };
    case 14:
      return { type: 'GTIN-14', compact };
    default:
      return { type: 'UNKNOWN', compact };
  }
}

const GTIN13_TYPES = new Set(['EAN-13', 'ISBN-13', 'ISMN']);

/** Full analysis of one identifier, reused by /validate and /convert. */
function analyze(raw) {
  const det = detect(raw);
  const type = det.type;
  const code = det.compact;

  const result = {
    code,
    detected_type: type,
    valid: false,
    check_digit_valid: null,
    check_digit: null,
    expected_check_digit: null,
    normalized_gtin_14: null,
    components: null,
    errors: [],
    _upca: null,
    _isbn13: null,
  };

  if (type === 'UNKNOWN') {
    result.errors.push(
      'Unrecognized identifier: expected an 8/12/13/14-digit GTIN, ISBN-10, ISSN or a 12-character ISRC.'
    );
    return result;
  }

  if (type === 'ISRC') {
    const m = code.match(/^([A-Z]{2})([A-Z0-9]{3})(\d{2})(\d{5})$/);
    result.components = {
      country_code: m[1],
      registrant_code: m[2],
      year: m[3],
      designation_code: m[4],
    };
    result.valid = true; // ISRC has no check digit; structural validation passed.
    return result;
  }

  if (type === 'ISBN-10') {
    const data = code.slice(0, 9);
    const expected = isbn10CheckDigit(data);
    result.check_digit = code[9];
    result.expected_check_digit = expected;
    result.check_digit_valid = expected === code[9];
    result.components = { registration_and_title: data };
    if (!result.check_digit_valid) {
      result.errors.push(`Check digit mismatch: last character is "${code[9]}", expected "${expected}"`);
    }
    const body12 = '978' + data;
    result._isbn13 = body12 + gtinCheckDigit(body12);
    result.valid = result.check_digit_valid;
    return result;
  }

  if (type === 'ISSN') {
    const data = code.slice(0, 7);
    const expected = issnCheckDigit(data);
    result.check_digit = code[7];
    result.expected_check_digit = expected;
    result.check_digit_valid = expected === code[7];
    result.components = { serial: data, formatted: code.slice(0, 4) + '-' + code.slice(4) };
    if (!result.check_digit_valid) {
      result.errors.push(`Check digit mismatch: last character is "${code[7]}", expected "${expected}"`);
    }
    result.valid = result.check_digit_valid;
    return result;
  }

  if (type === 'UPC-E') {
    const upcaData = upceToUpcaData(code);
    const expected = gtinCheckDigit(upcaData);
    const upca = upcaData + expected;
    result.check_digit = code[7];
    result.expected_check_digit = expected;
    result.check_digit_valid = expected === code[7];
    result._upca = upca;
    result.normalized_gtin_14 = '00' + upca;
    result.components = {
      number_system: code[0],
      manufacturer_code: code.slice(1, 4),
      product_code: code.slice(4, 7),
      expanded_upc_a: upca,
    };
    if (code[0] !== '0' && code[0] !== '1') result.errors.push('UPC-E number system must be 0 or 1');
    if (!result.check_digit_valid) {
      result.errors.push(`Check digit mismatch: last digit is "${code[7]}", expected "${expected}"`);
    }
    result.valid = result.check_digit_valid && result.errors.length === 0;
    return result;
  }

  // EAN-8, UPC-A, EAN-13, GTIN-14, ISBN-13, ISMN
  const data = code.slice(0, code.length - 1);
  const check = code[code.length - 1];
  const expected = gtinCheckDigit(data);
  result.check_digit = check;
  result.expected_check_digit = expected;
  result.check_digit_valid = expected === check;
  if (!result.check_digit_valid) {
    result.errors.push(`Check digit mismatch: last digit is "${check}", expected "${expected}"`);
  }

  if (type === 'GTIN-14') {
    result.normalized_gtin_14 = code;
    result.components = { packaging_indicator: code[0], gtin_13: code.slice(1, 13) };
  } else if (type === 'UPC-A') {
    result.normalized_gtin_14 = '00' + code;
    result._upca = code;
    result.components = { number_system: code[0], manufacturer: code.slice(1, 6), product: code.slice(6, 11) };
  } else if (type === 'EAN-8') {
    result.normalized_gtin_14 = '000000' + code;
    result.components = { payload: data };
  } else if (type === 'ISBN-13') {
    result.normalized_gtin_14 = '0' + code;
    result._isbn13 = code;
    result.components = { isbn_prefix: code.slice(0, 3), registration: code.slice(3, 12) };
  } else if (type === 'ISMN') {
    result.normalized_gtin_14 = '0' + code;
    result.components = { prefix: '9790', payload: code.slice(4, 12) };
  } else {
    result.normalized_gtin_14 = '0' + code;
    result.components = { gs1_prefix: code.slice(0, 3), payload: code.slice(3, 12) };
  }
  result.valid = result.check_digit_valid;
  return result;
}

// ---- Endpoint handlers ---------------------------------------------------

function validate(params) {
  need(params, ['code']);
  const a = analyze(params.code);
  return {
    code: a.code,
    detected_type: a.detected_type,
    valid: a.valid,
    check_digit_valid: a.check_digit_valid,
    check_digit: a.check_digit,
    expected_check_digit: a.expected_check_digit,
    normalized_gtin_14: a.normalized_gtin_14,
    components: a.components,
    errors: a.errors,
  };
}

function convert(params) {
  need(params, ['code']);
  const target = String(params.to || 'gtin14').trim().toLowerCase();
  const a = analyze(params.code);
  const type = a.detected_type;
  const code = a.code;

  let upca = a._upca;
  if (!upca && type === 'EAN-13' && code[0] === '0') upca = code.slice(1);
  if (!upca && type === 'GTIN-14' && code.slice(0, 2) === '00') upca = code.slice(2);

  let gtin13 = null;
  if (GTIN13_TYPES.has(type)) gtin13 = code;
  else if (type === 'GTIN-14' && code[0] === '0') gtin13 = code.slice(1);
  else if (upca) gtin13 = '0' + upca;

  const isbn13 = a._isbn13;
  const gtin14 = a.normalized_gtin_14;

  const out = {
    input: String(params.code).trim(),
    input_type: type,
    target,
    output: null,
    converted: false,
    note: '',
  };

  if (target === 'gtin14') {
    if (gtin14) {
      out.output = gtin14;
      out.converted = true;
      out.note = 'Left-padded to GTIN-14 (packaging indicator 0).';
    } else if (isbn13) {
      out.output = '0' + isbn13;
      out.converted = true;
      out.note = 'ISBN-13 padded to GTIN-14.';
    } else {
      out.note = `${type} has no GTIN-14 representation.`;
    }
  } else if (target === 'gtin13') {
    if (gtin13) {
      out.output = gtin13;
      out.converted = true;
      out.note = 'Normalized to GTIN-13.';
    } else {
      out.note = `${type} cannot be narrowed to 13 digits.`;
    }
  } else if (target === 'upca') {
    if (upca) {
      out.output = upca;
      out.converted = true;
      out.note = 'Normalized to 12-digit UPC-A.';
    } else {
      out.note = `${type} has no 12-digit UPC-A equivalent.`;
    }
  } else if (target === 'upce') {
    if (upca) {
      const upce = upcaToUpce(upca);
      if (upce) {
        out.output = upce;
        out.converted = true;
        out.note = 'Compressed UPC-A to UPC-E (check digit preserved).';
      } else {
        out.note = 'UPC-A is not representable as UPC-E (number system or manufacturer/product pattern).';
      }
    } else {
      out.note = `${type} has no UPC-A equivalent to compress.`;
    }
  } else if (target === 'isbn13') {
    if (isbn13) {
      out.output = isbn13;
      out.converted = true;
      out.note = 'Normalized to ISBN-13.';
    } else {
      out.note = `${type} cannot be converted to ISBN-13.`;
    }
  } else {
    out.note = `Unknown target "${target}". Supported: gtin13, gtin14, upca, upce, isbn13.`;
  }

  return out;
}

const GENERATE_TYPES = {
  ean13: { length: 12, algo: 'gtin', label: 'EAN-13' },
  gtin13: { length: 12, algo: 'gtin', label: 'EAN-13' },
  isbn13: { length: 12, algo: 'gtin', label: 'ISBN-13' },
  ismn: { length: 12, algo: 'gtin', label: 'ISMN' },
  gtin12: { length: 11, algo: 'gtin', label: 'UPC-A' },
  upca: { length: 11, algo: 'gtin', label: 'UPC-A' },
  ean8: { length: 7, algo: 'gtin', label: 'EAN-8' },
  gtin14: { length: 13, algo: 'gtin', label: 'GTIN-14' },
  issn: { length: 7, algo: 'issn', label: 'ISSN' },
  isbn10: { length: 9, algo: 'isbn10', label: 'ISBN-10' },
};

function generate(params) {
  need(params, ['type', 'body']);
  const type = String(params.type).trim().toLowerCase();
  const spec = GENERATE_TYPES[type];
  if (!spec) {
    badRequest(`Unsupported type "${params.type}". Supported: ${Object.keys(GENERATE_TYPES).join(', ')}`);
  }
  const body = String(params.body).replace(/[\s-]/g, '').toUpperCase();
  if (!/^\d+$/.test(body)) badRequest('Parameter "body" must contain digits only');
  if (body.length !== spec.length) {
    badRequest(`Parameter "body" for type "${type}" must be ${spec.length} digits, got ${body.length}`);
  }

  let check;
  if (spec.algo === 'gtin') check = gtinCheckDigit(body);
  else if (spec.algo === 'issn') check = issnCheckDigit(body);
  else check = isbn10CheckDigit(body);

  return { type: spec.label, body, check_digit: check, code: body + check };
}

const TYPES = [
  { type: 'EAN-8', length: 8, algorithm: 'GTIN mod-10 (weights 3,1 over 7 digits)', description: '8-digit GS1 GTIN-8 for small packaging.' },
  { type: 'UPC-A', length: 12, algorithm: 'GTIN mod-10 (weights 3,1 over 11 digits)', description: '12-digit North-American GTIN-12.' },
  { type: 'UPC-E', length: 8, algorithm: 'Check digit of the expanded UPC-A (mod-10)', description: 'Zero-suppressed UPC for tiny packages; expands via the published table.' },
  { type: 'EAN-13', length: 13, algorithm: 'GTIN mod-10 (weights 1,3 over 12 digits)', description: 'International 13-digit GTIN-13.' },
  { type: 'GTIN-14', length: 14, algorithm: 'GTIN mod-10 (weights 3,1 over 13 digits)', description: '14-digit logistics / outer-case GTIN.' },
  { type: 'ISBN-10', length: 10, algorithm: 'mod 11, weights 10..2, 10 = X', description: 'Legacy 10-digit book number.' },
  { type: 'ISBN-13', length: 13, algorithm: 'GTIN mod-10 (EAN-13); GS1 prefix 978/979', description: 'Current 13-digit book number.' },
  { type: 'ISSN', length: 8, algorithm: 'mod 11, weights 8..2, 10 = X', description: 'Serial-publication number, e.g. 0378-5955.' },
  { type: 'ISMN', length: 13, algorithm: 'GTIN mod-10 (EAN-13); GS1 prefix 9790', description: 'Music-score number, starts 9790.' },
  { type: 'ISRC', length: 12, algorithm: 'None — structural only (CC-XXX-YY-NNNNN)', description: 'Recording code: country + registrant + year + designation.' },
];

function listTypes() {
  return { count: TYPES.length, types: TYPES };
}

module.exports = {
  prefix: '/product-code/v1',
  name: 'Product Identifier Suite',
  tagline:
    'Validate & convert GTIN, EAN-8/13, UPC-A/E, ISBN-10/13, ISSN, ISMN and ISRC with real check-digit algorithms.',
  description:
    'Product Identifier Suite validates and converts the whole retail and publishing identifier family — GTIN-8/12/13/14, UPC-E, ISBN-10/13, ISSN, ISMN and ISRC — using each standard\'s published check-digit algorithm (GS1 mod-10, ISBN/ISSN mod-11) instead of one naive formula. It also implements the official UPC-E to UPC-A expansion table, zero-suppression compression, and GTIN-14 left-pad normalization so records from different systems line up. Built for retail and e-commerce catalog operations, PIM and ERP integrations, publishing and rights teams, and data-cleansing pipelines that must detect bad codes before they break a feed.',
  freeTier: 30,
  endpoints: [
    {
      path: '/validate',
      method: 'GET',
      summary: 'Validate any product identifier and verify its check digit',
      operationId: 'validateProductCode',
      params: [
        { name: 'code', type: 'string', required: true, description: 'Identifier to validate (GTIN-8/12/13/14, UPC-E, ISBN-10/13, ISSN, ISMN or ISRC)', example: '4006381333931' },
      ],
      handler: validate,
    },
    {
      path: '/convert',
      method: 'GET',
      summary: 'Convert between compatible identifier forms',
      operationId: 'convertProductCode',
      params: [
        { name: 'code', type: 'string', required: true, description: 'Source identifier', example: '01234565' },
        { name: 'to', type: 'string', required: false, description: 'Target form: gtin13, gtin14, upca, upce or isbn13', example: 'upca' },
      ],
      handler: convert,
    },
    {
      path: '/generate',
      method: 'GET',
      summary: 'Generate a valid identifier from a payload by computing its check digit',
      operationId: 'generateProductCode',
      params: [
        { name: 'type', type: 'string', required: true, description: 'Identifier type: ean13, upca, isbn13, issn, ean8, gtin14, ismn or isbn10', example: 'ean13' },
        { name: 'body', type: 'string', required: true, description: 'Payload digits WITHOUT the check digit', example: '400638133393' },
      ],
      handler: generate,
    },
    {
      path: '/types',
      method: 'GET',
      summary: 'List supported identifier types with length and algorithm',
      operationId: 'listProductCodeTypes',
      params: [],
      handler: listTypes,
    },
  ],
};
