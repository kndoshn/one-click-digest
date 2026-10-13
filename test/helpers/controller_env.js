// Test harness for the content controller (dist/content/controller.js): runs the content scripts in
// a VM context with chrome messaging, chrome.storage.onChanged and the DOM-facing modules
// (Overlay, Extract) stubbed. `inject()` simulates chrome.scripting.executeScript running every
// content script again (as on each toolbar click), followed by bootstrap.js.

import { CustomEventPolyfill, createClassicContext, runClassicScripts } from './classic_context.js';

const CONTENT_SCRIPTS = [
  'dist/content/runtime.js',
  'dist/content/i18n.js',
  'dist/content/models.js',
  'dist/content/state_machine.js',
  'dist/content/chunk.js',
  'dist/content/format.js',
  'dist/content/estimate.js',
  'dist/content/controller.js'
];

const OVERLAY_ID = '__article_summarizer_overlay__';

export function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export async function waitFor(fn, { timeoutMs = 4000, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (true) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export const tick = () => new Promise((r) => setTimeout(r, 20));

// Makes the stubbed chrome.runtime.sendMessage fail with chrome.runtime.lastError.
export function lastError(message) {
  return { __lastError: message };
}

export function shortArticle(text = 'Hello world. '.repeat(200)) {
  return { ok: true, title: 'T', url: 'https://example.com/a', text, charCount: text.length, linkDensity: 0.01 };
}

/**
 * @param {object} opts
 * @param {(msg: any) => any} opts.respond Response (or promise of one) for each non-GET_SETTINGS message.
 * @param {object} [opts.settings] Settings returned by GET_SETTINGS.
 * @param {() => any} [opts.settingsResponse] Overrides the whole GET_SETTINGS response.
 * @param {() => any} [opts.extract] AS.Extract.extractArticle stub.
 */
export function createControllerEnv({ respond, settings = { minArticleChars: 50 }, settingsResponse, extract } = {}) {
  const sent = [];
  const storageListeners = new Set();
  const overlays = [];
  const toasts = [];
  const errors = [];
  const page = { overlayHost: null };
  const env = { sent, storageListeners, overlays, toasts, errors, page, confirmResult: true, confirmCalls: 0, copyResult: true };

  // The page-level parent of the overlay host (document.documentElement in the real DOM).
  const root = {
    removeChild(node) {
      node.parentNode = null;
      if (page.overlayHost === node) page.overlayHost = null;
    }
  };

  const chrome = {
    i18n: {
      getMessage: (k, subs) => (subs === undefined ? String(k) : `${k}(${[].concat(subs).join(',')})`),
      getAcceptLanguages: (cb) => cb(['en-US'])
    },
    storage: {
      onChanged: {
        addListener: (fn) => storageListeners.add(fn),
        removeListener: (fn) => storageListeners.delete(fn)
      }
    },
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        // Extension messaging JSON-serializes payloads (undefined fields are dropped).
        const m = JSON.parse(JSON.stringify(msg));
        let resp;
        if (m.type === 'GET_SETTINGS') {
          resp = settingsResponse ? settingsResponse() : { ok: true, apiKeySet: true, settings };
        } else {
          sent.push(m);
          resp = respond ? respond(m) : { ok: false, code: 'unhandled' };
        }
        Promise.resolve(resp).then((r) => {
          if (r && r.__lastError) {
            chrome.runtime.lastError = { message: r.__lastError };
            try {
              cb(undefined);
            } finally {
              chrome.runtime.lastError = null;
            }
            return;
          }
          cb(r);
        });
      }
    }
  };

  const ctx = createClassicContext({
    chrome,
    navigator: { language: 'en-US' },
    location: { href: 'https://example.com/a', host: 'example.com' },
    document: { getElementById: (id) => (id === OVERLAY_ID ? page.overlayHost : null) },
    confirm: () => {
      env.confirmCalls += 1;
      return env.confirmResult;
    },
    console: { ...console, error: (...args) => errors.push(args) },
    CustomEvent: CustomEventPolyfill,
    performance
  });

  env.inject = () => {
    runClassicScripts(ctx, CONTENT_SCRIPTS);
    ctx.AS.Overlay = {
      mount: () => {
        if (env.mountError) throw env.mountError;
        const host = new EventTarget();
        host.parentNode = root;
        // `host` is the page-visible element; `events` carries the overlay's UI events.
        const inst = { host, events: new EventTarget(), lastState: null, states: [], renders: 0, unmounted: false, languageOptionsSet: 0 };
        overlays.push(inst);
        page.overlayHost = host;
        return inst;
      },
      unmount: (inst) => {
        inst.unmounted = true;
        if (inst.host.parentNode) inst.host.parentNode.removeChild(inst.host);
      },
      render: (inst, state) => {
        inst.lastState = state;
        inst.states.push(state);
        inst.renders += 1;
      },
      setLanguageOptions: (inst) => {
        inst.languageOptionsSet += 1;
      },
      showToast: (_inst, text) => {
        toasts.push(text);
      }
    };
    ctx.AS.Extract = { extractArticle: extract || (() => shortArticle()) };
    ctx.AS.copyToClipboard = async (text) => {
      env.copied = text;
      return env.copyResult;
    };
    ctx.AS.Controller.bootstrap();
  };

  // A UI event from the overlay's own controls.
  env.dispatch = (inst, type, detail = {}) => inst.events.dispatchEvent(new CustomEventPolyfill(type, { detail }));
  // An event a page script dispatches on the overlay host element (which is in the page DOM).
  env.dispatchFromPage = (inst, type, detail = {}) => inst.host.dispatchEvent(new CustomEventPolyfill(type, { detail }));
  env.ctx = ctx;
  return env;
}

// Injects the content scripts and waits until the new overlay finished bootstrapping
// (SETTINGS_LOADED is the last bootstrap step, after the storage listener is registered).
export async function injectAndWaitIdle(env) {
  const count = env.overlays.length;
  env.inject();
  return await waitFor(() => {
    const inst = env.overlays[count];
    return inst?.lastState?.phase === 'IDLE' && inst.lastState.apiKeySet ? inst : null;
  });
}

export function phaseOf(inst) {
  return inst.lastState?.phase;
}
