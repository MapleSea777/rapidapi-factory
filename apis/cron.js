'use strict';

/**
 * Cron Expression Suite — parses, validates, describes and computes the next
 * run times of 5-field and 6-field cron expressions (UTC), including macros.
 * Zero external dependencies.
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

function bad(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

const MONTH_NAMES = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const DOW_NAMES = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MAX_MINUTES = 4 * 366 * 24 * 60; // ~4 years of minutes as an iteration cap

// --- Parsing -------------------------------------------------------------

function parseFieldToken(raw, opts) {
  const { key, min, max, names, normDow } = opts;
  const norm = (v) => (normDow && v === 7 ? 0 : v);
  const toVal = (s) => {
    const up = s.toUpperCase();
    if (names && Object.prototype.hasOwnProperty.call(names, up)) return names[up];
    if (!/^\d+$/.test(up)) return NaN;
    return Number(up);
  };

  const wildcard = raw === '*' || raw === '?';
  const values = new Set();

  if (wildcard) {
    for (let v = min; v <= max; v++) values.add(norm(v));
    return { values, wildcard: true, raw };
  }

  for (const partRaw of raw.split(',')) {
    const part = partRaw.trim();
    if (!part) return { error: `Invalid "${key}" field: empty list item in "${raw}"` };

    let range = part;
    let stepStr = null;
    const slash = part.indexOf('/');
    if (slash !== -1) {
      range = part.slice(0, slash);
      stepStr = part.slice(slash + 1);
    }

    let step = 1;
    if (stepStr !== null) {
      if (!/^\d+$/.test(stepStr) || Number(stepStr) < 1) {
        return { error: `Invalid step in "${key}" field: "${part}"` };
      }
      step = Number(stepStr);
    }

    let lo;
    let hi;
    if (range === '*' || range === '?') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const idx = range.indexOf('-');
      const a = toVal(range.slice(0, idx));
      const b = toVal(range.slice(idx + 1));
      if (Number.isNaN(a) || Number.isNaN(b)) return { error: `Invalid range in "${key}" field: "${part}"` };
      lo = a;
      hi = b;
    } else {
      const a = toVal(range);
      if (Number.isNaN(a)) return { error: `Invalid value in "${key}" field: "${part}"` };
      lo = a;
      hi = stepStr !== null ? max : a;
    }

    if (lo < min || hi > max || lo > hi) {
      return { error: `Value out of range in "${key}" field (${min}-${max}): "${part}"` };
    }
    for (let v = lo; v <= hi; v += step) values.add(norm(v));
  }

  return { values, wildcard: false, raw };
}

function parseCron(expression) {
  const expr = String(expression == null ? '' : expression).trim();
  if (!expr) return { ok: false, errors: ['Expression is empty'] };

  let body = expr;
  if (body[0] === '@') {
    const key = body.toLowerCase();
    if (key === '@reboot') {
      return { ok: false, errors: ['@reboot has no scheduled next-run time'], expression: expr };
    }
    const mapped = MACROS[key];
    if (!mapped) return { ok: false, errors: [`Unknown macro: "${body}"`], expression: expr };
    body = mapped;
  }

  const tokens = body.split(/\s+/).filter(Boolean);
  let hasSeconds;
  if (tokens.length === 5) hasSeconds = false;
  else if (tokens.length === 6) hasSeconds = true;
  else return { ok: false, errors: [`Expected 5 or 6 fields, got ${tokens.length}`], expression: expr };

  const specList = hasSeconds
    ? [
        { key: 'second', min: 0, max: 59 },
        { key: 'minute', min: 0, max: 59 },
        { key: 'hour', min: 0, max: 23 },
        { key: 'day_of_month', min: 1, max: 31 },
        { key: 'month', min: 1, max: 12, names: MONTH_NAMES },
        { key: 'day_of_week', min: 0, max: 7, names: DOW_NAMES, normDow: true },
      ]
    : [
        { key: 'minute', min: 0, max: 59 },
        { key: 'hour', min: 0, max: 23 },
        { key: 'day_of_month', min: 1, max: 31 },
        { key: 'month', min: 1, max: 12, names: MONTH_NAMES },
        { key: 'day_of_week', min: 0, max: 7, names: DOW_NAMES, normDow: true },
      ];

  const fields = {};
  const errors = [];
  tokens.forEach((tok, i) => {
    const res = parseFieldToken(tok, specList[i]);
    if (res.error) errors.push(res.error);
    else fields[specList[i].key] = res;
  });

  if (errors.length) return { ok: false, errors, expression: expr };

  if (!hasSeconds) fields.second = { values: new Set([0]), wildcard: false, raw: null, implicit: true };

  const parsed = {
    hasSeconds,
    minute: fields.minute,
    hour: fields.hour,
    day_of_month: fields.day_of_month,
    month: fields.month,
    day_of_week: fields.day_of_week,
    second: fields.second,
    raw: {
      second: fields.second.raw,
      minute: fields.minute.raw,
      hour: fields.hour.raw,
      day_of_month: fields.day_of_month.raw,
      month: fields.month.raw,
      day_of_week: fields.day_of_week.raw,
    },
  };

  return { ok: true, parsed, expression: expr, hasSeconds };
}

// --- Matching ------------------------------------------------------------

function dayMatches(p, d) {
  const domMatch = p.day_of_month.values.has(d.getUTCDate());
  const dowMatch = p.day_of_week.values.has(d.getUTCDay());
  const domWild = p.day_of_month.wildcard;
  const dowWild = p.day_of_week.wildcard;
  if (domWild && dowWild) return true;
  if (!domWild && !dowWild) return domMatch || dowMatch;
  if (domWild) return dowMatch;
  return domMatch;
}

// --- Next-run computation ------------------------------------------------

function nextRuns(p, fromMs, count) {
  const out = [];
  let exhausted = false;
  let t;
  if (p.hasSeconds) t = Math.ceil(fromMs / 1000) * 1000;
  else t = Math.ceil(fromMs / 60000) * 60000;

  let iter = 0;
  while (out.length < count) {
    if (iter++ > MAX_MINUTES) {
      exhausted = true;
      break;
    }
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();

    if (!p.month.values.has(mo + 1)) {
      t = Date.UTC(y, mo + 1, 1, 0, 0, 0);
      continue;
    }
    if (!dayMatches(p, d)) {
      t = Date.UTC(y, mo, d.getUTCDate() + 1, 0, 0, 0);
      continue;
    }
    if (!p.hour.values.has(d.getUTCHours())) {
      t = Date.UTC(y, mo, d.getUTCDate(), d.getUTCHours() + 1, 0, 0);
      continue;
    }
    if (!p.minute.values.has(d.getUTCMinutes())) {
      if (p.hasSeconds) t = Date.UTC(y, mo, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes() + 1, 0);
      else t += 60000;
      continue;
    }
    if (p.hasSeconds && !p.second.values.has(d.getUTCSeconds())) {
      t += 1000;
      continue;
    }

    out.push(new Date(t));
    t += p.hasSeconds ? 1000 : 60000;
  }

  return { next: out, exhausted };
}

function publicFields(p) {
  return {
    second: p.raw.second,
    minute: p.raw.minute,
    hour: p.raw.hour,
    day_of_month: p.raw.day_of_month,
    month: p.raw.month,
    day_of_week: p.raw.day_of_week,
  };
}

// --- Human description ---------------------------------------------------

function isStar(raw) {
  return raw === null || raw === undefined || raw === '*' || raw === '?';
}

function stepOf(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^\*\/(\d+)$/.exec(raw);
  return m ? Number(m[1]) : null;
}

function sortNums(set) {
  return Array.from(set).sort((a, b) => a - b);
}

function listNums(set) {
  return sortNums(set).join(', ');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function contiguousText(values, names) {
  if (values.length === 1) return names[values[0]];
  let contiguous = true;
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) {
      contiguous = false;
      break;
    }
  }
  if (contiguous) return `${names[values[0]]} through ${names[values[values.length - 1]]}`;
  return values.map((v) => names[v]).join(', ');
}

function describeTime(p) {
  const rawMin = p.raw.minute;
  const rawHour = p.raw.hour;
  const rawSec = p.raw.second;
  const secStar = !p.hasSeconds || isStar(rawSec);

  if (isStar(rawMin) && isStar(rawHour)) {
    if (!p.hasSeconds) return 'Every minute';
    return secStar ? 'Every second' : `Every minute at second ${rawSec}`;
  }

  if (isStar(rawHour)) {
    const step = stepOf(rawMin);
    if (step) return `Every ${step} minutes`;
    if (p.minute.values.size === 1) {
      const m = sortNums(p.minute.values)[0];
      return m === 0 ? 'Every hour' : `Every hour at minute ${m}`;
    }
    return `At minute ${listNums(p.minute.values)} of every hour`;
  }

  if (isStar(rawMin)) {
    const step = stepOf(rawHour);
    if (step) return `Every ${step} hours`;
    return `Every minute during hours ${listNums(p.hour.values)}`;
  }

  const times = [];
  for (const hh of sortNums(p.hour.values)) {
    for (const mm of sortNums(p.minute.values)) {
      times.push(`${pad2(hh)}:${pad2(mm)}`);
    }
  }
  let text = `At ${times.join(', ')}`;
  if (!secStar) text += ` at second(s) ${listNums(p.second.values)}`;
  return text;
}

function describeDay(p) {
  const parts = [];
  if (!isStar(p.raw.day_of_week)) {
    parts.push(`on ${contiguousText(sortNums(p.day_of_week.values), DOW_FULL)}`);
  }
  if (!isStar(p.raw.day_of_month)) {
    parts.push(`on day ${listNums(p.day_of_month.values)} of the month`);
  }
  if (!isStar(p.raw.month)) {
    parts.push(`in ${contiguousText(sortNums(p.month.values).map((m) => m - 1), MONTH_FULL)}`);
  }
  return parts.join(' ');
}

function describe(p) {
  const out = [describeTime(p), describeDay(p)].filter(Boolean).join(' ');
  return out || 'Never';
}

// --- Param helpers -------------------------------------------------------

function parseCount(value) {
  if (value === undefined || value === null || value === '') return 5;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw bad('Parameter "count" must be a positive integer');
  return Math.min(n, 100);
}

function parseFrom(value) {
  if (value === undefined || value === null || value === '') return Date.now();
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw bad(`Parameter "from" is not a valid ISO date: "${value}"`);
  return ms;
}

// --- Handlers ------------------------------------------------------------

async function parseHandler(params) {
  need(params, ['expression']);
  const expression = String(params.expression);
  const count = parseCount(params.count);
  const fromMs = parseFrom(params.from);

  const res = parseCron(expression);
  if (!res.ok) {
    return {
      expression,
      valid: false,
      fields: null,
      has_seconds: Boolean(res.hasSeconds),
      description: null,
      errors: res.errors,
      next: [],
      exhausted: false,
    };
  }

  const p = res.parsed;
  const { next, exhausted } = nextRuns(p, fromMs, count);
  return {
    expression,
    valid: true,
    fields: publicFields(p),
    has_seconds: p.hasSeconds,
    description: describe(p),
    errors: [],
    next: next.map((d) => d.toISOString()),
    exhausted,
  };
}

async function nextHandler(params) {
  need(params, ['expression']);
  const expression = String(params.expression);
  const count = parseCount(params.count);
  const fromMs = parseFrom(params.from);

  const res = parseCron(expression);
  if (!res.ok) throw bad(res.errors.join('; '));

  const { next, exhausted } = nextRuns(res.parsed, fromMs, count);
  return { expression, next: next.map((d) => d.toISOString()), exhausted };
}

async function validateHandler(params) {
  need(params, ['expression']);
  const expression = String(params.expression);
  const res = parseCron(expression);
  return {
    expression,
    valid: res.ok,
    errors: res.ok ? [] : res.errors,
    fields: res.ok ? publicFields(res.parsed) : null,
  };
}

module.exports = {
  prefix: '/cron/v1',
  name: 'Cron Expression Suite',
  tagline:
    'Parse, validate, describe in English and compute the next run times of cron expressions (5/6-field, timezone-aware).',
  description:
    'Cron Expression Suite parses, validates and explains cron schedules and computes their next run times in UTC. It handles both classic 5-field and 6-field (seconds) syntax, lists, ranges and steps, month/weekday names, "?" wildcards, and the common @macros (@yearly, @monthly, @weekly, @daily, @hourly, @reboot). Each field is parsed into an allowed-value set so the next-run engine advances a UTC instant and reports every upcoming occurrence — with a bounded search that reports exhaustion instead of looping on impossible dates. Built for DevOps and monitoring tools, schedulers, workflow builders and no-code automation platforms that need reliable cron semantics without pulling in a dependency.',
  freeTier: 30,
  endpoints: [
    {
      path: '/parse',
      method: 'POST',
      summary: 'Parse and describe a cron expression with next run times',
      operationId: 'parseCron',
      description:
        'Parses a 5- or 6-field cron expression (or @macro), returns the parsed fields, a human-readable English description, whether a seconds field is present, and the next run times as ISO strings.',
      params: [
        { name: 'expression', type: 'string', required: true, description: 'Cron expression (5/6 fields or @macro)', example: '*/15 * * * *' },
        { name: 'count', type: 'integer', required: false, description: 'Number of next run times to return (default 5, max 100)', example: 5 },
        { name: 'from', type: 'string', required: false, description: 'ISO-8601 start instant (default: now)', example: '2024-01-01T00:00:00Z' },
      ],
      handler: parseHandler,
    },
    {
      path: '/next',
      method: 'POST',
      summary: 'Compute the next run times of a cron expression',
      operationId: 'nextCronRuns',
      description: 'Returns the upcoming run times (ISO strings) of a cron expression starting from an optional instant.',
      params: [
        { name: 'expression', type: 'string', required: true, description: 'Cron expression (5/6 fields or @macro)', example: '0 9 * * 1-5' },
        { name: 'count', type: 'integer', required: false, description: 'Number of next run times to return (default 5, max 100)', example: 5 },
        { name: 'from', type: 'string', required: false, description: 'ISO-8601 start instant (default: now)', example: '2024-01-01T00:00:00Z' },
      ],
      handler: nextHandler,
    },
    {
      path: '/validate',
      method: 'GET',
      summary: 'Validate a cron expression',
      operationId: 'validateCron',
      description: 'Checks whether a cron expression (or @macro) is well-formed and returns any errors plus the parsed fields.',
      params: [
        { name: 'expression', type: 'string', required: true, description: 'Cron expression to validate', example: '0 0 1 * *' },
      ],
      handler: validateHandler,
    },
  ],
};
