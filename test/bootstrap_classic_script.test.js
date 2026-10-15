import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// chrome.scripting.executeScript runs files as classic scripts, so each content bundle must be
// self-contained (an IIFE). The bundler normally guarantees this; the check guards the build config.
test('dist/content/*.js must be classic-script friendly (no import/export)', () => {
  const dir = path.join(process.cwd(), 'dist', 'content');
  assert.ok(fs.existsSync(dir), 'dist/content must exist (run build first)');

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f));

  assert.deepEqual(files.map((p) => path.basename(p)).sort(), ['main.js', 'pdf.js']);

  for (const p of files) {
    const text = fs.readFileSync(p, 'utf-8');
    // Compiling as a classic script fails on static import/export statements. (Words like
    // "import" can still appear in strings, and pdf.js keeps a dynamic import() it never uses here.)
    assert.doesNotThrow(() => new vm.Script(text, { filename: p }), `${path.basename(p)} must be a classic script`);
  }
});
