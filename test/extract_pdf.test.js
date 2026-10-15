// PDF extraction (src/content/extract_pdf.ts): on a PDF tab, extractArticle() fetches the PDF from
// the tab's URL and reads it with the PDF reader that content/pdf.js installs (stubbed here).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runContentBundle } from './helpers/classic_context.js';

const PDF_URL = 'https://example.com/files/report.pdf';
const READER_GLOBAL = '__oneClickDigestPdfReader';
const BYTES = [37, 80, 68, 70];

// Text long enough to pass minArticleChars (200) below.
const longText = (n = 8) => Array.from({ length: n }, (_, i) => `Sentence ${i + 1} of the report body.`).join(' ');

/**
 * @param {{ read?: (data: Uint8Array, opts: any) => any, reader?: boolean, fetch?: any, url?: string,
 *   contentType?: string, readability?: any }} [opts]
 */
function load({ read, reader = true, fetch, url = PDF_URL, contentType = 'application/pdf', readability } = {}) {
  const calls = { fetch: [], read: [] };
  const document = { contentType, title: '', querySelector: () => null };
  const ctx = createClassicContext({
    document,
    location: { href: url },
    URL,
    fetch:
      fetch ||
      (async (input) => {
        calls.fetch.push(input);
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(BYTES).buffer };
      }),
    ...(readability ? { Readability: readability } : {})
  });
  if (reader) {
    ctx[READER_GLOBAL] = {
      readPdf: async (data, opts) => {
        calls.read.push({ data: [...data], opts });
        return read
          ? read(data, opts)
          : { title: 'Report title', pageCount: 2, pagesRead: 2, text: `${longText()}\n\n${longText()}` };
      }
    };
  }
  runContentBundle(ctx);
  ctx.AS.applyRuntimeSettings({ minArticleChars: 200, maxArticleCharsToSend: 5000 });
  return { AS: ctx.AS, calls };
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const pdfText =
  (text, { title = '', pagesRead = 1 } = {}) =>
  () => ({ title, pageCount: pagesRead, pagesRead, text });

test('a PDF tab: fetches the PDF from the tab URL and reads it with the PDF reader', async () => {
  const { AS, calls } = load();
  const r = plain(await AS.Extract.extractArticle());
  const text = `${longText()}\n\n${longText()}`;
  assert.deepEqual(r, { ok: true, title: 'Report title', url: PDF_URL, text, charCount: text.length, linkDensity: 0 });
  assert.deepEqual(calls.fetch, [PDF_URL]);
  // The reader gets the downloaded bytes and stops reading once it has more than can be sent.
  assert.deepEqual(plain(calls.read), [{ data: BYTES, opts: { maxChars: 5000 } }]);
});

test('a PDF tab does not use Readability', async () => {
  let constructed = 0;
  const readability = class {
    constructor() {
      constructed++;
    }
    parse() {
      return { title: 'x', textContent: longText(), content: '' };
    }
  };
  const { AS } = load({ readability });
  assert.equal((await AS.Extract.extractArticle()).ok, true);
  assert.equal(constructed, 0);
});

test('PDF text: compatibility radicals become the usual characters and whitespace is normalized', async () => {
  // PDFs made on macOS often map common kanji to Kangxi radicals (U+2F00-U+2FDF), e.g. ⼤ for 大.
  const raw = `  京都⼤学 ⼈気 ⼼⾝ ⾼⽊ １２３ ＡＢＣ\r\n\t${longText()}   end\n\n\n\nNext page  `;
  const { AS } = load({ read: pdfText(raw) });
  const r = await AS.Extract.extractArticle();
  assert.equal(r.text, `京都大学 人気 心身 高木 １２３ ＡＢＣ\n ${longText()} end\n\nNext page`);
  assert.equal(r.charCount, r.text.length);
});

test('normalizePdfText: only radicals change; full-width digits and letters are kept', () => {
  const { AS } = load();
  assert.equal(AS.ExtractPdf.normalizePdfText('⼀⼈⼼⾝⿓'), '一人心身龍');
  assert.equal(AS.ExtractPdf.normalizePdfText('１２３ＡＢＣ ｶﾀｶﾅ ①'), '１２３ＡＢＣ ｶﾀｶﾅ ①');
});

test('PDF title: the title in the PDF, else the file name from the URL, else the page title', async () => {
  const title = async (pdfTitle, url) => {
    const { AS } = load({ read: pdfText(longText(), { title: pdfTitle }), url });
    return (await AS.Extract.extractArticle()).title;
  };
  assert.equal(await title('  Annual report ', PDF_URL), 'Annual report');
  assert.equal(await title('', PDF_URL), 'report.pdf');
  assert.equal(await title('   ', 'https://example.com/a/%E5%A0%B1%E5%91%8A.pdf?download=1#page=2'), '報告.pdf');
  // A malformed escape keeps the name as written.
  assert.equal(await title('', 'https://example.com/a/100%.pdf'), '100%.pdf');
  // No file name in the URL: the page title, which a PDF tab does not have.
  assert.equal(await title('', 'https://example.com/download/'), '(untitled)');
});

test('PDF titleFromPdfUrl: the last path segment, decoded', () => {
  const { AS } = load();
  assert.equal(AS.ExtractPdf.titleFromPdfUrl('https://example.com/x/y/z.pdf'), 'z.pdf');
  assert.equal(AS.ExtractPdf.titleFromPdfUrl('https://example.com/'), '');
  assert.equal(AS.ExtractPdf.titleFromPdfUrl('not a url'), '');
});

test('little or no text per page: reported as a PDF without text (e.g. scanned pages)', async () => {
  // Under minArticleChars (200) and under 100 characters per page read.
  for (const { text, pagesRead } of [
    { text: '', pagesRead: 1 },
    { text: '   \n\n ', pagesRead: 3 },
    { text: 'x'.repeat(99), pagesRead: 1 },
    { text: 'x'.repeat(199), pagesRead: 2 }
  ]) {
    const { AS } = load({ read: pdfText(text, { pagesRead }) });
    const r = await AS.Extract.extractArticle();
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PDF_NO_TEXT', `${text.length} chars on ${pagesRead} pages`);
  }
});

test('a short PDF with real text: reported as too short', async () => {
  // 100 characters per page or more, but under minArticleChars (200).
  for (const { text, pagesRead } of [
    { text: 'x'.repeat(100), pagesRead: 1 },
    { text: 'x'.repeat(199), pagesRead: 1 }
  ]) {
    const { AS } = load({ read: pdfText(text, { pagesRead }) });
    const r = plain(await AS.Extract.extractArticle());
    assert.equal(r.code, 'TOO_SHORT', `${text.length} chars on ${pagesRead} pages`);
    assert.equal(r.charCount, text.length);
  }
  // At minArticleChars the PDF is summarized.
  const { AS } = load({ read: pdfText('x'.repeat(200), { pagesRead: 5 }) });
  assert.equal((await AS.Extract.extractArticle()).ok, true);
});

test('PDF failures: no reader, a failed download, an unreadable PDF', async () => {
  const failures = [
    load({ reader: false }),
    load({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      }
    }),
    load({ fetch: async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) }) }),
    load({
      read: () => {
        throw new Error('Invalid PDF structure.');
      }
    })
  ];
  for (const { AS, calls } of failures) {
    const r = await AS.Extract.extractArticle();
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PDF_FAILED');
    assert.equal(typeof r.message, 'string');
    // An error page is never handed to the reader.
    if (calls.read.length > 0) assert.equal(calls.fetch.length, 1);
  }
  assert.equal(failures[2].calls.read.length, 0);
});
