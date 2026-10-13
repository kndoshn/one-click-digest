// Options page behavior: src/options/index.ts driven against public/options.html in a fake DOM,
// with chrome.storage, fetch (for _locales), confirm and location.reload stubbed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { MODELS } from '../src/shared/models.ts';
import { FakeDocument, loadHtml } from './helpers/fake_dom.js';

const OPTIONS_HTML = fs.readFileSync(path.join(process.cwd(), 'public', 'options.html'), 'utf-8');

function messages(folder) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', '_locales', folder, 'messages.json'), 'utf-8'));
}

const EN = messages('en');
const JA = messages('ja');
const msg = (key, sub = '') => EN[key].message.replace('$1', sub);

const DEFAULTS = {
  modelMap: 'claude-haiku-5-5',
  modelFinal: 'claude-sonnet-5-5',
  promptCachingEnabled: true,
  promptCachingTtl: '5m',
  hardCostLimitUsd: 1,
  approvalThresholdUsd: 1,
  approvalThresholdChars: 100_000,
  minArticleChars: 600,
  maxArticleCharsToSend: 200_000,
  uiLanguage: 'auto'
};

async function waitFor(fn, { timeoutMs = 2000, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (true) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

let importCount = 0;

async function openOptionsPage({ stored = {}, uiLanguage = 'en-US' } = {}) {
  const storage = { ...stored };
  const doc = loadHtml(new FakeDocument(), OPTIONS_HTML);
  const env = { storage, doc, writes: [], fetched: [], reloads: 0, confirmResult: true, confirmCalls: [] };

  globalThis.document = doc;
  globalThis.chrome = {
    i18n: { getUILanguage: () => uiLanguage, getMessage: () => '' },
    runtime: { getURL: (p) => `chrome-extension://test/${p}` },
    storage: {
      local: {
        get: (keys, cb) => {
          const out = {};
          for (const k of keys) if (Object.prototype.hasOwnProperty.call(storage, k)) out[k] = storage[k];
          setTimeout(() => cb(out), 0);
        },
        set: (obj, cb) => {
          env.writes.push({ ...obj });
          Object.assign(storage, obj);
          if (cb) setTimeout(cb, 0);
        },
        remove: (keys, cb) => {
          for (const k of keys) delete storage[k];
          if (cb) setTimeout(cb, 0);
        }
      }
    }
  };
  globalThis.fetch = async (url) => {
    env.fetched.push(url);
    const rel = String(url).replace('chrome-extension://test/', '');
    return { json: async () => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', rel), 'utf-8')) };
  };
  globalThis.confirm = (text) => {
    env.confirmCalls.push(text);
    return env.confirmResult;
  };
  globalThis.location = {
    reload: () => {
      env.reloads += 1;
    }
  };

  // A fresh module instance per page load (the module wires DOMContentLoaded at import time).
  importCount += 1;
  await import(`../src/options/index.ts?load=${importCount}`);

  env.el = (id) => doc.getElementById(id);
  env.status = () => doc.getElementById('status').textContent;
  env.setValue = (id, value) => {
    doc.getElementById(id).value = value;
  };
  // Clicks a button and waits for its async handler to report a status.
  env.click = async (id) => {
    doc.getElementById('status').textContent = '';
    doc.getElementById(id).click();
    await waitFor(() => env.status() !== '');
  };

  doc.dispatchEvent(new Event('DOMContentLoaded'));
  await waitFor(() => env.status() !== '');
  return env;
}

test('loads stored preferences, migrates legacy approval thresholds, and reflects a saved API key', async () => {
  const env = await openOptionsPage({
    stored: {
      claudeApiKey: 'sk-ant-x',
      modelMap: 'claude-sonnet-5',
      modelFinal: 'claude-haiku-5-5',
      promptCachingEnabled: false,
      promptCachingTtl: '1h',
      hardCostLimitUsd: 2.5,
      approvalThresholdUsd: 0.25,
      approvalThresholdChars: 50_000,
      minArticleChars: 300,
      maxArticleCharsToSend: 150_000,
      uiLanguage: 'auto'
    }
  });

  assert.equal(env.el('model-map').value, 'claude-sonnet-5');
  assert.equal(env.el('model-final').value, 'claude-haiku-5-5');
  assert.equal(env.el('prompt-caching-enabled').checked, false);
  assert.equal(env.el('prompt-caching-ttl').value, '1h');
  assert.equal(env.el('hard-limit').value, '2.5');
  // 0.25 is the legacy default: shown and written back as the current default.
  assert.equal(env.el('approval-usd').value, '1');
  assert.deepEqual(env.writes, [{ approvalThresholdUsd: 1 }]);
  assert.equal(env.el('approval-chars').value, '50000');
  assert.equal(env.el('min-article-chars').value, '300');
  assert.equal(env.el('max-send-chars').value, '150000');

  assert.equal(env.el('api-key').disabled, true);
  assert.equal(env.el('api-key').placeholder, msg('placeholderApiKeySaved'));
  assert.equal(env.el('clear').hidden, false);
  assert.equal(env.status(), msg('statusKeySet'));

  // i18n: English messages from the browser UI language.
  assert.deepEqual(env.fetched, ['chrome-extension://test/_locales/en/messages.json']);
  assert.equal(env.doc.title, msg('optionsTitle'));
  assert.equal(env.doc.querySelector('h1').textContent, msg('optionsHeading'));
  assert.equal(env.doc.querySelector('[data-i18n-html]').innerHTML, msg('optionsIntro'));

  // UI language select: "Auto (English)" first, and English itself is not repeated.
  const uiLang = env.el('ui-language');
  assert.equal(uiLang.value, 'auto');
  assert.equal(uiLang.options[0].textContent, msg('uiLanguageAutoFormat', 'English'));
  assert.deepEqual(
    uiLang.options.slice(1).map((o) => o.value),
    ['ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko']
  );
});

test('without an API key the input is enabled and the clear button is hidden', async () => {
  const env = await openOptionsPage();
  assert.equal(env.el('api-key').disabled, false);
  assert.equal(env.el('api-key').placeholder, msg('placeholderApiKeyEmpty'));
  assert.equal(env.el('clear').hidden, true);
  assert.equal(env.status(), msg('statusKeyMissing'));
  assert.equal(env.el('model-map').value, DEFAULTS.modelMap);
  assert.equal(env.el('prompt-caching-enabled').checked, true);
});

test('a stored Japanese UI language loads Japanese messages', async () => {
  const env = await openOptionsPage({ stored: { uiLanguage: 'ja' } });
  assert.deepEqual(env.fetched, ['chrome-extension://test/_locales/ja/messages.json']);
  assert.equal(env.el('ui-language').value, 'ja');
  assert.equal(env.doc.querySelector('h1').textContent, JA.optionsHeading.message);
  assert.equal(env.status(), JA.statusKeyMissing.message);
});

test('save: blank numeric fields fall back to the defaults instead of 0', async () => {
  const env = await openOptionsPage({ stored: { claudeApiKey: 'sk-ant-x' } });
  for (const id of ['hard-limit', 'approval-usd', 'approval-chars', 'min-article-chars', 'max-send-chars']) {
    env.setValue(id, '');
  }
  await env.click('save');

  const { claudeApiKey, ...saved } = env.storage;
  assert.equal(claudeApiKey, 'sk-ant-x');
  assert.deepEqual(saved, DEFAULTS);
  assert.equal(env.el('approval-usd').value, '1');
  assert.equal(env.status(), msg('statusSavedKeySet'));
});

test('save: out-of-range and non-numeric values fall back; counts are floored', async () => {
  const env = await openOptionsPage();
  env.setValue('hard-limit', '0');
  env.setValue('approval-usd', '0');
  env.setValue('approval-chars', '1234.9');
  env.setValue('min-article-chars', '-5');
  env.setValue('max-send-chars', '999');
  env.setValue('model-map', 'claude-sonnet-4-6');
  env.setValue('prompt-caching-ttl', '1h');
  env.el('prompt-caching-enabled').checked = false;
  await env.click('save');

  assert.deepEqual(env.storage, {
    ...DEFAULTS,
    modelMap: 'claude-sonnet-4-6',
    promptCachingEnabled: false,
    promptCachingTtl: '1h',
    // 0 is below the 0.01 minimum.
    hardCostLimitUsd: 1,
    // 0 is a valid approval threshold (always ask).
    approvalThresholdUsd: 0,
    approvalThresholdChars: 1234,
    minArticleChars: 600,
    maxArticleCharsToSend: 200_000
  });
  assert.equal(env.status(), msg('statusSavedKeyMissing'));

  env.setValue('hard-limit', 'abc');
  env.setValue('approval-usd', '2.5');
  await env.click('save');
  assert.equal(env.storage.hardCostLimitUsd, 1);
  assert.equal(env.storage.approvalThresholdUsd, 2.5);
});

test('save: a new API key is stored trimmed, then the input is cleared and locked', async () => {
  const env = await openOptionsPage();
  env.setValue('api-key', '  sk-ant-new  ');
  await env.click('save');

  assert.equal(env.storage.claudeApiKey, 'sk-ant-new');
  assert.equal(env.el('api-key').value, '');
  assert.equal(env.el('api-key').disabled, true);
  assert.equal(env.el('clear').hidden, false);
  assert.equal(env.status(), msg('statusSavedKeySet'));
});

test('save: changing the UI language reloads the page', async () => {
  const env = await openOptionsPage();
  env.setValue('ui-language', 'ja');
  await env.click('save');

  assert.equal(env.status(), msg('statusReloading'));
  assert.equal(env.storage.uiLanguage, 'ja');
  await waitFor(() => env.reloads === 1);
});

test('clear API key asks for confirmation first', async () => {
  const env = await openOptionsPage({ stored: { claudeApiKey: 'sk-ant-x' } });

  env.confirmResult = false;
  env.el('clear').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(env.confirmCalls, [msg('confirmClearApiKey')]);
  assert.equal(env.storage.claudeApiKey, 'sk-ant-x');

  env.confirmResult = true;
  await env.click('clear');
  assert.equal('claudeApiKey' in env.storage, false);
  assert.equal(env.el('api-key').disabled, false);
  assert.equal(env.el('clear').hidden, true);
  assert.equal(env.status(), msg('statusClearedKey'));
});

test('reset to defaults keeps the API key', async () => {
  const env = await openOptionsPage({
    stored: { claudeApiKey: 'sk-ant-x', modelMap: 'claude-sonnet-5', hardCostLimitUsd: 3, uiLanguage: 'auto' }
  });

  env.confirmResult = false;
  env.el('reset').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(env.storage.modelMap, 'claude-sonnet-5');

  env.confirmResult = true;
  await env.click('reset');
  const { claudeApiKey, ...saved } = env.storage;
  assert.equal(claudeApiKey, 'sk-ant-x');
  assert.deepEqual(saved, DEFAULTS);
  assert.equal(env.el('model-map').value, DEFAULTS.modelMap);
  assert.equal(env.el('hard-limit').value, '1');
  assert.equal(env.el('api-key').disabled, true);
  assert.equal(env.status(), msg('statusResetDefaults'));
});

test('model selects list the catalog with the default first', async () => {
  const env = await openOptionsPage();
  const values = (id) => env.el(id).options.map((o) => o.value);
  assert.deepEqual(values('model-map').sort(), MODELS.map((m) => m.id).sort());
  assert.equal(values('model-map')[0], DEFAULTS.modelMap);
  assert.equal(values('model-final')[0], DEFAULTS.modelFinal);
  assert.equal(env.el('model-map').options[0].textContent, `${MODELS[0].name} (${MODELS[0].id})`);
});

test('a stored model that is no longer offered falls back to the default and is reported', async () => {
  const env = await openOptionsPage({ stored: { claudeApiKey: 'sk-ant-x', modelFinal: 'claude-3-opus' } });
  assert.equal(env.el('model-final').value, DEFAULTS.modelFinal);
  assert.equal(env.status(), msg('statusModelUnavailable', 'claude-3-opus'));
  assert.equal(env.el('status').className, 'danger');
  // Nothing is written until the user saves.
  assert.equal(env.storage.modelFinal, 'claude-3-opus');

  await env.click('save');
  assert.equal(env.storage.modelFinal, DEFAULTS.modelFinal);
});
