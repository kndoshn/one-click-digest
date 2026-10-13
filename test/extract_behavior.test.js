// Article extraction (src/content/extract.ts): the Readability path (with a stubbed Readability)
// and the heuristic fallback, run against HTML fixtures in a fake DOM.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runContentBundle } from './helpers/classic_context.js';
import { FakeDocument, loadHtml } from './helpers/fake_dom.js';

const sentence = (n, word = 'Body') => `${word} sentence number ${n} with enough words to count.`;
const paragraphs = (count, word) =>
  Array.from({ length: count }, (_, i) => `<p>${sentence(i + 1, word)}</p>`).join('\n');

function load({ html = '', title = 'Page title', readability, minArticleChars = 200 } = {}) {
  const doc = loadHtml(new FakeDocument(), html);
  doc.title = title;
  doc.cloneNode = (deep) => ({ clonedFrom: doc, deep });
  const ctx = createClassicContext({
    document: doc,
    location: { href: 'https://example.com/post' },
    DOMParser: class {
      parseFromString(markup) {
        return loadHtml(new FakeDocument(), markup);
      }
    },
    ...(readability ? { Readability: readability } : {})
  });
  runContentBundle(ctx);
  ctx.AS.applyRuntimeSettings({ minArticleChars });
  return { AS: ctx.AS, doc };
}

function readabilityReturning(parsed, calls = []) {
  return class {
    constructor(doc, opts) {
      calls.push({ doc, opts });
    }
    parse() {
      if (parsed instanceof Error) throw parsed;
      return parsed;
    }
  };
}

const plain = (v) => JSON.parse(JSON.stringify(v));

test('Readability path: normalized text, title, URL and link density from the parsed content', () => {
  const calls = [];
  const text = `  ${sentence(1)}\r\n\r\n\r\n\r\n${sentence(2)}   \t ${sentence(3)} `.repeat(4);
  const { AS, doc } = load({
    readability: readabilityReturning(
      { title: '  Readable title ', textContent: text, content: '<p>text <a>link</a></p>' },
      calls
    )
  });

  const r = plain(AS.Extract.extractArticle());
  assert.equal(r.ok, true);
  assert.equal(r.title, 'Readable title');
  assert.equal(r.url, 'https://example.com/post');
  assert.ok(!/\r|\t| {2}|\n{3}/.test(r.text), 'whitespace is normalized');
  assert.ok(r.text.startsWith(sentence(1)));
  assert.equal(r.charCount, r.text.length);
  assert.equal(r.linkDensity, 4 / 9);
  // Readability mutates its input, so it gets a deep clone, and our minimum length.
  assert.equal(calls[0].doc.clonedFrom, doc);
  assert.equal(calls[0].doc.deep, true);
  assert.equal(calls[0].opts.charThreshold, 200);
});

test('Readability path: a blank title falls back to the page title', () => {
  const { AS } = load({
    title: 'Fallback title',
    readability: readabilityReturning({ title: ' ', textContent: sentence(1).repeat(10), content: 42 })
  });
  const r = AS.Extract.extractArticle();
  assert.equal(r.title, 'Fallback title');
  assert.equal(r.linkDensity, 0);
});

test('Readability path: too short or link-heavy results are rejected without the fallback', () => {
  const short = load({
    readability: readabilityReturning({ textContent: 'Too short.', content: '' }),
    html: paragraphs(20)
  });
  assert.deepEqual(plain(short.AS.Extract.extractArticle()), {
    ok: false,
    code: 'TOO_SHORT',
    message: 'The extracted text is too short to summarize reliably.',
    charCount: 10,
    linkDensity: 0
  });

  const linky = `<p>${'<a>link text here</a> '.repeat(30)} tail</p>`;
  const heavy = load({ readability: readabilityReturning({ textContent: sentence(1).repeat(10), content: linky }) });
  const r = heavy.AS.Extract.extractArticle();
  assert.equal(r.code, 'LINK_HEAVY');
  assert.ok(r.linkDensity > 0.65);

  // Link-heavy but very long text is still treated as an article.
  const long = load({ readability: readabilityReturning({ textContent: sentence(1).repeat(250), content: linky }) });
  assert.equal(long.AS.Extract.extractArticle().ok, true);
});

