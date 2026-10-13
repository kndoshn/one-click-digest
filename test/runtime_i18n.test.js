// Content runtime helpers (src/content/runtime.ts) and UI i18n (src/content/i18n.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CustomEventPolyfill, createClassicContext, runContentBundle } from './helpers/classic_context.js';
import { FakeDocument } from './helpers/fake_dom.js';

function load(globals = {}) {
  const ctx = createClassicContext({
    navigator: { language: 'en-US' },
    location: { href: 'https://example.com/a' },
    document: new FakeDocument(),
    CustomEvent: CustomEventPolyfill,
    ...globals
  });
  runContentBundle(ctx);
  return ctx;
}

function localeJson(folder) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', '_locales', folder, 'messages.json'), 'utf-8'));
}

test('clampText keeps short text and truncates long text', () => {
  const { AS } = load();
  assert.deepEqual({ ...AS.clampText('abc', 5) }, { text: 'abc', truncated: false });
  assert.deepEqual({ ...AS.clampText('abcde', 5) }, { text: 'abcde', truncated: false });
  assert.deepEqual({ ...AS.clampText('abcdef', 5) }, { text: 'abcde', truncated: true });
  assert.deepEqual({ ...AS.clampText('abc', 0) }, { text: '', truncated: true });
  assert.deepEqual({ ...AS.clampText('', 0) }, { text: '', truncated: false });
});

test('makeRunId returns distinct run_ ids', () => {
  const { AS } = load();
  const ids = new Set(Array.from({ length: 50 }, () => AS.makeRunId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^run_[a-z0-9]+_[a-z0-9]+$/);
});

test('getPageTitle prefers og:title, then document.title, then a placeholder', () => {
  const doc = new FakeDocument();
  const { AS } = load({ document: doc });
  assert.equal(AS.getPageTitle(), '(untitled)');

  doc.title = '  Doc title  ';
  assert.equal(AS.getPageTitle(), 'Doc title');

  const og = /** @type {any} */ (doc.createElement('meta'));
  og.setAttribute('property', 'og:title');
  og.content = 'OG title';
  doc.head.appendChild(og);
  assert.equal(AS.getPageTitle(), 'OG title');

  og.content = '';
  assert.equal(AS.getPageTitle(), 'Doc title');
});

test('getPageUrl returns location.href, or an empty string when it is unavailable', () => {
  assert.equal(load().AS.getPageUrl(), 'https://example.com/a');
  const throwing = {};
  Object.defineProperty(throwing, 'href', {
    get() {
      throw new Error('cross-origin');
    }
  });
  assert.equal(load({ location: throwing }).AS.getPageUrl(), '');
});

test('removeExistingOverlay notifies the owner of the overlay, then removes it', () => {
  const doc = new FakeDocument();
  const { AS } = load({ document: doc });
  AS.removeExistingOverlay(); // nothing to remove

  const host = doc.createElement('div');
  host.id = AS.OVERLAY_CONTAINER_ID;
  doc.documentElement.appendChild(host);
  const events = [];
  host.addEventListener(AS.OVERLAY_DISPOSE_EVENT, () => events.push(host.isConnected));

  AS.removeExistingOverlay();
  assert.deepEqual(events, [true], 'dispose is dispatched while the host is still attached');
  assert.equal(doc.getElementById(AS.OVERLAY_CONTAINER_ID), null);
  assert.equal(host.isConnected, false);
});

test('sendMessage resolves with the response and rejects on chrome.runtime.lastError or a throw', async () => {
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        if (msg.type === 'THROW') throw new Error('Extension context invalidated.');
        if (msg.type === 'LAST_ERROR') {
          chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
          cb(undefined);
          chrome.runtime.lastError = null;
          return;
        }
        cb({ ok: true, echo: msg.type });
      }
    }
  };
  const { AS } = load({ chrome });
  assert.deepEqual({ ...(await AS.sendMessage({ type: 'PING' })) }, { ok: true, echo: 'PING' });
  await assert.rejects(AS.sendMessage({ type: 'LAST_ERROR' }), /Receiving end does not exist/);
  await assert.rejects(AS.sendMessage({ type: 'THROW' }), /Extension context invalidated/);
});

test('getSettings reports no API key when the background fails or answers not-ok', async () => {
  for (const respond of [
    (cb) => cb({ ok: false }),
    () => {
      throw new Error('gone');
    }
  ]) {
    const { AS } = load({ chrome: { runtime: { lastError: null, sendMessage: (_m, cb) => respond(cb) } } });
    assert.deepEqual({ ...(await AS.getSettings()) }, { apiKeySet: false });
  }
  const { AS } = load({
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (_m, cb) => cb({ ok: true, apiKeySet: 1, settings: { uiLanguage: 'ja' } })
      }
    }
  });
  const r = await AS.getSettings();
  assert.equal(r.apiKeySet, true);
  assert.equal(r.settings.uiLanguage, 'ja');
});

test('openOptionsPage falls back to chrome.runtime.openOptionsPage when messaging fails', async () => {
  let opened = 0;
  const sent = [];
  /** @type {any} */
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg) => {
        sent.push(msg.type);
        throw new Error('no background');
      },
      openOptionsPage: async () => {
        opened += 1;
      }
    }
  };
  await load({ chrome }).AS.openOptionsPage();
  assert.deepEqual(sent, ['OPEN_OPTIONS']);
  assert.equal(opened, 1);

  // When messaging works the background opens the page.
  chrome.runtime.sendMessage = (msg, cb) => {
    sent.push(msg.type);
    cb({ ok: true });
  };
  await load({ chrome }).AS.openOptionsPage();
  assert.equal(opened, 1);
});

