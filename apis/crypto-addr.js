'use strict';

/**
 * Crypto Address Validator — offline multi-chain address validation.
 *
 * Everything is implemented from scratch with Node built-ins only (no network,
 * no external packages): Base58 (Bitcoin + Ripple alphabets), Base58Check
 * (double-SHA256), Bech32 / Bech32m (BIP-173 / BIP-350), Keccak-256 for the
 * Ethereum EIP-55 checksum, and Polkadot SS58 (blake2b-512).
 */

const crypto = require('crypto');
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

/* ------------------------------------------------------------------ *
 * Keccak-256 — the original Keccak with padding byte 0x01, which is   *
 * DIFFERENT from SHA-3-256 (padding 0x06). Node's 'sha3-256' is NOT   *
 * Keccak-256, so it cannot be used for Ethereum's EIP-55 checksum.    *
 * ------------------------------------------------------------------ */

const KECCAK_MASK = (1n << 64n) - 1n;

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const KECCAK_ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const KECCAK_PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

function keccakRotl(x, n) {
  const s = BigInt(n % 64);
  if (s === 0n) return x & KECCAK_MASK;
  return ((x << s) | (x >> (64n - s))) & KECCAK_MASK;
}

function keccakF(st) {
  const bc = [0n, 0n, 0n, 0n, 0n];
  for (let round = 0; round < 24; round++) {
    for (let i = 0; i < 5; i++) bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ keccakRotl(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) st[j + i] ^= t;
    }
    let t = st[1];
    for (let i = 0; i < 24; i++) {
      const j = KECCAK_PILN[i];
      const tmp = st[j];
      st[j] = keccakRotl(t, KECCAK_ROTC[i]);
      t = tmp;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = st[j + i];
      for (let i = 0; i < 5; i++) st[j + i] = bc[i] ^ ((bc[(i + 1) % 5] ^ KECCAK_MASK) & bc[(i + 2) % 5]);
    }
    st[0] ^= KECCAK_RC[round];
  }
}

function keccak256(input) {
  const rate = 136; // 1088-bit rate for Keccak-256
  const st = new Array(25).fill(0n);
  const padded = Buffer.alloc(input.length + (rate - (input.length % rate)));
  input.copy(padded);
  padded[input.length] ^= 0x01;        // Keccak domain padding (NOT 0x06)
  padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) lane |= BigInt(padded[off + i * 8 + b]) << BigInt(8 * b);
      st[i] ^= lane;
    }
    keccakF(st);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    let lane = st[i];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Hashing helpers                                                     *
 * ------------------------------------------------------------------ */

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function dsha256(buf) {
  return sha256(sha256(buf));
}

/* ------------------------------------------------------------------ *
 * Base58 (Bitcoin + Ripple alphabets), decoded from scratch.          *
 * ------------------------------------------------------------------ */

const BASE58_BTC = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_XRP = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

function base58Decode(str, alphabet) {
  const ALPHA = alphabet || BASE58_BTC;
  if (typeof str !== 'string' || str.length === 0) return null;
  let num = 0n;
  const base = 58n;
  for (let i = 0; i < str.length; i++) {
    const idx = ALPHA.indexOf(str[i]);
    if (idx === -1) return null;
    num = num * base + BigInt(idx);
  }
  let zeros = 0;
  while (zeros < str.length && str[zeros] === ALPHA[0]) zeros++;
  let body;
  if (num === 0n) {
    body = Buffer.alloc(0);
  } else {
    let hex = num.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    body = Buffer.from(hex, 'hex');
  }
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

function base58CheckDecode(address, alphabet) {
  const raw = base58Decode(address, alphabet);
  if (!raw || raw.length < 5) return null;
  const body = raw.slice(0, raw.length - 4);
  const checksum = raw.slice(raw.length - 4);
  return { raw, body, checksum, checksumValid: checksum.equals(dsha256(body).slice(0, 4)) };
}

/* ------------------------------------------------------------------ *
 * Bech32 / Bech32m (BIP-173 + BIP-350), from scratch.                 *
 * ------------------------------------------------------------------ */

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_REV = {};
for (let i = 0; i < BECH32_CHARSET.length; i++) BECH32_REV[BECH32_CHARSET[i]] = i;
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= BECH32_GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

/** Returns { hrp, data (5-bit values, checksum stripped), encoding } or null. */
function bech32Decode(str, maxLen = 90) {
  if (typeof str !== 'string') return null;
  if (str.length < 8 || str.length > maxLen) return null;
  const lower = str.toLowerCase();
  if (str !== lower && str !== str.toUpperCase()) return null; // mixed case forbidden
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) return null;
  const hrp = lower.slice(0, pos);
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    if (c < 33 || c > 126) return null;
  }
  const data = [];
  for (let i = pos + 1; i < lower.length; i++) {
    const v = BECH32_REV[lower[i]];
    if (v === undefined) return null;
    data.push(v);
  }
  const chk = bech32Polymod(bech32HrpExpand(hrp).concat(data));
  let encoding = null;
  if (chk === BECH32_CONST) encoding = 'bech32';
  else if (chk === BECH32M_CONST) encoding = 'bech32m';
  if (!encoding) return null;
  return { hrp, data: data.slice(0, -6), encoding };
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    return null;
  }
  return ret;
}

