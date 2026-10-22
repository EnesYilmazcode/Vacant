// A real mobile-width browser smoke test for the first interactive path:
// duration button -> ranking -> card. This caught a missing static import that
// source tests and direct helper tests could not see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Devtools, launch, serve, sleep } from '../lib/browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every duration button reaches the card on a mobile viewport', { timeout: 60000 }, async () => {
  const server = await serve(ROOT, 0);
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const chrome = await launch();
  let devtools;

  try {
    const version = await fetch(`http://127.0.0.1:${chrome.port}/json/version`).then((response) => response.json());
    devtools = await Devtools.open(version.webSocketDebuggerUrl);
    await devtools.send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });

    const target = await devtools.send('Target.createTarget', { url: 'about:blank' });
    const attached = await devtools.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const session = attached.sessionId;
    const call = (method, params = {}) => devtools.send(method, params, session);
    const errors = [];
    devtools.on((message) => {
      if (message.sessionId !== session || message.method !== 'Runtime.exceptionThrown') return;
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    });

    await call('Runtime.enable');
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    });
    await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await call('Emulation.setGeolocationOverride', {
      latitude: 39.99944,
      longitude: -83.01502,
      accuracy: 20,
    });

    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, label) => {
      const until = Date.now() + 25000;
      while (Date.now() < until) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await sleep(80);
      }
      throw new Error(`timed out waiting for ${label}`);
    };
    const tap = async (selector) => {
      const clicked = await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return false;
        element.click();
        return true;
      })()`);
      assert.equal(clicked, true, `nothing matches ${selector}`);
    };

    await call('Page.navigate', { url: `${origin}/Vacant/?dev1` });
    await waitFor("document.getElementById('ask')?.classList.contains('ready')", 'the app to boot');
    await waitFor("document.getElementById('dev-out')?.textContent.includes('simulated')", 'the deterministic dev scene');

    for (const duration of ['30', '60', '120', 'day']) {
      await tap(`#ask [data-min="${duration}"]`);
      await waitFor("document.body.classList.contains('carding') && !document.getElementById('card').hidden", `${duration} to open the card`);
      assert.deepEqual(errors, [], `${duration} raised ${errors.join('\n')}`);
      await evaluate('history.back()');
      await waitFor("document.body.classList.contains('asking')", `${duration} to return to the question`);
    }
  } finally {
    devtools?.ws.close();
    chrome.child.kill();
    server.close();
    await fsp.rm(chrome.profile, { recursive: true, force: true }).catch(() => {});
  }
});
