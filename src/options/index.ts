// Options page script
// - Stores Claude API key in chrome.storage.local (device-local)
// - Stores non-sensitive preferences in chrome.storage.local

import { STORAGE_KEYS } from '../shared/constants.js';
import { CacheTtl, RuntimeSettings, DEFAULT_SETTINGS } from '../shared/types.js';
import { SETTINGS_STORAGE_KEYS, parseStoredSettings, settingsToStorage } from '../shared/settings.js';
import { parseNumberOr } from '../shared/utils.js';

type Preferences = RuntimeSettings;

const DEFAULT_PREFS: Preferences = DEFAULT_SETTINGS;

const SUPPORTED_UI_LANGS = ['en', 'ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko'] as const;
type UiLang = (typeof SUPPORTED_UI_LANGS)[number];

type I18nSubstitutions = string | string[];

type MessagesMap = Record<string, string>;
let messages: MessagesMap = {};

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function applySubstitutions(message: string, substitutions?: I18nSubstitutions): string {
  if (!substitutions) return message;
  const list = Array.isArray(substitutions) ? substitutions : [substitutions];
  return message.replace(/\$(\d+)/g, (_m, idx) => {
    const i = Number(idx) - 1;
    return typeof list[i] === 'string' ? list[i] : '';
  });
}

function t(messageName: string, substitutions?: I18nSubstitutions): string {
  if (messages[messageName]) {
    return applySubstitutions(messages[messageName], substitutions);
  }

  try {
    if (chrome?.i18n?.getMessage) {
      const msg = chrome.i18n.getMessage(messageName, substitutions as any);
      if (typeof msg === 'string' && msg.trim().length > 0) return msg;
    }
  } catch {
    // ignore
  }

  return messageName;
}

function setStatus(msg: string, kind: 'normal' | 'danger' = 'normal'): void {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.className = kind === 'danger' ? 'danger' : '';
}

function setApiKeyPlaceholder(apiKeySet: boolean): void {
  const el = $('api-key') as HTMLInputElement | null;
  if (!el) return;
  el.placeholder = apiKeySet ? t('placeholderApiKeySaved') : t('placeholderApiKeyEmpty');
}

function setApiKeyInputState(apiKeySet: boolean): void {
  const el = $('api-key') as HTMLInputElement | null;
  if (!el) return;
  el.disabled = apiKeySet;
  setApiKeyPlaceholder(apiKeySet);
  const clearBtn = $('clear') as HTMLButtonElement | null;
  if (clearBtn) clearBtn.hidden = !apiKeySet;
}

function getInputValue(id: string): string {
  const el = $(id) as HTMLInputElement | null;
  return (el?.value || '').trim();
}

function setInputValue(id: string, value: string): void {
  const el = $(id) as HTMLInputElement | null;
  if (el) el.value = value;
}

function getSelectValue(id: string): string {
  const el = $(id) as HTMLSelectElement | null;
  return (el?.value || '').trim();
}

function setSelectValue(id: string, value: string): void {
  const el = $(id) as HTMLSelectElement | null;
  if (el) el.value = value;
}

function getCheckboxValue(id: string): boolean {
  const el = $(id) as HTMLInputElement | null;
  return Boolean(el?.checked);
}

function setCheckboxValue(id: string, checked: boolean): void {
  const el = $(id) as HTMLInputElement | null;
  if (el) el.checked = checked;
}

function parseNum(input: string, fallback: number, opts?: { min?: number; max?: number }): number {
  // Blank or non-numeric input falls back (an emptied field must not be saved as 0).
  const n = parseNumberOr(input, NaN);
  if (!Number.isFinite(n)) return fallback;
  const min = opts?.min;
  const max = opts?.max;
  if (typeof min === 'number' && n < min) return fallback;
  if (typeof max === 'number' && n > max) return fallback;
  return n;
}

// Keep in sync with toUiLang in src/content/i18n.ts.
function toUiLang(input: string): UiLang {
  const lower = String(input || '').trim().toLowerCase();
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('zh')) {
    if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo')) return 'zh-TW';
    return 'zh-CN';
  }
  const base = lower.split('-')[0];
  return (SUPPORTED_UI_LANGS as readonly string[]).includes(base) ? (base as UiLang) : 'en';
}

function resolveBrowserUiLang(): UiLang {
  try {
    if (chrome?.i18n?.getUILanguage) return toUiLang(chrome.i18n.getUILanguage());
  } catch {
    // ignore
  }
  return toUiLang(navigator.language || 'en');
}

function resolveUiLang(setting: string): UiLang {
  if (!setting || setting === 'auto') return resolveBrowserUiLang();
  return toUiLang(setting);
}

