// Characterization tests: the exact sequence of messages the content controller sends to the
// background worker, and the final summary it renders.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runContentBundle } from './helpers/classic_context.js';

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    dispatch(type, detail = {}) {
      for (const fn of listeners.get(type) || []) fn({ detail });
    }
  };
}

async function waitFor(fn, { timeoutMs = 4000, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (true) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function setup({ settings, article, respond }) {
  const sent = [];
  const host = makeEventTarget();
  const overlay = { host, events: host, lastState: null };

  const chrome = {
    i18n: { getMessage: (k) => String(k), getAcceptLanguages: (cb) => cb(['en-US']) },
    runtime: {
      lastError: null,
      openOptionsPage: () => {},
      sendMessage: (msg, cb) => {
        // Extension messaging JSON-serializes payloads (undefined fields are dropped).
        const m = JSON.parse(JSON.stringify(msg));
        if (m.type === 'GET_SETTINGS') {
          cb({ ok: true, apiKeySet: true, settings });
          return;
        }
        sent.push(m);
        cb(respond(m));
      }
    }
  };

  const ctx = createClassicContext({
    chrome,
    navigator: { language: 'en-US' },
    location: { href: article.url, host: 'example.com' },
    document: { getElementById: () => null },
    confirm: () => true,
    performance
  });

  runContentBundle(ctx);

  ctx.deps.overlay = {
    mount: () => overlay,
    unmount: () => {},
    render: (_inst, state) => {
      overlay.lastState = state;
    },
    setLanguageOptions: () => {},
    setBanner: () => {},
    showToast: () => {}
  };
  ctx.deps.extract = {
    extractArticle: () => ({ ok: true, linkDensity: 0.01, charCount: article.text.length, ...article })
  };

  ctx.AS.Controller.bootstrap(ctx.deps);
  return { sent, host, overlay };
}

function withoutRunId(messages) {
  const runIds = new Set(messages.map((m) => m.payload?.runId));
  assert.equal(runIds.size, 1, 'all messages must belong to one run');
  const [runId] = runIds;
  assert.match(runId, /^run_/);
  return messages.map((m) => {
    const { runId: _r, ...payload } = m.payload;
    return { type: m.type, payload };
  });
}

test('single pass: format repair, then truncation repair', async () => {
  const article = { title: 'Short', url: 'https://example.com/short', text: 'Hello world. '.repeat(200) };
  const { sent, host, overlay } = setup({
    settings: { minArticleChars: 50 },
    article,
    respond: (m) => {
      if (m.type === 'RUN_SUMMARY_SINGLE')
        return { ok: true, text: 'Here:\n- A.\n- B.\n- C.', usage: { input_tokens: 1, output_tokens: 2 } };
      if (m.type === 'RUN_SUMMARY_REPAIR' && !m.payload.fixTruncation)
        return { ok: true, text: '- A.\n\n- B.\n\n- C cut' };
      if (m.type === 'RUN_SUMMARY_REPAIR') return { ok: true, text: '- A.\n\n- B.\n\n- C done.' };
      return { ok: false, code: 'unhandled' };
    }
  });

  await waitFor(() => overlay.lastState?.phase === 'IDLE' && overlay.lastState.apiKeySet);
  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'DONE');

  assert.equal(overlay.lastState.summaryText, '- A.\n\n- B.\n\n- C done.');
  assert.deepEqual(JSON.parse(JSON.stringify(overlay.lastState.usage)), { input_tokens: 1, output_tokens: 2 });
  assert.deepEqual(withoutRunId(sent), [
    {
      type: 'RUN_SUMMARY_SINGLE',
      payload: {
        title: 'Short',
        url: article.url,
        language: 'en-US',
        mode: 'BULLETS_3',
        articleText: article.text,
        model: 'claude-haiku-5-5'
      }
    },
    {
      type: 'RUN_SUMMARY_REPAIR',
      payload: {
        language: 'en-US',
        mode: 'BULLETS_3',
        badOutput: 'Here:\n\n- A.\n\n- B.\n\n- C.',
        bulletCount: 3,
        model: 'claude-haiku-5-5',
        title: 'Short',
        url: article.url
      }
    },
    {
      type: 'RUN_SUMMARY_REPAIR',
      payload: {
        language: 'en-US',
        mode: 'BULLETS_3',
        badOutput: '- A.\n\n- B.\n\n- C cut',
        model: 'claude-haiku-5-5',
        title: 'Short',
        url: article.url,
        fixTruncation: true
      }
    }
  ]);
});

test('single pass: failed repair keeps the draft and normalizes continuation lines', async () => {
  const article = { title: 'Short', url: 'https://example.com/short', text: 'Hello world. '.repeat(200) };
  const { sent, host, overlay } = setup({
    settings: { minArticleChars: 50 },
    article,
    respond: (m) => {
      if (m.type === 'RUN_SUMMARY_SINGLE') return { ok: true, text: '  - A\n  continued.\n\n\n- B.\n\n- C.  ' };
      if (m.type === 'RUN_SUMMARY_REPAIR') return { ok: false, code: 'overloaded_error', status: 529 };
      return { ok: false, code: 'unhandled' };
    }
  });

  await waitFor(() => overlay.lastState?.phase === 'IDLE' && overlay.lastState.apiKeySet);
  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'DONE');

  assert.equal(overlay.lastState.summaryText, '- A continued.\n\n\n- B.\n\n- C.');
  assert.deepEqual(
    sent.map((m) => m.type),
    ['RUN_SUMMARY_SINGLE', 'RUN_SUMMARY_REPAIR']
  );
});

