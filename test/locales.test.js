// Locale files: every locale defines the same keys with non-empty messages and the same
// placeholders, and every message key the code or HTML refers to exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const localesDir = path.join(root, 'public', '_locales');
const locales = fs.readdirSync(localesDir).sort();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');
const messages = Object.fromEntries(
  locales.map((l) => [l, JSON.parse(fs.readFileSync(path.join(localesDir, l, 'messages.json'), 'utf-8'))])
);
const enKeys = Object.keys(messages.en).sort();
const placeholders = (s) => (s.match(/\$\d+/g) || []).sort();

test('locales: the expected set of locales, matching the UI language list in code', () => {
  assert.deepEqual(locales, ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt_BR', 'zh_CN', 'zh_TW']);
  const asFolders = (src) => {
    const m = src.match(/SUPPORTED_UI_LANGS = \[([^\]]+)\]/);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1].replace('-', '_')).sort();
  };
  assert.deepEqual(asFolders(read('src/shared/ui_lang.ts')), locales);
});

test('locales: every locale has the same keys as en, with non-empty messages and the same placeholders', () => {
  for (const locale of locales) {
    const m = messages[locale];
    assert.deepEqual(Object.keys(m).sort(), enKeys, `${locale}: keys differ from en`);
    for (const key of enKeys) {
      assert.equal(typeof m[key].message, 'string', `${locale}.${key}`);
      assert.ok(m[key].message.trim().length > 0, `${locale}.${key} is empty`);
      assert.deepEqual(
        placeholders(m[key].message),
        placeholders(messages.en[key].message),
        `${locale}.${key} placeholders`
      );
    }
  }
});

test('locales: every message key used by the code, HTML and manifest exists', () => {
  const sources = [
    ...['src/content', 'src/options'].flatMap((dir) =>
      fs.readdirSync(path.join(root, dir)).map((f) => path.join(dir, f))
    ),
    'public/options.html',
    'public/manifest.json'
  ].map(read);
  const text = sources.join('\n');

  const used = new Set();
  const patterns = [
    /\bt\(\s*'([A-Za-z0-9_]+)'/g, // t('key')
    /data-i18n(?:-html)?="([A-Za-z0-9_]+)"/g, // options.html
    /__MSG_([A-Za-z0-9_]+)__/g, // manifest.json
    /\b(?:labelKey|descKey|key): '([A-Za-z0-9_]+)'/g, // MODE_OPTIONS and footer buttons
    /^\s+[A-Z_]+: '((?:error|reason)[A-Za-z0-9]+)'/gm // EXTRACT_ERROR_KEYS
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) used.add(m[1]);

  // Sanity check that the patterns found the references.
  for (const key of ['appName', 'optionsHeading', 'mode3Label', 'buttonCancel', 'errorTooShort', 'toastModeAdjusted']) {
    assert.ok(used.has(key), `expected to find a reference to ${key}`);
  }
  const missing = [...used].filter((k) => !enKeys.includes(k));
  assert.deepEqual(missing, []);
});
