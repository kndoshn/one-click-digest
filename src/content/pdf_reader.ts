// Reads the text of a PDF with pdf.js. Bundled into content/pdf.js (see pdf_main.ts), not into
// content/main.js.
//
// Uses the legacy build: the modern one needs newer browsers (e.g. Uint8Array.prototype.toHex,
// Chrome 140+) and does not load in Node.js, where the tests run it.

import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import type { PdfText } from './pdf_api.ts';

// pdf.js normally parses in a Worker, but a content script cannot start one from the extension's
// files. When this global is set, pdf.js runs its worker code on the calling thread instead.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

// pdf.js text content items: text items have `str` and `hasEOL`; marked content items have
// neither. Only those two fields are used here.
type TextContentItem = { str?: unknown; hasEOL?: unknown; [field: string]: unknown };

type PdfDocument = Awaited<ReturnType<typeof getDocument>['promise']>;

export function pageText(items: readonly TextContentItem[]): string {
  let out = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    out += item.str;
    if (item.hasEOL === true) out += '\n';
  }
  return out.replace(/\n+$/, '');
}

async function readTitle(doc: PdfDocument): Promise<string> {
  try {
    const { info } = await doc.getMetadata();
    const title = (info as { Title?: unknown }).Title;
    return typeof title === 'string' ? title : '';
  } catch {
    return '';
  }
}

export async function readPdf(data: Uint8Array, opts: { maxChars: number }): Promise<PdfText> {
  const task = getDocument({
    data,
    // Keep pdf.js warnings about fonts and such out of the page's console.
    verbosity: VerbosityLevel.ERRORS
  });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    let length = 0;
    let pagesRead = 0;
    // Stop once the text is longer than can be sent: a long PDF is cut there anyway.
    while (pagesRead < doc.numPages && length <= opts.maxChars) {
      const page = await doc.getPage(++pagesRead);
      const text = pageText((await page.getTextContent()).items as TextContentItem[]);
      page.cleanup();
      if (text.trim().length === 0) continue;
      length += (pages.length > 0 ? 2 : 0) + text.length;
      pages.push(text);
    }
    return { title: await readTitle(doc), pageCount: doc.numPages, pagesRead, text: pages.join('\n\n') };
  } finally {
    await task.destroy();
  }
}
