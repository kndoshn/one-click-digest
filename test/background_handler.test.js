// Characterization tests for the background service worker.
//
// src/background/index.ts registers chrome listeners at import time, so we install a stubbed
// `chrome` and `fetch` on globalThis before importing it, then drive it through the message
// listener and inspect the exact requests it sends to the Anthropic API.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Browser globals are replaced with partial stubs, so they are assigned without their DOM/chrome types.
const globals = /** @type {any} */ (globalThis);

const storage = {};
const listeners = { onClicked: [], onChanged: [], onMessage: [] };
const injected = [];
const fetchCalls = [];
let fetchQueue = [];

function jsonResponse(status, obj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(obj)
  };
}

function messagesResponse(text, extra = {}) {
  return jsonResponse(200, {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 11, output_tokens: 7 },
    ...extra
  });
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

globals.chrome = {
  action: { onClicked: { addListener: (fn) => listeners.onClicked.push(fn) } },
  scripting: {
    executeScript: async (args) => {
      injected.push(args);
    }
  },
  storage: {
    local: {
      get: async (keys) => pick(storage, keys),
      set: async (obj) => {
        Object.assign(storage, obj);
      }
    },
    onChanged: { addListener: (fn) => listeners.onChanged.push(fn) }
  },
  runtime: {
    onMessage: { addListener: (fn) => listeners.onMessage.push(fn) },
    openOptionsPage: async () => {}
  }
};

globals.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  const next = fetchQueue.shift();
  if (!next) throw new Error('unexpected fetch');
  return typeof next === 'function' ? next(url, init) : next;
};

await import('../src/background/index.ts');

function send(msg) {
  return new Promise((resolve) => {
    // Extension messaging JSON-serializes responses (undefined fields are dropped).
    const ret = listeners.onMessage[0](msg, {}, (resp) => resolve(JSON.parse(JSON.stringify(resp))));
    assert.equal(ret, true, 'listener must return true for async responses');
  });
}

async function changeStorage(changes) {
  const storageChanges = {};
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) delete storage[k];
    else storage[k] = v;
    storageChanges[k] = { newValue: v };
  }
  for (const fn of listeners.onChanged) fn(storageChanges, 'local');
  // Settings refresh is fire-and-forget; let it settle.
  await new Promise((r) => setTimeout(r, 0));
}

function lastBody() {
  return JSON.parse(fetchCalls[fetchCalls.length - 1].init.body);
}

function resetFetch(queue) {
  fetchCalls.length = 0;
  fetchQueue = queue;
}

const BASE = { runId: 'run_1', title: 'T', url: 'https://e.com/a' };
const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU_PARAMS = { thinking: { type: 'disabled' } };
const SONNET_PARAMS = { output_config: { effort: 'medium' } };

const HINT_3 =
  'Return exactly 3 bullet points, each starting with "- ", with exactly one blank line between each pair of bullets.';
const HINT_5 =
  'Return exactly 5 bullet points, each starting with "- ", with exactly one blank line between each pair of bullets.';
const JA_NOTE = '\nWhen a bullet point is written in Japanese, do not end it with a trailing "。".';

function faithful(source) {
  return [
    `Stay faithful to the ${source}:`,
    `- Include only what the ${source} says. Do not add facts, causes, judgements or predictions of your own.`,
    '- Keep its hedges and level of certainty (words such as "about", "planned", "expected", "reportedly"). Do not state anything more strongly or more precisely than it does.',
    `- Keep numbers, names and units exact. When writing in a different language from the ${source}, make sure every number keeps its value.`
  ].join('\n');
}

function tldrHint(summary, conclusion, note = '') {
  return (
    'Return EXACTLY this structure, with no other text (27 lines total):\n' +
    `${summary}: <one line>\n` +
    '<blank line>\n' +
    '12 bullet lines, each starting with "- ", with exactly one blank line between each pair of bullets\n' +
    '<blank line>\n' +
    `${conclusion}: <one line>\n` +
    'No headings, no extra text.\n' +
    `The ${conclusion} line states the article's own conclusion, not your assessment or outlook.` +
    note
  );
}

