// The E2E build (`npm run build:e2e`) opens the overlay's shadow root, exposes an injection hook and
// allows a test origin. None of that may reach the production build in dist/.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'dist', rel), 'utf-8');

test('production build: no E2E hooks, closed overlay shadow root, no test origin', () => {
  assert.ok(!read('background/index.js').includes('__e2e'), 'background must not expose __e2e');
  const content = read('content/main.js');
  assert.match(content, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.ok(!content.includes('"open"'), 'content bundle must not open the shadow root');
  assert.ok(!read('manifest.json').includes('e2e.test'), 'manifest must not allow the E2E origin');
});
