// Background worker failure paths: unreadable storage, a failing options page, and malformed
// messages. (A separate file from background_handler.test.js because the worker keeps
// module-level caches.)

import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const listeners = { onChanged: [], onMessage: [] };
const state = { storageFails: true, openOptionsFails: true };
const errors = [];

globalThis.chrome = {
  action: { onClicked: { addListener: () => {} } },
  scripting: { executeScript: async () => {} },
  storage: {
    local: {
      get: async () => {
        if (state.storageFails) throw new Error('storage unavailable');
        return { claudeApiKey: 'sk-ant-x', hardCostLimitUsd: 3 };
      },
      set: async () => {}
    },
    onChanged: { addListener: (fn) => listeners.onChanged.push(fn) }
  },
  runtime: {
    onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
    openOptionsPage: async () => {
      if (state.openOptionsFails) throw new Error('no options page');
    }
  }
};
globalThis.fetch = async () => {
  throw new Error('unexpected fetch');
};
const consoleError = console.error;
console.error = (...args) => errors.push(args);
after(() => {
  console.error = consoleError;
});

await import('../dist/background/index.js');

function send(msg) {
  return new Promise((resolve) => {
    listeners.onMessage[0](msg, {}, (resp) => resolve(JSON.parse(JSON.stringify(resp))));
  });
}

test('unreadable storage: defaults are used and no API key is reported', async () => {
  const r = await send({ type: 'GET_SETTINGS' });
  assert.equal(r.ok, true);
  assert.equal(r.apiKeySet, false);
  assert.equal(r.settings.hardCostLimitUsd, 1);

  assert.deepEqual(await send({ type: 'COUNT_TOKENS', payload: { runId: 'r', title: 't', url: 'u', articleText: 'a', model: 'm' } }), {
    ok: false,
    code: 'api_key_missing',
    message: 'API key is not set.'
  });
});

test('settings are re-read on a storage change once storage works again', async () => {
  state.storageFails = false;
  for (const fn of listeners.onChanged) fn({ hardCostLimitUsd: { newValue: 3 } }, 'local');
  // Changes in other storage areas are ignored.
  for (const fn of listeners.onChanged) fn({ claudeApiKey: { newValue: 'sk-sync' } }, 'sync');
  await new Promise((r) => setTimeout(r, 10));

  const r = await send({ type: 'GET_SETTINGS' });
  assert.equal(r.settings.hardCostLimitUsd, 3);
  for (const fn of listeners.onChanged) fn({ claudeApiKey: { newValue: '  sk-ant-y ' } }, 'local');
  assert.equal((await send({ type: 'GET_SETTINGS' })).apiKeySet, true);
});

test('OPEN_OPTIONS reports a failure to open the options page', async () => {
  assert.deepEqual(await send({ type: 'OPEN_OPTIONS' }), {
    ok: false,
    code: 'open_options_failed',
    message: 'Failed to open options page.'
  });
  state.openOptionsFails = false;
  assert.deepEqual(await send({ type: 'OPEN_OPTIONS' }), { ok: true });
});

test('a message that crashes the handler gets an internal_error response without details', async () => {
  // RUN_SUMMARY_SINGLE without a payload.
  assert.deepEqual(await send({ type: 'RUN_SUMMARY_SINGLE' }), { ok: false, code: 'internal_error', message: 'Internal error' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], '[ArticleSummarizer] background message handler failed');
});

test('ABORT_RUN without a run id aborts nothing', async () => {
  assert.deepEqual(await send({ type: 'ABORT_RUN' }), { ok: true, aborted: false });
  assert.deepEqual(await send({ type: 'ABORT_RUN', payload: {} }), { ok: true, aborted: false });
});