const WORDS = 'about 20 to 25 words';
const CHARS = 'about 40 to 50 characters';

// The bullet length guide; `lines` are the TL;DR's Summary and Conclusion labels.
function lengthGuide(size, lines) {
  return (
    `Keep the summary quick to read: write each bullet as one sentence of ${size}.` +
    (lines ? ` The ${lines[0]} and ${lines[1]} lines are one sentence each too.` : '') +
    '\nIf a point needs more, leave out its less important details instead of writing a longer sentence. ' +
    'Keep the hedges and numbers of what you include.'
  );
}

function singlePrompt(language, hint, guide) {
  return [
    'Summarize the following web article for quick understanding.',
    `Output language: ${language}.`,
    hint,
    guide,
    faithful('article'),
    'Do not include extra commentary.',
    '',
    'Title: T',
    'URL: https://e.com/a',
    '',
    'Article:',
    'Body text'
  ].join('\n');
}

function reducePrefix(hint) {
  return [
    'You are an assistant that composes a final summary from multiple chunk summaries.',
    'Output language: en.',
    hint,
    lengthGuide(WORDS),
    faithful('chunk summaries'),
    '',
    'Title: T',
    'URL: https://e.com/a',
    '',
    'Chunk summaries:'
  ].join('\n');
}

const JOINED = '\nChunk 1:\n- a\n\nChunk 2:\n- b';

// --- Tests (run sequentially; they share the worker's module state) ---

test('rejects malformed messages', async () => {
  assert.deepEqual(await send(null), { ok: false, code: 'bad_request', message: 'Invalid message' });
  assert.deepEqual(await send({ type: 42 }), { ok: false, code: 'bad_request', message: 'Invalid message' });
});

test('GET_SETTINGS: normalizes stored values and migrates legacy approval thresholds', async () => {
  // Settings are loaded lazily on the first message; seed storage before that happens.
  // (The previous test returns before settings are loaded.)
  Object.assign(storage, {
    approvalThresholdUsd: 0.25,
    approvalThresholdChars: '25000',
    promptCachingTtl: 'bogus',
    minArticleChars: '700.9',
    hardCostLimitUsd: '2.5'
  });
  const resp = await send({ type: 'GET_SETTINGS' });
  assert.deepEqual(resp, {
    ok: true,
    apiKeySet: false,
    settings: {
      modelMap: HAIKU,
      modelFinal: SONNET,
      promptCachingEnabled: true,
      promptCachingTtl: '5m',
      hardCostLimitUsd: 2.5,
      approvalThresholdUsd: 1.0,
      approvalThresholdChars: 100_000,
      minArticleChars: 700,
      maxArticleCharsToSend: 200_000,
      uiLanguage: 'auto'
    },
    bulletStyle: 'dash'
  });
  assert.equal(storage.approvalThresholdUsd, 1.0);
  assert.equal(storage.approvalThresholdChars, 100_000);
});

test('API calls require an API key', async () => {
  resetFetch([]);
  const resp = await send({ type: 'COUNT_TOKENS', payload: { ...BASE, articleText: 'x', model: HAIKU } });
  assert.deepEqual(resp, { ok: false, code: 'api_key_missing', message: 'API key is not set.' });
  assert.equal(fetchCalls.length, 0);
});

test('API key changes are picked up (trimmed) and reported by GET_SETTINGS', async () => {
  await changeStorage({ claudeApiKey: '  sk-test  ' });
  const resp = await send({ type: 'GET_SETTINGS' });
  assert.equal(resp.apiKeySet, true);
});

test('COUNT_TOKENS: request shape and response', async () => {
  resetFetch([jsonResponse(200, { input_tokens: 1234 })]);
  const resp = await send({ type: 'COUNT_TOKENS', payload: { ...BASE, articleText: 'Body text', model: HAIKU } });
  assert.deepEqual(resp, { ok: true, inputTokens: 1234 });

  assert.equal(fetchCalls.length, 1);
  const { url, init } = fetchCalls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages/count_tokens');
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, {
    'content-type': 'application/json',
    'x-api-key': 'sk-test',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  });
  assert.ok(init.signal, 'request must be abortable');
  assert.deepEqual(lastBody(), {
    model: HAIKU,
    messages: [{ role: 'user', content: 'Title: T\nURL: https://e.com/a\n\nArticle:\nBody text' }]
  });
});