/* ------------------------------------------------------------------ *
 * Chain definitions                                                   *
 * ------------------------------------------------------------------ */

// Version byte -> { type, network } for Base58Check chains.
const BASE58_CHAINS = {
  BTC: {
    name: 'Bitcoin',
    versions: {
      0x00: { type: 'P2PKH', network: 'mainnet' },
      0x05: { type: 'P2SH', network: 'mainnet' },
      0x6f: { type: 'P2PKH', network: 'testnet' },
      0xc4: { type: 'P2SH', network: 'testnet' },
    },
  },
  LTC: {
    name: 'Litecoin',
    versions: {
      0x30: { type: 'P2PKH', network: 'mainnet' },
      0x32: { type: 'P2SH', network: 'mainnet' },
      0x05: { type: 'P2SH', network: 'mainnet-legacy' },
      0x6f: { type: 'P2PKH', network: 'testnet' },
      0x3a: { type: 'P2SH', network: 'testnet' },
    },
  },
  DOGE: {
    name: 'Dogecoin',
    versions: {
      0x1e: { type: 'P2PKH', network: 'mainnet' },
      0x16: { type: 'P2SH', network: 'mainnet' },
      0x71: { type: 'P2PKH', network: 'testnet' },
      0xc4: { type: 'P2SH', network: 'testnet' },
    },
  },
  DASH: {
    name: 'Dash',
    versions: {
      0x4c: { type: 'P2PKH', network: 'mainnet' },
      0x10: { type: 'P2SH', network: 'mainnet' },
      0x8c: { type: 'P2PKH', network: 'testnet' },
      0x13: { type: 'P2SH', network: 'testnet' },
    },
  },
};

const SEGWIT_HRP = {
  bc: { chain: 'BTC', network: 'mainnet' },
  tb: { chain: 'BTC', network: 'testnet' },
  bcrt: { chain: 'BTC', network: 'regtest' },
  ltc: { chain: 'LTC', network: 'mainnet' },
  tltc: { chain: 'LTC', network: 'testnet' },
};

const SS58_PREFIX = Buffer.from('SS58PRE', 'ascii');

/* ------------------------------------------------------------------ *
 * Per-chain validators.                                               *
 * Each returns a normalized result or (for "shape" checks) null.      *
 * ------------------------------------------------------------------ */

function checkBase58Chain(address, chainKey) {
  const cfg = BASE58_CHAINS[chainKey];
  const dec = base58CheckDecode(address, BASE58_BTC);
  if (!dec) {
    return { valid: false, chain: chainKey, type: null, network: null, checksum_valid: false, errors: ['Not a valid Base58 string'] };
  }
  const errors = [];
  if (dec.body.length !== 21) {
    errors.push(`Unexpected payload length: ${dec.body.length} bytes (expected 21 = 1 version byte + 20-byte hash)`);
  }
  if (!dec.checksumValid) errors.push('Base58Check checksum mismatch (double-SHA256)');
  const version = dec.body[0];
  const info = cfg.versions[version];
  if (!info) {
    errors.push(`Unrecognized version byte 0x${version.toString(16).padStart(2, '0')} for ${chainKey}`);
  }
  return {
    valid: errors.length === 0,
    chain: chainKey,
    type: info ? info.type : null,
    network: info ? info.network : null,
    checksum_valid: dec.checksumValid,
    errors,
  };
}

