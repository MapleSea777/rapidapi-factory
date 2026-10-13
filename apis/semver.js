'use strict';

/**
 * Semantic Version Suite — parses, compares, sorts, bumps and range-tests
 * SemVer 2.0.0 versions using full npm-style range semantics.
 *
 * Everything (version parsing, precedence, caret/tilde/x-range/hyphen/OR
 * ranges and the prerelease rule) is implemented from scratch with Node
 * built-ins only — no external dependencies and no network access.
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

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

// Official SemVer 2.0.0 grammar (https://semver.org).
const FULL_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const PARTIAL_RE =
  /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const CMP_RE = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/;

const RELEASES = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'];

function toPrerelease(str) {
  if (!str) return [];
  return str.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id));
}

/** Strict, full SemVer 2.0.0 parse. Returns null when invalid. */
function parseFull(raw) {
  const input = String(raw).trim();
  const m = FULL_RE.exec(input);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: toPrerelease(m[4]),
    build: m[5] ? m[5].split('.') : [],
    raw: input,
  };
}

/** Loosened parse used for range operands (\d+, x, X, *, optional leading v). */
function parsePartial(raw) {
  const s = String(raw).trim();
  if (s === '') {
    return { major: null, minor: null, patch: null, prerelease: [], build: [], xr: true };
  }
  const m = PARTIAL_RE.exec(s);
  if (!m) return null;
  const conv = (t) =>
    t === undefined || t === null || t === 'x' || t === 'X' || t === '*' ? null : Number(t);
  const major = conv(m[1]);
  const minor = conv(m[2]);
  const patch = conv(m[3]);
  // Wildcards must only occupy trailing positions: "1.x.3" / "x.1.2" are invalid.
  if (major === null && (minor !== null || patch !== null)) return null;
  if (minor === null && patch !== null) return null;
  return {
    major,
    minor,
    patch,
    prerelease: toPrerelease(m[4]),
    build: m[5] ? m[5].split('.') : [],
    xr: major === null || minor === null || patch === null,
  };
}

function full(major, minor, patch, prerelease) {
  return { major, minor, patch, prerelease: prerelease || [], build: [] };
}

function formatVersion(v) {
  let out = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease.length) out += '-' + v.prerelease.join('.');
  if (v.build.length) out += '+' + v.build.join('.');
  return out;
}

