import { apiError, clickToolbarButton, expect, ORIGIN, overlay, test, validSummaryReply } from './extension.ts';

test('summarizes an article and copies the summary', async ({ page, serviceWorker, api }) => {
  await page.goto(`${ORIGIN}/article.html`);
  await clickToolbarButton(serviceWorker, page);

  const panel = overlay(page);
  await panel.getByRole('button', { name: /^5 bullets/ }).click();
  await expect(panel.getByText('- Summary point 5.')).toBeVisible();

  // One summary request with the extracted article: the body text, not the navigation or footer.
  const summaries = api.calls.filter((c) => c.path === '/v1/messages');
  expect(summaries).toHaveLength(1);
  const prompt = JSON.stringify(summaries[0].body.messages);
  expect(prompt).toContain('protected bike lanes on four downtown streets');
  expect(prompt).not.toContain('Subscribe to our newsletter');

  await panel.getByRole('button', { name: 'Copy' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('- Summary point 1.');
});

// About 60,000 characters: more than one chunk, so the run maps each chunk and then reduces.
function longArticle(): string {
  const paragraphs = Array.from({ length: 80 }, (_, i) => {
    const sentences = Array.from(
      { length: 8 },
      (_, j) => `Section ${i + 1} sentence ${j + 1} describes another detail of the regional water plan in plain words.`
    );
    return `<p>${sentences.join(' ')}</p>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Regional water plan</title></head>
<body><main><article><h1>Regional water plan</h1>${paragraphs.join('\n')}</article></main></body></html>`;
}

test('a long article is summarized in chunks, then reduced', async ({ page, serviceWorker, api, pages }) => {
  pages.set('/long.html', longArticle());
  await page.goto(`${ORIGIN}/long.html`);
  await clickToolbarButton(serviceWorker, page);

  const panel = overlay(page);
  await panel.getByRole('button', { name: /^3 bullets/ }).click();
  await expect(panel.getByText('- Summary point 3.')).toBeVisible();

  const messages = api.calls.filter((c) => c.path === '/v1/messages');
  const maps = messages.filter((c) => c.body.system);
  expect(maps.length).toBeGreaterThan(1);
  // Map chunks run on the map model; the reduce pass gets every chunk summary on the final model.
  expect(new Set(maps.map((c) => c.body.model))).toEqual(new Set(['claude-haiku-5-5']));
  const reduce = messages.at(-1)!;
  expect(reduce.body.system).toBeUndefined();
  expect(reduce.body.model).toBe('claude-sonnet-5-5');
  expect(messages).toHaveLength(maps.length + 1);
});

test('an API error is shown in the overlay', async ({ page, serviceWorker, api }) => {
  api.messages = () => apiError(401, 'authentication_error', 'invalid x-api-key');
  await page.goto(`${ORIGIN}/article.html`);
  await clickToolbarButton(serviceWorker, page);

  await overlay(page)
    .getByRole('button', { name: /^3 bullets/ })
    .click();
  await expect(overlay(page).getByText('Authentication failed. Check your API key in Settings.')).toBeVisible();
});

test('a page without an article is not sent to the API', async ({ page, serviceWorker, api }) => {
  await page.goto(`${ORIGIN}/not-an-article.html`);
  await clickToolbarButton(serviceWorker, page);

  await overlay(page)
    .getByRole('button', { name: /^3 bullets/ })
    .click();
  await expect(overlay(page).getByText(/too short to summarize|does not look like a normal article/)).toBeVisible();
  expect(api.calls.filter((c) => c.path === '/v1/messages')).toHaveLength(0);
});

test('closing the overlay during a run aborts the request', async ({ page, serviceWorker, api }) => {
  api.messages = (body) => ({ ...validSummaryReply(body), delayMs: 3000 });
  await page.goto(`${ORIGIN}/article.html`);
  await clickToolbarButton(serviceWorker, page);

  const panel = overlay(page);
  await panel.getByRole('button', { name: /^3 bullets/ }).click();
  await expect.poll(() => api.calls.some((c) => c.path === '/v1/messages')).toBe(true);

  page.once('dialog', (dialog) => dialog.accept());
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => api.aborted).toContain('/v1/messages');
});

test('clicking the toolbar button again replaces a running overlay', async ({ page, serviceWorker, api }) => {
  api.messages = (body) => ({ ...validSummaryReply(body), delayMs: 3000 });
  await page.goto(`${ORIGIN}/article.html`);
  await clickToolbarButton(serviceWorker, page);
  await overlay(page)
    .getByRole('button', { name: /^3 bullets/ })
    .click();
  await expect.poll(() => api.calls.some((c) => c.path === '/v1/messages')).toBe(true);

  await clickToolbarButton(serviceWorker, page);
  // A single, fresh overlay at the start screen; the previous run's request was aborted.
  await expect(overlay(page)).toHaveCount(1);
  await expect(overlay(page).getByRole('button', { name: /^3 bullets/ })).toBeVisible();
  await expect.poll(() => api.aborted).toContain('/v1/messages');
});