function checkSegwit(address) {
  const dec = bech32Decode(address, 90);
  if (!dec) return null;
  const hrpInfo = SEGWIT_HRP[dec.hrp];
  if (!hrpInfo) return null;
  if (dec.data.length < 1) return null;
  const version = dec.data[0];
  if (version > 16) return null;
  const program = convertBits(dec.data.slice(1), 5, 8, false);
  if (program === null) return null;

  const errors = [];
  if (program.length < 2 || program.length > 40) errors.push('Witness program must be 2-40 bytes');
  if (version === 0 && program.length !== 20 && program.length !== 32) {
    errors.push('Witness v0 program must be 20 or 32 bytes');
  }
  if (version === 0 && dec.encoding !== 'bech32') errors.push('Witness v0 must use Bech32 (BIP-173)');
  if (version > 0 && dec.encoding !== 'bech32m') errors.push('Witness v1+ must use Bech32m (BIP-350)');

  let type;
  if (version === 0 && program.length === 20) type = 'P2WPKH';
  else if (version === 0 && program.length === 32) type = 'P2WSH';
  else if (version === 1 && program.length === 32) type = 'P2TR';
  else type = `WITNESS_V${version}`;

  return {
    valid: errors.length === 0,
    chain: hrpInfo.chain,
    type,
    network: hrpInfo.network,
    checksum_valid: true,
    errors,
  };
}

const ETH_RE = /^0x[0-9a-fA-F]{40}$/;

function checkEth(address) {
  if (typeof address !== 'string' || !ETH_RE.test(address)) {
    return {
      valid: false, chain: 'ETH', type: 'ERC20', network: 'mainnet', checksum_valid: false,
      errors: ['Expected "0x" followed by 40 hexadecimal characters'],
    };
  }
  const body = address.slice(2);
  const lower = body.toLowerCase();
  const hash = keccak256(Buffer.from(lower, 'ascii')).toString('hex');
  let checksummed = '';
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  const isLower = body === body.toLowerCase();
  const isUpper = body === body.toUpperCase();
  if (isLower || isUpper) {
    // Not checksummed, but structurally valid.
    return { valid: true, chain: 'ETH', type: 'ERC20', network: 'mainnet', checksum_valid: false, checksummed, errors: [] };
  }
  const ok = body === checksummed;
  return {
    valid: ok, chain: 'ETH', type: 'ERC20', network: 'mainnet', checksum_valid: ok, checksummed,
    errors: ok ? [] : ['EIP-55 checksum mismatch'],
  };
}

function checkTron(address) {
  if (typeof address !== 'string' || address[0] !== 'T') return null;
  const dec = base58CheckDecode(address, BASE58_BTC);
  if (!dec) return null;
  if (dec.body[0] !== 0x41) return null;
  const errors = [];
  if (dec.raw.length !== 25) errors.push(`Unexpected length: ${dec.raw.length} bytes (expected 25)`);
  if (!dec.checksumValid) errors.push('Base58Check checksum mismatch');
  return { valid: errors.length === 0, chain: 'TRON', type: 'TRC20', network: 'mainnet', checksum_valid: dec.checksumValid, errors };
}

function checkXrp(address) {
  if (typeof address !== 'string' || address[0] !== 'r') return null;
  const raw = base58Decode(address, BASE58_XRP);
  if (!raw || raw.length !== 25) return null;
  const body = raw.slice(0, 21);
  const checksum = raw.slice(21);
  const checksumValid = checksum.equals(dsha256(body).slice(0, 4));
  const errors = [];
  if (body[0] !== 0x00) errors.push('Unrecognized XRP version byte (expected 0x00 account id)');
  if (!checksumValid) errors.push('Base58Check checksum mismatch (double-SHA256)');
  return { valid: errors.length === 0, chain: 'XRP', type: 'XRP', network: 'mainnet', checksum_valid: checksumValid, errors };
}

function checkAda(address) {
  const dec = bech32Decode(address, 120);
  if (!dec) return null;
  if (dec.hrp !== 'addr' && dec.hrp !== 'addr_test') return null;
  const bytes = convertBits(dec.data, 5, 8, false);
  if (bytes === null) return null;
  const errors = [];
  if (bytes.length < 29 || bytes.length > 57) errors.push(`Unexpected payload length: ${bytes.length} bytes`);
  return {
    valid: errors.length === 0,
    chain: 'ADA',
    type: 'ADA',
    network: dec.hrp === 'addr' ? 'mainnet' : 'testnet',
    checksum_valid: true,
    errors,
  };
}

function checkSol(address) {
  const raw = base58Decode(address, BASE58_BTC);
  if (!raw || raw.length !== 32) return null;
  return { valid: true, chain: 'SOL', type: 'SOL', network: 'mainnet', checksum_valid: null, errors: [] };
}

