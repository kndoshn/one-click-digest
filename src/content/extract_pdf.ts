// Extraction for PDF tabs. Chrome shows a PDF in its viewer, and the tab's own document holds only
// an <embed>, so the text comes from the PDF file instead: fetched again from the tab's URL (the
// same origin, so cookies and HTTP cache apply) and read with the PDF reader in content/pdf.js.

import { type ExtractResult, MAX_ARTICLE_CHARS_TO_SEND, MIN_ARTICLE_CHARS } from './models.ts';
import { PDF_READER_GLOBAL, type PdfReader, type PdfText } from './pdf_api.ts';
import { getPageTitle, getPageUrl, normalizeText } from './runtime.ts';

// Under this many characters per page read, a PDF that is too short to summarize is reported as
// having (almost) no text: typically scanned pages, which are images.
const MIN_CHARS_PER_PAGE = 100;

export function isPdfDocument(): boolean {
  return document.contentType === 'application/pdf';
}

// PDFs made on macOS often map common kanji to Kangxi radicals (U+2F00-U+2FDF, e.g. ⼤ for 大),
// which look the same but are other characters. NFKC maps them back; it is applied to the radical
// blocks only, so that full-width letters and digits and the like are kept as written.
export function normalizePdfText(text: string): string {
  return normalizeText(text.replace(/[⺀-⿟]/g, (c) => c.normalize('NFKC')));
}

// The file name in the URL, e.g. "report.pdf", or '' when the path has none.
export function titleFromPdfUrl(url: string): string {
  let name: string;
  try {
    name = new URL(url).pathname.split('/').pop() || '';
  } catch {
    return '';
  }
  try {
    return decodeURIComponent(name).trim();
  } catch {
    return name.trim();
  }
}

function pdfFailed(message: string): ExtractResult {
  return { ok: false, code: 'PDF_FAILED', message };
}

async function readTabPdf(reader: PdfReader, url: string): Promise<PdfText> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Downloading the PDF failed with HTTP ${res.status}.`);
  const data = new Uint8Array(await res.arrayBuffer());
  return reader.readPdf(data, { maxChars: MAX_ARTICLE_CHARS_TO_SEND });
}

export async function extractPdf(): Promise<ExtractResult> {
  const reader = (globalThis as Record<string, unknown>)[PDF_READER_GLOBAL] as PdfReader | undefined;
  if (!reader) return pdfFailed('The PDF reader is not loaded.');

  const url = getPageUrl();
  let pdf: PdfText;
  try {
    pdf = await readTabPdf(reader, url);
  } catch (err) {
    return pdfFailed(err instanceof Error && err.message ? err.message : 'Reading the PDF failed.');
  }

  const text = normalizePdfText(pdf.text);
  const charCount = text.length;
  if (charCount < MIN_ARTICLE_CHARS) {
    if (charCount < pdf.pagesRead * MIN_CHARS_PER_PAGE) {
      return { ok: false, code: 'PDF_NO_TEXT', message: 'The PDF has little or no text.', charCount };
    }
    return {
      ok: false,
      code: 'TOO_SHORT',
      message: 'The extracted text is too short to summarize reliably.',
      charCount
    };
  }

  const title = pdf.title.trim() || titleFromPdfUrl(url) || getPageTitle();
  return { ok: true, title, url, text, charCount, linkDensity: 0 };
}
