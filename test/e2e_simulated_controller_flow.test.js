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
  // eslint-disable-next-line no-constant-condition
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

test('Simulated E2E: single-pass run reaches DONE and calls RUN_SUMMARY_SINGLE', async () => {
  const sent = [];
  const host = makeEventTarget();
  const overlay = {
    host,
    lastState: null,
    renders: [],
    toast: null,
    banner: null
  };

  // Minimal globals required by runtime/controller.
  const chrome = {
    i18n: {
      getMessage: (k) => String(k),
      getAcceptLanguages: (cb) => cb(['en'])
    },
    runtime: {
      lastError: null,
      openOptionsPage: () => {},
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (msg.type === 'GET_SETTINGS') {
          cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50 } });
          return;
        }
        if (msg.type === 'RUN_SUMMARY_SINGLE') {
          cb({ ok: true, text: ['- A.', '', '- B.', '', '- C.'].join('\n'), usage: { input_tokens: 10, output_tokens: 10 } });
          return;
        }
        if (msg.type === 'ABORT_RUN') {
          cb({ ok: true, aborted: true });
          return;
        }
        cb({ ok: false, code: 'unhandled', message: 'unhandled in test' });
      }
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

  // Stub DOM-dependent modules.
  ctx.AS.Overlay = {
    mount: () => overlay,
    unmount: () => {},
    render: (_inst, state) => {
      overlay.lastState = state;
      overlay.renders.push(state);
    },
    setLanguageOptions: () => {},
    setBanner: (_inst, text) => {
      overlay.banner = text;
    },
    showToast: (_inst, text) => {
      overlay.toast = text;
    }
  };

  ctx.AS.Extract = {
    extractArticle: () => ({
      ok: true,
      title: 'T',
      url: 'https://example.com/article',
      text: 'Hello world. '.repeat(200),
      charCount: 2400,
      linkDensity: 0.01
    })
  };

  // Avoid touching the real DOM clipboard APIs.
  ctx.AS.copyToClipboard = async () => true;

  ctx.AS.Controller.bootstrap();

  // Wait until settings are loaded (apiKeySet reflected).
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'IDLE');

  // Start run.
  host.dispatch('as:mode', { mode: 'BULLETS_3' });

  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'DONE');
  assert.ok(String(overlay.lastState.summaryText).includes('- A'));
  assert.ok(sent.some((m) => m.type === 'RUN_SUMMARY_SINGLE'));
});

test('Simulated E2E: long article triggers approval → map-reduce → repair', async () => {
  const sent = [];
  const host = makeEventTarget();
  const overlay = { host, lastState: null, renders: [] };

  const chrome = {
    i18n: {
      getMessage: (k) => String(k),
      getAcceptLanguages: (cb) => cb(['en'])
    },
    runtime: {
      lastError: null,
      openOptionsPage: () => {},
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (msg.type === 'GET_SETTINGS') {
          cb({
            ok: true,
            apiKeySet: true,
            settings: { minArticleChars: 50, hardCostLimitUsd: 1.0, approvalThresholdChars: 1000 }
          });
          return;
        }
        if (msg.type === 'COUNT_TOKENS') {
          cb({ ok: true, inputTokens: 20000 });
          return;
        }
        if (msg.type === 'RUN_SUMMARY_MAP') {
          cb({ ok: true, text: ['- m1', '- m2', '- m3', '- m4', '- m5'].join('\n'), usage: { input_tokens: 1000, output_tokens: 200 } });
          return;
        }
        if (msg.type === 'RUN_SUMMARY_REDUCE') {
          // Intentionally invalid format to trigger repair.
          cb({ ok: true, text: 'TL;DR: invalid\n- only one', usage: { input_tokens: 500, output_tokens: 50 } });
          return;
        }
        if (msg.type === 'RUN_SUMMARY_REPAIR') {
          cb({
            ok: true,
            text: ['- Final A.', '', '- Final B.', '', '- Final C.'].join('\n'),
            usage: { input_tokens: 200, output_tokens: 80 }
          });
          return;
        }
        if (msg.type === 'ABORT_RUN') {
          cb({ ok: true, aborted: true });
          return;
        }
        cb({ ok: false, code: 'unhandled', message: 'unhandled in test' });
      }
    }
  };

  const ctx = createClassicContext({
    chrome,
    navigator: { language: 'en' },
    location: { href: 'https://example.com/long', host: 'example.com' },
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
    setBanner: () => {},
    showToast: () => {}
  };

  ctx.AS.Extract = {
    extractArticle: () => {
      const huge = 'Long article text. '.repeat(4000);
      return {
        ok: true,
        title: 'Long',
        url: 'https://example.com/long',
        text: huge,
        charCount: huge.length,
        linkDensity: 0.01
      };
    }
  };

  ctx.AS.copyToClipboard = async () => true;

  ctx.AS.Controller.bootstrap();

  // Wait until settings are loaded (ensures token refinement path is eligible).
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'IDLE' && overlay.lastState.apiKeySet === true);

  // Start run.
  host.dispatch('as:mode', { mode: 'BULLETS_3' });

  // Approval flow: should land in PREFLIGHT.
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'PREFLIGHT');

  // Proceed to confirm.
  host.dispatch('as:proceed', {});
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'CONFIRM');

  // Run.
  host.dispatch('as:run', {});
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'DONE', { timeoutMs: 6000 });

  assert.ok(String(overlay.lastState.summaryText).includes('Final A'));
  assert.ok(sent.some((m) => m.type === 'RUN_SUMMARY_MAP'));
  assert.ok(sent.some((m) => m.type === 'RUN_SUMMARY_REDUCE'));
  assert.ok(sent.some((m) => m.type === 'RUN_SUMMARY_REPAIR'));
});