test('COUNT_TOKENS: missing input_tokens is a parse error', async () => {
  resetFetch([jsonResponse(200, {})]);
  const resp = await send({ type: 'COUNT_TOKENS', payload: { ...BASE, articleText: 'x', model: HAIKU } });
  assert.deepEqual(resp, { ok: false, code: 'parse_error', message: 'Token count response missing input_tokens.' });
});

test('RUN_SUMMARY_SINGLE: BULLETS_3 request body', async () => {
  resetFetch([
    jsonResponse(200, {
      content: [
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: '- A' },
        { type: 'text', text: '\n\n- B' }
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 6 }
    })
  ]);
  const resp = await send({
    type: 'RUN_SUMMARY_SINGLE',
    payload: { ...BASE, language: 'en', mode: 'BULLETS_3', articleText: 'Body text', model: HAIKU }
  });
  assert.deepEqual(resp, { ok: true, text: '- A\n\n- B', usage: { input_tokens: 5, output_tokens: 6 } });
  assert.equal(fetchCalls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual(lastBody(), {
    model: HAIKU,
    max_tokens: 450,
    messages: [{ role: 'user', content: singlePrompt('en', HINT_3, lengthGuide(WORDS)) }],
    ...HAIKU_PARAMS
  });
});

test('RUN_SUMMARY_SINGLE: Japanese TL;DR mode uses localized labels and the punctuation note', async () => {
  resetFetch([messagesResponse('ok')]);
  await send({
    type: 'RUN_SUMMARY_SINGLE',
    payload: { ...BASE, language: 'ja', mode: 'TLDR_12_CONCLUSION', articleText: 'Body text', model: HAIKU }
  });
  assert.deepEqual(lastBody(), {
    model: HAIKU,
    max_tokens: 1600,
    messages: [
      {
        role: 'user',
        content: singlePrompt('ja', tldrHint('要約', '結論', JA_NOTE), lengthGuide(CHARS, ['要約', '結論']))
      }
    ],
    ...HAIKU_PARAMS
  });
});

test('RUN_SUMMARY_SINGLE: header labels per language', async () => {
  const cases = [
    ['en-US', 'Summary', 'Conclusion'],
    ['fr', 'Résumé', 'Conclusion'],
    ['de-DE', 'Zusammenfassung', 'Fazit'],
    ['es', 'Resumen', 'Conclusion'],
    ['it', 'Sintesi', 'Conclusione'],
    ['pt-BR', 'Resumo', 'Conclusão'],
    ['zh-CN', '摘要', '结论'],
    ['zh-TW', '摘要', '結論'],
    ['zh-HK', '摘要', '結論'],
    ['ko', '요약', '결론'],
    ['xx', 'Summary', 'Conclusion']
  ];
  for (const [language, summary, conclusion] of cases) {
    resetFetch([messagesResponse('ok')]);
    await send({
      type: 'RUN_SUMMARY_SINGLE',
      payload: { ...BASE, language, mode: 'TLDR_12_CONCLUSION', articleText: 'Body text', model: HAIKU }
    });
    const guide = lengthGuide(language.startsWith('zh') ? CHARS : WORDS, [summary, conclusion]);
    assert.equal(
      lastBody().messages[0].content,
      singlePrompt(language, tldrHint(summary, conclusion), guide),
      language
    );
  }
});

