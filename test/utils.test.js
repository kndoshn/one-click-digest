import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumberOr } from '../dist/shared/utils.js';

test('parseNumberOr: returns number when given valid number', () => {
  assert.equal(parseNumberOr(42, 0), 42);
  assert.equal(parseNumberOr(3.14, 0), 3.14);
  assert.equal(parseNumberOr(-10, 0), -10);
  assert.equal(parseNumberOr(0, 99), 0);
});

test('parseNumberOr: returns number when given valid numeric string', () => {
  assert.equal(parseNumberOr('42', 0), 42);
  assert.equal(parseNumberOr('3.14', 0), 3.14);
  assert.equal(parseNumberOr('-10', 0), -10);
  assert.equal(parseNumberOr('0', 99), 0);
});

test('parseNumberOr: returns fallback for invalid inputs', () => {
  assert.equal(parseNumberOr(null, 99), 99);
  assert.equal(parseNumberOr(undefined, 99), 99);
  // Note: Number('') returns 0, which is finite, so returns 0 not fallback
  assert.equal(parseNumberOr('', 99), 0);
  assert.equal(parseNumberOr('abc', 99), 99);
  assert.equal(parseNumberOr({}, 99), 99);
  // Note: [] is not a string or number, so returns fallback
  assert.equal(parseNumberOr([], 99), 99);
  assert.equal(parseNumberOr(NaN, 99), 99);
  assert.equal(parseNumberOr(Infinity, 99), 99);
  assert.equal(parseNumberOr(-Infinity, 99), 99);
});

test('parseNumberOr: handles edge cases', () => {
  // Note: Number('  42  ') trims whitespace and returns 42
  assert.equal(parseNumberOr('  42  ', 0), 42);
  assert.equal(parseNumberOr('1e10', 0), 1e10); // scientific notation
  assert.equal(parseNumberOr('0x10', 0), 16); // hex
});
