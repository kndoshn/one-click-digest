import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Extractor: includes Readability path and a fallback selector set (regression guard)', () => {
  const p = path.join(process.cwd(), 'src', 'content', 'extract.ts');
  const text = fs.readFileSync(p, 'utf-8');

  // Readability integration
  assert.ok(/Readability/.test(text), 'Readability should be referenced in extract.ts');
  assert.ok(/document\.cloneNode\(true\)/.test(text), 'Readability should run on a cloned document');

  // Fallback selectors (heuristic extraction)
  assert.ok(text.includes("'article'"), "fallback selectors should include 'article'");
  assert.ok(text.includes("'main'"), "fallback selectors should include 'main'");
  assert.ok(text.includes('[role="main"]'), "fallback selectors should include [role=\"main\"]");
});
