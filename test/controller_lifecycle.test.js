// Controller lifecycle: closing the overlay, and re-injection (clicking the toolbar button again,
// which re-runs every content script and bootstraps a fresh controller in the same isolated world).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createControllerEnv as createEnv,
  deferred,
  injectAndWaitIdle,
  tick,
  waitFor
} from './helpers/controller_env.js';

const VALID_3 = '- A.\n\n- B.\n\n- C.';

test('re-injection during a run aborts the previous run and ignores its late response', async () => {
  const pending = deferred();
  const env = createEnv({
    respond: (m) => {
      if (m.type === 'RUN_SUMMARY_SINGLE') return pending.promise;
      if (m.type === 'ABORT_RUN') return { ok: true, aborted: true };
      return { ok: false, code: 'unhandled' };
    }
  });

  const first = await injectAndWaitIdle(env);
  env.dispatch(first, 'as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => env.sent.some((m) => m.type === 'RUN_SUMMARY_SINGLE'));
  const runId = env.sent.find((m) => m.type === 'RUN_SUMMARY_SINGLE').payload.runId;
  assert.equal(first.lastState.phase, 'SUMMARIZING');

  // The user clicks the toolbar button again while the summary is still running.
  const second = await injectAndWaitIdle(env);
  assert.notEqual(second, first);

  assert.deepEqual(
    env.sent.filter((m) => m.type === 'ABORT_RUN'),
    [{ type: 'ABORT_RUN', payload: { runId } }],
    'the previous run must be aborted'
  );
  assert.equal(first.host.parentNode, null, 'the previous overlay is removed from the page');
  assert.equal(env.page.overlayHost, second.host);
  assert.equal(env.storageListeners.size, 1, "the previous controller's storage listener is removed");

  // The previous run's response arrives late: it must not continue the pipeline or re-render.
  const rendersBefore = first.renders;
  pending.resolve({ ok: true, text: 'not valid\n- x' });
  await tick();
  assert.equal(first.renders, rendersBefore);
  assert.deepEqual(
    env.sent.map((m) => m.type),
    ['RUN_SUMMARY_SINGLE', 'ABORT_RUN']
  );
  assert.equal(second.lastState.phase, 'IDLE');
});

test('re-injection while idle does not send ABORT_RUN', async () => {
  const env = createEnv({ respond: () => ({ ok: false, code: 'unhandled' }) });
  const first = await injectAndWaitIdle(env);
  await injectAndWaitIdle(env);
  assert.equal(first.host.parentNode, null);
  assert.equal(env.storageListeners.size, 1);
  assert.deepEqual(env.sent, []);
});

test('re-injection before the first overlay mounts still leaves a single overlay', async () => {
  const settingsQueue = [];
  const env = createEnv({
    respond: () => ({ ok: false, code: 'unhandled' }),
    settingsResponse: () => {
      const d = deferred();
      settingsQueue.push(d);
      return d.promise;
    }
  });

  // Two quick clicks: both bootstraps are waiting for GET_SETTINGS.
  env.inject();
  env.inject();
  assert.equal(settingsQueue.length, 2);
  assert.equal(env.overlays.length, 0);

  const settings = { ok: true, apiKeySet: true, settings: {} };
  settingsQueue[0].resolve(settings);
  await waitFor(() => env.overlays.length === 1);
  settingsQueue[1].resolve(settings);
  await waitFor(() => env.overlays.length === 2 && env.overlays[1].lastState?.apiKeySet);
  await tick();

  const [first, second] = env.overlays;
  assert.equal(first.host.parentNode, null, 'the first overlay is replaced');
  assert.equal(env.page.overlayHost, second.host);
  assert.equal(env.storageListeners.size, 1);
});

test('closing an idle overlay unmounts it and removes the storage listener', async () => {
  const env = createEnv({ respond: () => ({ ok: false, code: 'unhandled' }) });
  const inst = await injectAndWaitIdle(env);
  assert.equal(env.storageListeners.size, 1);

  env.dispatch(inst, 'as:close');
  assert.equal(inst.unmounted, true);
  assert.equal(env.confirmCalls, 0, 'no confirmation when nothing is running');
  assert.equal(env.storageListeners.size, 0);
  assert.deepEqual(env.sent, []);
});

test('cancel on an idle overlay closes it', async () => {
  const env = createEnv({ respond: () => ({ ok: false, code: 'unhandled' }) });
  const inst = await injectAndWaitIdle(env);
  env.dispatch(inst, 'as:cancel');
  assert.equal(inst.unmounted, true);
  assert.equal(env.storageListeners.size, 0);
});

test('closing while busy asks first; declining keeps the run, confirming aborts it', async () => {
  const pending = deferred();
  const env = createEnv({
    respond: (m) => {
      if (m.type === 'RUN_SUMMARY_SINGLE') return pending.promise;
      if (m.type === 'ABORT_RUN') return { ok: true, aborted: true };
      return { ok: false, code: 'unhandled' };
    }
  });
  const inst = await injectAndWaitIdle(env);
  env.dispatch(inst, 'as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => env.sent.some((m) => m.type === 'RUN_SUMMARY_SINGLE'));

  env.confirmResult = false;
  env.dispatch(inst, 'as:close');
  assert.equal(env.confirmCalls, 1);
  assert.equal(inst.unmounted, false);
  assert.equal(inst.lastState.phase, 'SUMMARIZING');
  assert.ok(!env.sent.some((m) => m.type === 'ABORT_RUN'));

  env.confirmResult = true;
  env.dispatch(inst, 'as:close');
  assert.equal(env.confirmCalls, 2);
  assert.equal(inst.unmounted, true);
  assert.equal(env.storageListeners.size, 0);
  const runId = env.sent.find((m) => m.type === 'RUN_SUMMARY_SINGLE').payload.runId;
  assert.deepEqual(env.sent[env.sent.length - 1], { type: 'ABORT_RUN', payload: { runId } });

  const rendersBefore = inst.renders;
  pending.resolve({ ok: true, text: VALID_3 });
  await tick();
  assert.equal(inst.renders, rendersBefore, 'a closed overlay is not re-rendered');
});

test('a UI language change in storage re-renders the overlay; other changes are ignored', async () => {
  const env = createEnv({ respond: () => ({ ok: false, code: 'unhandled' }) });
  const inst = await injectAndWaitIdle(env);
  const [listener] = env.storageListeners;
  const renders = inst.renders;
  const optionsSet = inst.languageOptionsSet;

  listener({ uiLanguage: { newValue: 'ja' } }, 'sync');
  listener({ modelMap: { newValue: 'claude-haiku-4-5' } }, 'local');
  await tick();
  assert.equal(inst.renders, renders);
  assert.equal(inst.languageOptionsSet, optionsSet);

  // setUiLanguage('auto') resolves without fetching messages.
  listener({ uiLanguage: { newValue: 'auto' } }, 'local');
  await waitFor(() => inst.renders > renders);
  assert.equal(inst.languageOptionsSet, optionsSet + 1);
});

test('UI events dispatched by a page script on the overlay host are ignored', async () => {
  const env = createEnv({
    settings: { minArticleChars: 50, approvalThresholdChars: 1000 },
    respond: (m) => (m.type === 'COUNT_TOKENS' ? { ok: true, inputTokens: 700 } : { ok: false, code: 'unhandled' })
  });
  const inst = await injectAndWaitIdle(env);

  // A page cannot start a (paid) run...
  env.dispatchFromPage(inst, 'as:mode', { mode: 'BULLETS_3' });
  await tick();
  assert.equal(inst.lastState.phase, 'IDLE');
  assert.deepEqual(env.sent, []);

  // ...nor approve one on the user's behalf.
  env.dispatch(inst, 'as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => inst.lastState.phase === 'PREFLIGHT' && inst.lastState.refining === false);
  env.dispatchFromPage(inst, 'as:proceed');
  env.dispatchFromPage(inst, 'as:run');
  await tick();
  assert.equal(inst.lastState.phase, 'PREFLIGHT');
  assert.deepEqual(
    env.sent.map((m) => m.type),
    ['COUNT_TOKENS']
  );
});
