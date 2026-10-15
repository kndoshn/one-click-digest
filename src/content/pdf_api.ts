// What content/pdf.js (the PDF reader, built from pdf_main.ts) provides to content/main.js.
//
// The background injects content/pdf.js before content/main.js only into PDF tabs, so pdf.js stays
// out of the bundle injected into every page. The two scripts share the content script's global
// object, and the reader is installed on it under this name. main.js only imports types and this
// constant from here, never the reader itself.

export const PDF_READER_GLOBAL = '__oneClickDigestPdfReader';

export type PdfText = {
  // The title in the PDF's metadata, or '' when it has none.
  title: string;
  pageCount: number;
  // Pages read before the text grew longer than maxChars.
  pagesRead: number;
  // Each page's lines, with a blank line between pages.
  text: string;
};

export type PdfReader = {
  readPdf(data: Uint8Array, opts: { maxChars: number }): Promise<PdfText>;
};
