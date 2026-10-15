// Builds the unpacked extension into dist/.
//
// - background/index.js and options/index.js: ES modules (the manifest loads the worker with
//   "type": "module", and options.html uses <script type="module">).
// - content/main.js: a single IIFE. It is injected with chrome.scripting.executeScript, which runs
//   files as classic scripts, so it must not contain import/export.
// - content/pdf.js: the PDF reader (pdf.js), also an IIFE, injected before content/main.js into PDF
//   tabs only. Fully minified, as it is mostly third-party code; license comments are kept.
// - public/ (manifest, options.html, locales, icons) and third_party/ are copied as is.
//
// Flags:
// --test  also bundles test/helpers/content_api.ts into build/test/ for the content script tests.
// --e2e   builds the E2E variant into build/e2e/ instead of dist/: __E2E__ is true (open overlay
//         shadow root, injection hook for Playwright) and the manifest also allows the test origin.

import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

// The origin the E2E tests serve their fixture pages from (see e2e/).
const E2E_ORIGIN = 'https://e2e.test';

const rootDir = process.cwd();
const e2e = process.argv.includes('--e2e');
const outDir = path.join(rootDir, e2e ? 'build/e2e' : 'dist');
const testBuildDir = path.join(rootDir, 'build', 'test');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  target: 'es2022',
  platform: 'browser',
  charset: 'utf8',
  legalComments: 'inline',
  logLevel: 'warning',
  define: { __E2E__: String(e2e) },
  // Drops the code behind `if (__E2E__)` from production builds; whitespace and names are kept.
  minifySyntax: true
};

// pdf.js marks its license notice with @licstart, which esbuild does not keep as a legal comment.
// Put the notice from the bundled file at the top of content/pdf.js instead.
function pdfjsLicenseBanner() {
  const pdfjs = fs.readFileSync(path.join(rootDir, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'), 'utf-8');
  const notice = /^\/\*\*[\s\S]*?\*\//.exec(pdfjs)?.[0];
  if (!notice?.includes('Apache License')) throw new Error('pdf.js license notice not found');
  const { version } = JSON.parse(fs.readFileSync(path.join(rootDir, 'node_modules/pdfjs-dist/package.json'), 'utf-8'));
  return `/*! PDF.js ${version} (pdfjs-dist, legacy build)${notice.slice(3)}`;
}

fs.rmSync(outDir, { recursive: true, force: true });

console.log(`[build] esbuild${e2e ? ' (e2e)' : ''}`);
await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: { 'background/index': 'src/background/index.ts', 'options/index': 'src/options/index.ts' },
    outdir: outDir,
    format: 'esm'
  }),
  esbuild.build({
    ...common,
    entryPoints: { 'content/main': 'src/content/main.ts' },
    outdir: outDir,
    format: 'iife'
  }),
  esbuild.build({
    ...common,
    entryPoints: { 'content/pdf': 'src/content/pdf_main.ts' },
    outdir: outDir,
    format: 'iife',
    minify: true,
    banner: { js: pdfjsLicenseBanner() }
  })
]);

console.log('[build] copy public/ and third_party/');
fs.cpSync(path.join(rootDir, 'public'), outDir, { recursive: true });
fs.cpSync(path.join(rootDir, 'third_party'), path.join(outDir, 'third_party'), { recursive: true });

if (e2e) {
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  manifest.host_permissions = [...manifest.host_permissions, `${E2E_ORIGIN}/*`];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

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
