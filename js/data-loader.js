// Status checking and parsing shared by every schedule request. Keeping these
// functions independent of the UI makes a stalled or invalid response testable
// without booting the application controller.
import { mark, measure } from './engine.js';

export function answered(response) {
  // fetch resolves on a 5xx. Without this guard a body such as `503` is valid
  // JSON and reaches the application disguised as a schedule.
  if (!response.ok) throw new Error(`${response.status} for ${response.url}`);
  return response;
}

export function fetchJson(url, signal, fetcher = globalThis.fetch) {
  return fetcher(url, signal ? { signal } : undefined).then(answered).then((response) => response.json());
}

export async function parsedIndex(
  url,
  signal,
  { fetcher = globalThis.fetch, markFn = mark, measureFn = measure } = {},
) {
  // The room index dominates the JSON on the first-answer path. Reading text
  // keeps its otherwise hidden parse cost inside the same timing marks used by
  // the performance diagnostics.
  const text = await fetcher(url, { signal }).then(answered).then((response) => response.text());
  markFn('vacant:parse:start');
  const out = JSON.parse(text);
  markFn('vacant:parse:end');
  measureFn('vacant:parse', 'vacant:parse:start', 'vacant:parse:end');
  return out;
}
