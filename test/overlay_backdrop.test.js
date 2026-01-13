import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const overlayPath = path.join(process.cwd(), 'src', 'content', 'overlay.ts');
const overlayCode = fs.readFileSync(overlayPath, 'utf-8');

test('Overlay: backdrop element exists in mount()', () => {
  const mountIdx = overlayCode.indexOf('export function mount');
  assert.ok(mountIdx >= 0, 'mount() function should exist');

  const mountEndIdx = overlayCode.indexOf('export function unmount', mountIdx);
  const mountSnippet = overlayCode.slice(mountIdx, mountEndIdx);
  assert.ok(
    /backdrop/.test(mountSnippet),
    'mount() should create a backdrop element'
  );
  assert.ok(
    /shadow\.appendChild\(backdrop\)|shadow\.insertBefore\(backdrop/.test(mountSnippet),
    'backdrop should be added to shadow DOM'
  );
});

test('Overlay: backdrop has click listener that dispatches as:close', () => {
  const mountIdx = overlayCode.indexOf('export function mount');
  assert.ok(mountIdx >= 0);

  const mountEndIdx = overlayCode.indexOf('export function unmount', mountIdx);
  const mountSnippet = overlayCode.slice(mountIdx, mountEndIdx);
  assert.ok(
    /backdrop\.addEventListener\(['"]click['"].*dispatch\(host,\s*['"]as:close['"]\)/.test(mountSnippet) ||
    /backdrop.*click.*as:close/s.test(mountSnippet),
    'backdrop click should dispatch as:close event'
  );
});

test('Overlay: backdrop has CSS for full-screen fixed positioning', () => {
  const cssIdx = overlayCode.indexOf('function css()');
  assert.ok(cssIdx >= 0, 'css() function should exist');

  const cssEndIdx = overlayCode.indexOf('function el<K', cssIdx);
  const cssSnippet = overlayCode.slice(cssIdx, cssEndIdx > 0 ? cssEndIdx : cssIdx + 3000);

  assert.ok(
    /\.backdrop\s*\{[^}]*position:\s*fixed/s.test(cssSnippet),
    'backdrop should have position: fixed'
  );
  assert.ok(
    /\.backdrop\s*\{[^}]*inset:\s*0/s.test(cssSnippet),
    'backdrop should have inset: 0'
  );
});

test('Overlay: backdrop respects busy state via data-busy attribute', () => {
  const cssIdx = overlayCode.indexOf('function css()');
  assert.ok(cssIdx >= 0);

  const cssEndIdx = overlayCode.indexOf('function el<K', cssIdx);
  const cssSnippet = overlayCode.slice(cssIdx, cssEndIdx > 0 ? cssEndIdx : cssIdx + 3000);

  assert.ok(
    /\.backdrop\[data-busy=['"]?true['"]?\]\s*\{[^}]*pointer-events:\s*none/s.test(cssSnippet),
    'backdrop with data-busy="true" should have pointer-events: none'
  );
});

test('Overlay: render() updates backdrop data-busy attribute', () => {
  const renderIdx = overlayCode.indexOf('export function render(');
  assert.ok(renderIdx >= 0, 'render() function should exist');

  const renderSnippet = overlayCode.slice(renderIdx, renderIdx + 500);
  assert.ok(
    /inst\.backdrop\.dataset/.test(renderSnippet) ||
    /backdrop.*data-busy|backdrop.*busy/.test(renderSnippet),
    'render() should update backdrop busy state'
  );
});

test('Overlay: Instance type includes backdrop', () => {
  const instanceIdx = overlayCode.indexOf('export type Instance');
  assert.ok(instanceIdx >= 0, 'Instance type should exist');

  const instanceSnippet = overlayCode.slice(instanceIdx, instanceIdx + 600);
  assert.ok(
    /backdrop:\s*HTMLDivElement/.test(instanceSnippet),
    'Instance type should include backdrop: HTMLDivElement'
  );
});

test('Overlay: close button still dispatches as:close (regression)', () => {
  const mountIdx = overlayCode.indexOf('export function mount');
  assert.ok(mountIdx >= 0);

  const mountSnippet = overlayCode.slice(mountIdx, mountIdx + 1500);
  assert.ok(
    /closeButton\.addEventListener\(['"]click['"].*dispatch\(host,\s*['"]as:close['"]\)/.test(mountSnippet) ||
    /closeButton.*click.*as:close/s.test(mountSnippet),
    'close button should still dispatch as:close event'
  );
});