test('RUN_SUMMARY_SINGLE: max_tokens per mode, with the Japanese note on bullet modes', async () => {
  /** @type {Array<[string, number, number]>} */
  const cases = [
    ['BULLETS_3', 450, 3],
    ['BULLETS_5', 700, 5],
    ['BULLETS_10', 1200, 10]
  ];
  for (const [mode, maxTokens, count] of cases) {
    resetFetch([messagesResponse('ok')]);
    await send({
      type: 'RUN_SUMMARY_SINGLE',
      payload: { ...BASE, language: 'ja-JP', mode, articleText: 'Body text', model: HAIKU }
    });
    const hint = `Return exactly ${count} bullet points, each starting with "- ", with exactly one blank line between each pair of bullets.${JA_NOTE}`;
    assert.equal(lastBody().max_tokens, maxTokens, mode);
    assert.equal(lastBody().messages[0].content, singlePrompt('ja-JP', hint, lengthGuide(CHARS)), mode);
  }
});

test('RUN_SUMMARY_MAP: request body', async () => {
  resetFetch([messagesResponse('- m')]);
  const resp = await send({
    type: 'RUN_SUMMARY_MAP',
    payload: { ...BASE, language: 'en', chunkIndex: 2, chunkCount: 3, chunkText: 'Chunk body', model: HAIKU }
  });
  assert.deepEqual(resp, { ok: true, text: '- m', usage: { input_tokens: 11, output_tokens: 7 } });
  assert.deepEqual(lastBody(), {
    model: HAIKU,
    max_tokens: 800,
    system:
      'You are an assistant that extracts key points from article chunks.\n' +
      'Output language: en.\n' +
      'Return 5 concise bullet points, each starting with "- ".\n' +
      'Focus on facts, claims, and important context. Avoid repetition.\n' +
      'Do not add disclaimers or meta commentary.',
    messages: [{ role: 'user', content: 'Title: T\nURL: https://e.com/a\nChunk: 2/3\n\nChunk text:\nChunk body' }],
    ...HAIKU_PARAMS
  });
});

test('RUN_SUMMARY_MAP: maxRetries 0 still makes one final call with a larger budget', async () => {
  resetFetch([
    messagesResponse('- partial', { stop_reason: 'max_tokens' }),
    messagesResponse('- partial again', { stop_reason: 'max_tokens' })
  ]);
  const resp = await send({
    type: 'RUN_SUMMARY_MAP',
    payload: { ...BASE, language: 'en', chunkIndex: 1, chunkCount: 2, chunkText: 'c', model: HAIKU }
  });
  assert.equal(resp.ok, true);
  assert.equal(resp.text, '- partial again');
  assert.deepEqual(
    fetchCalls.map((c) => JSON.parse(c.init.body).max_tokens),
    [800, 1200]
  );
});

test('RUN_SUMMARY_REDUCE: cached chunk-summary prefix', async () => {
  resetFetch([messagesResponse('- r')]);
  await send({
    type: 'RUN_SUMMARY_REDUCE',
    payload: { ...BASE, language: 'en', mode: 'BULLETS_5', chunkSummaries: ['- a', '- b'], model: SONNET }
  });
  assert.deepEqual(lastBody(), {
    model: SONNET,
    max_tokens: 700,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: reducePrefix(HINT_5) },
          { type: 'text', text: JOINED, cache_control: { type: 'ephemeral', ttl: '5m' } },
          { type: 'text', text: '\n\nNow write the final output.\nOnly return the summary itself (no preamble).' }
        ]
      }
    ],
    ...SONNET_PARAMS
  });
});

test('RUN_SUMMARY_REPAIR: with chunk summaries and truncation fix', async () => {
  resetFetch([messagesResponse('- fixed')]);
  const resp = await send({
    type: 'RUN_SUMMARY_REPAIR',
    payload: {
      ...BASE,
      language: 'en',
      mode: 'BULLETS_3',
      badOutput: 'bad',
      model: SONNET,
      chunkSummaries: ['- a', '- b'],
      fixTruncation: true
    }
  });
  assert.equal(resp.text, '- fixed');
  const suffix = [
    '',
    'Original output:',
    'bad',
    '',
    'Reformat the output to match the required format.',
    HINT_3,
    'If the output looks cut off, complete the last bullet without adding new facts. Keep the bullet count unchanged.',
    'Only return the corrected summary.'
  ].join('\n');
  assert.deepEqual(lastBody(), {
    model: SONNET,
    max_tokens: 450,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: reducePrefix(HINT_3) },
          { type: 'text', text: JOINED, cache_control: { type: 'ephemeral', ttl: '5m' } },
          { type: 'text', text: `\n${suffix}` }
        ]
      }
    ],
    ...SONNET_PARAMS
  });
});

