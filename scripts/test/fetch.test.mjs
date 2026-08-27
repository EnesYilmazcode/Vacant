// Offline. Every fetch is a stub, so `node --test` makes zero network calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  config,
  fetchJson,
  fetchWith,
  mapLimit,
  requests,
  resetRequests,
  retryAfterMs,
  setRequests,
} from '../lib/fetch.mjs';

// A stub Response good enough for fetchWith: status, statusText, ok, headers,
// and a json()/text() body.
function stub(status, body = {}, headers = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    headers: { get: (k) => map.get(k.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// Replays a queue of responses and records every call.
function scripted(responses) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    const next = responses.shift();
    if (next === undefined) throw new Error('stub ran out of responses');
    if (next instanceof Error) throw next;
    return next;
  };
  impl.calls = calls;
  return impl;
}

test('retries a 429 and returns the eventual body', async () => {
  resetRequests();
  const impl = scripted([stub(429), stub(200, { ok: true })]);
  const out = await fetchJson('https://example.test/x', { fetchImpl: impl });
  assert.deepEqual(out, { ok: true });
  assert.equal(impl.calls.length, 2);
  assert.equal(requests(), 2, 'both attempts count against the cap');
});

test('a 403 gets exactly one bonus retry, then goes fatal', async () => {
  resetRequests();
  const impl = scripted([stub(403), stub(403), stub(200, { never: true })]);
  await assert.rejects(
    () => fetchJson('https://example.test/x', { fetchImpl: impl }),
    /403/,
    'the second 403 is a block, not a twitchy WAF',
  );
  assert.equal(impl.calls.length, 2, 'stops after the bonus retry, never reaches the 200');
});

test('a 404 is fatal by default and null under allow404', async () => {
  resetRequests();
  await assert.rejects(
    () => fetchJson('https://example.test/x', { fetchImpl: scripted([stub(404)]) }),
    /404/,
  );
  resetRequests();
  const out = await fetchJson('https://example.test/x', {
    allow404: true,
    fetchImpl: scripted([stub(404)]),
  });
  assert.equal(out, null);
});

test('a 400 is fatal and is never retried', async () => {
  resetRequests();
  const impl = scripted([stub(400), stub(200, { never: true })]);
  await assert.rejects(() => fetchJson('https://example.test/x', { fetchImpl: impl }), /400/);
  assert.equal(impl.calls.length, 1);
});

test('a 500 is retried up to RETRIES times, then throws', async () => {
  resetRequests();
  const impl = scripted([stub(500), stub(500), stub(500), stub(500)]);
  await assert.rejects(() => fetchJson('https://example.test/x', { fetchImpl: impl }), /500/);
  assert.equal(impl.calls.length, config.RETRIES + 1, 'one first try plus RETRIES retries');
});

test('retryAfterMs reads seconds, reads a date, and clamps to 30 s', () => {
  assert.equal(retryAfterMs('5'), 5000);
  assert.equal(retryAfterMs('  7  '), 7000);
  assert.equal(retryAfterMs('3600'), config.MAX_RETRY_AFTER_MS, 'an hour clamps to 30 s');
  assert.equal(retryAfterMs(new Date(Date.now() + 3_600_000).toUTCString()), config.MAX_RETRY_AFTER_MS);
  assert.equal(retryAfterMs(null), 0);
  assert.equal(retryAfterMs('later'), 0, 'unparseable falls back to ordinary backoff');
  assert.equal(retryAfterMs(new Date(Date.now() - 60_000).toUTCString()), 0, 'a past date is 0');
});

test('a missing headers object does not throw over the absent Retry-After', async () => {
  resetRequests();
  const bare = { status: 503, statusText: '503', ok: false, json: async () => ({}) };
  const impl = scripted([bare, stub(200, { ok: true })]);
  assert.deepEqual(await fetchJson('https://example.test/x', { fetchImpl: impl }), { ok: true });
});

test('the request cap aborts before the fetch, and says so', async () => {
  resetRequests();
  setRequests(config.MAX_REQUESTS - 1);
  const impl = scripted([stub(200, { last: true }), stub(200, { never: true })]);
  assert.deepEqual(await fetchJson('https://example.test/x', { fetchImpl: impl }), { last: true });
  await assert.rejects(
    () => fetchJson('https://example.test/x', { fetchImpl: impl }),
    /request cap reached/,
  );
  assert.equal(impl.calls.length, 1, 'the capped call never reaches fetch');
  resetRequests();
});

test('the user agent names the project, the repo and the volume', () => {
  assert.match(config.USER_AGENT, /Vacant/);
  assert.match(config.USER_AGENT, /github\.com\/EnesYilmazcode\/Vacant/);
  assert.match(config.USER_AGENT, /requests\/week/);
});

test('no Accept-Encoding header is set by hand', async () => {
  resetRequests();
  const impl = scripted([stub(200, {})]);
  await fetchJson('https://example.test/x', { fetchImpl: impl });
  const headers = impl.calls[0].opts.headers;
  const keys = Object.keys(headers).map((k) => k.toLowerCase());
  assert.ok(!keys.includes('accept-encoding'), 'undici negotiates and decodes it for us');
});

test('the timeout is 60 s, not Finder inherited 30', () => {
  assert.equal(config.TIMEOUT_MS, 60000);
});

test('mapLimit keeps input order and runs at most CONCURRENCY at once', async () => {
  resetRequests();
  let live = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], async (n) => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= config.CONCURRENCY, `peak ${peak} exceeded CONCURRENCY ${config.CONCURRENCY}`);
});