function checkDot(address) {
  const raw = base58Decode(address, BASE58_BTC);
  if (!raw || raw.length < 4) return null;
  if (raw[0] >= 128) return null; // reserved prefix range
  const prefixLen = raw[0] < 64 ? 1 : 2;
  const total = raw.length;
  const account = raw.slice(prefixLen, total - 2);
  const checksum = raw.slice(total - 2);
  if (account.length !== 32) return null;
  let prefix;
  if (prefixLen === 1) prefix = raw[0];
  else prefix = ((raw[0] & 0x3f) << 2) | (raw[1] >> 6) | ((raw[1] & 0x3f) << 8);
  const hash = crypto
    .createHash('blake2b512')
    .update(Buffer.concat([SS58_PREFIX, raw.slice(0, prefixLen), account]))
    .digest();
  const ok = hash.slice(0, 2).equals(checksum);
  const errors = [];
  if (!ok) errors.push('SS58 checksum mismatch (blake2b-512 of "SS58PRE" + prefix + account)');
  const network = prefix === 0 ? 'polkadot' : prefix === 42 ? 'substrate' : `prefix-${prefix}`;
  return { valid: ok, chain: 'DOT', type: 'SS58', network, checksum_valid: ok, prefix, errors };
}

/* ------------------------------------------------------------------ *
 * Aggregation + dispatch                                              *
 * ------------------------------------------------------------------ */

function allMatches(address) {
  const out = [];
  for (const key of ['BTC', 'LTC', 'DOGE', 'DASH']) {
    const r = checkBase58Chain(address, key);
    if (r.valid) out.push(r);
  }
  const sw = checkSegwit(address);
  if (sw && sw.valid) out.push(sw);
  const eth = checkEth(address);
  if (eth.valid) out.push(eth);
  const tron = checkTron(address);
  if (tron && tron.valid) out.push(tron);
  const xrp = checkXrp(address);
  if (xrp && xrp.valid) out.push(xrp);
  const ada = checkAda(address);
  if (ada && ada.valid) out.push(ada);
  const sol = checkSol(address);
  if (sol && sol.valid) out.push(sol);
  const dot = checkDot(address);
  if (dot && dot.valid) out.push(dot);
  return out;
}

function strictOrNull(chain, type, network, result, fallbackError) {
  if (result) return result;
  return { valid: false, chain, type, network, checksum_valid: false, errors: [fallbackError] };
}

function validateForChain(address, chain) {
  switch (chain) {
    case 'BTC':
    case 'LTC':
    case 'DOGE':
    case 'DASH': {
      const legacy = checkBase58Chain(address, chain);
      if (legacy.valid) return legacy;
      const sw = checkSegwit(address);
      if (sw && sw.chain === chain) return sw;
      return legacy;
    }
    case 'ETH':
      return checkEth(address);
    case 'TRON':
      return strictOrNull('TRON', 'TRC20', 'mainnet', checkTron(address), 'Not a valid TRON (TRC20) Base58Check address');
    case 'XRP':
      return strictOrNull('XRP', 'XRP', 'mainnet', checkXrp(address), 'Not a valid XRP (Ripple-alphabet Base58Check) address');
    case 'ADA':
      return strictOrNull('ADA', 'ADA', 'mainnet', checkAda(address), 'Not a valid Cardano Bech32 address (expected hrp "addr"/"addr_test")');
    case 'SOL':
      return strictOrNull('SOL', 'SOL', 'mainnet', checkSol(address), 'Not a valid Solana address (expected Base58 of exactly 32 bytes)');
    case 'DOT':
      return strictOrNull('DOT', 'SS58', 'substrate', checkDot(address), 'Not a valid Polkadot SS58 address');
    default:
      badRequest(`Unknown chain "${chain}". Supported: ${Object.keys(BASE58_CHAINS).join(', ')}, ETH, TRON, XRP, ADA, SOL, DOT`);
  }
}

/* ------------------------------------------------------------------ *
 * Endpoint handlers                                                   *
 * ------------------------------------------------------------------ */

function validate(params) {
  need(params, ['address']);
  const address = String(params.address).trim();
  let result;
  if (params.chain !== undefined && params.chain !== null && String(params.chain).trim() !== '') {
    const chain = String(params.chain).trim().toUpperCase();
    result = validateForChain(address, chain);
  } else {
    const matches = allMatches(address);
    if (matches.length) {
      result = matches[0];
    } else {
      result = {
        valid: false, chain: null, type: null, network: null, checksum_valid: null,
        errors: ['Address does not match any supported chain format'],
      };
    }
  }
  return {
    address,
    valid: result.valid,
    chain: result.chain,
    type: result.type,
    network: result.network,
    checksum_valid: result.checksum_valid,
    errors: result.errors,
  };
}

