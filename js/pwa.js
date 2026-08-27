// Registration, updates, and the two bars that are not the app: the install hint
// and the "schedule updated" notice.
//
// Loaded before app.js so the offline card can be up before boot's first fetch
// has had time to fail.

import { initInstallHint, mountBar, unmountBar } from './install.js';
import { initFirstRun } from './firstrun.js';

const SCOPE = '/Vacant/';
const RELOAD_GUARD = 'vacant.swReload';

// A tap, a key, or a scroll means the user is reading something. After that an
// update is allowed to land but is never allowed to yank the page out from
// under them.
let touched = false;
for (const type of ['pointerdown', 'keydown', 'wheel']) {
  addEventListener(type, () => { touched = true; }, { once: true, passive: true });
}

// Nothing here waits on the app, and the app does not wait on any of it.
initFirstRun();
initInstallHint();
register();

// Returns whether it reloaded, so a caller that had something to say can say it
// instead of silently doing nothing on the second call.
function reloadOnce(win = window) {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD)) return false;
    sessionStorage.setItem(RELOAD_GUARD, '1');
  } catch {
    // No session storage. controllerchange fires once per worker anyway, so the
    // reload is still bounded without it.
  }
  win.location.reload();
  return true;
}

async function register() {
  if (!('serviceWorker' in navigator)) return;

  // Pages caps every asset at max-age=600 and gives no way to change it, so a
  // frequently reloading user can read a cached copy of the worker script
  // indefinitely. updateViaCache 'none' is what stops ten minutes from becoming
  // forever, and it is the single most load-bearing option on this call.
  let reg;
  try {
    reg = await navigator.serviceWorker.register(`${SCOPE}sw.js`, {
      scope: SCOPE,
      updateViaCache: 'none',
    });
  } catch {
    // No worker means no offline, and nothing else about the app changes.
    return;
  }

  // True only when a worker was already driving this page before it loaded. The
  // first install claims the page too, and reloading for that would reload every
  // first visit.
  const hadController = Boolean(navigator.serviceWorker.controller);

  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    if (!next) return;
    next.addEventListener('statechange', () => {
      // The live controller, not hadController. A worker installed while no
      // worker controls the page is the first one and activates by itself;
      // measured, using the page-load snapshot here left the second deploy
      // waiting forever and the old shell cache never got collected.
      if (next.state !== 'installed' || !navigator.serviceWorker.controller) return;
      // A waiting worker serves nobody. Told to skip, it activates now, so the
      // NEXT launch of the installed icon gets the new shell rather than the
      // launch after that.
      next.postMessage('SKIP_WAITING');
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || touched) return;
    reloadOnce();
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'vacant:data-updated') return;
    // Nobody has touched anything, so nothing is lost by just taking the new
    // schedule. If this session already spent its one reload, say it out loud
    // rather than swallowing the news.
    if (!touched && reloadOnce()) return;
    showRefresh();
  });

  // Delivery to navigator.serviceWorker is suspended until the page either sets
  // onmessage or asks for it. With addEventListener alone the worker's messages
  // queue and never arrive; measured, the "schedule updated" bar never appeared
  // once until this line existed.
  navigator.serviceWorker.startMessages();

  // iOS freezes a backgrounded web app, so an installed icon can go days without
  // ever checking. Coming back to the foreground is when it checks.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

// The one case where the app knows something the user does not: the schedule on
// screen is no longer the schedule on the server. Swapping it under a rendered
// list would change an answer they are already walking towards, so it asks.
function showRefresh() {
  if (document.getElementById('refresh')) return;
  const el = document.createElement('aside');
  el.className = 'bar';
  el.id = 'refresh';
  el.setAttribute('role', 'status');
  el.innerHTML = '<p>Ohio State published a newer schedule.</p>';

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'bar-go';
  go.textContent = 'Refresh';
  go.onclick = () => location.reload();

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bar-x';
  close.setAttribute('aria-label', 'Keep reading the schedule I have');
  close.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  close.onclick = () => unmountBar(document, el);

  el.append(go, close);
  mountBar(document, el);
}