test('RUN_SUMMARY_REPAIR: plain prompt without chunk summaries', async () => {
  resetFetch([messagesResponse('- fixed')]);
  await send({
    type: 'RUN_SUMMARY_REPAIR',
    payload: { ...BASE, language: 'en', mode: 'BULLETS_3', badOutput: 'bad', model: HAIKU }
  });
  assert.deepEqual(lastBody(), {
    model: HAIKU,
    max_tokens: 450,
    messages: [
      {
        role: 'user',
        content: [
          'Reformat the summary to match the required format.',
          'Output language: en.',
          HINT_3,
          '',
          'Use only information from the original output, with its hedges and numbers unchanged.',
          'Only return the corrected summary.',
          '',
          'Original output:',
          'bad'
        ].join('\n')
      }
    ],
    ...HAIKU_PARAMS
  });
});

test('RUN_SUMMARY_REPAIR: says how many bullets the output has when the count is wrong', async () => {
  const cases = [
    [
      5,
      'The original output has 5 bullet points instead of 3. Merge related bullets or drop the least important ones so that there are exactly 3.'
    ],
    [
      2,
      'The original output has 2 bullet points instead of 3. Split bullets that cover more than one point so that there are exactly 3.'
    ]
  ];
  for (const [bulletCount, line] of cases) {
    resetFetch([messagesResponse('- fixed')]);
    await send({
      type: 'RUN_SUMMARY_REPAIR',
      payload: { ...BASE, language: 'en', mode: 'BULLETS_3', badOutput: 'bad', model: HAIKU, bulletCount }
    });
    const prompt = lastBody().messages[0].content;
    assert.ok(prompt.includes(`${HINT_3}\n${line}\n`), prompt);
  }

  // The right count adds nothing.
  resetFetch([messagesResponse('- fixed')]);
  await send({
    type: 'RUN_SUMMARY_REPAIR',
    payload: { ...BASE, language: 'en', mode: 'BULLETS_3', badOutput: 'bad', model: HAIKU, bulletCount: 3 }
  });
  assert.ok(!lastBody().messages[0].content.includes('The original output has'));
});

test('RUN_SUMMARY_REPAIR: the bullet count also goes into the prompt with chunk summaries', async () => {
  resetFetch([messagesResponse('- fixed')]);
  await send({
    type: 'RUN_SUMMARY_REPAIR',
    payload: {
      ...BASE,
      language: 'en',
      mode: 'TLDR_12_CONCLUSION',
      badOutput: 'bad',
      model: SONNET,
      chunkSummaries: ['- a', '- b'],
      bulletCount: 14
    }
  });
  const suffix = lastBody().messages[0].content.at(-1).text;
  assert.ok(
    suffix.includes(
      'The original output has 14 bullet points instead of 12. Merge related bullets or drop the least important ones so that there are exactly 12.'
    ),
    suffix
  );
});

test('RUN_SUMMARY_REPAIR: empty chunk summaries fall back to the plain prompt', async () => {
  resetFetch([messagesResponse('- fixed')]);
  await send({
    type: 'RUN_SUMMARY_REPAIR',
    payload: {
      ...BASE,
      language: 'en',
      mode: 'BULLETS_3',
      badOutput: 'bad',
      model: HAIKU,
      chunkSummaries: [],
      fixTruncation: true
    }
  });
  assert.equal(typeof lastBody().messages[0].content, 'string');
  assert.ok(lastBody().messages[0].content.includes('If the output looks cut off'));
});