async function loadMessagesForUi(setting: string): Promise<UiLang> {
  const lang = resolveUiLang(setting);
  // _locales folders use underscores (pt_BR, zh_CN, zh_TW).
  const folder = lang.replace('-', '_');
  try {
    const url = chrome.runtime.getURL(`_locales/${folder}/messages.json`);
    const resp = await fetch(url);
    const json = await resp.json();
    const map: MessagesMap = {};
    for (const [key, val] of Object.entries(json || {})) {
      const msg = (val as any)?.message;
      if (typeof msg === 'string') map[key] = msg;
    }
    messages = map;
  } catch {
    messages = {};
  }
  return lang;
}

function readPrefsFromUi(): Preferences {
  const modelMap = getSelectValue('model-map') || DEFAULT_PREFS.modelMap;
  const modelFinal = getSelectValue('model-final') || DEFAULT_PREFS.modelFinal;
  const promptCachingEnabled = getCheckboxValue('prompt-caching-enabled');
  const promptCachingTtl = (getSelectValue('prompt-caching-ttl') as CacheTtl) || DEFAULT_PREFS.promptCachingTtl;
  const uiLanguage = getSelectValue('ui-language') || DEFAULT_PREFS.uiLanguage;

  const hardCostLimitUsd = parseNum(getInputValue('hard-limit'), DEFAULT_PREFS.hardCostLimitUsd, { min: 0.01 });
  const approvalThresholdUsd = parseNum(getInputValue('approval-usd'), DEFAULT_PREFS.approvalThresholdUsd, { min: 0 });
  const approvalThresholdChars = Math.floor(
    parseNum(getInputValue('approval-chars'), DEFAULT_PREFS.approvalThresholdChars, { min: 0 })
  );
  const minArticleChars = Math.floor(parseNum(getInputValue('min-article-chars'), DEFAULT_PREFS.minArticleChars, { min: 0 }));
  const maxArticleCharsToSend = Math.floor(
    parseNum(getInputValue('max-send-chars'), DEFAULT_PREFS.maxArticleCharsToSend, { min: 1_000 })
  );

  return {
    modelMap,
    modelFinal,
    promptCachingEnabled,
    promptCachingTtl,
    hardCostLimitUsd,
    approvalThresholdUsd,
    approvalThresholdChars,
    minArticleChars,
    maxArticleCharsToSend,
    uiLanguage
  };
}

function applyPrefsToUi(p: Preferences): void {
  setSelectValue('model-map', p.modelMap);
  setSelectValue('model-final', p.modelFinal);
  setCheckboxValue('prompt-caching-enabled', p.promptCachingEnabled);
  setSelectValue('prompt-caching-ttl', p.promptCachingTtl);
  setInputValue('hard-limit', String(p.hardCostLimitUsd));
  setInputValue('approval-usd', String(p.approvalThresholdUsd));
  setInputValue('approval-chars', String(p.approvalThresholdChars));
  setInputValue('min-article-chars', String(p.minArticleChars));
  setInputValue('max-send-chars', String(p.maxArticleCharsToSend));
  setSelectValue('ui-language', p.uiLanguage || 'auto');
}

async function readPrefsFromStorage(): Promise<{ prefs: Preferences; apiKeySet: boolean }> {
  const keys = [STORAGE_KEYS.CLAUDE_API_KEY, ...SETTINGS_STORAGE_KEYS];

  return await new Promise((resolve) => {
    chrome.storage.local.get(keys, (res: any) => {
      const apiKeySet = Boolean(res?.[STORAGE_KEYS.CLAUDE_API_KEY]);
      const { settings, migration } = parseStoredSettings(res);
      // Best-effort write-back; reading lastError marks a failure as handled.
      if (migration) chrome.storage.local.set(migration, () => void chrome.runtime.lastError);
      resolve({ prefs: settings, apiKeySet });
    });
  });
}

async function savePreferences(prefs: Preferences, apiKeyMaybe: string): Promise<void> {
  const toSet = settingsToStorage(prefs);

  if (apiKeyMaybe) {
    toSet[STORAGE_KEYS.CLAUDE_API_KEY] = apiKeyMaybe;
  }

  await new Promise<void>((resolve) => {
    chrome.storage.local.set(toSet, () => resolve());
  });
}

async function clearApiKey(): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.storage.local.remove([STORAGE_KEYS.CLAUDE_API_KEY], () => resolve());
  });
}

