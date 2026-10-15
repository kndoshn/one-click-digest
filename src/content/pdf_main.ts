// Entry point of content/pdf.js, the PDF reader. The background injects it into PDF tabs before
// content/main.js, which reads the PDF through the global installed here (see pdf_api.ts).

import { PDF_READER_GLOBAL, type PdfReader } from './pdf_api.ts';
import { readPdf } from './pdf_reader.ts';

const reader: PdfReader = { readPdf };
(globalThis as Record<string, unknown>)[PDF_READER_GLOBAL] = reader;