test('prompt caching settings: TTL 1h and disabled', async () => {
  await changeStorage({ promptCachingTtl: '1h' });
  resetFetch([messagesResponse('- r')]);
  await send({
    type: 'RUN_SUMMARY_REDUCE',
    payload: { ...BASE, language: 'en', mode: 'BULLETS_5', chunkSummaries: ['- a', '- b'], model: SONNET }
  });
  assert.deepEqual(lastBody().messages[0].content[1], {
    type: 'text',
    text: JOINED,
    cache_control: { type: 'ephemeral', ttl: '1h' }
  });

  await changeStorage({ promptCachingEnabled: false });
  resetFetch([messagesResponse('- r')]);
  await send({
    type: 'RUN_SUMMARY_REDUCE',
    payload: { ...BASE, language: 'en', mode: 'BULLETS_5', chunkSummaries: ['- a', '- b'], model: SONNET }
  });
  assert.deepEqual(lastBody().messages[0].content[1], { type: 'text', text: JOINED });

  await changeStorage({ promptCachingEnabled: true, promptCachingTtl: '5m' });
});

test('max_tokens stop reason: retries with a larger budget, then returns the last result', async () => {
  const truncated = () => messagesResponse('- cut', { stop_reason: 'max_tokens' });
  resetFetch([truncated(), truncated(), truncated(), messagesResponse('- full')]);
  const resp = await send({
    type: 'RUN_SUMMARY_SINGLE',
    payload: { ...BASE, language: 'en', mode: 'BULLETS_5', articleText: 'Body text', model: HAIKU }
  });
  assert.equal(resp.ok, true);
  assert.equal(resp.text, '- full');
  assert.deepEqual(
    fetchCalls.map((c) => JSON.parse(c.init.body).max_tokens),
    [700, 1050, 1575, 2362]
  );
});

test('max_tokens retry returns as soon as a retry completes', async () => {
  resetFetch([messagesResponse('- cut', { stop_reason: 'max_tokens' }), messagesResponse('- full')]);
  const resp = await send({
    type: 'RUN_SUMMARY_REDUCE',
    payload: { ...BASE, language: 'en', mode: 'TLDR_12_CONCLUSION', chunkSummaries: ['- a'], model: SONNET }
  });
  assert.equal(resp.text, '- full');
  assert.deepEqual(
    fetchCalls.map((c) => JSON.parse(c.init.body).max_tokens),
    [1600, 2400]
  );
});

test('API errors are normalized', async () => {
  resetFetch([
    jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
  ]);
  assert.deepEqual(
    await send({
      type: 'RUN_SUMMARY_SINGLE',
      payload: { ...BASE, language: 'en', mode: 'BULLETS_3', articleText: 'x', model: HAIKU }
    }),
    { ok: false, code: 'authentication_error', message: 'invalid x-api-key', status: 401 }
  );

  resetFetch([{ ok: false, status: 502, text: async () => 'Bad gateway' }]);
  assert.deepEqual(
    await send({
      type: 'RUN_SUMMARY_SINGLE',
      payload: { ...BASE, language: 'en', mode: 'BULLETS_3', articleText: 'x', model: HAIKU }
    }),
    { ok: false, code: 'api_error', message: 'Messages request failed.', status: 502 }
  );

  resetFetch([jsonResponse(500, {})]);
  assert.deepEqual(await send({ type: 'COUNT_TOKENS', payload: { ...BASE, articleText: 'x', model: HAIKU } }), {
    ok: false,
    code: 'api_error',
    message: 'Token count request failed.',
    status: 500
  });

  resetFetch([
    () => {
      throw new TypeError('Failed to fetch');
    }
  ]);
  assert.deepEqual(
    await send({
      type: 'RUN_SUMMARY_MAP',
      payload: { ...BASE, language: 'en', chunkIndex: 1, chunkCount: 2, chunkText: 'c', model: HAIKU }
    }),
    { ok: false, code: 'network_error', message: 'Failed to fetch', status: 0 }
  );

  resetFetch([messagesResponse('', { stop_reason: 'refusal' })]);
  assert.deepEqual(
    await send({
      type: 'RUN_SUMMARY_SINGLE',
      payload: { ...BASE, language: 'en', mode: 'BULLETS_3', articleText: 'x', model: HAIKU }
    }),
    { ok: false, code: 'refusal', message: 'The model declined to respond.' }
  );
});

