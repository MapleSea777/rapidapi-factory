'use strict';

/**
 * QR Forge — a from-scratch QR Code encoder (ISO/IEC 18004).
 * Byte mode, versions 1-10, ECC levels L/M/Q/H, Reed-Solomon over GF(256),
 * full mask evaluation with penalty scoring, PNG (via zlib) and SVG output.
 * This is the kind of API users pay for: not trivially reproducible.
 */

const zlib = require('zlib');

// ---------- GF(256) arithmetic (primitive polynomial 0x11d) ----------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGalois() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gmul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const factor = GF_EXP[i];
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gmul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, eccLen) {
  const gen = rsGenPoly(eccLen);
  const res = data.concat(new Array(eccLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor !== 0) {
      for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], factor);
    }
  }
  return res.slice(data.length);
}

// ---------- Version/ECC block table (ISO 18004, versions 1-10) ----------
// Each entry: [numberOfBlocks, dataCodewordsPerBlock]
const EC_TABLE = {
  1: { L: [[1, 19]], M: [[1, 16]], Q: [[1, 13]], H: [[1, 9]] },
  2: { L: [[1, 34]], M: [[1, 28]], Q: [[1, 22]], H: [[1, 16]] },
  3: { L: [[1, 55]], M: [[1, 44]], Q: [[2, 17]], H: [[2, 13]] },
  4: { L: [[1, 80]], M: [[2, 32]], Q: [[2, 24]], H: [[4, 9]] },
  5: { L: [[1, 108]], M: [[2, 43]], Q: [[2, 15], [2, 16]], H: [[2, 11], [2, 12]] },
  6: { L: [[2, 68]], M: [[4, 27]], Q: [[4, 19]], H: [[4, 15]] },
  7: { L: [[2, 78]], M: [[4, 31]], Q: [[2, 14], [4, 15]], H: [[4, 13], [1, 14]] },
  8: { L: [[2, 97]], M: [[2, 38], [2, 39]], Q: [[4, 18], [2, 19]], H: [[4, 14], [2, 15]] },
  9: { L: [[2, 116]], M: [[3, 36], [2, 37]], Q: [[4, 16], [4, 17]], H: [[4, 12], [4, 13]] },
  10: { L: [[2, 68], [2, 69]], M: [[4, 43], [1, 44]], Q: [[6, 19], [2, 20]], H: [[6, 15], [2, 16]] },
};

const ALIGNMENT_CENTERS = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

function totalDataCodewords(version, level) {
  let sum = 0;
  for (const [count, per] of EC_TABLE[version][level]) sum += count * per;
  return sum;
}

function chooseVersion(byteLength, level) {
  for (let v = 1; v <= 10; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const capacityBits = totalDataCodewords(v, level) * 8;
    if (4 + countBits + 8 * byteLength <= capacityBits) return v;
  }
  return -1;
}

// ---------- Bit buffer ----------
class BitBuffer {
  constructor() { this.bits = []; }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() { return this.bits.length; }
}

function buildDataCodewords(bytes, version, level) {
  const bb = new BitBuffer();
  bb.put(0b0100, 4); // byte mode
  bb.put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) bb.put(b, 8);

  const capacityBits = totalDataCodewords(version, level) * 8;
  // Terminator (max 4 zero bits)
  for (let i = 0; i < 4 && bb.length < capacityBits; i++) bb.bits.push(0);
  // Pad to byte boundary
  while (bb.length % 8 !== 0) bb.bits.push(0);
  // Pad bytes
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bb.length < capacityBits) bb.put(padBytes[padIdx++ % 2], 8);

  const codewords = [];
  for (let i = 0; i < bb.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

function interleaveBlocks(codewords, version, level) {
  const groups = EC_TABLE[version][level];
  const blocks = [];
  let offset = 0;
  let eccLen = null;
  for (const [count, perBlock] of groups) {
    for (let i = 0; i < count; i++) {
      const data = codewords.slice(offset, offset + perBlock);
      offset += perBlock;
      const blockEccLen = eccLenFor(version, level);
      if (eccLen === null) eccLen = blockEccLen;
      blocks.push({ data, ecc: rsEncode(data, eccLen) });
    }
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  }
  for (let i = 0; i < eccLen; i++) {
    for (const b of blocks) out.push(b.ecc[i]);
  }
  return out;
}

function eccLenFor(version, level) {
  const totalCodewords = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 }[version];
  const blocks = EC_TABLE[version][level].reduce((s, [c]) => s + c, 0);
  return (totalCodewords - totalDataCodewords(version, level)) / blocks;
}

// ---------- Matrix construction ----------
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function bchFormat(data5) {
  let rem = data5;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data5 << 10) | rem) ^ 0x5412;
}

class Matrix {
  constructor(version) {
    this.version = version;
    this.size = 17 + 4 * version;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }

  set(x, y, dark, isFunc) {
    this.modules[y][x] = dark;
    if (isFunc) this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
    const s = this.size;
    // Timing patterns
    for (let i = 0; i < s; i++) {
      this.set(6, i, i % 2 === 0, true);
      this.set(i, 6, i % 2 === 0, true);
    }
    // Finder patterns with separators
    this.drawFinder(3, 3);
    this.drawFinder(s - 4, 3);
    this.drawFinder(3, s - 4);
    // Alignment patterns
    const centers = ALIGNMENT_CENTERS[this.version] || [];
    const n = centers.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(centers[i], centers[j]);
      }
    }
    // Reserve format info areas (drawn with mask 0 placeholder)
    this.drawFormat(0);
  }

  drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        this.set(x, y, dist !== 2 && dist !== 4, true);
      }
    }
  }

  drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        this.set(cx + dx, cy + dy, dist !== 1, true);
      }
    }
  }

  drawFormat(mask, level = 'M', final = false) {
    const bits = bchFormat((FORMAT_BITS[level] << 3) | mask);
    const get = (i) => ((bits >>> i) & 1) !== 0;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, get(i), true);
    this.set(8, 7, get(6), true);
    this.set(8, 8, get(7), true);
    this.set(7, 8, get(8), true);
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, get(i), true);
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, get(i), true);
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, get(i), true);
    this.set(8, s - 8, true, true); // dark module
    void final;
  }

  drawCodewords(data) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    const fn = MASKS[mask];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && fn(x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  penalty() {
    const s = this.size;
    const m = this.modules;
    let total = 0;

    // Rule 1: runs of same color >= 5
    for (let y = 0; y < s; y++) {
      let run = 1;
      for (let x = 1; x <= s; x++) {
        if (x < s && m[y][x] === m[y][x - 1]) run++;
        else { if (run >= 5) total += 3 + (run - 5); run = 1; }
      }
    }
    for (let x = 0; x < s; x++) {
      let run = 1;
      for (let y = 1; y <= s; y++) {
        if (y < s && m[y][x] === m[y - 1][x]) run++;
        else { if (run >= 5) total += 3 + (run - 5); run = 1; }
      }
    }

    // Rule 2: 2x2 blocks of same color
    for (let y = 0; y < s - 1; y++) {
      for (let x = 0; x < s - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) total += 3;
      }
    }

    // Rule 3: finder-like patterns
    const P1 = [true, false, true, true, true, false, true, false, false, false, false];
    const P2 = [...P1].reverse();
    const match = (arr, start, pat) => pat.every((v, k) => arr[start + k] === v);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x <= s - 11; x++) {
        if (match(m[y], x, P1) || match(m[y], x, P2)) total += 40;
      }
    }
    for (let x = 0; x < s; x++) {
      const col = [];
      for (let y = 0; y < s; y++) col.push(m[y][x]);
      for (let y = 0; y <= s - 11; y++) {
        if (match(col, y, P1) || match(col, y, P2)) total += 40;
      }
    }

    // Rule 4: dark proportion
    let dark = 0;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (m[y][x]) dark++;
    const pct = (dark * 100) / (s * s);
    total += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return total;
  }
}

function encodeQr(text, level) {
  const bytes = [...Buffer.from(text, 'utf8')];
  const version = chooseVersion(bytes.length, level);
  if (version === -1) {
    const e = new Error('Text too long: exceeds byte-mode capacity (271 bytes at version 10, level L)');
    e.status = 400;
    throw e;
  }
  const codewords = buildDataCodewords(bytes, version, level);
  const finalData = interleaveBlocks(codewords, version, level);

  const matrix = new Matrix(version);
  matrix.drawFunctionPatterns();
  matrix.drawCodewords(finalData);

  // Choose best mask
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const copy = cloneMatrix(matrix);
    copy.applyMask(mask);
    copy.drawFormat(mask, level, true);
    const p = copy.penalty();
    if (p < bestPenalty) {
      bestPenalty = p;
      bestMask = mask;
    }
  }
  matrix.applyMask(bestMask);
  matrix.drawFormat(bestMask, level, true);

  return { modules: matrix.modules, version, size: matrix.size, mask: bestMask, dataCodewords: codewords.length };
}

function cloneMatrix(m) {
  const c = new Matrix(m.version);
  for (let y = 0; y < m.size; y++) {
    c.modules[y] = [...m.modules[y]];
    c.isFunction[y] = [...m.isFunction[y]];
  }
  return c;
}

// ---------- Output renderers ----------
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function parseHexColor(str, fallback) {
  const m = String(str || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(m)) {
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  }
  return fallback;
}