function compareIdentifiers(a, b) {
  const an = typeof a === 'number';
  const bn = typeof b === 'number';
  if (an && bn) return a === b ? 0 : a < b ? -1 : 1;
  if (an) return -1; // numeric identifiers always rank lower.
  if (bn) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // no prerelease outranks any prerelease.
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const c = compareIdentifiers(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}

/** Full SemVer precedence comparison (build metadata is ignored). */
function compare(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

// ---- Range expansion ------------------------------------------------------

function expandXrange(p) {
  if (p.major === null) return [{ op: '>=', version: full(0, 0, 0), any: true }];
  if (p.minor === null) {
    return [
      { op: '>=', version: full(p.major, 0, 0) },
      { op: '<', version: full(p.major + 1, 0, 0) },
    ];
  }
  if (p.patch === null) {
    return [
      { op: '>=', version: full(p.major, p.minor, 0) },
      { op: '<', version: full(p.major, p.minor + 1, 0) },
    ];
  }
  return [{ op: '=', version: full(p.major, p.minor, p.patch, p.prerelease) }];
}

function expandCaret(p) {
  if (p.major === null) return [{ op: '>=', version: full(0, 0, 0), any: true }];
  const M = p.major;
  const m = p.minor === null ? 0 : p.minor;
  const pa = p.patch === null ? 0 : p.patch;
  const lower = full(M, m, pa, p.prerelease);
  let upper;
  if (M !== 0) upper = full(M + 1, 0, 0);
  else if (p.minor === null) upper = full(1, 0, 0);
  else if (m !== 0) upper = full(0, m + 1, 0);
  else if (p.patch === null) upper = full(0, 1, 0);
  else upper = full(0, 0, pa + 1);
  return [
    { op: '>=', version: lower },
    { op: '<', version: upper },
  ];
}

function expandTilde(p) {
  if (p.major === null) return [{ op: '>=', version: full(0, 0, 0), any: true }];
  const M = p.major;
  const m = p.minor === null ? 0 : p.minor;
  const pa = p.patch === null ? 0 : p.patch;
  const lower = full(M, m, pa, p.prerelease);
  const upper = p.minor === null ? full(M + 1, 0, 0) : full(M, m + 1, 0);
  return [
    { op: '>=', version: lower },
    { op: '<', version: upper },
  ];
}

function expandSimple(op, p) {
  const M = p.major === null ? 0 : p.major;
  const m = p.minor === null ? 0 : p.minor;
  const pa = p.patch === null ? 0 : p.patch;

  if (op === '^') return expandCaret(p);
  if (op === '~') return expandTilde(p);
  if (op === '=' || op === undefined) return expandXrange(p);

  if (!p.xr) return [{ op, version: full(M, m, pa, p.prerelease) }];

  if (op === '>=') return [{ op: '>=', version: full(M, m, pa) }];
  if (op === '>') {
    if (p.minor === null) return [{ op: '>=', version: full(M + 1, 0, 0) }];
    if (p.patch === null) return [{ op: '>=', version: full(M, m + 1, 0) }];
    return [{ op: '>', version: full(M, m, pa) }];
  }
  if (op === '<') return [{ op: '<', version: full(M, m, pa) }];
  if (op === '<=') {
    if (p.minor === null) return [{ op: '<', version: full(M + 1, 0, 0) }];
    if (p.patch === null) return [{ op: '<', version: full(M, m + 1, 0) }];
    return [{ op: '<=', version: full(M, m, pa) }];
  }
  return null;
}

function expandHyphen(lowStr, highStr) {
  const lo = parsePartial(lowStr);
  const hi = parsePartial(highStr);
  if (!lo || !hi) return null;
  const from = {
    op: '>=',
    version: full(
      lo.major === null ? 0 : lo.major,
      lo.minor === null ? 0 : lo.minor,
      lo.patch === null ? 0 : lo.patch,
      lo.prerelease
    ),
  };
  let to = null;
  if (hi.major === null) to = null;
  else if (hi.minor === null) to = { op: '<', version: full(hi.major + 1, 0, 0) };
  else if (hi.patch === null) to = { op: '<', version: full(hi.major, hi.minor + 1, 0) };
  else to = { op: '<=', version: full(hi.major, hi.minor, hi.patch, hi.prerelease) };
  return to ? [from, to] : [from];
}

/** Parse a range expression into an OR-list of comparator sets. */
function parseRange(raw) {
  const text = String(raw).trim();
  const alternatives = text.split(/\s*\|\|\s*/);
  const sets = [];
  for (const alt of alternatives) {
    const trimmed = alt.trim();
    if (trimmed === '') {
      sets.push([{ op: '>=', version: full(0, 0, 0), any: true }]);
      continue;
    }
    const hyphen = trimmed.match(/^(.+?)\s+-\s+(.+)$/);
    if (hyphen) {
      const set = expandHyphen(hyphen[1].trim(), hyphen[2].trim());
      if (!set) return null;
      sets.push(set);
      continue;
    }
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const set = [];
    for (const tok of tokens) {
      const m = CMP_RE.exec(tok);
      if (!m) return null;
      const partial = parsePartial(m[2]);
      if (!partial) return null;
      const expanded = expandSimple(m[1], partial);
      if (!expanded) return null;
      for (const c of expanded) set.push(c);
    }
    if (set.length === 0) set.push({ op: '>=', version: full(0, 0, 0), any: true });
    sets.push(set);
  }
  return sets;
}

function testComparator(version, c) {
  const cmp = compare(version, c.version);
  switch (c.op) {
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '=':
      return cmp === 0;
    default:
      return true;
  }
}

function testSet(version, set) {
  for (const c of set) {
    if (!testComparator(version, c)) return false;
  }
  if (version.prerelease.length > 0) {
    // A prerelease only satisfies a set if some comparator carries a
    // prerelease with the same [major, minor, patch] tuple.
    for (const c of set) {
      if (c.any) continue;
      if (c.version.prerelease.length > 0) {
        if (
          c.version.major === version.major &&
          c.version.minor === version.minor &&
          c.version.patch === version.patch
        ) {
          return true;
        }
      }
    }
    return false;
  }
  return true;
}

function satisfiesVersion(version, sets) {
  for (const set of sets) {
    if (testSet(version, set)) return true;
  }
  return false;
}

// ---- Bump / increment -----------------------------------------------------

function incPre(v, identifier) {
  if (v.prerelease.length === 0) {
    v.prerelease = [0];
  } else {
    let incremented = false;
    for (let i = v.prerelease.length - 1; i >= 0; i--) {
      if (typeof v.prerelease[i] === 'number') {
        v.prerelease[i] += 1;
        incremented = true;
        break;
      }
    }
    if (!incremented) v.prerelease.push(0);
  }
  if (identifier) {
    if (v.prerelease[0] === identifier) {
      if (typeof v.prerelease[1] !== 'number') v.prerelease = [identifier, 0];
    } else {
      v.prerelease = [identifier, 0];
    }
  }
}

function incPatch(v) {
  if (v.prerelease.length === 0) v.patch += 1;
  v.prerelease = [];
}

function inc(v, release, identifier) {
  const out = { major: v.major, minor: v.minor, patch: v.patch, prerelease: v.prerelease.slice(), build: [] };
  switch (release) {
    case 'premajor':
      out.prerelease = [];
      out.patch = 0;
      out.minor = 0;
      out.major += 1;
      incPre(out, identifier);
      break;
    case 'preminor':
      out.prerelease = [];
      out.patch = 0;
      out.minor += 1;
      incPre(out, identifier);
      break;
    case 'prepatch':
      out.prerelease = [];
      incPatch(out);
      incPre(out, identifier);
      break;
    case 'prerelease':
      if (out.prerelease.length === 0) incPatch(out);
      incPre(out, identifier);
      break;
    case 'major':
      if (out.minor !== 0 || out.patch !== 0 || out.prerelease.length === 0) out.major += 1;
      out.minor = 0;
      out.patch = 0;
      out.prerelease = [];
      break;
    case 'minor':
      if (out.patch !== 0 || out.prerelease.length === 0) out.minor += 1;
      out.patch = 0;
      out.prerelease = [];
      break;
    case 'patch':
      if (out.prerelease.length === 0) out.patch += 1;
      out.prerelease = [];
      break;
  }
  return out;
}

// ---- Handlers -------------------------------------------------------------

function parseErrors(input) {
  const s = String(input).trim();
  const errors = [];
  if (s === '') {
    errors.push('Version string is empty.');
    return errors;
  }
  if (/^v/i.test(s)) errors.push('Version must not include a leading "v".');
  if (!/^\d/.test(s)) errors.push('Version must start with a numeric major component.');
  const core = s.split(/[-+]/)[0];
  const parts = core.split('.');
  if (parts.length !== 3) {
    errors.push(`Version core must be three dot-separated numeric components (major.minor.patch), got ${parts.length}: "${core}".`);
  }
  if (parts.some((p) => /^0\d+$/.test(p))) errors.push('Numeric identifiers must not include leading zeroes.');
  if (errors.length === 0) errors.push('Not a valid SemVer 2.0.0 version string.');
  return errors;
}

function parse(params) {
  need(params, ['version']);
  const input = String(params.version);
  const v = parseFull(params.version);
  return {
    input,
    valid: !!v,
    major: v ? v.major : null,
    minor: v ? v.minor : null,
    patch: v ? v.patch : null,
    prerelease: v ? v.prerelease : [],
    build: v ? v.build : [],
    normalized: v ? formatVersion(v) : null,
    errors: v ? [] : parseErrors(input),
  };
}

function compareHandler(params) {
  need(params, ['a', 'b']);
  const a = parseFull(params.a);
  const b = parseFull(params.b);
  if (!a) throw badRequest(`Invalid semantic version for "a": "${params.a}"`);
  if (!b) throw badRequest(`Invalid semantic version for "b": "${params.b}"`);
  const comparison = compare(a, b);
  return {
    a: String(params.a),
    b: String(params.b),
    comparison,
    relation: comparison < 0 ? 'less' : comparison > 0 ? 'greater' : 'equal',
  };
}

function satisfies(params) {
  need(params, ['version', 'range']);
  const errors = [];
  const v = parseFull(params.version);
  if (!v) errors.push(`Invalid semantic version: "${params.version}".`);
  const sets = parseRange(params.range);
  if (!sets) errors.push(`Invalid range syntax: "${params.range}".`);
  return {
    version: String(params.version),
    range: String(params.range),
    satisfies: !!(v && sets) && satisfiesVersion(v, sets),
    errors,
  };
}

function bump(params) {
  need(params, ['version', 'release']);
  const v = parseFull(params.version);
  if (!v) throw badRequest(`Invalid semantic version: "${params.version}"`);
  const release = String(params.release).trim().toLowerCase();
  if (!RELEASES.includes(release)) {
    throw badRequest(`Invalid release type: "${params.release}". Expected one of: ${RELEASES.join(', ')}`);
  }
  const identifier =
    params.prerelease_id !== undefined && params.prerelease_id !== null && String(params.prerelease_id) !== ''
      ? String(params.prerelease_id).trim()
      : undefined;
  return {
    version: String(params.version),
    release,
    next: formatVersion(inc(v, release, identifier)),
  };
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function sortVersions(params) {
  need(params, ['versions']);
  const raw = params.versions;
  let entries;
  if (Array.isArray(raw)) {
    entries = raw.map(String);
  } else {
    const text = String(raw).trim();
    if (text.startsWith('[')) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw badRequest('versions must be a comma-separated string or a JSON array of version strings');
      }
      if (!Array.isArray(parsed)) {
        throw badRequest('versions must be a comma-separated string or a JSON array of version strings');
      }
      entries = parsed.map(String);
    } else {
      entries = text.split(',');
    }
  }
  entries = entries.map((e) => String(e).trim()).filter((e) => e.length > 0);

  const parsed = [];
  const invalid = [];
  for (const e of entries) {
    const v = parseFull(e);
    if (v) parsed.push({ raw: e, v });
    else invalid.push(e);
  }
  parsed.sort((x, y) => compare(x.v, y.v));
  if (toBool(params.desc, false)) parsed.reverse();

  return { sorted: parsed.map((p) => p.raw), valid: invalid.length === 0, invalid };
}

module.exports = {
  prefix: '/semver/v1',
  name: 'Semantic Version Suite',
  tagline: 'Parse, compare, sort, bump and range-test SemVer 2.0.0 versions with full npm-style range semantics.',
  description:
    'Semantic Version Suite implements the complete SemVer 2.0.0 precedence rules — numeric core comparison, prerelease ordering (numeric vs alphanumeric, left-to-right, longer-list-wins) and build-metadata handling — plus npm-style range syntax: caret (^), tilde (~), x-ranges (1.2.x, *, empty), hyphen ranges (1.2.3 - 2.3.4), OR (||) and AND (space-separated), including the correct prerelease-satisfaction rule. Use it from dependency-update bots, CI/CD pipelines, release tooling and no-code platforms that need to reason about versions without pulling in a package.',
  freeTier: 30,
  endpoints: [
    {
      path: '/parse',
      method: 'GET',
      summary: 'Parse a SemVer version',
      operationId: 'parseSemver',
      description: 'Parse a SemVer 2.0.0 string into its components, returning validity and a normalized form.',
      params: [
        { name: 'version', type: 'string', required: true, description: 'SemVer 2.0.0 version string', example: '1.2.3-alpha.1+build.5' },
      ],
      handler: parse,
    },
    {
      path: '/compare',
      method: 'GET',
      summary: 'Compare two SemVer versions',
      operationId: 'compareSemver',
      description: 'Compare two SemVer 2.0.0 versions using full precedence rules; build metadata is ignored.',
      params: [
        { name: 'a', type: 'string', required: true, description: 'First version', example: '1.0.0-alpha' },
        { name: 'b', type: 'string', required: true, description: 'Second version', example: '1.0.0' },
      ],
      handler: compareHandler,
    },
    {
      path: '/satisfies',
      method: 'GET',
      summary: 'Test a version against a range',
      operationId: 'satisfiesSemver',
      description: 'Test whether a version satisfies an npm-style range (^, ~, x-ranges, hyphen, || and AND comparators).',
      params: [
        { name: 'version', type: 'string', required: true, description: 'Version to test', example: '1.2.3' },
        { name: 'range', type: 'string', required: true, description: 'Range expression', example: '^1.2.0' },
      ],
      handler: satisfies,
    },
    {
      path: '/bump',
      method: 'GET',
      summary: 'Bump a version',
      operationId: 'bumpSemver',
      description: 'Increment a version by release type (major, minor, patch, premajor, preminor, prepatch, prerelease), optionally with a prerelease identifier.',
      params: [
        { name: 'version', type: 'string', required: true, description: 'Version to bump', example: '1.2.3' },
        { name: 'release', type: 'string', required: true, description: 'Release type', example: 'patch', enum: RELEASES },
        { name: 'prerelease_id', type: 'string', required: false, description: 'Prerelease identifier (e.g. "beta")', example: 'beta' },
      ],
      handler: bump,
    },
    {
      path: '/sort',
      method: 'POST',
      summary: 'Sort a list of versions',
      operationId: 'sortSemver',
      description: 'Sort versions ascending (or descending) using SemVer precedence; invalid entries are reported separately.',
      params: [
        { name: 'versions', type: 'string', required: true, description: 'Comma-separated versions or a JSON array string', example: '1.2.3,1.0.0,1.10.0,1.2.3-alpha' },
        { name: 'desc', type: 'boolean', required: false, description: 'Sort descending (default false)', example: false },
      ],
      handler: sortVersions,
    },
  ],
};