function detect(params) {
  need(params, ['address']);
  const address = String(params.address).trim();
  const matches = allMatches(address).map((m) => ({ chain: m.chain, type: m.type, network: m.network }));
  return { address, matches, ambiguous: matches.length > 1 };
}

function chains() {
  const list = [
    { chain: 'BTC', name: 'Bitcoin', types: ['P2PKH', 'P2SH', 'P2WPKH', 'P2WSH', 'P2TR'], algorithm: 'Base58Check (double-SHA256) + Bech32/Bech32m (BIP-173 / BIP-350)' },
    { chain: 'LTC', name: 'Litecoin', types: ['P2PKH', 'P2SH', 'P2WPKH', 'P2WSH', 'P2TR'], algorithm: 'Base58Check (double-SHA256) + Bech32/Bech32m' },
    { chain: 'DOGE', name: 'Dogecoin', types: ['P2PKH', 'P2SH'], algorithm: 'Base58Check (double-SHA256)' },
    { chain: 'DASH', name: 'Dash', types: ['P2PKH', 'P2SH'], algorithm: 'Base58Check (double-SHA256)' },
    { chain: 'ETH', name: 'Ethereum', types: ['ERC20 (EIP-55 checksum)'], algorithm: 'Keccak-256 checksum (EIP-55)' },
    { chain: 'TRON', name: 'Tron', types: ['TRC20'], algorithm: 'Base58Check (double-SHA256), version byte 0x41' },
    { chain: 'XRP', name: 'XRP Ledger', types: ['XRP'], algorithm: 'Base58Check with Ripple alphabet (double-SHA256)' },
    { chain: 'ADA', name: 'Cardano', types: ['ADA'], algorithm: 'Bech32 (hrp "addr" / "addr_test")' },
    { chain: 'SOL', name: 'Solana', types: ['SOL'], algorithm: 'Base58, no checksum (32-byte payload)' },
    { chain: 'DOT', name: 'Polkadot', types: ['SS58'], algorithm: 'SS58: Base58 + blake2b-512 ("SS58PRE" + prefix + account)' },
  ];
  return { count: list.length, chains: list };
}

module.exports = {
  prefix: '/crypto-addr/v1',
  name: 'Crypto Address Validator',
  tagline:
    'Validate & classify multi-chain crypto addresses: BTC/LTC/DOGE (Base58Check + Bech32/Bech32m), ETH (EIP-55), TRON, XRP, ADA, SOL, DOT.',
  description:
    'Crypto Address Validator checks and classifies crypto wallet addresses across ten chains with zero dependencies: from-scratch Base58Check (double-SHA256), full Bech32/Bech32m segwit decoding (BIP-173 / BIP-350, P2WPKH / P2WSH / P2TR), Ethereum EIP-55 Keccak-256 checksums, Ripple-alphabet XRP addresses, Cardano Bech32, Solana base58, and Polkadot SS58 (blake2b-512). It reports the detected chain, address type, network and whether the embedded checksum is valid, and can auto-detect the chain from a raw address. Built for crypto exchanges, wallets, fintech KYC/withdrawal screens and payment gateways that must screen user-entered addresses before funds move.',
  freeTier: 30,
  endpoints: [
    {
      path: '/validate',
      method: 'GET',
      summary: 'Validate an address (optionally for a specific chain)',
      operationId: 'validateCryptoAddress',
      description:
        'Validate a crypto address. If "chain" is provided it is validated strictly against that chain; otherwise the address is matched against every supported chain and the first match is reported.',
      params: [
        { name: 'address', type: 'string', required: true, description: 'Crypto wallet address to validate', example: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' },
        { name: 'chain', type: 'string', required: false, description: 'Restrict validation to one chain (BTC, LTC, DOGE, DASH, ETH, TRON, XRP, ADA, SOL, DOT)', example: 'BTC' },
      ],
      handler: validate,
    },
    {
      path: '/detect',
      method: 'GET',
      summary: 'Detect the chain(s) an address belongs to',
      operationId: 'detectCryptoAddress',
      description: 'Auto-detect which supported chain(s) and address types an address matches, and whether the result is ambiguous.',
      params: [
        { name: 'address', type: 'string', required: true, description: 'Crypto wallet address to classify', example: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' },
      ],
      handler: detect,
    },
    {
      path: '/chains',
      method: 'GET',
      summary: 'List supported chains, address types and algorithms',
      operationId: 'listCryptoChains',
      description: 'Return the list of supported chains with their address types and the validation algorithm used for each.',
      params: [],
      handler: chains,
    },
  ],
};
