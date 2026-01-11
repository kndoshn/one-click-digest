import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassicContext, runClassicScripts } from './helpers/classic_context.js';

test('i18n: setUiLanguage overrides messages for content UI', async () => {
  const messages = {
    labelLanguage: { message: 'Langue de sortie' },
    optionsHeading: { message: 'Options' }
  };

  const ctx = createClassicContext({
    fetch: async () => ({
      json: async () => messages
    }),
    chrome: {
      runtime: {
        getURL: (path) => `chrome-extension://test/${path}`
      },
      i18n: {
        getMessage: (key) => (key === 'labelLanguage' ? 'Output Language' : '')
      }
    },
    navigator: { language: 'en-US' }
  });

  runClassicScripts(ctx, ['dist/content/i18n.js']);

  await ctx.AS.setUiLanguage('fr');
  assert.equal(ctx.AS.t('labelLanguage'), 'Langue de sortie');
  assert.equal(ctx.AS.getUiLanguage(), 'fr');

  await ctx.AS.setUiLanguage('auto');
  assert.equal(ctx.AS.t('labelLanguage'), 'Output Language');
});
