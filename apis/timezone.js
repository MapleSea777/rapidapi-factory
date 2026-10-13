'use strict';

/**
 * Timezone & Business Hours — DST-correct IANA conversion and a distributed-team
 * business-hours overlap solver, built entirely on the Intl API (zero deps).
 *
 * Offsets are derived by rendering an instant in a target zone with
 * Intl.DateTimeFormat#formatToParts, reconstructing the wall clock as if it were
 * UTC, and differencing it against the instant. This is correct even across DST
 * boundaries because Intl always reports the wall clock actually in force.
 */

const { requireParams, toNumber } = require('../lib/http');

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

const p2 = (n) => String(n).padStart(2, '0');

// ---------- Intl plumbing (formatters cached per zone) ----------
const _fmtCache = new Map();

function formatter(zone) {
  let f = _fmtCache.get(zone);
  if (f) return f;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
  } catch (e) {
    throw badRequest(`Invalid IANA timezone: "${zone}"`);
  }
  _fmtCache.set(zone, f);
  return f;
}

/** Wall-clock fields in `zone` at the UTC instant `ms`. */
function wall(zone, ms) {
  const parts = {};
  for (const p of formatter(zone).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    abbr: parts.timeZoneName,
  };
}

/** Offset in seconds of `zone` at `ms` (east positive). */
function offsetSeconds(zone, ms) {
  const w = wall(zone, ms);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const floored = Math.floor(ms / 1000) * 1000;
  return Math.round((wallAsUtc - floored) / 1000);
}

// Standard (non-DST) offset. DST adds to the base offset in essentially every
// modern zone, so the yearly minimum offset is the standard one. Sampled at the
// 15th of each month to span both solstices (handles both hemispheres).
const _stdCache = new Map();
function standardOffset(zone, year) {
  const key = `${zone}|${year}`;
  if (_stdCache.has(key)) return _stdCache.get(key);
  let min = Infinity;
  for (let m = 0; m < 12; m++) {
    const o = offsetSeconds(zone, Date.UTC(year, m, 15, 12, 0, 0));
    if (o < min) min = o;
  }
  _stdCache.set(key, min);
  return min;
}

function fmtOffset(sec) {
  const sign = sec < 0 ? '-' : '+';
  const abs = Math.abs(sec);
  return `${sign}${p2(Math.floor(abs / 3600))}:${p2(Math.floor((abs % 3600) / 60))}`;
}

function localISO(w) {
  return (
    `${w.year}-${p2(w.month)}-${p2(w.day)}` +
    `T${p2(w.hour)}:${p2(w.minute)}:${p2(w.second)}`
  );
}

/** Full per-zone result used by /convert and /now. */
function describe(zone, ms) {
  const w = wall(zone, ms);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const floored = Math.floor(ms / 1000) * 1000;
  const sec = Math.round((wallAsUtc - floored) / 1000);
  const year = new Date(ms).getUTCFullYear();
  return {
    zone,
    local: localISO(w),
    utc_offset: fmtOffset(sec),
    utc_offset_seconds: sec,
    abbreviation: w.abbr,
    is_dst: sec > standardOffset(zone, year),
  };
}

// ---------- Param parsing ----------
const OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Parse an ISO 8601 instant; strings without an offset are treated as UTC. */
function parseInstant(value, name) {
  const str = String(value).trim();
  const normalized = OFFSET_RE.test(str) ? str : `${str}Z`;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) {
    throw badRequest(`Parameter "${name}" must be a valid ISO 8601 instant`);
  }
  return ms;
}

function parseZones(value) {
  const names = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) throw badRequest('Parameter "zones" must list at least one IANA timezone');
  const out = [];
  for (const z of names) {
    formatter(z); // throws 400 for an unknown zone
    if (!out.includes(z)) out.push(z);
  }
  return out;
}

function optInt(params, name, def, min, max) {
  const raw = params[name];
  if (raw === undefined || raw === null || raw === '') return def;
  const n = toNumber(raw, NaN);
  if (!Number.isInteger(n)) throw badRequest(`Parameter "${name}" must be an integer`);
  if (n < min || n > max) throw badRequest(`Parameter "${name}" must be between ${min} and ${max}`);
  return n;
}

// ---------- Endpoints ----------
function convert(params) {
  need(params, ['instant', 'zones']);
  const ms = parseInstant(params.instant, 'instant');
  const zones = parseZones(params.zones);
  return {
    instant_utc: new Date(ms).toISOString(),
    results: zones.map((z) => describe(z, ms)),
  };
}

