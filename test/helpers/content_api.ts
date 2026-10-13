// Entry point of the content script test bundle (build/test/content.js, built by
// `node scripts/build.mjs --test`). The bundle is an IIFE that assigns `globalThis.AS`; tests run
// it in a vm context (see classic_context.js) and reach the modules as AS.<export> or
// AS.<Module>.<export>. It does not call Controller.bootstrap(), so tests can pass stubs to it.

export * from '../../src/content/runtime.ts';
export * from '../../src/content/i18n.ts';
export * from '../../src/content/models.ts';
export * as Chunker from '../../src/content/chunk.ts';
export * as Controller from '../../src/content/controller.ts';
export * as Estimate from '../../src/content/estimate.ts';
export * as Extract from '../../src/content/extract.ts';
export * as Format from '../../src/content/format.ts';
export * as Overlay from '../../src/content/overlay.ts';
export * as StateMachine from '../../src/content/state_machine.ts';