test('the heuristic fallback runs when Readability is missing, returns nothing, or throws', () => {
  const html = `<article>${paragraphs(10)}</article>`;
  for (const readability of [
    undefined,
    readabilityReturning(null),
    readabilityReturning({ textContent: '' }),
    readabilityReturning(new Error('x'))
  ]) {
    const { AS } = load({ html, readability });
    const r = AS.Extract.extractArticle();
    assert.equal(r.ok, true);
    assert.equal(r.title, 'Page title');
    assert.equal(r.text.split('\n').length, 10);
  }
});

test('fallback: picks the article over navigation and skips nav/footer/header blocks and short fragments', () => {
  const html = `
    <nav><ul>${'<li><a>Navigation link number one</a></li>'.repeat(10)}</ul></nav>
    <div id="content">
      <article>
        <h1>A headline that is long enough</h1>
        <p class="breadcrumb">Home / Section / Article breadcrumb trail</p>
        ${paragraphs(8)}
        <p>Too short.</p>
        <li class="site-footer">Footer block that should be skipped entirely</li>
        <p>Read the <a>linked source document</a> for more on this topic.</p>
      </article>
    </div>`;
  const { AS } = load({ html });
  const r = AS.Extract.extractArticle();
  assert.equal(r.ok, true);
  const lines = r.text.split('\n');
  assert.equal(lines[0], 'A headline that is long enough');
  assert.equal(lines.length, 1 + 8 + 1);
  assert.ok(!r.text.includes('Navigation'));
  assert.ok(!r.text.includes('breadcrumb'));
  assert.ok(!r.text.includes('Footer'));
  assert.ok(!r.text.includes('Too short.'));
  assert.ok(r.linkDensity > 0 && r.linkDensity < 0.1);
});

test('fallback: an <article> outscores a slightly longer container, and link-heavy page chrome penalizes <body>', () => {
  // <body> is always a candidate; the many short navigation links (counted for link density but
  // too short to count as text) push its score below the article's.
  const html = `
    <ul>${Array.from({ length: 60 }, (_, i) => `<li><a>Section ${i}</a></li>`).join('')}</ul>
    <div class="post">${paragraphs(10, 'Post')}</div>
    <article>${paragraphs(9, 'Art')}</article>`;
  const { AS } = load({ html });
  const r = AS.Extract.extractArticle();
  assert.ok(r.text.startsWith(sentence(1, 'Art')), r.text.slice(0, 40));
});

test('fallback: link-heavy, too short, and empty pages are rejected', () => {
  const linkHeavy = load({ html: `<main>${'<p><a>A link that is long enough to count</a> x</p>'.repeat(20)}</main>` });
  assert.equal(linkHeavy.AS.Extract.extractArticle().code, 'LINK_HEAVY');

  const short = load({ html: `<main>${paragraphs(2)}</main>`, minArticleChars: 600 });
  const r = short.AS.Extract.extractArticle();
  assert.equal(r.code, 'TOO_SHORT');
  assert.ok(r.charCount > 0 && r.charCount < 600);

  const empty = load({ html: '<div><span>tiny</span></div>' });
  assert.deepEqual(plain(empty.AS.Extract.extractArticle()), {
    ok: false,
    code: 'NO_MAIN_TEXT',
    message: 'No text blocks were found.'
  });
});

test('unexpected DOM errors are reported as UNKNOWN', () => {
  const { AS, doc } = load({ html: paragraphs(10) });
  Object.defineProperty(doc, 'body', {
    get() {
      throw new Error('DOM exploded');
    }
  });
  assert.deepEqual(plain(AS.Extract.extractArticle()), { ok: false, code: 'UNKNOWN', message: 'DOM exploded' });
});
