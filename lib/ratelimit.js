'use strict';

/**
 * In-memory sliding-window rate limiter.
 * RapidAPI enforces plan quotas itself, but a server-side cap protects
 * the backend from abuse and lets us honor "X requests/month" tiers.
 */

const buckets = new Map(); // key -> { count, windowStart }

const WINDOW_MS = 60 * 1000; // per-minute window for burst protection

function rateLimit(key, maxPerMinute) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  // Lazy cleanup to keep memory bounded.
  if (buckets.size > 50000) {
    for (const [k, b] of buckets) {
      if (now - b.windowStart >= WINDOW_MS) buckets.delete(k);
    }
  }

  const allowed = bucket.count <= maxPerMinute;
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000),
    remaining: Math.max(0, maxPerMinute - bucket.count),
  };
}

module.exports = { rateLimit };