function now(params) {
  need(params, ['zones']);
  const zones = parseZones(params.zones);
  const ms = Date.now();
  return {
    utc: new Date(ms).toISOString(),
    results: zones.map((z) => describe(z, ms)),
  };
}

function overlap(params) {
  need(params, ['zones']);
  const zones = parseZones(params.zones);
  const reference = zones[0];

  const days = optInt(params, 'days', 7, 1, 30);
  const hoursStart = optInt(params, 'hours_start', 9, 0, 23);
  const hoursEnd = optInt(params, 'hours_end', 17, 1, 24);
  if (hoursEnd <= hoursStart) throw badRequest('Parameter "hours_end" must be greater than "hours_start"');
  const duration = optInt(params, 'duration_minutes', 60, 1, 1440);
  const minTz = optInt(params, 'min_tz_count', 2, 1, zones.length);

  // Resolve the start date (defaults to "today" in the reference zone).
  let dateStr;
  if (params.start !== undefined && params.start !== null && params.start !== '') {
    dateStr = String(params.start).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(Date.parse(`${dateStr}T00:00:00Z`))) {
      throw badRequest('Parameter "start" must be an ISO date (YYYY-MM-DD)');
    }
  } else {
    const w = wall(reference, Date.now());
    dateStr = `${w.year}-${p2(w.month)}-${p2(w.day)}`;
  }

  // UTC instant of local midnight on dateStr in the reference zone.
  const guess = Date.parse(`${dateStr}T00:00:00Z`);
  let windowStart = guess - offsetSeconds(reference, guess) * 1000;
  windowStart = guess - offsetSeconds(reference, windowStart) * 1000;
  const windowEnd = windowStart + days * 86400000;

  const STEP = 30 * 60 * 1000;
  const minLocal = hoursStart * 60;
  const maxLocal = hoursEnd * 60;
  const slots = [];
  let run = null;

  const flush = () => {
    if (!run) return;
    const endUtc = run.lastT + STEP;
    if ((endUtc - run.start) / 60000 >= duration) {
      slots.push({
        start_utc: new Date(run.start).toISOString(),
        end_utc: new Date(endUtc).toISOString(),
        participating_zones: run.zones,
        local_times: run.localTimes,
      });
    }
    run = null;
  };

  for (let t = windowStart; t < windowEnd; t += STEP) {
    const participating = [];
    const localTimes = {};
    for (const z of zones) {
      const w = wall(z, t);
      const dow = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
      const mins = w.hour * 60 + w.minute;
      if (dow >= 1 && dow <= 5 && mins >= minLocal && mins < maxLocal) {
        participating.push(z);
        localTimes[z] = `${p2(w.hour)}:${p2(w.minute)}`;
      }
    }
    if (participating.length >= minTz) {
      if (run && run.lastT + STEP === t) {
        run.lastT = t;
      } else {
        flush();
        run = { start: t, lastT: t, zones: participating, localTimes };
      }
    } else {
      flush();
    }
  }
  flush();

  return {
    reference_zone: reference,
    zones,
    window: {
      start: new Date(windowStart).toISOString(),
      end: new Date(windowEnd).toISOString(),
    },
    slots,
  };
}

const ZONES = [
  'UTC', 'Etc/UTC',
  'Africa/Cairo', 'Africa/Casablanca', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'America/Anchorage', 'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Chicago',
  'America/Denver', 'America/Halifax', 'America/Lima', 'America/Los_Angeles', 'America/Mexico_City',
  'America/Montevideo', 'America/New_York', 'America/Phoenix', 'America/Santiago',
  'America/Sao_Paulo', 'America/St_Johns', 'America/Toronto', 'America/Vancouver',
  'Asia/Almaty', 'Asia/Baghdad', 'Asia/Bangkok', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Dubai',
  'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Jerusalem', 'Asia/Karachi',
  'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Riyadh',
  'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Taipei', 'Asia/Tehran',
  'Asia/Tokyo', 'Asia/Yangon',
  'Atlantic/Azores', 'Atlantic/Reykjavik',
  'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Brussels', 'Europe/Bucharest',
  'Europe/Budapest', 'Europe/Copenhagen', 'Europe/Dublin', 'Europe/Helsinki', 'Europe/Istanbul',
  'Europe/Kyiv', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow',
  'Europe/Oslo', 'Europe/Paris', 'Europe/Prague', 'Europe/Rome', 'Europe/Stockholm',
  'Europe/Vienna', 'Europe/Warsaw', 'Europe/Zurich',
  'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Guam', 'Pacific/Honolulu',
];