test('map-reduce: approval, token count, map per chunk, reduce, format repair, truncation repair', async () => {
  // Three ~20K-char paragraphs: each becomes its own chunk (8K-token target).
  const paras = ['First paragraph. ', 'Second paragraph. ', 'Third paragraph. '].map((s) =>
    s.repeat(Math.ceil(20_000 / s.length)).trim()
  );
  const article = { title: 'Long', url: 'https://example.com/long', text: paras.join('\n\n') };
  const mapOut = (i) => `- point ${i}`;

  const { sent, host, overlay } = setup({
    settings: { minArticleChars: 50, approvalThresholdChars: 1000 },
    article,
    respond: (m) => {
      if (m.type === 'COUNT_TOKENS') return { ok: true, inputTokens: 18_000 };
      if (m.type === 'RUN_SUMMARY_MAP') return { ok: true, text: mapOut(m.payload.chunkIndex) };
      if (m.type === 'RUN_SUMMARY_REDUCE')
        return { ok: true, text: 'Summary:\n- x', usage: { input_tokens: 9, output_tokens: 8 } };
      if (m.type === 'RUN_SUMMARY_REPAIR' && !m.payload.fixTruncation)
        return { ok: true, text: '- A.\n\n- B.\n\n- C cut' };
      if (m.type === 'RUN_SUMMARY_REPAIR') return { ok: true, text: '- A.\n\n- B.\n\n- C done.' };
      return { ok: false, code: 'unhandled' };
    }
  });

  await waitFor(() => overlay.lastState?.phase === 'IDLE' && overlay.lastState.apiKeySet);
  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState?.phase === 'PREFLIGHT' && !overlay.lastState.refining);
  assert.equal(overlay.lastState.estimate.tokenExact, 18_000 + 256);
  assert.equal(overlay.lastState.estimate.chunkCount, 3);

  host.dispatch('as:proceed');
  await waitFor(() => overlay.lastState?.phase === 'CONFIRM');
  assert.equal(overlay.lastState.note, 'noteChunking');
  host.dispatch('as:run');
  await waitFor(() => overlay.lastState?.phase === 'DONE');

  assert.equal(overlay.lastState.summaryText, '- A.\n\n- B.\n\n- C done.');
  assert.deepEqual(JSON.parse(JSON.stringify(overlay.lastState.usage)), { input_tokens: 9, output_tokens: 8 });

  const chunkSummaries = [mapOut(1), mapOut(2), mapOut(3)];
  const repairBase = {
    language: 'en-US',
    mode: 'BULLETS_3',
    model: 'claude-sonnet-5-5',
    title: 'Long',
    url: article.url,
    chunkSummaries
  };
  assert.deepEqual(withoutRunId(sent), [
    {
      type: 'COUNT_TOKENS',
      payload: { title: 'Long', url: article.url, articleText: article.text, model: 'claude-haiku-5-5' }
    },
    ...paras.map((chunkText, i) => ({
      type: 'RUN_SUMMARY_MAP',
      payload: {
        title: 'Long',
        url: article.url,
        language: 'en-US',
        chunkText,
        chunkIndex: i + 1,
        chunkCount: 3,
        model: 'claude-haiku-5-5'
      }
    })),
    {
      type: 'RUN_SUMMARY_REDUCE',
      payload: {
        title: 'Long',
        url: article.url,
        language: 'en-US',
        mode: 'BULLETS_3',
        chunkSummaries,
        model: 'claude-sonnet-5-5'
      }
    },
    { type: 'RUN_SUMMARY_REPAIR', payload: { ...repairBase, badOutput: 'Summary:\n\n- x', bulletCount: 1 } },
    {
      type: 'RUN_SUMMARY_REPAIR',
      payload: { ...repairBase, badOutput: '- A.\n\n- B.\n\n- C cut', fixTruncation: true }
    }
  ]);
});

