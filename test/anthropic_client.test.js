// Unit tests for the background Anthropic API client (dist/background/anthropic.js) with a
// stubbed global fetch.

import test from 'node:test';
import assert from 'node:assert/strict';

import { countTokens, runMessagesWithRetry } from '../dist/background/anthropic.js';

let fetchImpl;
const fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init, body: JSON.parse(init.body), abortedAtCall: init.signal.aborted });
  return fetchImpl(url, init);
};

function reset(impl) {
  fetchCalls.length = 0;
  fetchImpl = impl;
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function messages(text, stopReason = 'end_turn') {
  return response(200, { content: [{ type: 'text', text }], stop_reason: stopReason, usage: { input_tokens: 1, output_tokens: 2 } });
}

function abortError() {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

// Like the real fetch: rejects at once for an aborted signal, otherwise when the signal aborts.
function rejectOnAbort(signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(abortError())));
}

const REQUEST = { apiKey: 'sk-test', model: 'claude-haiku-5-5', maxTokens: 100, userPrompt: 'hi', timeoutMs: 5_000 };
const ABORTED = { ok: false, code: 'aborted', message: 'Request aborted', status: 0 };

test('an already-aborted signal aborts the request instead of sending it', async () => {
  reset((_url, init) => (init.signal.aborted ? Promise.reject(abortError()) : messages('- sent anyway')));
  const controller = new AbortController();
  controller.abort();

  const r = await runMessagesWithRetry({ ...REQUEST, abortSignal: controller.signal });
  assert.deepEqual(r, ABORTED);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].abortedAtCall, true);
});

test('an abort that lands between max_tokens retries stops the next attempt', async () => {
  const controller = new AbortController();
  reset((_url, init) => {
    if (fetchCalls.length === 1) {
      // The run is cancelled while the first (truncated) response is being read.
      return { ok: true, status: 200, text: async () => {
        controller.abort();
        return JSON.stringify({ content: [{ type: 'text', text: '- cut' }], stop_reason: 'max_tokens' });
      } };
    }
    return init.signal.aborted ? Promise.reject(abortError()) : messages('- retried anyway');
  });

  const r = await runMessagesWithRetry({ ...REQUEST, abortSignal: controller.signal });
  assert.deepEqual(r, ABORTED);
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[1].abortedAtCall, true);
});

test('timeouts and network failures are normalized', async () => {
  reset((_url, init) => rejectOnAbort(init.signal));
  assert.deepEqual(await runMessagesWithRetry({ ...REQUEST, timeoutMs: 5 }), {
    ok: false,
    code: 'timeout',
    message: 'Request timed out',
    status: 0
  });

  reset(() => Promise.reject(new TypeError('Failed to fetch')));
  assert.deepEqual(await runMessagesWithRetry(REQUEST), {
    ok: false,
    code: 'network_error',
    message: 'Failed to fetch',
    status: 0
  });

  reset(() => Promise.reject({}));
  assert.deepEqual(await countTokens({ apiKey: 'k', model: 'm', userPrompt: 'p' }), {
    ok: false,
    code: 'network_error',
    message: 'Network error',
    status: 0
  });
});

test('error responses without a JSON error body fall back to generic values', async () => {
  reset(() => response(502, '<html>Bad gateway</html>'));
  assert.deepEqual(await runMessagesWithRetry(REQUEST), {
    ok: false,
    code: 'api_error',
    message: 'Messages request failed.',
    status: 502
  });

  reset(() => response(503, ''));
  assert.deepEqual(await countTokens({ apiKey: 'k', model: 'm', userPrompt: 'p' }), {
    ok: false,
    code: 'api_error',
    message: 'Token count request failed.',
    status: 503
  });

  reset(() => response(400, { message: 'top-level message', error: { error_type: 'invalid_request_error' } }));
  assert.deepEqual(await runMessagesWithRetry(REQUEST), {
    ok: false,
    code: 'invalid_request_error',
    message: 'top-level message',
    status: 400
  });
});

test('only text blocks make up the summary (thinking and other blocks are skipped)', async () => {
  reset(() =>
    response(200, {
      content: [
        { type: 'thinking', thinking: 'secret reasoning' },
        { type: 'text', text: '- A.\n\n' },
        { type: 'redacted_thinking', data: 'x' },
        { type: 'text', text: '- B.' },
        { type: 'text', text: 42 },
        null
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 4 }
    })
  );
  assert.deepEqual(await runMessagesWithRetry(REQUEST), {
    ok: true,
    text: '- A.\n\n- B.',
    usage: { input_tokens: 3, output_tokens: 4 },
    stopReason: 'end_turn'
  });

  // A 200 response without content is an empty summary, not an error.
  reset(() => response(200, ''));
  assert.deepEqual(await runMessagesWithRetry(REQUEST), { ok: true, text: '', usage: undefined, stopReason: undefined });
});

test('max_tokens retries never exceed the cap', async () => {
  reset(() => messages('- cut', 'max_tokens'));
  const r = await runMessagesWithRetry({ ...REQUEST, maxTokens: 1000, maxTokensCap: 1200, maxRetries: 3 });
  assert.equal(r.stopReason, 'max_tokens');
  // 1000 -> 1200 (capped); the next step cannot grow, so the capped result is returned.
  assert.deepEqual(
    fetchCalls.map((c) => c.body.max_tokens),
    [1000, 1200]
  );

  // A cap below the starting budget never shrinks it.
  reset(() => messages('- cut', 'max_tokens'));
  await runMessagesWithRetry({ ...REQUEST, maxTokens: 1000, maxTokensCap: 10 });
  assert.deepEqual(
    fetchCalls.map((c) => c.body.max_tokens),
    [1000]
  );
});

test('the abort listener on the caller signal is removed after every attempt', async () => {
  let added = 0;
  let removed = 0;
  const signal = {
    aborted: false,
    addEventListener: () => {
      added += 1;
    },
    removeEventListener: () => {
      removed += 1;
    }
  };
  reset(() => messages('- cut', 'max_tokens'));
  await runMessagesWithRetry({ ...REQUEST, abortSignal: signal, maxRetries: 1 });
  assert.equal(fetchCalls.length, 3);
  assert.equal(added, 3);
  assert.equal(removed, 3);
});
