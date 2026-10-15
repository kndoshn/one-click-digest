// Builds small PDFs for tests: each page draws its lines in Helvetica, one text line per entry.
// A page without lines has no text, like a scanned page. Text must be ASCII.

/**
 * @param {{ pages: string[][], title?: string }} spec
 * @returns {Uint8Array}
 */
export function makePdf({ pages, title }) {
  const objects = [];
  const add = (body) => objects.push(body);
  const escape = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);

  add(''); // 1: catalog, filled in below
  add(''); // 2: page tree, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 3: font
  const kids = [];
  for (const lines of pages) {
    const ops = lines.map((line, i) => `${i > 0 ? 'T* ' : ''}(${escape(line)}) Tj`);
    const content = ['BT', '/F1 12 Tf', '14 TL', '72 750 Td', ...ops, 'ET'].join('\n');
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> ` +
          `/Contents ${stream} 0 R >>`
      )
    );
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = title === undefined ? undefined : add(`<< /Title (${escape(title)}) >>`);

  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${info ? ` /Info ${info} 0 R` : ''} >>\n`;
  out += `startxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
