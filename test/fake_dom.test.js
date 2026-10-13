// The fake DOM's selector and HTML parsing (test/helpers/fake_dom.js), including inputs that would
// make a backtracking regular expression take exponential time.

import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeDocument, loadHtml } from './helpers/fake_dom.js';

// Each extra repetition doubles the work of an exponential regex. At 25 the vulnerable versions
// took about 0.9 s (selector) and 1.8 s (HTML); the fixed ones take well under a millisecond.
const REPEAT = 25;
const LIMIT_MS = 500;

function timed(fn) {
  const start = performance.now();
  const result = fn();
  return { result, ms: performance.now() - start };
}

test('querySelectorAll matches tag, id, class and attribute selectors', () => {
  const doc = new FakeDocument();
  loadHtml(doc, '<div id="a" class="x y" data-k="v"><span data-k=\'w\'>t</span><p data-flag>u</p></div>');

  assert.equal(doc.querySelectorAll('div#a.x.y').length, 1);
  assert.equal(doc.querySelectorAll('[data-k="v"]').length, 1);
  assert.equal(doc.querySelectorAll("[data-k='w']").length, 1);
  assert.equal(doc.querySelectorAll('[data-k=v]').length, 1);
  assert.equal(doc.querySelectorAll('[data-flag]').length, 1);
  assert.equal(doc.querySelectorAll('*').length, 6); // html, head, body, div, span, p
});

test('an unsupported selector fails fast instead of backtracking', () => {
  const doc = new FakeDocument();
  const selector = '[-=' + '""][-='.repeat(REPEAT) + '!';

  const { ms } = timed(() => assert.throws(() => doc.querySelectorAll(selector), /unsupported selector/));
  assert.ok(ms < LIMIT_MS, `took ${Math.round(ms)} ms`);
});

test('loadHtml parses quoted, unquoted and bare attributes', () => {
  const doc = new FakeDocument();
  loadHtml(doc, '<input id=q type="text" value=\'a b\' disabled>');

  const input = doc.querySelector('#q');
  assert.equal(input.getAttribute('type'), 'text');
  assert.equal(input.getAttribute('value'), 'a b');
  assert.ok(input.hasAttribute('disabled'));
});

test('loadHtml does not backtrack on a long run of malformed attributes', () => {
  const doc = new FakeDocument();
  const html = '<a\t!=' + '""\t!='.repeat(REPEAT) + '<';

  const { ms } = timed(() => loadHtml(doc, html));
  assert.ok(ms < LIMIT_MS, `took ${Math.round(ms)} ms`);
});