test('Simulated E2E: token refinement clears even when API key is missing (no stuck "refining")', async () => {
  const sent = [];
  const host = makeEventTarget();
  const overlay = { host, lastState: null, renders: [] };

  const chrome = {
    i18n: {
      getMessage: (k) => String(k),
      getAcceptLanguages: (cb) => cb(['en'])
    },
    runtime: {
      lastError: null,
      openOptionsPage: () => {},
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (msg.type === 'GET_SETTINGS') {
          // API key is not set.
          cb({ ok: true, apiKeySet: false, settings: { minArticleChars: 50, approvalThresholdChars: 1000 } });
          return;
        }
        if (msg.type === 'COUNT_TOKENS') {
          // Background would reject without a key; controller should clear refining.
          cb({ ok: false, code: 'api_key_missing', message: 'API key is not set.' });
          return;
        }
        if (msg.type === 'ABORT_RUN') {
          cb({ ok: true, aborted: true });
          return;
        }
        cb({ ok: false, code: 'unhandled', message: 'unhandled in test' });
      }
    }
  };

  const ctx = createClassicContext({
    chrome,
    navigator: { language: 'en' },
    location: { href: 'https://example.com/long', host: 'example.com' },
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
    setBanner: () => {},
    showToast: () => {}
  };

  ctx.AS.Extract = {
    extractArticle: () => {
      const huge = 'Long article text. '.repeat(4000);
      return {
        ok: true,
        title: 'Long',
        url: 'https://example.com/long',
        text: huge,
        charCount: huge.length,
        linkDensity: 0.01
      };
    }
  };

  ctx.AS.copyToClipboard = async () => true;

  ctx.AS.Controller.bootstrap();

  // Wait for IDLE. apiKeySet should be false.
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'IDLE' && overlay.lastState.apiKeySet === false);

  // Start run.
  host.dispatch('as:mode', { mode: 'BULLETS_3' });

  // Should land in PREFLIGHT.
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'PREFLIGHT');

  // Refinement should not get stuck even though COUNT_TOKENS fails.
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'PREFLIGHT' && overlay.lastState.refining === false);

  // Ensure COUNT_TOKENS was attempted (gating removed).
  assert.ok(sent.some((m) => m.type === 'COUNT_TOKENS'));
});

test('Simulated E2E: cancel aborts and resets without confirm', async () => {
  const sent = [];
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
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (msg.type === 'GET_SETTINGS') {
          cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50, approvalThresholdChars: 1000 } });
          return;
        }
        if (msg.type === 'COUNT_TOKENS') {
          cb({ ok: true, inputTokens: 20000 });
          return;
        }
        if (msg.type === 'ABORT_RUN') {
          cb({ ok: true, aborted: true });
          return;
        }
        cb({ ok: false, code: 'unhandled', message: 'unhandled in test' });
      }
    }
  };

  const ctx = createClassicContext({
    chrome,
    navigator: { language: 'en' },
    location: { href: 'https://example.com/long', host: 'example.com' },
    document: { getElementById: () => null },
    confirm: () => {
      throw new Error('confirm should not be called');
    },
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
    setBanner: (_inst, text) => {
      overlay.banner = text;
    },
    showToast: () => {}
  };

  ctx.AS.Extract = {
    extractArticle: () => {
      const huge = 'Long article text. '.repeat(4000);
      return {
        ok: true,
        title: 'Long',
        url: 'https://example.com/long',
        text: huge,
        charCount: huge.length,
        linkDensity: 0.01
      };
    }
  };

  ctx.AS.copyToClipboard = async () => true;

  ctx.AS.Controller.bootstrap();

  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'PREFLIGHT');

  host.dispatch('as:cancel', {});

  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'IDLE');
  assert.ok(sent.some((m) => m.type === 'ABORT_RUN'));
  assert.equal(overlay.lastState.banner, 'bannerCancelled');
});

