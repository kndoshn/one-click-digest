import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BAD_PATTERNS = [/api\.anthropic\.com/i, /authorization\s*:/i, /x-api-key/i, /anthropic/i];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('src/content must not contain Claude API calls or auth headers', () => {
  const dir = path.join(process.cwd(), 'src', 'content');
  assert.ok(fs.existsSync(dir), 'src/content must exist');
  const files = walk(dir).filter((p) => p.endsWith('.ts') || p.endsWith('.js'));
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf-8');
    for (const re of BAD_PATTERNS) {
      assert.ok(!re.test(text), `Found forbidden pattern ${re} in ${f}`);
    }
  }
});

// Content scripts can import shared modules, so also check what actually ships: the bundle.
test('the content script bundle must not contain Claude API calls or auth headers', () => {
  const p = path.join(process.cwd(), 'dist', 'content', 'main.js');
  assert.ok(fs.existsSync(p), 'dist/content/main.js must exist (run build first)');
  const text = fs.readFileSync(p, 'utf-8');
  for (const re of BAD_PATTERNS) {
    assert.ok(!re.test(text), `Found forbidden pattern ${re} in dist/content/main.js`);
  }
});
