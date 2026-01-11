import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runClassicScripts } from './helpers/classic_context.js';

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    dispatch(type, detail = {}) {
      const arr = listeners.get(type) || [];
      for (const fn of arr) fn({ detail });
    }
  };
}

async function waitFor(fn, { timeoutMs = 2500, intervalMs = 10 } = {}) {
  const start = Date.now();
  while (true) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function loadCore(ctx) {
  return runClassicScripts(ctx, [
    'dist/content/runtime.js',
    'dist/content/i18n.js',
    'dist/content/models.js',
    'dist/content/state_machine.js',
    'dist/content/format.js',
    'dist/content/chunk.js',
    'dist/content/estimate.js',
    'dist/content/controller.js'
  ]);
}

function createTestContext(sendMessageHandler) {
  const host = makeEventTarget();
  const overlay = { host, lastState: null, renders: [], banner: null };

  const chrome = {
    i18n: {
      getMessage: (k) => String(k),
      getAcceptLanguages: (cb) => cb(['en'])
    },
    runtime: {
      lastError: null,
      openOptionsPage: () => {},
      sendMessage: sendMessageHandler
    }
  };

  const ctx = createClassicContext({
    chrome,
    navigator: { language: 'en' },
    location: { href: 'https://example.com/article', host: 'example.com' },
    document: { getElementById: () => null },
    confirm: () => true,
    alert: () => {},
    performance
  });

  loadCore(ctx);

  ctx.AS.Overlay = {
    mount: () => overlay,
    unmount: () => {},
    render: (_inst, state) => {
      overlay.lastState = state;
      overlay.renders.push(state);
    },
    setLanguageOptions: () => {},
    setBanner: (_inst, text) => { overlay.banner = text; },
    showToast: () => {}
  };

  ctx.AS.Extract = {
    extractArticle: () => ({
      ok: true,
      title: 'Test Article',
      url: 'https://example.com/article',
      text: 'Hello world. '.repeat(200),
      charCount: 2400,
      linkDensity: 0.01
    })
  };

  ctx.AS.copyToClipboard = async () => true;

  return { ctx, overlay, host };
}

test('Error handling: API 401 authentication error shows friendly message', async () => {
  const sent = [];
  const { ctx, overlay, host } = createTestContext((msg, cb) => {
    sent.push(msg);
    if (msg.type === 'GET_SETTINGS') {
      cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50 } });
      return;
    }
    if (msg.type === 'RUN_SUMMARY_SINGLE') {
      cb({ ok: false, code: 'authentication_error', message: 'Invalid API key', status: 401 });
      return;
    }
    if (msg.type === 'ABORT_RUN') {
      cb({ ok: true, aborted: true });
      return;
    }
    cb({ ok: false, code: 'unhandled', message: 'unhandled' });
  });

  ctx.AS.Controller.bootstrap();
  await waitFor(() => overlay.lastState?.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'ERROR');

  assert.ok(overlay.lastState.message.includes('errorAuth'));
});

test('Error handling: API 429 rate limit shows rate limit message', async () => {
  const { ctx, overlay, host } = createTestContext((msg, cb) => {
    if (msg.type === 'GET_SETTINGS') {
      cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50 } });
      return;
    }
    if (msg.type === 'RUN_SUMMARY_SINGLE') {
      cb({ ok: false, code: 'rate_limit_error', message: 'Rate limited', status: 429 });
      return;
    }
    if (msg.type === 'ABORT_RUN') {
      cb({ ok: true, aborted: true });
      return;
    }
    cb({ ok: false, code: 'unhandled', message: 'unhandled' });
  });

  ctx.AS.Controller.bootstrap();
  await waitFor(() => overlay.lastState?.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'ERROR');

  assert.ok(overlay.lastState.message.includes('errorRateLimit'));
});

test('Error handling: Network timeout shows timeout message', async () => {
  const { ctx, overlay, host } = createTestContext((msg, cb) => {
    if (msg.type === 'GET_SETTINGS') {
      cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50 } });
      return;
    }
    if (msg.type === 'RUN_SUMMARY_SINGLE') {
      cb({ ok: false, code: 'timeout', message: 'Request timed out', status: 0 });
      return;
    }
    if (msg.type === 'ABORT_RUN') {
      cb({ ok: true, aborted: true });
      return;
    }
    cb({ ok: false, code: 'unhandled', message: 'unhandled' });
  });

  ctx.AS.Controller.bootstrap();
  await waitFor(() => overlay.lastState?.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'ERROR');

  assert.ok(overlay.lastState.message.includes('errorTimeout'));
});

