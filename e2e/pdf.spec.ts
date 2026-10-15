// PDFs open in Chrome's PDF viewer, whose page has no article in its DOM. The extension reads the
// PDF itself (content/pdf.js, pdf.js) and summarizes its text like an article.
import { makePdf } from '../test/helpers/make_pdf.js';
import { clickToolbarButton, expect, ORIGIN, overlay, test } from './extension.ts';

const lines = Array.from(
  { length: 30 },
  (_, i) => `Line ${i + 1} of the harbor report explains the new ferry schedule in plain words.`
);

test('summarizes a PDF from the text of its pages', async ({ page, serviceWorker, api, pages }) => {
  // No .pdf in the URL: the content type tells the extension it is a PDF.
  pages.set('/files/harbor-report', makePdf({ title: 'Harbor report', pages: [lines.slice(0, 15), lines.slice(15)] }));
  await page.goto(`${ORIGIN}/files/harbor-report`);
  await clickToolbarButton(serviceWorker, page);

  const panel = overlay(page);
  await panel.getByRole('button', { name: /^3 bullets/ }).click();
  await expect(panel.getByText('- Summary point 3.')).toBeVisible();

  const summaries = api.calls.filter((c) => c.path === '/v1/messages');
  expect(summaries).toHaveLength(1);
  const prompt = JSON.stringify(summaries[0].body.messages);
  expect(prompt).toContain('Title: Harbor report');
  // Both pages, in order.
  expect(prompt).toContain('Line 1 of the harbor report');
  expect(prompt).toContain('Line 30 of the harbor report');
  expect(prompt.indexOf('Line 15 of')).toBeLessThan(prompt.indexOf('Line 16 of'));

  await panel.getByRole('button', { name: 'Copy' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('- Summary point 1.');
});

test('a PDF without text (e.g. scanned pages) says so and is not sent to the API', async ({
  page,
  serviceWorker,
  api,
  pages
}) => {
  pages.set('/scan.pdf', makePdf({ pages: [[], []] }));
  await page.goto(`${ORIGIN}/scan.pdf`);
  await clickToolbarButton(serviceWorker, page);

  await overlay(page)
    .getByRole('button', { name: /^3 bullets/ })
    .click();
  await expect(overlay(page).getByText(/has little or no text/)).toBeVisible();
  expect(api.calls.filter((c) => c.path === '/v1/messages')).toHaveLength(0);
});
