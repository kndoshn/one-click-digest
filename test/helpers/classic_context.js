import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/**
 * Creates a VM context suitable for evaluating "classic" (non-module) scripts.
 *
 * The content scripts are injected into pages as a classic-script bundle, so tests run the test
 * bundle (an IIFE that defines `AS`) in a context with stubbed browser globals.
 */
export function createClassicContext(extraGlobals = {}) {
  const base = {
    console,
    // timers are safe defaults even if a test doesn't use them
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    EventTarget,
    Event,
    ...extraGlobals
  };
  return vm.createContext(base);
}

// The content script test bundle (see test/helpers/content_api.ts and scripts/build.mjs).
export const CONTENT_TEST_BUNDLE = 'build/test/content.js';

// Runs the content script test bundle in `ctx`: defines ctx.AS, as each toolbar click does in a page.
// ctx.deps collects stubs for AS.Controller.bootstrap(ctx.deps) (overlay, extract, copyToClipboard).
export function runContentBundle(ctx) {
  runClassicScripts(ctx, [CONTENT_TEST_BUNDLE]);
  ctx.deps = {};
  return ctx;
}

export function runClassicScripts(ctx, relPaths) {
  for (const relPath of relPaths) {
    const abs = path.join(process.cwd(), relPath);
    const code = fs.readFileSync(abs, 'utf-8');
    // Use the absolute path so V8 coverage (c8) can find the file and its inline source map.
    vm.runInContext(code, ctx, { filename: abs });
  }
  return ctx;
}

// Node 18 has no global CustomEvent (it is available from Node 19).
export const CustomEventPolyfill =
  globalThis.CustomEvent ||
  class CustomEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.detail = init.detail ?? null;
    }
  };
