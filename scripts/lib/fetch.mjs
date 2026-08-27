// The one HTTP client every script in this repo uses.
//
// Ported from EnesYilmazcode/Finder scripts/fetch-courses.mjs:84-149, retuned.
// Finder runs CONCURRENCY 5 at DELAY_MS 120 against a box that answers in 128 ms
// p50, which sustains about 15.6 req/s. That is the request shape that looks
// like an attack in a log. Vacant needs 136 requests a week, so it can afford
// to be slow.
//
// content.osu.edu sends no rate-limit, ETag, Last-Modified or Cache-Control
// header, so there is no conditional GET to fall back on. Fewer, slower
// requests is the only lever there is.

const CONCURRENCY = 2;
const DELAY_MS = 500;
const RETRIES = 3;
const TIMEOUT_MS = 60000;

// 408 and 425 ask for the request again and a 429 clears on its own. The rest
// of 4xx will not fix itself. A 5xx or a timeout might.
const RETRY_STATUS = new Set([408, 425, 429]);

// Retry-After can name an hour, longer than a run will spend on one request.
const MAX_RETRY_AFTER_MS = 30000;

// A runaway loop against a university's API is the failure that gets the whole
// project blocked. A full two-pass term harvest is 272 requests, so 3000 is an
// order of magnitude of headroom and still nowhere near abusive.
const MAX_REQUESTS = 3000;

const USER_AGENT =
  'Vacant/0.1 (+https://github.com/EnesYilmazcode/Vacant; ' +
  'contact via repo issues) weekly classroom-schedule index, ~280 requests/week';

let requestCount = 0;

// Per RUN, not per request. The comment on the 403 branch says a repeat across a
// run is a block rather than a twitchy WAF, and a flag scoped inside fetchWith
// resets on every call, so a 272 request harvest would issue 544 against a WAF
// already refusing it.
let retriedForbidden = false;

export const requests = () => requestCount;
export const resetRequests = () => {
  requestCount = 0;
  retriedForbidden = false;
};

// Tests only, so the cap can be exercised without making 3000 stub calls.
export const setRequests = (n) => {
  requestCount = n;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry-After is either a count of seconds or an HTTP date. Anything else, or a
// date already past, leaves the ordinary backoff in charge.
export function retryAfterMs(header) {
  if (!header) return 0;
  const seconds = /^\s*\d+\s*$/.test(header) ? Number(header) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!(ms > 0)) return 0;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

export async function fetchWith(url, parse, { allow404 = false, fetchImpl = fetch } = {}) {
  let lastError;
  let wait = 0;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(wait || 500 * 2 ** (attempt - 1));
    wait = 0;

    if (requestCount >= MAX_REQUESTS) {
      const err = new Error(
        `request cap reached: ${requestCount} requests, refusing to fetch ${url}`,
      );
      err.fatal = true;
      throw err;
    }
    requestCount++;

    try {
      // No Accept-Encoding by hand. undici negotiates and decodes it; setting it
      // ourselves means we get a gzip body back and never decompress it.
      const res = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json,text/html' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.status === 404 && allow404) return null;

      if (res.status >= 400 && res.status < 500) {
        let retryable = RETRY_STATUS.has(res.status);
        // The API sits behind a Citrix NetScaler WAF, so a burst comes back as
        // 403 rather than 429. One bonus retry separates a twitchy WAF from a
        // real block: if 403s repeat across a run instead of clearing, stop.
        if (res.status === 403 && !retriedForbidden) {
          retriedForbidden = true;
          retryable = true;
        }
        if (!retryable) {
          const err = new Error(`${res.status} ${res.statusText}`);
          err.fatal = true;
          throw err;
        }
      }

      if (!res.ok) {
        // A stub response with no headers still has to be reported by status
        // rather than throw over the Retry-After that is not there.
        wait = retryAfterMs(res.headers?.get?.('retry-after'));
        lastError = new Error(`${res.status} ${res.statusText}`);
        continue;
      }

      return await parse(res);
    } catch (err) {
      lastError = err;
      if (err.fatal) break;
    }
  }

  const err = new Error(`GET ${url} failed: ${lastError?.message ?? 'unknown'}`);
  // Callers distinguish "stop the whole run" from "skip this item", which is the
  // only reason the flag exists. Rewrapping into a plain Error threw it away.
  if (lastError?.fatal) err.fatal = true;
  err.cause = lastError;
  throw err;
}

export const fetchJson = (url, opts) => fetchWith(url, (res) => res.json(), opts);
export const fetchText = (url, opts) => fetchWith(url, (res) => res.text(), opts);

export async function mapLimit(items, worker, limit = CONCURRENCY) {
  const out = new Array(items.length);
  let next = 0;
  // Promise.all rejects on the first failure but does not stop the other
  // runners, which keep issuing requests against MAX_REQUESTS with no way for
  // the caller to stop them. One shared flag ends the walk.
  let stopped = false;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !stopped) {
      const i = next++;
      try {
        out[i] = await worker(items[i], i);
      } catch (err) {
        stopped = true;
        throw err;
      }
      // Space the requests, but not after the last one. A trailing pause per
      // runner added DELAY_MS to every call for nothing.
      if (next < items.length && !stopped) await sleep(DELAY_MS);
    }
  });

  await Promise.all(runners);
  return out;
}

export const config = {
  CONCURRENCY,
  DELAY_MS,
  RETRIES,
  TIMEOUT_MS,
  MAX_RETRY_AFTER_MS,
  MAX_REQUESTS,
  USER_AGENT,
};