test('getAcceptLanguages uses chrome.i18n, falling back to navigator.language', async () => {
  const withList = (list) =>
    load({ chrome: { i18n: { getAcceptLanguages: (cb) => cb(list) } } }).AS.getAcceptLanguages();
  assert.deepEqual([...(await withList(['ja', 'en-US']))], ['ja', 'en-US']);
  assert.deepEqual([...(await withList([]))], ['en-US']);
  assert.deepEqual([...(await withList(undefined))], ['en-US']);
  assert.deepEqual([...(await load({ chrome: {} }).AS.getAcceptLanguages())], ['en-US']);
  assert.deepEqual([...(await load({ chrome: {}, navigator: {} }).AS.getAcceptLanguages())], ['en']);
});

test('copyToClipboard uses the async clipboard API, then falls back to execCommand', async () => {
  const written = [];
  const ok = await load({ navigator: { clipboard: { writeText: async (t) => written.push(t) } } }).AS.copyToClipboard(
    'hello'
  );
  assert.equal(ok, true);
  assert.deepEqual(written, ['hello']);

  // Clipboard API rejected (e.g. no focus): execCommand fallback with a temporary textarea.
  const doc = /** @type {any} */ (new FakeDocument());
  const copiedValues = [];
  doc.execCommand = (cmd) => {
    const ta = doc.querySelector('textarea');
    copiedValues.push([cmd, ta.value, ta.isConnected]);
    return true;
  };
  const fallback = load({
    document: doc,
    navigator: {
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        }
      }
    }
  });
  assert.equal(await fallback.AS.copyToClipboard('world'), true);
  assert.deepEqual(copiedValues, [['copy', 'world', true]]);
  assert.equal(doc.querySelector('textarea'), null, 'the textarea is removed');

  doc.execCommand = () => {
    throw new Error('unsupported');
  };
  assert.equal(await fallback.AS.copyToClipboard('x'), false);
});

test('UI language: browser language mapping to supported locales', () => {
  const cases = [
    ['en-US', 'en'],
    ['ja', 'ja'],
    ['fr-CA', 'fr'],
    ['pt-PT', 'pt-BR'],
    ['zh', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['ko-KR', 'ko'],
    ['nl', 'en'],
    ['', 'en']
  ];
  for (const [browser, expected] of cases) {
    const { AS } = load({ chrome: { i18n: { getUILanguage: () => browser } } });
    assert.equal(AS.getUiLanguage(), expected, browser);
  }
  // Without chrome.i18n, navigator.language is used.
  assert.equal(load({ chrome: {}, navigator: { language: 'de-DE' } }).AS.getUiLanguage(), 'de');
});

test('UI language override: loads the locale file, applies substitutions, and resets on auto or failure', async () => {
  const fetched = [];
  const chrome = {
    i18n: { getUILanguage: () => 'en-US', getMessage: (k) => (k === 'onlyInChrome' ? 'from chrome' : '') },
    runtime: { getURL: (p) => `chrome-extension://id/${p}` }
  };
  let failFetch = false;
  const fetch = async (url) => {
    fetched.push(url);
    if (failFetch) throw new Error('offline');
    const rel = url.replace('chrome-extension://id/', '');
    return { json: async () => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', rel), 'utf-8')) };
  };
  const { AS } = load({ chrome, fetch });
  const ja = localeJson('ja');
  const zhTW = localeJson('zh_TW');

  await AS.setUiLanguage('ja');
  assert.equal(AS.getUiLanguage(), 'ja');
  assert.equal(AS.t('buttonCopy'), ja.buttonCopy.message);
  assert.equal(AS.t('toastModeAdjusted', '3点'), ja.toastModeAdjusted.message.replace('$1', '3点'));
  assert.equal(AS.t('toastModeAdjusted', []), ja.toastModeAdjusted.message.replace('$1', ''));
  // Keys missing from the override fall back to chrome.i18n, then to the key itself.
  assert.equal(AS.t('onlyInChrome'), 'from chrome');
  assert.equal(AS.t('missingEverywhere'), 'missingEverywhere');

  await AS.setUiLanguage('zh-HK');
  assert.equal(AS.getUiLanguage(), 'zh-TW');
  assert.equal(AS.t('buttonCopy'), zhTW.buttonCopy.message);

  await AS.setUiLanguage('auto');
  assert.equal(AS.getUiLanguage(), 'en');
  assert.equal(AS.t('buttonCopy'), 'buttonCopy');

  await AS.setUiLanguage('fr');
  failFetch = true;
  await AS.setUiLanguage('de');
  assert.equal(AS.getUiLanguage(), 'en', 'a failed load clears the override');

  assert.deepEqual(fetched, [
    'chrome-extension://id/_locales/ja/messages.json',
    'chrome-extension://id/_locales/zh_TW/messages.json',
    'chrome-extension://id/_locales/fr/messages.json',
    'chrome-extension://id/_locales/de/messages.json'
  ]);
});

test('t() survives a throwing chrome.i18n.getMessage', () => {
  const { AS } = load({
    chrome: {
      i18n: {
        getMessage: () => {
          throw new Error('no i18n');
        }
      }
    }
  });
  assert.equal(AS.t('buttonCopy'), 'buttonCopy');
});