test('Error handling: Network error shows network message', async () => {
  const { ctx, overlay, host } = createTestContext((msg, cb) => {
    if (msg.type === 'GET_SETTINGS') {
      cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50 } });
      return;
    }
    if (msg.type === 'RUN_SUMMARY_SINGLE') {
      cb({ ok: false, code: 'network_error', message: 'Failed to fetch', status: 0 });
      return;
    }
    if (msg.type === 'ABORT_RUN') {
      cb({ ok: true, aborted: true });
      return;
    }
    cb({ ok: false, code: 'unhandled', message: 'unhandled' });
  });

  ctx.AS.Controller.bootstrap();
  await waitFor(() => overlay.lastState?.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'ERROR');

  assert.ok(overlay.lastState.message.includes('errorNetwork'));
});

test('Error handling: API 500 server error shows server message', async () => {
  const { ctx, overlay, host } = createTestContext((msg, cb) => {
    if (msg.type === 'GET_SETTINGS') {
      cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50 } });
      return;
    }
    if (msg.type === 'RUN_SUMMARY_SINGLE') {
      cb({ ok: false, code: 'server_error', message: 'Internal server error', status: 500 });
      return;
    }
    if (msg.type === 'ABORT_RUN') {
      cb({ ok: true, aborted: true });
      return;
    }
    cb({ ok: false, code: 'unhandled', message: 'unhandled' });
  });

  ctx.AS.Controller.bootstrap();
  await waitFor(() => overlay.lastState?.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'ERROR');

  assert.ok(overlay.lastState.message.includes('errorServer'));
});

test('Error handling: Missing API key shows api key missing message', async () => {
  const { ctx, overlay, host } = createTestContext((msg, cb) => {
    if (msg.type === 'GET_SETTINGS') {
      cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50 } });
      return;
    }
    if (msg.type === 'RUN_SUMMARY_SINGLE') {
      cb({ ok: false, code: 'api_key_missing', message: 'API key is not set', status: 0 });
      return;
    }
    if (msg.type === 'ABORT_RUN') {
      cb({ ok: true, aborted: true });
      return;
    }
    cb({ ok: false, code: 'unhandled', message: 'unhandled' });
  });

  ctx.AS.Controller.bootstrap();
  await waitFor(() => overlay.lastState?.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'ERROR');

  assert.ok(overlay.lastState.message.includes('errorApiKeyMissing'));
});

test('Error handling: Extraction too short shows too short message', async () => {
  const { ctx, overlay, host } = createTestContext((msg, cb) => {
    if (msg.type === 'GET_SETTINGS') {
      cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50 } });
      return;
    }
    if (msg.type === 'ABORT_RUN') {
      cb({ ok: true, aborted: true });
      return;
    }
    cb({ ok: false, code: 'unhandled', message: 'unhandled' });
  });

  ctx.AS.Extract = {
    extractArticle: () => ({
      ok: false,
      code: 'TOO_SHORT',
      message: 'Too short',
      charCount: 100,
      linkDensity: 0.1
    })
  };

  ctx.AS.Controller.bootstrap();
  await waitFor(() => overlay.lastState?.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'ERROR');

  assert.ok(overlay.lastState.message.includes('errorTooShort'));
});

test('Error handling: Link-heavy page shows not article message', async () => {
  const { ctx, overlay, host } = createTestContext((msg, cb) => {
    if (msg.type === 'GET_SETTINGS') {
      cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50 } });
      return;
    }
    if (msg.type === 'ABORT_RUN') {
      cb({ ok: true, aborted: true });
      return;
    }
    cb({ ok: false, code: 'unhandled', message: 'unhandled' });
  });

  ctx.AS.Extract = {
    extractArticle: () => ({
      ok: false,
      code: 'LINK_HEAVY',
      message: 'Link heavy',
      charCount: 5000,
      linkDensity: 0.8
    })
  };

  ctx.AS.Controller.bootstrap();
  await waitFor(() => overlay.lastState?.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'ERROR');

  assert.ok(overlay.lastState.message.includes('errorNotArticle'));
});