test('Simulated E2E: truncation repair runs when last bullet is cut off', async () => {
  const sent = [];
  const host = makeEventTarget();
  const overlay = { host, lastState: null, renders: [] };

  const chrome = {
    i18n: {
      getMessage: (k) => String(k),
      getAcceptLanguages: (cb) => cb(['en'])
    },
    runtime: {
      lastError: null,
      openOptionsPage: () => {},
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (msg.type === 'GET_SETTINGS') {
          cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50, approvalThresholdChars: 1000 } });
          return;
        }
        if (msg.type === 'RUN_SUMMARY_SINGLE') {
          cb({
            ok: true,
            text: ['- Alpha.', '', '- Beta.', '', '- Gamma is cut'].join('\n'),
            usage: { input_tokens: 10, output_tokens: 10 }
          });
          return;
        }
        if (msg.type === 'RUN_SUMMARY_REPAIR') {
          cb({
            ok: true,
            text: ['- Alpha.', '', '- Beta.', '', '- Gamma is complete.'].join('\n'),
            usage: { input_tokens: 5, output_tokens: 5 }
          });
          return;
        }
        cb({ ok: false, code: 'unhandled', message: 'unhandled in test' });
      }
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
    setBanner: () => {},
    showToast: () => {}
  };

  ctx.AS.Extract = {
    extractArticle: () => ({
      ok: true,
      title: 'T',
      url: 'https://example.com/article',
      text: 'Hello world. '.repeat(200),
      charCount: 2400,
      linkDensity: 0.01
    })
  };

  ctx.AS.copyToClipboard = async () => true;

  ctx.AS.Controller.bootstrap();

  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });

  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'PREFLIGHT');
  host.dispatch('as:proceed', {});
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'CONFIRM');
  host.dispatch('as:run', {});
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'DONE');
  assert.ok(String(overlay.lastState.summaryText).includes('Gamma is complete.'));
  assert.ok(sent.some((m) => m.type === 'RUN_SUMMARY_REPAIR' && m.payload?.fixTruncation === true));
});

test('Simulated E2E: Japanese bullet ending without trailing "。" is not treated as truncated', async () => {
  const sent = [];
  const host = makeEventTarget();
  const overlay = { host, lastState: null, renders: [] };

  const chrome = {
    i18n: {
      getMessage: (k) => String(k),
      // No explicit language selection is made in this test, so resolvedLanguage()
      // falls back to the first accept-language, which we set to Japanese.
      getAcceptLanguages: (cb) => cb(['ja'])
    },
    runtime: {
      lastError: null,
      openOptionsPage: () => {},
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (msg.type === 'GET_SETTINGS') {
          cb({ ok: true, apiKeySet: true, settings: { minArticleChars: 50, approvalThresholdChars: 1000 } });
          return;
        }
        if (msg.type === 'RUN_SUMMARY_SINGLE') {
          // Valid structure (bullets separated by blank lines), last bullet intentionally
          // ends in a bare hiragana character with no trailing "。", per bulletStyleNoteFor.
          cb({
            ok: true,
            text: ['- 最初のポイント', '', '- 二番目のポイント', '', '- 三番目のポイントです'].join('\n'),
            usage: { input_tokens: 10, output_tokens: 10 }
          });
          return;
        }
        if (msg.type === 'RUN_SUMMARY_REPAIR') {
          // Should never be reached; if the truncation heuristic misfires for Japanese,
          // this stands in for whatever a "fixed" response would look like.
          cb({
            ok: true,
            text: ['- 最初のポイント', '', '- 二番目のポイント', '', '- 三番目のポイントです。'].join('\n'),
            usage: { input_tokens: 5, output_tokens: 5 }
          });
          return;
        }
        cb({ ok: false, code: 'unhandled', message: 'unhandled in test' });
      }
    }
  };

  const ctx = createClassicContext({
    chrome,
    navigator: { language: 'ja' },
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
    setBanner: () => {},
    showToast: () => {}
  };

  ctx.AS.Extract = {
    extractArticle: () => ({
      ok: true,
      title: 'T',
      url: 'https://example.com/article',
      text: 'Hello world. '.repeat(200),
      charCount: 2400,
      linkDensity: 0.01
    })
  };

  ctx.AS.copyToClipboard = async () => true;

  ctx.AS.Controller.bootstrap();

  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'IDLE');

  host.dispatch('as:mode', { mode: 'BULLETS_3' });

  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'PREFLIGHT');
  host.dispatch('as:proceed', {});
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'CONFIRM');
  host.dispatch('as:run', {});
  await waitFor(() => overlay.lastState && overlay.lastState.phase === 'DONE');

  assert.ok(String(overlay.lastState.summaryText).includes('三番目のポイントです'));
  assert.ok(!sent.some((m) => m.type === 'RUN_SUMMARY_REPAIR'), 'should not attempt any repair pass');
});
