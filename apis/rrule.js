'use strict';

/**
 * Recurrence Rule Expander — expands and describes iCalendar RRULE
 * recurrence strings (RFC 5545) into concrete occurrence date-times.
 * All computation is performed in UTC using only Node built-ins.
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

const FREQS = ['SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const NUMERIC_BY_KEYS = [
  'BYMONTH', 'BYWEEKNO', 'BYYEARDAY', 'BYMONTHDAY',
  'BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYSETPOS',
];

// ---- date helpers (UTC only) ------------------------------------------------

function startOfDayUtc(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}
function daysInMonth(y, m /* 0-based */) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}
function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function dayOfYear(d) {
  return Math.floor((startOfDayUtc(d).getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}
function iso(d) {
  return new Date(d).toISOString().replace(/\.000Z$/, 'Z');
}
function uniqSorted(list) {
  return [...new Set(list)].sort((a, b) => a - b);
}

/** Parse ISO 8601 ("1997-09-02T09:00:00Z") or iCalendar basic ("19970902T090000"). */
function parseDateTime(str) {
  if (str === undefined || str === null) return null;
  const s = String(str).trim();
  if (!s) return null;

  // Basic format: YYYYMMDD[THHMMSS][Z]
  let m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ISO 8601 with optional offset.
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const tz = m[7];
    if (tz && tz !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1;
      const hasColon = tz.includes(':');
      const oh = +tz.slice(1, 3);
      const om = +tz.slice(hasColon ? 4 : 3, hasColon ? 6 : 5);
      t -= sign * (oh * 60 + om) * 60000;
    }
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isDateOnly(str) {
  const s = String(str).trim();
  return /^\d{8}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ---- week helpers (WKST-aware) ---------------------------------------------

function weekStartDate(date, wkst) {
  const idx = WD[wkst] === undefined ? 1 : WD[wkst];
  const delta = (date.getUTCDay() - idx + 7) % 7;
  return addDays(startOfDayUtc(date), -delta);
}

/** RFC 5545 week number for an arbitrary first-day-of-week (week 1 contains Jan 4). */
function weekNumber(date, wkst) {
  const ws = weekStartDate(date, wkst);
  const jan4 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const wk1 = weekStartDate(jan4, wkst);
  if (ws.getTime() < wk1.getTime()) {
    return weekNumber(new Date(Date.UTC(date.getUTCFullYear() - 1, 11, 31)), wkst);
  }
  return Math.floor((ws.getTime() - wk1.getTime()) / (7 * 86400000)) + 1;
}

function weeksInYear(y, wkst) {
  return weekNumber(new Date(Date.UTC(y, 11, 28)), wkst);
}

/** Day index (1-based) of the nth weekday inside a consecutive day range. */
function nthWeekdayInRange(rangeStart, rangeDays, n, targetDow) {
  const startDow = rangeStart.getUTCDay();
  if (n > 0) {
    const offset = (targetDow - startDow + 7) % 7;
    const idx = offset + (n - 1) * 7;
    if (idx < rangeDays) return addDays(rangeStart, idx);
    return null;
  }
  const k = -n;
  const lastDow = (startDow + (rangeDays - 1)) % 7;
  const offset = (lastDow - targetDow + 7) % 7;
  const idx = (rangeDays - 1) - offset - (k - 1) * 7;
  if (idx >= 0) return addDays(rangeStart, idx);
  return null;
}

// ---- RRULE parsing ----------------------------------------------------------

function extractFromSource(raw) {
  const s = String(raw).trim();
  let dtstart = null;
  let rruleLine = null;

  const lines = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length > 1) {
    for (const line of lines) {
      const a = /^DTSTART(?:;TZID=[^:]+)?[:=](.+)$/i.exec(line);
      if (a) { dtstart = a[1].trim(); continue; }
      const b = /^RRULE[:=](.+)$/i.exec(line);
      if (b) { rruleLine = b[1].trim(); continue; }
    }
  }
  if (!rruleLine) {
    const a = /DTSTART(?:;TZID=[^:;]+)?[:=]([^;\n]+)/i.exec(s);
    if (a) dtstart = a[1].trim();
    const b = /RRULE[:=](.+)$/is.exec(s);
    if (b) rruleLine = b[1].replace(/\s+/g, '').trim();
  }
  if (!rruleLine) rruleLine = s.replace(/\s+/g, '');
  return { rruleLine, dtstart };
}

function toNumberList(str) {
  return String(str).split(',').map((x) => x.trim()).filter((x) => x !== '').map((x) => Number(x));
}

function parseRRuleLine(line) {
  const parts = {};
  const errors = [];
  const pairs = String(line).split(';').map((x) => x.trim()).filter(Boolean);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) { errors.push(`Malformed rule part: "${pair}"`); continue; }
    const key = pair.slice(0, eq).trim().toUpperCase();
    const val = pair.slice(eq + 1).trim();
    if (!val) { errors.push(`Empty value for ${key}`); continue; }

    if (key === 'FREQ') parts.FREQ = val.toUpperCase();
    else if (key === 'INTERVAL') parts.INTERVAL = Number(val);
    else if (key === 'COUNT') parts.COUNT = Number(val);
    else if (key === 'UNTIL') parts.UNTIL = val;
    else if (key === 'WKST') parts.WKST = val.toUpperCase();
    else if (key === 'BYDAY') parts.BYDAY = val.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    else if (NUMERIC_BY_KEYS.includes(key)) parts[key] = toNumberList(val);
    else if (!(key in parts)) parts[key] = val;
  }
  return { parts, errors };
}

function validateParts(parts) {
  const errors = [];

  if (!parts.FREQ) errors.push('FREQ is required');
  else if (!FREQS.includes(parts.FREQ)) errors.push(`Unknown FREQ "${parts.FREQ}"`);

  if (parts.INTERVAL !== undefined && (!Number.isInteger(parts.INTERVAL) || parts.INTERVAL < 1)) {
    errors.push('INTERVAL must be a positive integer');
  }
  if (parts.COUNT !== undefined && (!Number.isInteger(parts.COUNT) || parts.COUNT < 1)) {
    errors.push('COUNT must be a positive integer');
  }
  if (parts.COUNT !== undefined && parts.UNTIL !== undefined) {
    errors.push('COUNT and UNTIL are mutually exclusive');
  }
  if (parts.UNTIL !== undefined && !parseDateTime(parts.UNTIL)) {
    errors.push(`Invalid UNTIL "${parts.UNTIL}"`);
  }
  if (parts.WKST !== undefined && WD[parts.WKST] === undefined) {
    errors.push(`Invalid WKST "${parts.WKST}"`);
  }

  if (parts.BYDAY) {
    for (const e of parts.BYDAY) {
      if (!/^([+-]?\d{1,3})?(SU|MO|TU|WE|TH|FR|SA)$/.test(e)) {
        errors.push(`Invalid BYDAY "${e}"`);
      } else if (/^[+-]?\d/.test(e) && parts.FREQ && parts.FREQ !== 'MONTHLY' && parts.FREQ !== 'YEARLY') {
        errors.push(`Numeric BYDAY is only valid with FREQ=MONTHLY or YEARLY: "${e}"`);
      }
    }
  }

  const ranges = {
    BYMONTH: [1, 12], BYWEEKNO: [-53, 53], BYYEARDAY: [-366, 366], BYMONTHDAY: [-31, 31],
    BYHOUR: [0, 23], BYMINUTE: [0, 59], BYSECOND: [0, 59], BYSETPOS: [-366, 366],
  };
  for (const [key, [lo, hi]] of Object.entries(ranges)) {
    if (!parts[key]) continue;
    for (const v of parts[key]) {
      if (!Number.isInteger(v) || v === 0 || v < lo || v > hi) {
        errors.push(`${key} has out-of-range value: ${v}`);
      }
    }
  }
  return errors;
}

// ---- day-set evaluation -----------------------------------------------------

function monthdayMatch(dayOfMonth, dim, list) {
  for (const v of list) {
    if (v > 0 && v === dayOfMonth) return true;
    if (v < 0 && dayOfMonth === dim + v + 1) return true;
  }
  return false;
}

function yeardayMatch(day, list) {
  const y = day.getUTCFullYear();
  const doy = dayOfYear(day);
  const total = isLeap(y) ? 366 : 365;
  for (const v of list) {
    if (v > 0 && v === doy) return true;
    if (v < 0 && doy === total + v + 1) return true;
  }
  return false;
}

function weeknoMatch(day, list, wkst) {
  const wn = weekNumber(day, wkst);
  const total = weeksInYear(day.getUTCFullYear(), wkst);
  for (const v of list) {
    if (v > 0 && v === wn) return true;
    if (v < 0 && wn === total + v + 1) return true;
  }
  return false;
}

function bydayMatch(day, list, freq, parts) {
  const dow = day.getUTCDay();
  const dayMs = startOfDayUtc(day).getTime();
  for (const entry of list) {
    const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(entry);
    if (!m) continue;
    const target = WD[m[2]];
    if (target !== dow) continue;
    if (!m[1]) return true;
    const n = parseInt(m[1], 10);

    let scopeStart;
    let scopeDays;
    if (freq === 'MONTHLY') {
      const y = day.getUTCFullYear();
      const mo = day.getUTCMonth();
      scopeStart = new Date(Date.UTC(y, mo, 1));
      scopeDays = daysInMonth(y, mo);
    } else if (freq === 'YEARLY') {
      if (parts.BYMONTH && parts.BYMONTH.length) {
        const y = day.getUTCFullYear();
        const mo = day.getUTCMonth();
        scopeStart = new Date(Date.UTC(y, mo, 1));
        scopeDays = daysInMonth(y, mo);
      } else {
        const y = day.getUTCFullYear();
        scopeStart = new Date(Date.UTC(y, 0, 1));
        scopeDays = isLeap(y) ? 366 : 365;
      }
    } else {
      return true; // ordinals are not meaningful outside MONTHLY/YEARLY
    }
    const hit = nthWeekdayInRange(scopeStart, scopeDays, n, target);
    if (hit && hit.getTime() === dayMs) return true;
  }
  return false;
}

function dayPassesDateFilters(day, parts, wkst) {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth() + 1;
  const d = day.getUTCDate();
  if (parts.BYMONTH && !parts.BYMONTH.includes(m)) return false;
  if (parts.BYMONTHDAY && !monthdayMatch(d, daysInMonth(y, m - 1), parts.BYMONTHDAY)) return false;
  if (parts.BYDAY && parts.BYDAY.length && !bydayMatch(day, parts.BYDAY, 'DAILY', parts)) return false;
  if (parts.BYYEARDAY && !yeardayMatch(day, parts.BYYEARDAY)) return false;
  if (parts.BYWEEKNO && !weeknoMatch(day, parts.BYWEEKNO, wkst)) return false;
  return true;
}

function dayMatchesFull(day, parts, freq, dtstart, wkst) {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth() + 1;
  const d = day.getUTCDate();

  if (parts.BYMONTH && !parts.BYMONTH.includes(m)) return false;
  if (parts.BYWEEKNO && !weeknoMatch(day, parts.BYWEEKNO, wkst)) return false;
  if (parts.BYYEARDAY && !yeardayMatch(day, parts.BYYEARDAY)) return false;
  if (parts.BYMONTHDAY && !monthdayMatch(d, daysInMonth(y, m - 1), parts.BYMONTHDAY)) return false;
  if (parts.BYDAY && parts.BYDAY.length && !bydayMatch(day, parts.BYDAY, freq, parts)) return false;

  const hasDayRule = (parts.BYDAY && parts.BYDAY.length) || (parts.BYMONTHDAY && parts.BYMONTHDAY.length);
  if (!hasDayRule) {
    // Default day semantics taken from DTSTART.
    if (freq === 'MONTHLY') return d === dtstart.getUTCDate();
    if (freq === 'YEARLY') {
      if (parts.BYMONTH && parts.BYMONTH.length) return d === dtstart.getUTCDate();
      return m === dtstart.getUTCMonth() + 1 && d === dtstart.getUTCDate();
    }
    if (freq === 'WEEKLY') return day.getUTCDay() === dtstart.getUTCDay();
    // DAILY: every day matches
  }
  return true;
}

// ---- period iteration -------------------------------------------------------

function periodStartFor(freq, dtstart, wkst) {
  const y = dtstart.getUTCFullYear();
  const mo = dtstart.getUTCMonth();
  switch (freq) {
    case 'YEARLY': return new Date(Date.UTC(y, 0, 1));
    case 'MONTHLY': return new Date(Date.UTC(y, mo, 1));
    case 'WEEKLY': return weekStartDate(dtstart, wkst);
    case 'DAILY': return startOfDayUtc(dtstart);
    case 'HOURLY': return new Date(Date.UTC(y, mo, dtstart.getUTCDate(), dtstart.getUTCHours()));
    case 'MINUTELY': return new Date(Date.UTC(y, mo, dtstart.getUTCDate(), dtstart.getUTCHours(), dtstart.getUTCMinutes()));
    default: return new Date(Math.floor(dtstart.getTime() / 1000) * 1000);
  }
}

function advance(freq, cursor, interval) {
  const y = cursor.getUTCFullYear();
  const mo = cursor.getUTCMonth();
  switch (freq) {
    case 'YEARLY': return new Date(Date.UTC(y + interval, 0, 1));
    case 'MONTHLY': return new Date(Date.UTC(y, mo + interval, 1));
    case 'WEEKLY': return addDays(cursor, 7 * interval);
    case 'DAILY': return addDays(cursor, interval);
    case 'HOURLY': return new Date(cursor.getTime() + interval * 3600000);
    case 'MINUTELY': return new Date(cursor.getTime() + interval * 60000);
    default: return new Date(cursor.getTime() + interval * 1000);
  }
}

function periodRange(periodStart, freq) {
  if (freq === 'YEARLY') {
    const y = periodStart.getUTCFullYear();
    return { rangeStart: new Date(Date.UTC(y, 0, 1)), rangeDays: isLeap(y) ? 366 : 365 };
  }
  if (freq === 'MONTHLY') {
    const y = periodStart.getUTCFullYear();
    const mo = periodStart.getUTCMonth();
    return { rangeStart: new Date(Date.UTC(y, mo, 1)), rangeDays: daysInMonth(y, mo) };
  }
  if (freq === 'WEEKLY') {
    return { rangeStart: periodStart, rangeDays: 7 };
  }
  return { rangeStart: periodStart, rangeDays: 1 };
}

function expandTimes(parts, dtstart) {
  const hours = parts.BYHOUR && parts.BYHOUR.length ? uniqSorted(parts.BYHOUR) : [dtstart.getUTCHours()];
  const minutes = parts.BYMINUTE && parts.BYMINUTE.length ? uniqSorted(parts.BYMINUTE) : [dtstart.getUTCMinutes()];
  const seconds = parts.BYSECOND && parts.BYSECOND.length ? uniqSorted(parts.BYSECOND) : [dtstart.getUTCSeconds()];
  const out = [];
  for (const h of hours) for (const m of minutes) for (const s of seconds) out.push({ h, m, s });
  return out;
}

function applySetPos(list, setpos) {
  if (!setpos || !setpos.length) return list;
  const picks = new Set();
  for (const p of setpos) {
    const idx = p > 0 ? p - 1 : list.length + p;
    if (idx >= 0 && idx < list.length) picks.add(idx);
  }
  return [...picks].sort((a, b) => a - b).map((i) => list[i]);
}

function subDailyCandidates(cursor, freq, parts, dtstart, wkst) {
  const y = cursor.getUTCFullYear();
  const mo = cursor.getUTCMonth();
  const d = cursor.getUTCDate();
  const day = new Date(Date.UTC(y, mo, d));
  if (!dayPassesDateFilters(day, parts, wkst)) return [];

  const out = [];
  if (freq === 'HOURLY') {
    const H = cursor.getUTCHours();
    if (parts.BYHOUR && !parts.BYHOUR.includes(H)) return [];
    const minutes = parts.BYMINUTE && parts.BYMINUTE.length ? uniqSorted(parts.BYMINUTE) : [dtstart.getUTCMinutes()];
    const seconds = parts.BYSECOND && parts.BYSECOND.length ? uniqSorted(parts.BYSECOND) : [dtstart.getUTCSeconds()];
    for (const m of minutes) for (const s of seconds) out.push(new Date(Date.UTC(y, mo, d, H, m, s)));
  } else if (freq === 'MINUTELY') {
    const H = cursor.getUTCHours();
    const Mi = cursor.getUTCMinutes();
    if (parts.BYHOUR && !parts.BYHOUR.includes(H)) return [];
    if (parts.BYMINUTE && !parts.BYMINUTE.includes(Mi)) return [];
    const seconds = parts.BYSECOND && parts.BYSECOND.length ? uniqSorted(parts.BYSECOND) : [dtstart.getUTCSeconds()];
    for (const s of seconds) out.push(new Date(Date.UTC(y, mo, d, H, Mi, s)));
  } else {
    const H = cursor.getUTCHours();
    const Mi = cursor.getUTCMinutes();
    const S = cursor.getUTCSeconds();
    if (parts.BYHOUR && !parts.BYHOUR.includes(H)) return [];
    if (parts.BYMINUTE && !parts.BYMINUTE.includes(Mi)) return [];
    if (parts.BYSECOND && !parts.BYSECOND.includes(S)) return [];
    out.push(new Date(Date.UTC(y, mo, d, H, Mi, S)));
  }
  out.sort((a, b) => a - b);
  return applySetPos(out, parts.BYSETPOS);
}

function periodCandidates(periodStart, freq, parts, dtstart, wkst) {
  if (freq === 'HOURLY' || freq === 'MINUTELY' || freq === 'SECONDLY') {
    return subDailyCandidates(periodStart, freq, parts, dtstart, wkst);
  }
  const { rangeStart, rangeDays } = periodRange(periodStart, freq);
  const days = [];
  for (let i = 0; i < rangeDays; i++) {
    const d = addDays(rangeStart, i);
    if (dayMatchesFull(d, parts, freq, dtstart, wkst)) days.push(d);
  }
  const times = expandTimes(parts, dtstart);
  const list = [];
  for (const d of days) {
    for (const t of times) {
      list.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), t.h, t.m, t.s)));
    }
  }
  list.sort((a, b) => a - b);
  return applySetPos(list, parts.BYSETPOS);
}

