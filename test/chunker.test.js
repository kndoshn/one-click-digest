import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runContentBundle } from './helpers/classic_context.js';

function loadChunker() {
  const ctx = createClassicContext();
  runContentBundle(ctx);
  assert.ok(ctx.AS?.Chunker, 'AS.Chunker should exist');
  return ctx.AS;
}

test('Chunker: splits paragraphs into multiple chunks around target token size', () => {
  const AS = loadChunker();

  const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}: ` + 'word '.repeat(80));
  const text = paragraphs.join('\n\n');

  const chunks = AS.Chunker.chunkText(text, 120);
  assert.ok(Array.isArray(chunks));
  assert.ok(chunks.length > 1, 'expected multiple chunks');
  for (const c of chunks) {
    assert.ok(typeof c === 'string' && c.trim().length > 0, 'chunk must be non-empty');
  }
});

test('Chunker: returns a single chunk when input is short', () => {
  const AS = loadChunker();
  const text = 'short paragraph.\n\nsecond.';
  const chunks = AS.Chunker.chunkText(text, 2000);
  assert.equal(chunks.length, 1);
});
