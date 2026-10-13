import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/**
 * Creates a VM context suitable for evaluating "classic" (non-module) scripts.
 *
 * We use this to unit test dist/content/*.js which are injected as classic scripts
 * in MV3, and are therefore not importable as normal ESM modules.
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

export function runClassicScripts(ctx, relPaths) {
  for (const relPath of relPaths) {
    const abs = path.join(process.cwd(), relPath);
    const code = fs.readFileSync(abs, 'utf-8');
    // Use the absolute path so V8 coverage (c8) attributes the code to dist/content/*.js.
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