// ---- text description -------------------------------------------------------

function ordinal(n) {
  const abs = Math.abs(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const v = abs % 100;
  return abs + (s[(v - 20) % 10] || s[v] || s[0]);
}

function joinList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function humanize(parts) {
  const freq = parts.FREQ;
  const interval = parts.INTERVAL || 1;
  const unit = {
    SECONDLY: ['second', 'seconds'],
    MINUTELY: ['minute', 'minutes'],
    HOURLY: ['hour', 'hours'],
    DAILY: ['day', 'days'],
    WEEKLY: ['week', 'weeks'],
    MONTHLY: ['month', 'months'],
    YEARLY: ['year', 'years'],
  }[freq] || ['period', 'periods'];

  let text = interval === 1 ? `Every ${unit[0]}` : `Every ${interval} ${unit[1]}`;

  if (parts.BYDAY && parts.BYDAY.length) {
    const items = parts.BYDAY.map((entry) => {
      const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(entry);
      if (!m) return entry;
      const name = WEEKDAY_FULL[WD[m[2]]];
      if (!m[1]) return name;
      const n = parseInt(m[1], 10);
      return `the ${n === -1 ? 'last' : ordinal(n)} ${name}`;
    });
    text += ` on ${joinList(items)}`;
  }
  if (parts.BYMONTHDAY && parts.BYMONTHDAY.length) {
    const items = parts.BYMONTHDAY.map((v) => {
      if (v === -1) return 'the last day';
      if (v < 0) return `the ${ordinal(Math.abs(v))} to last day`;
      return `the ${ordinal(v)}`;
    });
    text += ` on ${joinList(items)}`;
  }
  if (parts.BYMONTH && parts.BYMONTH.length) {
    text += ` in ${joinList(parts.BYMONTH.map((m) => MONTH_FULL[m - 1]))}`;
  }
  if (parts.BYYEARDAY && parts.BYYEARDAY.length) {
    text += ` on day ${joinList(parts.BYYEARDAY.map(String))}`;
  }
  if (parts.BYWEEKNO && parts.BYWEEKNO.length) {
    text += ` in week ${joinList(parts.BYWEEKNO.map(String))}`;
  }
  if (parts.BYHOUR && parts.BYHOUR.length) {
    text += ` at hour ${joinList(parts.BYHOUR.map(String))}`;
  }
  if (parts.BYSETPOS && parts.BYSETPOS.length) {
    text += ` (taking ${joinList(parts.BYSETPOS.map((v) => ordinal(v)))} in each period)`;
  }
  if (parts.COUNT) text += `, ${parts.COUNT} times`;
  if (parts.UNTIL) {
    const d = parseDateTime(parts.UNTIL);
    text += `, until ${d ? iso(d) : parts.UNTIL}`;
  }
  return text;
}

// ---- endpoint handlers ------------------------------------------------------

function normalizePartsOutput(parts) {
  return {
    FREQ: parts.FREQ || null,
    INTERVAL: parts.INTERVAL === undefined ? 1 : parts.INTERVAL,
    COUNT: parts.COUNT === undefined ? null : parts.COUNT,
    UNTIL: parts.UNTIL === undefined ? null : parts.UNTIL,
    BYDAY: parts.BYDAY || null,
    BYMONTHDAY: parts.BYMONTHDAY || null,
    BYMONTH: parts.BYMONTH || null,
    BYSETPOS: parts.BYSETPOS || null,
    WKST: parts.WKST || 'MO',
    BYYEARDAY: parts.BYYEARDAY || null,
    BYWEEKNO: parts.BYWEEKNO || null,
    BYHOUR: parts.BYHOUR || null,
    BYMINUTE: parts.BYMINUTE || null,
    BYSECOND: parts.BYSECOND || null,
  };
}

const MAX_PERIODS = 200000;

function expand(params) {
  need(params, ['rrule']);

  const extracted = extractFromSource(String(params.rrule));
  const dtstartRaw = params.dtstart || extracted.dtstart;
  if (!dtstartRaw) badRequest('Missing required parameter: "dtstart"');

  const dtstart = parseDateTime(dtstartRaw);
  if (!dtstart) badRequest('Invalid "dtstart": expected ISO 8601 or iCalendar date-time');

  const { parts, errors } = parseRRuleLine(extracted.rruleLine);
  const allErrors = errors.concat(validateParts(parts));
  if (allErrors.length) badRequest(`Invalid RRULE: ${allErrors.join('; ')}`);

  const freq = parts.FREQ;
  const interval = parts.INTERVAL || 1;
  const wkst = parts.WKST || 'MO';

  let until = null;
  if (parts.UNTIL !== undefined) {
    until = parseDateTime(parts.UNTIL);
    if (!until) badRequest(`Invalid UNTIL "${parts.UNTIL}"`);
    if (isDateOnly(parts.UNTIL)) until = new Date(until.getTime() + 86399000); // end of day
  }

  const requested = params.count === undefined || params.count === ''
    ? 10
    : Math.round(Number(params.count));
  if (!Number.isFinite(requested) || requested < 1 || requested > 500) {
    badRequest('Parameter "count" must be an integer between 1 and 500');
  }

  const ruleCount = parts.COUNT || Infinity;
  const limit = Math.min(requested, ruleCount);

  const exdates = new Set();
  if (params.exdate) {
    for (const piece of String(params.exdate).split(',')) {
      const t = piece.trim();
      if (!t) continue;
      const d = parseDateTime(t);
      if (!d) badRequest(`Invalid EXDATE "${t}"`);
      exdates.add(d.getTime());
    }
  }

  const occurrences = [];
  let cursor = periodStartFor(freq, dtstart, wkst);
  const horizon = Date.UTC(dtstart.getUTCFullYear() + 200, dtstart.getUTCMonth(), dtstart.getUTCDate());
  let exhausted = false;
  let periods = 0;
  const dtMs = dtstart.getTime();

  while (occurrences.length < limit) {
    if (periods++ > MAX_PERIODS || cursor.getTime() > horizon) { exhausted = true; break; }

    const candidates = periodCandidates(cursor, freq, parts, dtstart, wkst);
    let stop = false;
    for (const c of candidates) {
      if (c.getTime() < dtMs) continue;
      if (until && c.getTime() > until.getTime()) { exhausted = true; stop = true; break; }
      if (exdates.has(c.getTime())) continue;
      occurrences.push(c);
      if (occurrences.length >= limit) { stop = true; break; }
    }
    if (stop) break;
    cursor = advance(freq, cursor, interval);
  }

  if (occurrences.length < requested) exhausted = true;
  if (Number.isFinite(ruleCount) && occurrences.length >= ruleCount) exhausted = true;

  const result = {
    rrule: extracted.rruleLine,
    dtstart: iso(dtstart),
    occurrences: occurrences.map(iso),
    count: occurrences.length,
    exhausted,
  };
  if (params.tzid) {
    result.notes = `tzid "${params.tzid}" accepted, but recurrence expansion is computed in UTC. Supply dtstart and EXDATE values with an explicit Z or offset; full IANA time-zone/DST conversion is not applied.`;
  }
  return result;
}

function describe(params) {
  need(params, ['rrule']);
  const extracted = extractFromSource(String(params.rrule));
  const { parts, errors } = parseRRuleLine(extracted.rruleLine);
  const allErrors = errors.concat(validateParts(parts));
  if (allErrors.length) badRequest(`Invalid RRULE: ${allErrors.join('; ')}`);
  return { rrule: extracted.rruleLine, text: humanize(parts) };
}

function validate(params) {
  need(params, ['rrule']);
  const extracted = extractFromSource(String(params.rrule));
  const { parts, errors } = parseRRuleLine(extracted.rruleLine);
  const allErrors = errors.concat(validateParts(parts));
  return {
    rrule: extracted.rruleLine,
    valid: allErrors.length === 0,
    parts: normalizePartsOutput(parts),
    errors: allErrors,
  };
}

module.exports = {
  prefix: '/rrule/v1',
  name: 'Recurrence Rule Expander',
  tagline: 'Expand & describe iCalendar RRULE strings (RFC 5545) into concrete occurrence dates.',
  description:
    'Recurrence Rule Expander implements the full RFC 5545 RRULE semantics in UTC: FREQ/INTERVAL/COUNT/UNTIL, ordinal BYDAY (e.g. 2MO, -1FR), BYSETPOS, negative BYMONTHDAY (-1 = last day), BYMONTH/BYYEARDAY/BYWEEKNO/BYHOUR/BYMINUTE/BYSECOND, WKST-aware weeks, correct month-length overflow and EXDATE exclusion. It returns concrete occurrence instants or a plain-English description. Built for calendar/scheduling SaaS, HR payroll cycles, maintenance planning and booking systems.',
  freeTier: 30,
  endpoints: [
    {
      path: '/expand',
      method: 'POST',
      summary: 'Expand an RRULE into concrete occurrence date-times',
      operationId: 'expandRRule',
      params: [
        { name: 'rrule', type: 'string', required: true, description: 'RRULE string, e.g. "FREQ=WEEKLY;COUNT=10"; may be wrapped as "DTSTART:19970902T090000Z;RRULE:FREQ=WEEKLY;COUNT=10"', example: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4' },
        { name: 'dtstart', type: 'string', required: true, description: 'Start date-time (ISO 8601 or iCalendar basic form)', example: '1997-09-02T09:00:00Z' },
        { name: 'count', type: 'integer', required: false, description: 'Max occurrences to return (default 10, max 500)', example: 10 },
        { name: 'exdate', type: 'string', required: false, description: 'Comma-separated exclusion dates', example: '1997-09-16T09:00:00Z' },
        { name: 'tzid', type: 'string', required: false, description: 'Optional IANA time-zone id (accepted; expansion is still UTC-based)', example: 'America/New_York' },
      ],
      handler: expand,
    },
    {
      path: '/describe',
      method: 'POST',
      summary: 'Describe an RRULE in plain English',
      operationId: 'describeRRule',
      params: [
        { name: 'rrule', type: 'string', required: true, description: 'RRULE string to describe', example: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10' },
      ],
      handler: describe,
    },
    {
      path: '/validate',
      method: 'GET',
      summary: 'Validate an RRULE and list its parsed parts',
      operationId: 'validateRRule',
      params: [
        { name: 'rrule', type: 'string', required: true, description: 'RRULE string to validate', example: 'FREQ=MONTHLY;BYDAY=2MO;COUNT=3' },
      ],
      handler: validate,
    },
  ],
};
