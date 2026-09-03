// The clock the screenshots are taken on, as source to inject into the page.
//
// Two clocks have to be pinned and only one of them is obvious.
//
// `Date` is the obvious one. Every row prints "till 3:00pm" off Date.now(), so
// an unpinned capture answers a different question every run.
//
// The animation clock is the one that got missed. js/app.js starts the flyover
// at performance.now() and drives its camera from the requestAnimationFrame
// timestamp, and neither of those is Date. Leaving them running rewrote
// docs/media/ask.webp on every run: three runs of scripts/shoot.mjs on an
// unchanged tree wrote three different files, 215, 221 and 219 distinct
// colours, while the other four frames came out byte identical every time.
//
// Both are pinned to the same instant, which leaves the flyover on the first
// frame it draws rather than wherever the sleep happened to land.
//
// This is a string because it is injected before the page's own scripts run,
// and it lives here rather than inside the shooter so it can be checked
// without a browser.
//
// `animation: false` pins the wall clock and leaves performance.now() and the
// frame timestamp alone. scripts/launch-desktop.mjs needs that half: it has to
// fix the date, because the app refuses to rank outside scheduled hours and a
// run started at 9pm measures a boot that answers nothing, but pinning
// performance.now() there would pin the thing it is measuring.

export function pinnedClockSource(ms, { animation = true } = {}) {
  if (!Number.isFinite(ms)) throw new TypeError('pinnedClockSource needs a timestamp in ms');
  return `(() => {
  const Real = Date;
  function Frozen(...a) {
    if (!new.target) return new Real(${ms}).toString();
    return a.length ? new Real(...a) : new Real(${ms});
  }
  Frozen.prototype = Real.prototype;
  Frozen.now = () => ${ms};
  Frozen.parse = Real.parse;
  Frozen.UTC = Real.UTC;
  globalThis.Date = Frozen;

${
    animation
      ? `
  // The flyover reads (frame timestamp - performance.now() at boot), so the
  // two have to agree or the camera drifts. Zero for both is the one value
  // that makes the difference zero however long the boot took.
  if (globalThis.performance) globalThis.performance.now = () => 0;
  const real = globalThis.requestAnimationFrame;
  if (real) {
    globalThis.requestAnimationFrame = (fn) => real.call(globalThis, () => fn(0));
  }`
      : ''
  }
})();`;
}
