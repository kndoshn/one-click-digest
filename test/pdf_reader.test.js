// PDF reader (src/content/pdf_reader.ts, bundled into dist/content/pdf.js): reads the text of
// PDFs built by test/helpers/make_pdf.js with the real pdf.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { pageText, readPdf } from '../src/content/pdf_reader.ts';
import { makePdf } from './helpers/make_pdf.js';

test('readPdf: text of every page in order, a line per text line and a blank line between pages', async () => {
  const pdf = makePdf({
    title: 'Annual report',
    pages: [['First page, line one.', 'First page, line two.'], ['Second page (with parentheses).']]
  });
  const r = await readPdf(pdf, { maxChars: 10_000 });
  assert.deepEqual(r, {
    title: 'Annual report',
    pageCount: 2,
    pagesRead: 2,
    text: 'First page, line one.\nFirst page, line two.\n\nSecond page (with parentheses).'
  });
});

test('readPdf: no title in the metadata gives an empty title', async () => {
  const r = await readPdf(makePdf({ pages: [['Some text.']] }), { maxChars: 10_000 });
  assert.equal(r.title, '');
});

test('readPdf: pages without text give empty text', async () => {
  const r = await readPdf(makePdf({ pages: [[], []] }), { maxChars: 10_000 });
  assert.equal(r.text, '');
  assert.equal(r.pageCount, 2);
  assert.equal(r.pagesRead, 2);
});

test('readPdf: stops reading pages once the text is longer than maxChars', async () => {
  const line = 'x'.repeat(40);
  // pdf.js takes over the data it reads, so each call gets a new copy.
  const pdf = () => makePdf({ pages: Array.from({ length: 5 }, () => [line]) });
  // After two pages the text is 40 + 2 + 40 = 82 characters, past the limit.
  const r = await readPdf(pdf(), { maxChars: 50 });
  assert.equal(r.pageCount, 5);
  assert.equal(r.pagesRead, 2);
  assert.equal(r.text, `${line}\n\n${line}`);

  // Exactly at the limit is not past it.
  const atLimit = await readPdf(pdf(), { maxChars: 82 });
  assert.equal(atLimit.pagesRead, 3);
});

test('readPdf: data that is not a PDF rejects', async () => {
  await assert.rejects(readPdf(new TextEncoder().encode('<html>not a pdf</html>'), { maxChars: 10_000 }));
});

test('pageText: joins text items, breaking lines where pdf.js marks the end of a line', () => {
  assert.equal(
    pageText([
      { str: 'Hello', hasEOL: false },
      { str: ' ', hasEOL: false },
      { str: 'world', hasEOL: true },
      // Marked content items have no text.
      { type: 'beginMarkedContent' },
      { str: 'Next line', hasEOL: false }
    ]),
    'Hello world\nNext line'
  );
  assert.equal(pageText([]), '');
  // A trailing end of line does not leave a newline at the end of the page.
  assert.equal(pageText([{ str: 'Only line', hasEOL: true }]), 'Only line');
});
