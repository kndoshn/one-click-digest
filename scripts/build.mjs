// Builds the unpacked extension into dist/.
//
// - background/index.js and options/index.js: ES modules (the manifest loads the worker with
//   "type": "module", and options.html uses <script type="module">).
// - content/main.js: a single IIFE. It is injected with chrome.scripting.executeScript, which runs
//   files as classic scripts, so it must not contain import/export.
// - public/ (manifest, options.html, locales, icons) and third_party/ are copied as is.
//
// `node scripts/build.mjs --test` also bundles test/helpers/content_api.ts into build/test/ for the
// content script tests (see that file).

import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const testBuildDir = path.join(rootDir, 'build', 'test');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  target: 'es2022',
  platform: 'browser',
  charset: 'utf8',
  legalComments: 'inline',
  logLevel: 'warning'
};

fs.rmSync(distDir, { recursive: true, force: true });

console.log('[build] esbuild');
await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: { 'background/index': 'src/background/index.ts', 'options/index': 'src/options/index.ts' },
    outdir: distDir,
    format: 'esm'
  }),
  esbuild.build({
    ...common,
    entryPoints: { 'content/main': 'src/content/main.ts' },
    outdir: distDir,
    format: 'iife'
  })
]);

console.log('[build] copy public/ and third_party/');
fs.cpSync(path.join(rootDir, 'public'), distDir, { recursive: true });
fs.cpSync(path.join(rootDir, 'third_party'), path.join(distDir, 'third_party'), { recursive: true });

if (process.argv.includes('--test')) {
  console.log('[build] test bundle');
  fs.rmSync(testBuildDir, { recursive: true, force: true });
  await esbuild.build({
    ...common,
    entryPoints: { content: 'test/helpers/content_api.ts' },
    outdir: testBuildDir,
    format: 'iife',
    globalName: 'AS',
    // Lets c8 map coverage back to src/content/*.ts.
    sourcemap: 'inline'
  });
}

console.log('[build] done');