function zones(params) {
  const q = params.q ? String(params.q).trim().toLowerCase() : '';
  const ms = Date.now();
  const year = new Date(ms).getUTCFullYear();
  const list = ZONES.filter((z) => !q || z.toLowerCase().includes(q)).map((z) => {
    const sec = offsetSeconds(z, ms);
    const w = wall(z, ms);
    return {
      zone: z,
      utc_offset: fmtOffset(sec),
      utc_offset_seconds: sec,
      abbreviation: w.abbr,
      is_dst: sec > standardOffset(z, year),
    };
  });
  return { q: params.q || null, count: list.length, zones: list };
}

module.exports = {
  prefix: '/timezone/v1',
  name: 'Timezone & Business Hours',
  tagline: 'Convert instants across IANA timezones and find overlapping business-hours slots for distributed teams.',
  description:
    'Timezone & Business Hours does two hard things correctly: DST-aware IANA instant conversion and business-hours overlap solving. Offsets are computed from the Intl API’s rendered wall clock, so EST/EDT, GMT/BST and every half-hour zone stay exact even across transitions. The overlap endpoint intersects each teammate’s weekday working hours and returns merged UTC meeting slots everyone can attend. Built for remote and distributed teams, sales scheduling, global support desks and meeting planners.',
  freeTier: 30,
  endpoints: [
    {
      path: '/convert',
      method: 'GET',
      summary: 'Convert an instant across IANA timezones',
      operationId: 'convertInstant',
      description:
        'Convert a single ISO 8601 instant into local wall-clock time for one or more comma-separated IANA timezones, with DST-correct offset, abbreviation and DST flag. Strings without an offset are treated as UTC.',
      params: [
        { name: 'instant', type: 'string', required: true, description: 'ISO 8601 instant (no offset = UTC)', example: '2024-01-15T12:00:00Z' },
        { name: 'zones', type: 'string', required: true, description: 'Comma-separated IANA timezone names', example: 'America/New_York,Europe/London,Asia/Shanghai' },
      ],
      handler: convert,
    },
    {
      path: '/now',
      method: 'GET',
      summary: 'Current time in multiple timezones',
      operationId: 'nowInZones',
      description: 'Return the current UTC instant and the corresponding local time, offset, abbreviation and DST flag for each requested IANA timezone.',
      params: [
        { name: 'zones', type: 'string', required: true, description: 'Comma-separated IANA timezone names', example: 'UTC,America/Los_Angeles,Asia/Tokyo' },
      ],
      handler: now,
    },
    {
      path: '/overlap',
      method: 'POST',
      summary: 'Find overlapping business-hours slots',
      operationId: 'findBusinessHourOverlap',
      description:
        'Given two or more timezones (the first is the reference), scan a multi-day window in 30-minute steps and return contiguous UTC slots where at least min_tz_count zones are inside their weekday business hours.',
      params: [
        { name: 'zones', type: 'string', required: true, description: 'Comma-separated IANA timezone names; first is the reference', example: 'America/New_York,Europe/London' },
        { name: 'start', type: 'string', required: false, description: 'Start date YYYY-MM-DD (default: today in reference zone)', example: '2024-01-15' },
        { name: 'days', type: 'integer', required: false, description: 'Number of days to scan (1-30, default 7)', example: '7' },
        { name: 'hours_start', type: 'integer', required: false, description: 'Business day start hour, 0-23 (default 9)', example: '9' },
        { name: 'hours_end', type: 'integer', required: false, description: 'Business day end hour, 1-24 (default 17)', example: '17' },
        { name: 'duration_minutes', type: 'integer', required: false, description: 'Minimum slot length in minutes (default 60)', example: '60' },
        { name: 'min_tz_count', type: 'integer', required: false, description: 'Minimum zones in a slot (default 2)', example: '2' },
      ],
      handler: overlap,
    },
    {
      path: '/zones',
      method: 'GET',
      summary: 'List common IANA timezones with current offsets',
      operationId: 'listZones',
      description: 'Return a curated catalogue of common IANA timezone identifiers with their current UTC offset, abbreviation and DST flag, optionally filtered by a substring match on the zone name.',
      params: [
        { name: 'q', type: 'string', required: false, description: 'Case-insensitive substring filter on the zone name', example: 'America' },
      ],
      handler: zones,
    },
  ],
};