function applyI18n(): void {
  document.title = t('optionsTitle');
  const nodes = document.querySelectorAll<HTMLElement>('[data-i18n]');
  for (const el of Array.from(nodes)) {
    const key = el.dataset.i18n;
    if (!key) continue;
    el.textContent = t(key);
  }

  const htmlNodes = document.querySelectorAll<HTMLElement>('[data-i18n-html]');
  for (const el of Array.from(htmlNodes)) {
    const key = el.dataset.i18nHtml;
    if (!key) continue;
    el.innerHTML = t(key);
  }
}

function renderUiLanguageOptions(setting: string, displayLang: UiLang): void {
  const select = $('ui-language') as HTMLSelectElement | null;
  if (!select) return;
  select.innerHTML = '';

  let languageNames: Intl.DisplayNames | null = null;
  let regionNames: Intl.DisplayNames | null = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      languageNames = new Intl.DisplayNames([displayLang], { type: 'language' });
      regionNames = new Intl.DisplayNames([displayLang], { type: 'region' });
    }
  } catch {
    languageNames = null;
    regionNames = null;
  }

  const labelFor = (lang: UiLang): string => {
    if (!languageNames) return lang;
    try {
      if (lang === 'pt-BR' && regionNames) {
        return `${languageNames.of('pt')} (${regionNames.of('BR')})`;
      }
      if (lang === 'zh-CN' && regionNames) {
        return `${languageNames.of('zh')} (${regionNames.of('CN')})`;
      }
      if (lang === 'zh-TW' && regionNames) {
        return `${languageNames.of('zh')} (${regionNames.of('TW')})`;
      }
      const base = lang.split('-')[0];
      return languageNames.of(base) || lang;
    } catch {
      return lang;
    }
  };

  const resolved = resolveUiLang(setting);
  const autoOption = document.createElement('option');
  autoOption.value = 'auto';
  autoOption.textContent = t('uiLanguageAutoFormat', labelFor(resolved));
  select.appendChild(autoOption);

  for (const lang of SUPPORTED_UI_LANGS) {
    if (setting === 'auto' && lang === resolved) continue;
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = labelFor(lang);
    select.appendChild(opt);
  }

  select.value = setting && setting !== 'auto' ? setting : 'auto';
}

// Runs an async event handler. Failures are logged instead of becoming unhandled rejections.
function runAsync(task: () => Promise<void>): void {
  task().catch((err: unknown) => {
    console.error('[ArticleSummarizer] Options page action failed', err);
  });
}

function wireUi(initialUiLanguage: string): void {
  const saveBtn = $('save') as HTMLButtonElement | null;
  const clearBtn = $('clear') as HTMLButtonElement | null;
  const resetBtn = $('reset') as HTMLButtonElement | null;

  saveBtn?.addEventListener('click', () =>
    runAsync(async () => {
      const apiKey = getInputValue('api-key');
      const prefs = readPrefsFromUi();
      await savePreferences(prefs, apiKey);

      if (apiKey) setInputValue('api-key', '');

      const reloadNeeded = (prefs.uiLanguage || 'auto') !== (initialUiLanguage || 'auto');
      if (reloadNeeded) {
        setStatus(t('statusReloading'));
        setTimeout(() => location.reload(), 250);
        return;
      }

      const { prefs: stored, apiKeySet } = await readPrefsFromStorage();
      applyPrefsToUi(stored);
      setApiKeyInputState(apiKeySet);
      setStatus(apiKeySet ? t('statusSavedKeySet') : t('statusSavedKeyMissing'));
    })
  );

  clearBtn?.addEventListener('click', () =>
    runAsync(async () => {
      if (!confirm(t('confirmClearApiKey'))) return;
      await clearApiKey();
      setInputValue('api-key', '');
      setApiKeyInputState(false);
      setStatus(t('statusClearedKey'));
    })
  );

  resetBtn?.addEventListener('click', () =>
    runAsync(async () => {
      if (!confirm(t('confirmResetDefaults'))) return;
      applyPrefsToUi(DEFAULT_PREFS);
      await savePreferences(DEFAULT_PREFS, '');
      const { apiKeySet } = await readPrefsFromStorage();
      setApiKeyInputState(apiKeySet);
      setStatus(t('statusResetDefaults'));
    })
  );
}

document.addEventListener('DOMContentLoaded', () =>
  runAsync(async () => {
    const { prefs, apiKeySet } = await readPrefsFromStorage();
    const displayLang = await loadMessagesForUi(prefs.uiLanguage || 'auto');
    applyI18n();
    renderUiLanguageOptions(prefs.uiLanguage || 'auto', displayLang);
    applyPrefsToUi(prefs);
    wireUi(prefs.uiLanguage || 'auto');
    setApiKeyInputState(apiKeySet);
    setStatus(apiKeySet ? t('statusKeySet') : t('statusKeyMissing'));
  })
);