function renderPng(modules, scale, border, darkRgb, lightRgb) {
  const n = modules.length;
  const dim = (n + border * 2) * scale;
  const rowLen = 1 + dim * 3;
  const raw = Buffer.alloc(rowLen * dim);
  const row = Buffer.alloc(rowLen);
  for (let py = 0; py < dim; py++) {
    row[0] = 0; // filter: none
    const my = Math.floor(py / scale) - border;
    for (let px = 0; px < dim; px++) {
      const mx = Math.floor(px / scale) - border;
      const dark = mx >= 0 && mx < n && my >= 0 && my < n && modules[my][mx];
      const rgb = dark ? darkRgb : lightRgb;
      row[1 + px * 3] = rgb[0];
      row[2 + px * 3] = rgb[1];
      row[3 + px * 3] = rgb[2];
    }
    row.copy(raw, py * rowLen);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0);
  ihdr.writeUInt32BE(dim, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderSvg(modules, scale, border, dark, light) {
  const n = modules.length;
  const dim = (n + border * 2) * scale;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules[y][x]) d += `M${(x + border) * scale} ${(y + border) * scale}h${scale}v${scale}h${-scale}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

// ---------- API handlers ----------
function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function generate(params) {
  const text = params.text !== undefined ? params.text : params.data;
  if (text === undefined || text === null || text === '') {
    const e = new Error('Missing required parameter: "text"');
    e.status = 400;
    throw e;
  }
  const ecc = String(params.ecc || 'M').toUpperCase();
  if (!['L', 'M', 'Q', 'H'].includes(ecc)) {
    const e = new Error('Parameter "ecc" must be one of L, M, Q, H');
    e.status = 400;
    throw e;
  }
  const format = String(params.format || 'png').toLowerCase();
  if (!['png', 'svg'].includes(format)) {
    const e = new Error('Parameter "format" must be png or svg');
    e.status = 400;
    throw e;
  }
  const scale = clampInt(params.scale, 8, 1, 64);
  const border = clampInt(params.border === undefined ? 4 : params.border, 4, 0, 32);
  const darkHex = String(params.dark || '#000000');
  const lightHex = String(params.light || '#ffffff');

  const qr = encodeQr(String(text), ecc);
  const meta = {
    version: qr.version,
    modules: qr.size,
    mask: qr.mask,
    ecc_level: ecc,
    data_codewords: qr.dataCodewords,
    content_bytes: Buffer.byteLength(String(text), 'utf8'),
  };

  if (format === 'svg') {
    return { format: 'svg', svg: renderSvg(qr.modules, scale, border, darkHex, lightHex), ...meta };
  }
  const png = renderPng(qr.modules, scale, border, parseHexColor(darkHex, [0, 0, 0]), parseHexColor(lightHex, [255, 255, 255]));
  const b64 = png.toString('base64');
  return { format: 'png', png_base64: b64, data_uri: `data:image/png;base64,${b64}`, bytes: png.length, ...meta };
}

function capacity(params) {
  const ecc = String(params.ecc || 'M').toUpperCase();
  if (!['L', 'M', 'Q', 'H'].includes(ecc)) {
    const e = new Error('Parameter "ecc" must be one of L, M, Q, H');
    e.status = 400;
    throw e;
  }
  const caps = {};
  for (let v = 1; v <= 10; v++) {
    const countBits = v <= 9 ? 8 : 16;
    caps[`v${v}`] = Math.floor((totalDataCodewords(v, ecc) * 8 - 4 - countBits) / 8);
  }
  return { ecc_level: ecc, byte_mode_capacity: caps };
}

module.exports = {
  prefix: '/qr/v1',
  name: 'QR Forge',
  tagline: 'ISO-compliant QR code generation with PNG/SVG output — full Reed-Solomon engine.',
  description:
    'QR Forge is a from-scratch ISO/IEC 18004 QR encoder: byte mode, versions 1-10, all four ECC levels, Reed-Solomon error correction over GF(256), automatic mask optimization with full penalty scoring. Outputs crisp PNG (any scale/colors) or SVG. No third-party libraries — ideal for receipts, tickets, marketing, and logistics.',
  freeTier: 30,
  endpoints: [
    {
      path: '/generate',
      method: 'GET',
      summary: 'Generate a QR code (PNG or SVG)',
      operationId: 'generateQr',
      params: [
        { name: 'text', type: 'string', required: true, description: 'Content to encode (up to 271 bytes)', example: 'https://example.com' },
        { name: 'ecc', type: 'string', required: false, description: 'Error correction: L|M|Q|H', example: 'M' },
        { name: 'format', type: 'string', required: false, description: 'png | svg', example: 'png' },
        { name: 'scale', type: 'integer', required: false, description: 'Pixels per module (1-64)', example: 8 },
        { name: 'border', type: 'integer', required: false, description: 'Quiet zone modules (0-32)', example: 4 },
        { name: 'dark', type: 'string', required: false, description: 'Dark color hex', example: '#000000' },
        { name: 'light', type: 'string', required: false, description: 'Light color hex', example: '#ffffff' },
      ],
      handler: generate,
    },
    {
      path: '/capacity',
      method: 'GET',
      summary: 'Byte-mode capacity table',
      operationId: 'qrCapacity',
      params: [{ name: 'ecc', type: 'string', required: false, description: 'ECC level L|M|Q|H', example: 'M' }],
      handler: capacity,
    },
  ],
};

// Exported for tests
module.exports._internals = { rsEncode, bchFormat, encodeQr, renderPng };