test('map-reduce: a failed map chunk stops the run with an error', async () => {
  const paras = ['First paragraph. ', 'Second paragraph. '].map((s) => s.repeat(Math.ceil(20_000 / s.length)).trim());
  const article = { title: 'Long', url: 'https://example.com/long', text: paras.join('\n\n') };
  const { sent, host, overlay } = setup({
    settings: { minArticleChars: 50, approvalThresholdChars: 1000 },
    article,
    respond: (m) => {
      if (m.type === 'COUNT_TOKENS') return { ok: false, code: 'network_error', status: 0 };
      if (m.type === 'RUN_SUMMARY_MAP' && m.payload.chunkIndex === 1) return { ok: true, text: '- one' };
      if (m.type === 'RUN_SUMMARY_MAP')
        return { ok: false, code: 'rate_limit_error', message: 'slow down', status: 429 };
      return { ok: false, code: 'unhandled' };
    }
  });

  await waitFor(() => overlay.lastState?.phase === 'IDLE' && overlay.lastState.apiKeySet);
  host.dispatch('as:mode', { mode: 'BULLETS_5' });
  await waitFor(() => overlay.lastState?.phase === 'PREFLIGHT' && !overlay.lastState.refining);
  host.dispatch('as:proceed');
  await waitFor(() => overlay.lastState?.phase === 'CONFIRM');
  host.dispatch('as:run');
  await waitFor(() => overlay.lastState?.phase === 'ERROR');

  assert.equal(overlay.lastState.message, 'errorRateLimit\n(code=rate_limit_error, status=429)');
  assert.deepEqual(
    sent.map((m) => m.type),
    ['COUNT_TOKENS', 'RUN_SUMMARY_MAP', 'RUN_SUMMARY_MAP']
  );
});

test('cancelling during the format repair does not send a truncation repair', async () => {
  const article = { title: 'Short', url: 'https://example.com/short', text: 'Hello world. '.repeat(200) };
  let host;
  const env = setup({
    settings: { minArticleChars: 50 },
    article,
    respond: (m) => {
      if (m.type === 'RUN_SUMMARY_SINGLE') return { ok: true, text: 'Here:\n- A.\n- B.\n- C cut' };
      if (m.type === 'RUN_SUMMARY_REPAIR') {
        // The user cancels while the repair request is in flight.
        host.dispatch('as:cancel');
        return { ok: true, text: '- A.\n\n- B.\n\n- C cut' };
      }
      if (m.type === 'ABORT_RUN') return { ok: true, aborted: true };
      return { ok: false, code: 'unhandled' };
    }
  });
  host = env.host;

  await waitFor(() => env.overlay.lastState?.phase === 'IDLE' && env.overlay.lastState.apiKeySet);
  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => env.sent.some((m) => m.type === 'ABORT_RUN'));
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(env.overlay.lastState.phase, 'IDLE');
  assert.equal(env.overlay.lastState.banner, 'bannerCancelled');
  assert.deepEqual(
    env.sent.map((m) => m.type),
    ['RUN_SUMMARY_SINGLE', 'RUN_SUMMARY_REPAIR', 'ABORT_RUN']
  );
});
