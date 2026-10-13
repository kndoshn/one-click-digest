// Chunker invariants: no text is lost or reordered, chunks stay near the token target, and huge
// paragraphs (including CJK text without spaces) are split.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runContentBundle } from './helpers/classic_context.js';

const ctx = createClassicContext();
runContentBundle(ctx);
const { Chunker, Estimate } = ctx.AS;

const squash = (s) => s.replace(/\s+/g, '');

// Deterministic pseudo-random generator (LCG) so failures are reproducible.
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

function randomArticle(seed) {
  const rand = rng(seed);
  const words = ['alpha', 'beta', 'gamma', 'delta', '要約', 'テスト', '文章', 'epsilon', 'zeta'];
  const paras = [];
  const paraCount = 1 + Math.floor(rand() * 40);
  for (let p = 0; p < paraCount; p++) {
    const len = Math.floor(rand() * (rand() < 0.1 ? 6000 : 300));
    const parts = [];
    for (let i = 0; i < len; i++) {
      parts.push(words[Math.floor(rand() * words.length)]);
      if (rand() < 0.08) parts.push(rand() < 0.5 ? '.' : '。');
    }
    paras.push(parts.join(rand() < 0.3 ? '' : ' '));
  }
  return paras.join(rand() < 0.5 ? '\n\n' : '\r\n\r\n\n');
}

test('Chunker: no text is lost or reordered, and chunks stay near the target', () => {
  const target = 1500;
  for (let seed = 1; seed <= 60; seed++) {
    const text = randomArticle(seed);
    const chunks = Chunker.chunkText(text, target);
    assert.equal(chunks.map(squash).join(''), squash(text), `seed ${seed}: content changed`);
    for (const chunk of chunks) {
      assert.equal(chunk, chunk.trim(), `seed ${seed}: chunk is not trimmed`);
      assert.ok(chunk.length > 0, `seed ${seed}: empty chunk`);
      // Paragraph packing stays within the target; split paragraphs can overshoot a little
      // because each piece is cut on a nearby boundary.
      assert.ok(Estimate.estimateTokens(chunk).high <= target * 1.25, `seed ${seed}: chunk too large`);
    }
  }
});

test('Chunker: a long CJK paragraph without spaces is split at sentence ends', () => {
  const sentence = '本文の要点をまとめるための長い文章です。';
  const text = sentence.repeat(2000);
  const chunks = Chunker.chunkText(text, 1000);
  assert.ok(chunks.length > 1);
  // Split pieces that are packed into one chunk are joined with a blank line.
  assert.equal(squash(chunks.join('')), text);
  for (const chunk of chunks.slice(0, -1)) {
    assert.ok(chunk.endsWith('。'), `chunk should end at a sentence boundary: …${chunk.slice(-10)}`);
  }
});

test('Chunker: paragraphs that fit together share a chunk', () => {
  const text = ['one two three', 'four five six', 'seven eight nine'].join('\n\n');
  assert.deepEqual([...Chunker.chunkText(text, 8000)], [text]);
  // A tiny target puts each paragraph in its own chunk.
  assert.deepEqual([...Chunker.chunkText(text, 3)], ['one two three', 'four five six', 'seven eight nine']);
});
