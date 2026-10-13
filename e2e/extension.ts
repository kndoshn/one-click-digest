// Playwright fixtures for the extension: a Chromium with the E2E build loaded, fixture pages served
// from https://e2e.test, and the Claude API mocked with context.route() (which also intercepts the
// service worker's requests).

import fs from 'node:fs';
import path from 'node:path';
import { type BrowserContext, chromium, type Page, test as base, type Worker } from '@playwright/test';

const EXTENSION_DIR = path.resolve('build/e2e');
const PAGES_DIR = path.resolve('e2e/pages');
export const ORIGIN = 'https://e2e.test';
export const OVERLAY_ID = '__article_summarizer_overlay__';

export type ApiCall = { path: string; body: any };
export type ApiReply = { status?: number; json: unknown; delayMs?: number };

export type MockApi = {
  calls: ApiCall[];
  // Replies to POST /v1/messages; replace it to simulate errors or slow responses.
  messages: (body: any) => ApiReply;
  // Requests the extension aborted (e.g. after the overlay was closed).
  aborted: string[];
};

// A Messages API reply in the format the given request asks for: a few "- " lines for map chunks,
// otherwise the number of bullets the prompt requests, separated by blank lines.
export function validSummaryReply(body: any): ApiReply {
  const prompt = JSON.stringify(body.messages);
  const count = Number(/exactly (\d+) bullet points/.exec(prompt)?.[1] ?? 3);
  const text = body.system
    ? '- Chunk point one.\n- Chunk point two.'
    : Array.from({ length: count }, (_, i) => `- Summary point ${i + 1}.`).join('\n\n');
  return messageReply(text);
}

export function messageReply(text: string, stopReason = 'end_turn'): ApiReply {
  return {
    json: {
      id: 'msg_e2e',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      usage: { input_tokens: 1000, output_tokens: 100 }
    }
  };
}

export function apiError(status: number, type: string, message: string): ApiReply {
  return { status, json: { type: 'error', error: { type, message } } };
}

type Fixtures = {
  serviceWorker: Worker;
  api: MockApi;
  // Extra pages served from ORIGIN, by path (fixture files in e2e/pages are served too).
  pages: Map<string, string>;
};

export const test = base.extend<Fixtures & { context: BrowserContext }>({
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
      throw new Error('build/e2e is missing: run `npm run build:e2e` first');
    }
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      locale: 'en-US',
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },

  // Automatic, so every test serves the fixture pages and never reaches the real API.
  pages: [
    async ({ context }, use) => {
      const pages = new Map<string, string>();
      await context.route(`${ORIGIN}/**`, async (route) => {
        const { pathname } = new URL(route.request().url());
        const file = path.join(PAGES_DIR, path.basename(pathname));
        const html = pages.get(pathname) ?? (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined);
        if (html === undefined) return route.fulfill({ status: 404, body: 'not found' });
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      });
      await use(pages);
    },
    { auto: true }
  ],

  api: [
    async ({ context, serviceWorker }, use) => {
      const api: MockApi = { calls: [], messages: validSummaryReply, aborted: [] };
      context.on('requestfailed', (request) => {
        const url = new URL(request.url());
        if (url.origin === 'https://api.anthropic.com' && request.failure()?.errorText === 'net::ERR_ABORTED') {
          api.aborted.push(url.pathname);
        }
      });
      await context.route('https://api.anthropic.com/**', async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        const body = request.postDataJSON();
        api.calls.push({ path: pathname, body });
        const reply: ApiReply =
          pathname === '/v1/messages/count_tokens'
            ? { json: { input_tokens: Math.ceil(JSON.stringify(body.messages).length / 4) } }
            : api.messages(body);
        if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
        if (request.failure()) return; // aborted by the extension while waiting
        await route.fulfill({
          status: reply.status ?? 200,
          contentType: 'application/json',
          body: JSON.stringify(reply.json)
        });
      });
      // English UI regardless of the machine's language (the browser UI language decides otherwise).
      await serviceWorker.evaluate(() =>
        chrome.storage.local.set({ claudeApiKey: 'sk-ant-e2e-test', uiLanguage: 'en' })
      );
      await use(api);
    },
    { auto: true }
  ]
});

export const expect = test.expect;

// What clicking the toolbar button does: the background injects the content scripts into the tab.
export async function clickToolbarButton(serviceWorker: Worker, page: Page): Promise<void> {
  await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    const hooks = (globalThis as unknown as { __e2e: { injectContentScripts(tab: chrome.tabs.Tab): Promise<void> } })
      .__e2e;
    await hooks.injectContentScripts(tab);
  }, page.url());
}

export function overlay(page: Page) {
  return page.locator(`#${OVERLAY_ID}`);
}
