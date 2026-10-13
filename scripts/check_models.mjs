// Compares src/shared/models.ts with the Models API (GET /v1/models) and prints a Markdown report
// of differences (nothing when the catalog is up to date):
// - catalog models the API no longer lists (retired; requests would fail), and
// - Haiku/Sonnet models the API lists that the catalog does not offer yet.
// Prices are not available from the API; they still have to be checked by hand.
//
// Usage: ANTHROPIC_API_KEY=... node scripts/check_models.mjs

import { MODELS, PRICING_CHECKED_ON } from '../src/shared/models.ts';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set');
  process.exit(2);
}

async function listModelIds() {
  const ids = [];
  let afterId;
  do {
    const url = new URL('https://api.anthropic.com/v1/models');
    url.searchParams.set('limit', '1000');
    if (afterId) url.searchParams.set('after_id', afterId);
    const res = await fetch(url, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
    if (!res.ok) throw new Error(`GET /v1/models failed: HTTP ${res.status}`);
    const body = await res.json();
    ids.push(...body.data.map((m) => m.id));
    afterId = body.has_more ? body.last_id : undefined;
  } while (afterId);
  return ids;
}

// The API lists some models by a dated ID (claude-haiku-4-5-20251001) whose alias is the catalog ID.
const matches = (catalogId, apiId) => apiId === catalogId || new RegExp(`^${catalogId}-\\d{8}$`).test(apiId);

const apiIds = await listModelIds();
const missing = MODELS.filter((m) => !apiIds.some((id) => matches(m.id, id))).map((m) => m.id);
const families = /^claude-(haiku|sonnet)-/;
const notOffered = apiIds.filter((id) => families.test(id) && !MODELS.some((m) => matches(m.id, id)));

const lines = [];
if (missing.length > 0) {
  lines.push('### No longer listed by the Models API', '');
  lines.push('Requests with these models will fail. Remove them from `MODELS` in `src/shared/models.ts`.', '');
  lines.push(...missing.map((id) => `- \`${id}\``), '');
}
if (notOffered.length > 0) {
  lines.push('### Haiku/Sonnet models not in the catalog', '');
  lines.push(
    `Consider adding them to \`src/shared/models.ts\` (prices from the pricing page; last checked ${PRICING_CHECKED_ON}).`,
    ''
  );
  lines.push(...notOffered.map((id) => `- \`${id}\``), '');
}
if (lines.length > 0) process.stdout.write(lines.join('\n'));