test('ABORT_RUN aborts every in-flight request for the run', async () => {
  const pending = () => (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    });
  resetFetch([pending(), pending()]);

  const runId = 'run_abort';
  const countP = send({ type: 'COUNT_TOKENS', payload: { ...BASE, runId, articleText: 'x', model: HAIKU } });
  const singleP = send({
    type: 'RUN_SUMMARY_SINGLE',
    payload: { ...BASE, runId, language: 'en', mode: 'BULLETS_3', articleText: 'x', model: HAIKU }
  });
  // Let both requests reach fetch.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchCalls.length, 2);

  assert.deepEqual(await send({ type: 'ABORT_RUN', payload: { runId: 'other_run' } }), { ok: true, aborted: false });
  assert.deepEqual(await send({ type: 'ABORT_RUN', payload: { runId } }), { ok: true, aborted: true });

  const expected = { ok: false, code: 'aborted', message: 'Request aborted', status: 0 };
  assert.deepEqual(await countP, expected);
  assert.deepEqual(await singleP, expected);

  // Nothing left to abort.
  assert.deepEqual(await send({ type: 'ABORT_RUN', payload: { runId } }), { ok: true, aborted: false });
});

test('completed requests are unregistered from the abort registry', async () => {
  resetFetch([messagesResponse('- ok')]);
  const runId = 'run_done';
  await send({
    type: 'RUN_SUMMARY_SINGLE',
    payload: { ...BASE, runId, language: 'en', mode: 'BULLETS_3', articleText: 'x', model: HAIKU }
  });
  assert.deepEqual(await send({ type: 'ABORT_RUN', payload: { runId } }), { ok: true, aborted: false });
});

test('SET_BULLET_STYLE: saves a known style for GET_SETTINGS, rejects anything else, needs no API key', async () => {
  const apiKey = storage.claudeApiKey;
  delete storage.claudeApiKey;
  try {
    assert.deepEqual(await send({ type: 'SET_BULLET_STYLE', payload: { style: 'number' } }), { ok: true });
    assert.equal(storage.bulletStyle, 'number');
    assert.equal((await send({ type: 'GET_SETTINGS' })).bulletStyle, 'number');

    const bad = { ok: false, code: 'bad_request', message: 'Invalid bullet style' };
    assert.deepEqual(await send({ type: 'SET_BULLET_STYLE', payload: { style: 'bogus' } }), bad);
    assert.deepEqual(await send({ type: 'SET_BULLET_STYLE' }), bad);
    assert.equal(storage.bulletStyle, 'number');

    // A value written by something else is not trusted as is.
    storage.bulletStyle = 'bogus';
    assert.equal((await send({ type: 'GET_SETTINGS' })).bulletStyle, 'dash');
  } finally {
    storage.claudeApiKey = apiKey;
    delete storage.bulletStyle;
  }
});

test('OPEN_OPTIONS and unknown message types', async () => {
  assert.deepEqual(await send({ type: 'OPEN_OPTIONS' }), { ok: true });
  assert.deepEqual(await send({ type: 'NOPE' }), {
    ok: false,
    code: 'unknown_type',
    message: 'Unknown message type: NOPE'
  });
});

test('action click injects content scripts only into regular pages', async () => {
  const click = listeners.onClicked[0];
  await click({ id: 7, url: 'https://example.com/post' });
  assert.equal(injected.length, 1);
  assert.deepEqual(injected[0], {
    target: { tabId: 7, allFrames: false },
    files: ['third_party/readability/Readability.js', 'content/main.js']
  });
  // Every injected file is part of the build.
  for (const f of injected[0].files) {
    assert.ok(fs.existsSync(path.join(process.cwd(), 'dist', f)), `dist/${f} must exist (run build first)`);
  }

  for (const url of [
    'chrome://settings',
    'chrome-extension://x/y',
    'about:blank',
    'file:///tmp/a.html',
    'view-source:https://a',
    ''
  ]) {
    await click({ id: 8, url });
  }
  await click({ url: 'https://example.com' });
  assert.equal(injected.length, 1);
});
