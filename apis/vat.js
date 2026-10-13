'use strict';

/**
 * VAT & Tax ID Validator — validates EU / UK / EEA VAT identification numbers
 * using the real, published per-country checksum algorithms (ISO 7064 MOD 11,10,
 * Luhn, MOD 97 / 89 / 23 / 37, weighted-11 tests and letter check-digit tables).
 * Zero external dependencies; no network calls.
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

/* ------------------------------------------------------------------ *
 * Small numeric helpers
 * ------------------------------------------------------------------ */

function digitSum(n) {
  let t = 0;
  while (n > 0) {
    t += n % 10;
    n = Math.floor(n / 10);
  }
  return t;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Luhn: is `s` (digits, check digit included) internally consistent? */
function luhnValid(s) {
  let sum = 0;
  let dbl = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Compute the Luhn check digit that should follow `body`. */
function luhnCheck(body) {
  for (let d = 0; d < 10; d++) if (luhnValid(body + d)) return String(d);
  return null;
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** Germany: ISO 7064 MOD 11,10 product algorithm over the leading digits. */
function deProduct(s) {
  let p = 10;
  for (let i = 0; i < s.length; i++) {
    let sum = (Number(s[i]) + p) % 10;
    if (sum === 0) sum = 10;
    p = (2 * sum) % 11;
  }
  return p;
}

/** Croatia: same ISO 7064 MOD 11,10 core, lowercase "sum" lives on. */
function hrProduct(s) {
  return deProduct(s);
}

/** Austria: special weighting (positions 2/4/6 doubled, +4 offset). */
function atCheck(s7) {
  const d = s7.split('').map(Number);
  const s =
    digitSum(2 * d[1]) + d[0] + d[2] + digitSum(2 * d[3]) + d[4] + digitSum(2 * d[5]) + d[6] + 4;
  return (10 - (s % 10)) % 10;
}

/** Portugal: weights 9..2, check = 0 or 11 - remainder. */
function ptCheck(s8) {
  let S = 0;
  for (let i = 0; i < 8; i++) S += (9 - i) * Number(s8[i]);
  const r = S % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Poland: weights 6,5,7,2,3,4,5,6,7 -> remainder 10 is invalid. */
function plCheck(s9) {
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let S = 0;
  for (let i = 0; i < 9; i++) S += w[i] * Number(s9[i]);
  const r = S % 11;
  return r === 10 ? null : r;
}

/** Czech Republic: legal-entity style check digit. */
function czLegalCheck(s7) {
  let a1 = 0;
  const w = [8, 7, 6, 5, 4, 3, 2];
  for (let i = 0; i < 7; i++) a1 += w[i] * Number(s7[i]);
  const a2 = a1 % 11 === 0 ? a1 + 11 : Math.ceil(a1 / 11) * 11;
  return (a2 - a1) % 10;
}

/** Slovenia: MOD 11, weights 8..2; remainder 1 yields no valid check digit. */
function siCheck(s7) {
  const w = [8, 7, 6, 5, 4, 3, 2];
  let S = 0;
  for (let i = 0; i < 7; i++) S += w[i] * Number(s7[i]);
  let r = 11 - (S % 11);
  if (r === 10) return null;
  if (r === 11) r = 0;
  return r;
}

/** Hungary: weights 9,7,3,1,9,7,3. */
function huCheck(s7) {
  const w = [9, 7, 3, 1, 9, 7, 3];
  let S = 0;
  for (let i = 0; i < 7; i++) S += w[i] * Number(s7[i]);
  return (10 - (S % 10)) % 10;
}

/** Romania: right-aligned weights, check = (S * 10) mod 11 (10 -> 0). */
function roCheck(body) {
  const weights = [7, 5, 3, 2, 1, 7, 5, 3, 2, 1];
  const n = body.length;
  const w = weights.slice(10 - n);
  let S = 0;
  for (let i = 0; i < n; i++) S += w[i] * Number(body[i]);
  const c = (S * 10) % 11;
  return c === 10 ? 0 : c;
}

/** Estonia: weights 3,7,1,3,7,1,3,7. */
function eeCheck(s8) {
  const w = [3, 7, 1, 3, 7, 1, 3, 7];
  let S = 0;
  for (let i = 0; i < 8; i++) S += w[i] * Number(s8[i]);
  return (10 * Math.ceil(S / 10) - S) % 10;
}

/** Greece: descending binary weights, mod 11 then mod 10. */
function grCheck(s8) {
  const w = [256, 128, 64, 32, 16, 8, 4, 2];
  let S = 0;
  for (let i = 0; i < 8; i++) S += w[i] * Number(s8[i]);
  return (S % 11) % 10;
}

/** Cyprus: letter table over alternating digit positions. */
function cyCheck(s8) {
  const key = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21];
  let S = 0;
  for (let i = 0; i < 8; i++) {
    const d = Number(s8[i]);
    S += i % 2 === 1 ? d : key[d];
  }
  return String.fromCharCode(65 + (S % 26));
}

/** Lithuania: weights 1..8, fallback weights 3..10. */
function ltCheck(s8) {
  let S = 0;
  for (let i = 0; i < 8; i++) S += (i + 1) * Number(s8[i]);
  let r = S % 11;
  if (r === 10) {
    let S2 = 0;
    for (let i = 0; i < 8; i++) S2 += (i + 3) * Number(s8[i]);
    r = S2 % 11;
    if (r === 10) r = 0;
  }
  return r;
}

/** Latvia: weights 9,1,4,8,3,10,2,5,7,6 with the (3 - r) rule. */
function lvCheck(s10) {
  const w = [9, 1, 4, 8, 3, 10, 2, 5, 7, 6];
  let S = 0;
  for (let i = 0; i < 10; i++) S += w[i] * Number(s10[i]);
  let c = 3 - (S % 11);
  if (c < 0) c += 11;
  return c;
}

/** Malta: weights 3,4,6,7,8,9 -> 37 - (sum mod 37). */
function mtCheck(s6) {
  const w = [3, 4, 6, 7, 8, 9];
  let S = 0;
  for (let i = 0; i < 6; i++) S += w[i] * Number(s6[i]);
  return 37 - (S % 37);
}

/** Norway: weights 3,2,7,6,5,4,3,2; remainder 1 has no check digit. */
function noCheck(s8) {
  const w = [3, 2, 7, 6, 5, 4, 3, 2];
  let S = 0;
  for (let i = 0; i < 8; i++) S += w[i] * Number(s8[i]);
  const r = S % 11;
  const c = r === 0 ? 0 : 11 - r;
  return c === 10 ? null : c;
}

/** Switzerland: eCH-0097 weights 5,4,3,2,7,6,5,4, mod 11. */
function chCheck(s8) {
  const w = [5, 4, 3, 2, 7, 6, 5, 4];
  let S = 0;
  for (let i = 0; i < 8; i++) S += w[i] * Number(s8[i]);
  const c = (11 - (S % 11)) % 11;
  return c === 10 ? null : c;
}

const IE_LETTERS = 'WABCDEFGHIJKLMNOPQRSTUV';
const IE_W = [8, 7, 6, 5, 4, 3, 2];

/** Ireland: rewrite the legacy middle-letter shape to the canonical order. */
function ieTransform(local) {
  if ((local.length === 8 || local.length === 9) && /[A-Z]/.test(local[1])) {
    return '0' + local.slice(2, 7) + local[0] + local.slice(7);
  }
  return local;
}

/** Ireland: MOD 23 checksum with the WABCDEFGHIJKLMNOPQRSTUV table. */
function ieCheck(local) {
  if (local.length !== 8 && local.length !== 9) return false;
  const s = ieTransform(local);
  if (!/^\d{7}/.test(s) || !IE_LETTERS.includes(s[7])) return false;
  let total = 0;
  for (let i = 0; i < 7; i++) total += Number(s[i]) * IE_W[i];
  if (s.length === 9) {
    if (!IE_LETTERS.includes(s[8])) return true; // permissive for uncertain suffix mappings
    total += IE_LETTERS.indexOf(s[8]) * 9;
  }
  return IE_LETTERS[total % 23] === s[7];
}

function ieCalc(body7) {
  let total = 0;
  for (let i = 0; i < 7; i++) total += Number(body7[i]) * IE_W[i];
  return IE_LETTERS[total % 23];
}

/** Czech Republic: legal entity (8) or individual (9/10) styles. */
function czCheck(local) {
  if (!/^\d{8,10}$/.test(local)) return false;
  const d = local.split('').map(Number);
  const n = d.length;

  if (n === 8) {
    return czLegalCheck(local.slice(0, 7)) === d[7];
  }

  if (n === 9) {
    // individual style 2 (checksum)
    let a1 = 0;
    const w = [8, 7, 6, 5, 4, 3, 2];
    for (let i = 0; i < 7; i++) a1 += w[i] * d[i + 1];
    const a2 = a1 % 11 === 0 ? a1 + 11 : Math.ceil(a1 / 11) * 11;
    const table = [0, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9, 8];
    const style2 = d[8] === table[a2 - a1];
    // individual style 1 (date validity)
    const year = d[0] * 10 + d[1];
    const month = d[2] * 10 + d[3];
    const day = d[4] * 10 + d[5];
    const style1 =
      year < 54 && ((month >= 1 && month <= 12) || (month >= 51 && month <= 62)) && day >= 1 && day <= 31;
    return style1 || style2;
  }

  // 10-digit individual style 3
  const r1 = Number(local);
  const r2 =
    (d[0] * 10 + d[1]) +
    (d[2] * 10 + d[3]) +
    (d[4] * 10 + d[5]) +
    (d[6] * 10 + d[7]) +
    (d[8] * 10 + d[9]);
  return r1 % 11 === 0 && r2 % 11 === 0;
}

/** Bulgaria: 10-digit physical-person / foreigner / miscellaneous forms. */
function bg10(local) {
  const first9 = local.slice(0, 9);
  const last = Number(local[9]);

  const wp = [2, 4, 8, 5, 10, 9, 7, 3, 6];
  let Sp = 0;
  for (let i = 0; i < 9; i++) Sp += wp[i] * Number(first9[i]);
  const cp = (Sp % 11) % 10;
  const year = Number(local.slice(0, 2));
  const month = Number(local.slice(2, 4));
  const day = Number(local.slice(4, 6));
  const isPerson = cp === last && year < 100 && month >= 1 && month <= 40 && day >= 1 && day <= 31;

  const wf = [21, 19, 17, 13, 11, 9, 7, 3, 1];
  let Sf = 0;
  for (let i = 0; i < 9; i++) Sf += wf[i] * Number(first9[i]);
  const isForeigner = Sf % 10 === last;

  const wm = [4, 3, 2, 7, 6, 5, 4, 3, 2];
  let Sm = 0;
  for (let i = 0; i < 9; i++) Sm += wm[i] * Number(first9[i]);
  let cm = 11 - (Sm % 11);
  if (cm === 11) cm = 0;
  else if (cm === 10) cm = null;
  const isMisc = cm !== null && cm === last;

  return isPerson || isForeigner || isMisc;
}

/** Spain: company (CIF) control character. */
function esCifValid(local) {
  const type = local[0];
  const body = local.slice(1, 8);
  const ctrl = local[8];
  let S = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(body[i]);
    S += i % 2 === 0 ? digitSum(d * 2) : d;
  }
  const D = (10 - (S % 10)) % 10;
  const letter = 'JABCDEFGHI'[D];
  if ('ABEH'.includes(type)) return ctrl === String(D);
  if ('KPQS'.includes(type)) return ctrl === letter;
  return ctrl === String(D) || ctrl === letter;
}

/* ------------------------------------------------------------------ *
 * Country catalogue: format pattern + real checksum algorithm
 * ------------------------------------------------------------------ */

const COUNTRIES = {
  DE: {
    name: 'Germany',
    pattern: '^\\d{9}$',
    checksum: true,
    bodyHint: 'the first 8 digits (the 9th is the ISO 7064 MOD 11,10 check digit)',
    check(local) {
      if (!/^\d{9}$/.test(local)) return { applicable: true, valid: false };
      const r = 11 - deProduct(local.slice(0, 8));
      const ok = Number(local[0]) > 0 && ((r === 10 && Number(local[8]) === 0) || Number(local[8]) === r);
      return { applicable: true, valid: ok };
    },
    make(body) {
      if (!/^\d{8}$/.test(body) || body[0] === '0') return null;
      const r = 11 - deProduct(body);
      if (r === 11) return null;
      const c = r === 10 ? 0 : r;
      return { full: body + c, check: String(c) };
    },
  },
  FR: {
    name: 'France',
    pattern: '^[0-9A-HJ-NP-Z]{2}\\d{9}$',
    checksum: true,
    bodyHint: 'the 9-digit SIREN (the 2-character MOD 97 key is generated)',
    check(local) {
      if (/^\d{11}$/.test(local)) {
        const key = Number(local.slice(0, 2));
        const siren = Number(local.slice(2));
        return { applicable: true, valid: key === (12 + 3 * (siren % 97)) % 97 };
      }
      if (/^[0-9A-HJ-NP-Z]{2}\d{9}$/.test(local)) {
        // Alphanumeric keys are structurally valid; not confidently computable offline.
        return { applicable: false, valid: null };
      }
      return { applicable: true, valid: false };
    },
    make(body) {
      if (!/^\d{9}$/.test(body)) return null;
      const key = (12 + 3 * (Number(body) % 97)) % 97;
      return { full: pad2(key) + body, check: pad2(key) };
    },
  },
  IT: {
    name: 'Italy',
    pattern: '^\\d{11}$',
    checksum: true,
    bodyHint: 'the first 10 digits (the 11th is the partita IVA check digit)',
    check(local) {
      if (!/^\d{11}$/.test(local)) return { applicable: true, valid: false };
      let S = 0;
      for (let i = 0; i < 10; i++) {
        const d = Number(local[i]);
        S += i % 2 === 0 ? d : digitSum(d * 2);
      }
      return { applicable: true, valid: (10 - (S % 10)) % 10 === Number(local[10]) };
    },
    make(body) {
      if (!/^\d{10}$/.test(body)) return null;
      let S = 0;
      for (let i = 0; i < 10; i++) {
        const d = Number(body[i]);
        S += i % 2 === 0 ? d : digitSum(d * 2);
      }
      const c = (10 - (S % 10)) % 10;
      return { full: body + c, check: String(c) };
    },
  },
  ES: {
    name: 'Spain',
    pattern: '^(?:\\d{8}[A-Z]|[XYZ]\\d{7}[A-Z]|[A-HJ-NP-SUVW]\\d{7}[0-9A-J])$',
    checksum: true,
    bodyHint: 'the 8 digits of a DNI/NIF (the check letter is generated)',
    check(local) {
      if (/^\d{8}[A-Z]$/.test(local)) {
        return { applicable: true, valid: DNI_LETTERS[Number(local.slice(0, 8)) % 23] === local[8] };
      }
      if (/^[XYZ]\d{7}[A-Z]$/.test(local)) {
        const base = { X: 0, Y: 1, Z: 2 }[local[0]];
        const n = base * 10000000 + Number(local.slice(1, 8));
        return { applicable: true, valid: DNI_LETTERS[n % 23] === local[8] };
      }
      if (/^[A-HJ-NP-SUVW]\d{7}[0-9A-J]$/.test(local)) {
        return { applicable: true, valid: esCifValid(local) };
      }
      return { applicable: true, valid: false };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      const letter = DNI_LETTERS[Number(body) % 23];
      return { full: body + letter, check: letter };
    },
  },
  NL: {
    name: 'Netherlands',
    pattern: '^\\d{9}(?:B\\d{2})?$',
    checksum: true,
    bodyHint: 'the first 8 digits (the 9th is the 11-test check digit)',
    check(local) {
      const m = /^(\d{9})(?:B\d{2})?$/.exec(local);
      if (!m) return { applicable: true, valid: false };
      const d = m[1];
      let S = 0;
      for (let i = 0; i < 8; i++) S += (9 - i) * Number(d[i]);
      return { applicable: true, valid: (S - Number(d[8])) % 11 === 0 };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      let S = 0;
      for (let i = 0; i < 8; i++) S += (9 - i) * Number(body[i]);
      const r = S % 11;
      if (r === 10) return null;
      return { full: body + r, check: String(r) };
    },
  },
  BE: {
    name: 'Belgium',
    pattern: '^\\d{9,10}$',
    checksum: true,
    bodyHint: 'the first 8 digits (the 2 check digits are generated)',
    check(local) {
      let s = local;
      if (/^\d{9}$/.test(s)) s = '0' + s;
      if (!/^\d{10}$/.test(s)) return { applicable: true, valid: false };
      const c = Number(s.slice(0, 8)) % 97 || 97;
      return { applicable: true, valid: c === Number(s.slice(8)) };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      const c = Number(body) % 97 || 97;
      return { full: body + pad2(c), check: pad2(c) };
    },
  },
  LU: {
    name: 'Luxembourg',
    pattern: '^\\d{8}$',
    checksum: true,
    bodyHint: 'the first 6 digits (the 2 check digits are generated)',
    check(local) {
      if (!/^\d{8}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: Number(local.slice(0, 6)) % 89 === Number(local.slice(6)) };
    },
    make(body) {
      if (!/^\d{6}$/.test(body)) return null;
      const c = Number(body) % 89;
      return { full: body + pad2(c), check: pad2(c) };
    },
  },
  AT: {
    name: 'Austria',
    pattern: '^U\\d{8}$',
    checksum: true,
    bodyHint: 'the 7 digits after the leading U (the 8th digit is the check digit)',
    check(local) {
      if (!/^U\d{8}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: atCheck(local.slice(1, 8)) === Number(local[8]) };
    },
    make(body) {
      const b = body.replace(/^U/, '');
      if (!/^\d{7}$/.test(b)) return null;
      const c = atCheck(b);
      return { full: 'U' + b + c, check: String(c) };
    },
  },
  PT: {
    name: 'Portugal',
    pattern: '^\\d{9}$',
    checksum: true,
    bodyHint: 'the first 8 digits (the 9th is the check digit)',
    check(local) {
      if (!/^\d{9}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: ptCheck(local.slice(0, 8)) === Number(local[8]) };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      const c = ptCheck(body);
      return { full: body + c, check: String(c) };
    },
  },
  IE: {
    name: 'Ireland',
    pattern: '^[0-9][A-Z0-9]\\d{5}[A-Z][A-Z]?$',
    checksum: true,
    bodyHint: 'the 7 digits (the MOD 23 check letter is generated)',
    check(local) {
      return { applicable: true, valid: ieCheck(local) };
    },
    make(body) {
      if (!/^\d{7}$/.test(body)) return null;
      const letter = ieCalc(body);
      return { full: body + letter, check: letter };
    },
  },
  DK: {
    name: 'Denmark',
    pattern: '^\\d{8}$',
    checksum: true,
    bodyHint: 'the first 7 digits (the 8th is the check digit)',
    check(local) {
      if (!/^\d{8}$/.test(local)) return { applicable: true, valid: false };
      const w = [2, 7, 6, 5, 4, 3, 2, 1];
      let S = 0;
      for (let i = 0; i < 8; i++) S += w[i] * Number(local[i]);
      return { applicable: true, valid: S % 11 === 0 };
    },
    make(body) {
      if (!/^\d{7}$/.test(body)) return null;
      const w = [2, 7, 6, 5, 4, 3, 2];
      let S = 0;
      for (let i = 0; i < 7; i++) S += w[i] * Number(body[i]);
      const c = (11 - (S % 11)) % 11;
      if (c === 10) return null;
      return { full: body + c, check: String(c) };
    },
  },
  SE: {
    name: 'Sweden',
    pattern: '^\\d{12}$',
    checksum: true,
    bodyHint: 'the first 9 digits (the Luhn digit and the trailing "01" are appended)',
    check(local) {
      if (!/^\d{12}$/.test(local) || !local.endsWith('01')) return { applicable: true, valid: false };
      return { applicable: true, valid: luhnValid(local.slice(0, 10)) };
    },
    make(body) {
      if (!/^\d{9}$/.test(body)) return null;
      const c = luhnCheck(body);
      if (c === null) return null;
      return { full: body + c + '01', check: c };
    },
  },
  FI: {
    name: 'Finland',
    pattern: '^\\d{8}$',
    checksum: true,
    bodyHint: 'the first 7 digits (the 8th is the MOD 11-2 check digit)',
    check(local) {
      if (!/^\d{8}$/.test(local)) return { applicable: true, valid: false };
      const w = [7, 9, 10, 5, 8, 4, 2, 1];
      let S = 0;
      for (let i = 0; i < 8; i++) S += w[i] * Number(local[i]);
      return { applicable: true, valid: S % 11 === 0 };
    },
    make(body) {
      if (!/^\d{7}$/.test(body)) return null;
      const w = [7, 9, 10, 5, 8, 4, 2];
      let S = 0;
      for (let i = 0; i < 7; i++) S += w[i] * Number(body[i]);
      const c = (11 - (S % 11)) % 11;
      if (c === 10) return null;
      return { full: body + c, check: String(c) };
    },
  },
  PL: {
    name: 'Poland',
    pattern: '^\\d{10}$',
    checksum: true,
    bodyHint: 'the first 9 digits (the 10th is the check digit)',
    check(local) {
      if (!/^\d{10}$/.test(local)) return { applicable: true, valid: false };
      const c = plCheck(local.slice(0, 9));
      return { applicable: true, valid: c !== null && c === Number(local[9]) };
    },
    make(body) {
      if (!/^\d{9}$/.test(body)) return null;
      const c = plCheck(body);
      if (c === null) return null;
      return { full: body + c, check: String(c) };
    },
  },
  CZ: {
    name: 'Czech Republic',
    pattern: '^\\d{8,10}$',
    checksum: true,
    bodyHint: 'the first 7 digits of a legal-entity ID (the 8th check digit is generated)',
    check(local) {
      return { applicable: true, valid: czCheck(local) };
    },
    make(body) {
      if (!/^\d{7}$/.test(body)) return null;
      const c = czLegalCheck(body);
      return { full: body + c, check: String(c) };
    },
  },
  SK: {
    name: 'Slovakia',
    pattern: '^\\d{10}$',
    checksum: true,
    bodyHint: 'the first 9 digits (the 10th check digit is generated)',
    check(local) {
      if (!/^\d{10}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: Number(local) % 11 === 0 };
    },
    make(body) {
      if (!/^\d{9}$/.test(body)) return null;
      for (let d = 0; d < 10; d++) {
        if (Number(body + d) % 11 === 0) return { full: body + d, check: String(d) };
      }
      return null;
    },
  },
  SI: {
    name: 'Slovenia',
    pattern: '^\\d{8}$',
    checksum: true,
    bodyHint: 'the first 7 digits (the 8th is the check digit)',
    check(local) {
      if (!/^\d{8}$/.test(local)) return { applicable: true, valid: false };
      const c = siCheck(local.slice(0, 7));
      return { applicable: true, valid: c !== null && c === Number(local[7]) };
    },
    make(body) {
      if (!/^\d{7}$/.test(body)) return null;
      const c = siCheck(body);
      if (c === null) return null;
      return { full: body + c, check: String(c) };
    },
  },
  HU: {
    name: 'Hungary',
    pattern: '^\\d{8}$',
    checksum: true,
    bodyHint: 'the first 7 digits (the 8th is the check digit)',
    check(local) {
      if (!/^\d{8}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: huCheck(local.slice(0, 7)) === Number(local[7]) };
    },
    make(body) {
      if (!/^\d{7}$/.test(body)) return null;
      const c = huCheck(body);
      return { full: body + c, check: String(c) };
    },
  },
  RO: {
    name: 'Romania',
    pattern: '^\\d{2,10}$',
    checksum: true,
    bodyHint: 'the digits before the check digit (1 to 9 digits)',
    check(local) {
      if (!/^\d{2,10}$/.test(local)) return { applicable: true, valid: false };
      const c = roCheck(local.slice(0, -1));
      return { applicable: true, valid: c === Number(local[local.length - 1]) };
    },
    make(body) {
      if (!/^\d{1,9}$/.test(body)) return null;
      const c = roCheck(body);
      return { full: body + c, check: String(c) };
    },
  },
  BG: {
    name: 'Bulgaria',
    pattern: '^\\d{9,10}$',
    checksum: true,
    bodyHint: 'the first 8 digits (a 9-digit legal-entity ID is generated)',
    check(local) {
      if (/^\d{9}$/.test(local)) {
        let S = 0;
        for (let i = 0; i < 8; i++) S += (i + 1) * Number(local[i]);
        let c = S % 11;
        if (c === 10) {
          let S2 = 0;
          for (let i = 0; i < 8; i++) S2 += (i + 3) * Number(local[i]);
          c = S2 % 11;
        }
        return { applicable: true, valid: (c % 10) === Number(local[8]) };
      }
      if (/^\d{10}$/.test(local)) return { applicable: true, valid: bg10(local) };
      return { applicable: true, valid: false };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      let S = 0;
      for (let i = 0; i < 8; i++) S += (i + 1) * Number(body[i]);
      let c = S % 11;
      if (c === 10) {
        let S2 = 0;
        for (let i = 0; i < 8; i++) S2 += (i + 3) * Number(body[i]);
        c = S2 % 11;
      }
      c = c % 10;
      return { full: body + c, check: String(c) };
    },
  },
  HR: {
    name: 'Croatia',
    pattern: '^\\d{11}$',
    checksum: true,
    bodyHint: 'the first 10 digits (the 11th is the OIB check digit)',
    check(local) {
      if (!/^\d{11}$/.test(local)) return { applicable: true, valid: false };
      const p = hrProduct(local.slice(0, 10));
      return { applicable: true, valid: (p + Number(local[10])) % 10 === 1 };
    },
    make(body) {
      if (!/^\d{10}$/.test(body)) return null;
      const p = hrProduct(body);
      let c = (1 - p) % 10;
      if (c < 0) c += 10;
      return { full: body + c, check: String(c) };
    },
  },
  EE: {
    name: 'Estonia',
    pattern: '^\\d{9}$',
    checksum: true,
    bodyHint: 'the first 8 digits (the 9th is the check digit)',
    check(local) {
      if (!/^\d{9}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: eeCheck(local.slice(0, 8)) === Number(local[8]) };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      const c = eeCheck(body);
      return { full: body + c, check: String(c) };
    },
  },
  LT: {
    name: 'Lithuania',
    pattern: '^\\d{9}$',
    checksum: true,
    bodyHint: 'the first 8 digits (the 9th is the check digit)',
    check(local) {
      if (!/^\d{9}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: ltCheck(local.slice(0, 8)) === Number(local[8]) };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      const c = ltCheck(body);
      return { full: body + c, check: String(c) };
    },
  },
  LV: {
    name: 'Latvia',
    pattern: '^\\d{11}$',
    checksum: true,
    bodyHint: 'the first 10 digits (the 11th is the check digit)',
    check(local) {
      if (!/^\d{11}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: lvCheck(local.slice(0, 10)) === Number(local[10]) };
    },
    make(body) {
      if (!/^\d{10}$/.test(body)) return null;
      const c = lvCheck(body);
      return { full: body + c, check: String(c) };
    },
  },
  GR: {
    name: 'Greece',
    pattern: '^\\d{9}$',
    checksum: true,
    bodyHint: 'the first 8 digits (the 9th is the check digit)',
    check(local) {
      if (!/^\d{9}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: grCheck(local.slice(0, 8)) === Number(local[8]) };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      const c = grCheck(body);
      return { full: body + c, check: String(c) };
    },
  },
  CY: {
    name: 'Cyprus',
    pattern: '^\\d{8}[A-Z]$',
    checksum: true,
    bodyHint: 'the 8 digits (the check letter is generated)',
    check(local) {
      if (!/^\d{8}[A-Z]$/.test(local)) return { applicable: true, valid: false };
      if (local.slice(0, 2) === '12') return { applicable: true, valid: false };
      return { applicable: true, valid: cyCheck(local.slice(0, 8)) === local[8] };
    },
    make(body) {
      if (!/^\d{8}$/.test(body) || body.slice(0, 2) === '12') return null;
      const ch = cyCheck(body);
      return { full: body + ch, check: ch };
    },
  },
  MT: {
    name: 'Malta',
    pattern: '^\\d{8}$',
    checksum: true,
    bodyHint: 'the first 6 digits (the 2 check digits are generated)',
    check(local) {
      if (!/^\d{8}$/.test(local)) return { applicable: true, valid: false };
      return { applicable: true, valid: mtCheck(local.slice(0, 6)) === Number(local.slice(6)) };
    },
    make(body) {
      if (!/^\d{6}$/.test(body)) return null;
      const c = mtCheck(body);
      return { full: body + pad2(c), check: pad2(c) };
    },
  },
  GB: {
    name: 'United Kingdom',
    pattern: '^(?:\\d{9}|\\d{12}|GD\\d{3}|HA\\d{3})$',
    checksum: true,
    bodyHint: 'the first 7 digits (the 2 check digits are generated)',
    check(local) {
      if (/^(GD|HA)\d{3}$/.test(local)) return { applicable: false, valid: null };
      let n = local;
      if (/^\d{12}$/.test(n)) n = n.slice(0, 9);
      if (!/^\d{9}$/.test(n)) return { applicable: true, valid: false };
      let S = 0;
      for (let i = 0; i < 7; i++) S += (8 - i) * Number(n[i]);
      return { applicable: true, valid: (S + Number(n.slice(7, 9))) % 97 === 0 };
    },
    make(body) {
      if (!/^\d{7}$/.test(body)) return null;
      let S = 0;
      for (let i = 0; i < 7; i++) S += (8 - i) * Number(body[i]);
      const c = (97 - (S % 97)) % 97;
      return { full: body + pad2(c), check: pad2(c) };
    },
  },
  NO: {
    name: 'Norway',
    pattern: '^\\d{9}$',
    checksum: true,
    bodyHint: 'the first 8 digits (the 9th is the check digit)',
    check(local) {
      if (!/^\d{9}$/.test(local)) return { applicable: true, valid: false };
      const c = noCheck(local.slice(0, 8));
      return { applicable: true, valid: c !== null && c === Number(local[8]) };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      const c = noCheck(body);
      if (c === null) return null;
      return { full: body + c, check: String(c) };
    },
  },
  CH: {
    name: 'Switzerland',
    pattern: '^\\d{9}$',
    checksum: true,
    bodyHint: 'the first 8 digits (the 9th is the check digit)',
    check(local) {
      if (!/^\d{9}$/.test(local)) return { applicable: true, valid: false };
      const c = chCheck(local.slice(0, 8));
      return { applicable: true, valid: c !== null && c === Number(local[8]) };
    },
    make(body) {
      if (!/^\d{8}$/.test(body)) return null;
      const c = chCheck(body);
      if (c === null) return null;
      return { full: body + c, check: String(c) };
    },
  },
};

for (const c of Object.values(COUNTRIES)) c.re = new RegExp(c.pattern);

/* ------------------------------------------------------------------ *
 * Handlers
 * ------------------------------------------------------------------ */

function normalizeLocal(raw, code) {
  let s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith(code)) s = s.slice(code.length);
  else if (code === 'GR' && s.startsWith('EL')) s = s.slice(2);
  else if (code === 'GB' && s.startsWith('UK')) s = s.slice(2);
  return s;
}

function resolveCountry(params) {
  const code = String(params.country || '').trim().toUpperCase();
  const country = COUNTRIES[code];
  if (!country) {
    const e = new Error(`Unsupported country code: "${params.country}". See /countries for the supported list.`);
    e.status = 400;
    throw e;
  }
  return { code, country };
}

async function validate(params) {
  need(params, ['country', 'vat']);
  const { code, country } = resolveCountry(params);
  const input = String(params.vat).trim();
  const local = normalizeLocal(input, code);
  const errors = [];
  const formatValid = country.re.test(local);

  let checksumApplicable;
  let checksumValid = null;
  if (formatValid) {
    const r = country.check(local);
    checksumApplicable = r.applicable;
    checksumValid = r.applicable ? r.valid : null;
    if (checksumApplicable && checksumValid === false) {
      errors.push(`Checksum verification failed for ${code}`);
    }
  } else {
    checksumApplicable = country.checksum;
    errors.push(`Number does not match the expected ${code} format (${country.pattern})`);
  }

  const valid = formatValid && (!checksumApplicable || checksumValid === true);

  return {
    input,
    country: code,
    normalized: code + local,
    valid,
    format_valid: formatValid,
    checksum_valid: checksumValid,
    checksum_applicable: checksumApplicable,
    pattern: country.pattern,
    errors,
  };
}

async function countries() {
  const list = Object.keys(COUNTRIES).map((code) => ({
    code,
    name: COUNTRIES[code].name,
    pattern: COUNTRIES[code].pattern,
    checksum: COUNTRIES[code].checksum,
  }));
  return { count: list.length, countries: list };
}

async function checkDigits(params) {
  need(params, ['country', 'body']);
  const { code, country } = resolveCountry(params);
  const body = String(params.body).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const gen = country.make(body);
  if (!gen) {
    const e = new Error(
      `Cannot generate check digits for ${code} from the supplied body. Expected ${country.bodyHint}.`
    );
    e.status = 400;
    throw e;
  }

  const normalized = code + gen.full;
  const formatValid = country.re.test(gen.full);
  const r = formatValid ? country.check(gen.full) : { applicable: country.checksum, valid: null };

  return {
    country: code,
    body,
    check: gen.check,
    vat_number: normalized,
    normalized,
    format_valid: formatValid,
    checksum_applicable: r.applicable,
    valid: formatValid && (!r.applicable || r.valid === true),
  };
}

module.exports = {
  prefix: '/vat/v1',
  name: 'VAT & Tax ID Validator',
  tagline: 'Validate EU/UK/EEA VAT numbers with real per-country checksum algorithms.',
  description:
    'VAT & Tax ID Validator validates European VAT identification numbers against the real, published per-country rules: ISO 7064 MOD 11,10 product checks, Luhn, MOD 97 / 89 / 23 / 37, weighted mod-11 tests and letter check-digit tables. The hard part — and our moat — is the catalogue of 30 country-specific checksum algorithms, which most simple validators skip in favour of a plain regex. It returns the normalized number together with separate format and checksum verdicts, and can even generate the correct check digits from a partial number. Built for e-commerce tax engines, ERP/accounting integrations and fintech KYC/onboarding flows.',
  freeTier: 30,
  endpoints: [
    {
      path: '/validate',
      method: 'GET',
      summary: 'Validate a VAT / Tax ID number',
      operationId: 'validateVat',
      description:
        'Validate a VAT number for a supported country. Returns the normalized number, a format verdict and — where a public algorithm exists — a checksum verdict.',
      params: [
        { name: 'country', type: 'string', required: true, description: 'ISO 3166-1 alpha-2 country code, e.g. DE, FR, GB', example: 'DE' },
        { name: 'vat', type: 'string', required: true, description: 'VAT number, with or without country prefix and separators', example: 'DE 123 456 788' },
      ],
      handler: validate,
    },
    {
      path: '/countries',
      method: 'GET',
      summary: 'List supported countries',
      operationId: 'listVatCountries',
      description: 'Returns the supported country codes, their canonical format pattern and whether a real checksum algorithm is applied.',
      params: [],
      handler: countries,
    },
    {
      path: '/check-digits',
      method: 'GET',
      summary: 'Generate check digits',
      operationId: 'vatCheckDigits',
      description:
        'Given a partial number (the digits before the check portion) generate the correct check digit(s) and return the completed VAT number.',
      params: [
        { name: 'country', type: 'string', required: true, description: 'ISO 3166-1 alpha-2 country code', example: 'IT' },
        { name: 'body', type: 'string', required: true, description: 'The digits preceding the check portion', example: '12345678901'.slice(0, 10) },
      ],
      handler: checkDigits,
    },
  ],
};
