// pdfjs-dist ships no types for its worker module. src/content/pdf_reader.ts only hands the module
// to pdf.js (as globalThis.pdfjsWorker), which looks up WorkerMessageHandler on it.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