test('fetchWith passes the parsed response through untouched', async () => {
  resetRequests();
  const impl = scripted([stub(200, { a: 1 })]);
  const out = await fetchWith('https://example.test/x', (res) => res.status, { fetchImpl: impl });
  assert.equal(out, 200);
});

// --- regressions found by code review, 2026-08-26 ---

test('the 403 bonus retry is spent per RUN, not refreshed per request', async () => {
  resetRequests();
  // First call spends the one bonus retry.
  const a = scripted([stub(403), stub(200, { ok: true })]);
  assert.deepEqual(await fetchJson('https://example.test/a', { fetchImpl: a }), { ok: true });

  // Second call must NOT get another one. Under a real NetScaler block a 272
  // request harvest would otherwise issue 544 against a WAF already refusing it.
  const b = scripted([stub(403), stub(200, { never: true })]);
  await assert.rejects(() => fetchJson('https://example.test/b', { fetchImpl: b }), /403/);
  assert.equal(b.calls.length, 1, 'no second bonus retry within the same run');

  resetRequests();
  const c = scripted([stub(403), stub(200, { ok: true })]);
  assert.deepEqual(await fetchJson('https://example.test/c', { fetchImpl: c }), { ok: true });
});

test('the fatal flag survives the rewrap, so callers can tell stop from skip', async () => {
  resetRequests();
  const err = await fetchJson('https://example.test/x', {
    fetchImpl: scripted([stub(400)]),
  }).catch((e) => e);
  assert.equal(err.fatal, true, 'a non-retryable 4xx must stay fatal to the caller');

  resetRequests();
  const soft = await fetchJson('https://example.test/x', {
    fetchImpl: scripted([stub(500), stub(500), stub(500), stub(500)]),
  }).catch((e) => e);
  assert.notEqual(soft.fatal, true, 'an exhausted retry ladder is not fatal');
});

test('the request cap error reaches the caller as fatal', async () => {
  resetRequests();
  setRequests(config.MAX_REQUESTS);
  const err = await fetchJson('https://example.test/x', {
    fetchImpl: scripted([stub(200, {})]),
  }).catch((e) => e);
  assert.match(err.message, /request cap reached/);
  assert.equal(err.fatal, true);
  resetRequests();
});

test('mapLimit stops the other runners when one fails', async () => {
  resetRequests();
  let started = 0;
  const items = Array.from({ length: 40 }, (_, i) => i);
  await assert.rejects(() =>
    mapLimit(items, async (n) => {
      started++;
      if (n === 1) throw new Error('boom');
      await new Promise((r) => setTimeout(r, 1));
      return n;
    }),
  );
  // Without the shared stop flag the surviving runner walks all 40, burning
  // requests against MAX_REQUESTS with nothing able to stop it.
  assert.ok(started < items.length, `started ${started} of ${items.length} after a failure`);
});
