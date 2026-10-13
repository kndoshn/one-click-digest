// Options page script
// - Stores Claude API key in chrome.storage.local (device-local)
// - Stores non-sensitive preferences in chrome.storage.local
import { STORAGE_KEYS } from '../shared/constants.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import { SETTINGS_STORAGE_KEYS, parseStoredSettings, settingsToStorage } from '../shared/settings.js';
const DEFAULT_PREFS = DEFAULT_SETTINGS;
const SUPPORTED_UI_LANGS = ['en', 'ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko'];
let messages = {};
function $(id) {
    return document.getElementById(id);
}
function applySubstitutions(message, substitutions) {
    if (!substitutions)
        return message;
    const list = Array.isArray(substitutions) ? substitutions : [substitutions];
    return message.replace(/\$(\d+)/g, (_m, idx) => {
        const i = Number(idx) - 1;
        return typeof list[i] === 'string' ? list[i] : '';
    });
}
function t(messageName, substitutions) {
    if (messages[messageName]) {
        return applySubstitutions(messages[messageName], substitutions);
    }
    try {
        if (chrome?.i18n?.getMessage) {
            const msg = chrome.i18n.getMessage(messageName, substitutions);
            if (typeof msg === 'string' && msg.trim().length > 0)
                return msg;
        }
    }
    catch {
        // ignore
    }
    return messageName;
}
function setStatus(msg, kind = 'normal') {
    const el = $('status');
    if (!el)
        return;
    el.textContent = msg;
    el.className = kind === 'danger' ? 'danger' : '';
}
function setApiKeyPlaceholder(apiKeySet) {
    const el = $('api-key');
    if (!el)
        return;
    el.placeholder = apiKeySet ? t('placeholderApiKeySaved') : t('placeholderApiKeyEmpty');
}
function setApiKeyInputState(apiKeySet) {
    const el = $('api-key');
    if (!el)
        return;
    el.disabled = apiKeySet;
    setApiKeyPlaceholder(apiKeySet);
    const clearBtn = $('clear');
    if (clearBtn)
        clearBtn.hidden = !apiKeySet;
}
function getInputValue(id) {
    const el = $(id);
    return (el?.value || '').trim();
}
function setInputValue(id, value) {
    const el = $(id);
    if (el)
        el.value = value;
}
function getSelectValue(id) {
    const el = $(id);
    return (el?.value || '').trim();
}
function setSelectValue(id, value) {
    const el = $(id);
    if (el)
        el.value = value;
}
function getCheckboxValue(id) {
    const el = $(id);
    return Boolean(el?.checked);
}
function setCheckboxValue(id, checked) {
    const el = $(id);
    if (el)
        el.checked = checked;
}
function parseNum(input, fallback, opts) {
    const n = Number(input);
    if (!Number.isFinite(n))
        return fallback;
    const min = opts?.min;
    const max = opts?.max;
    if (typeof min === 'number' && n < min)
        return fallback;
    if (typeof max === 'number' && n > max)
        return fallback;
    return n;
}
// Keep in sync with toUiLang in src/content/i18n.ts.
function toUiLang(input) {
    const lower = String(input || '').trim().toLowerCase();
    if (lower.startsWith('pt'))
        return 'pt-BR';
    if (lower.startsWith('zh')) {
        if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo'))
            return 'zh-TW';
        return 'zh-CN';
    }
    const base = lower.split('-')[0];
    return SUPPORTED_UI_LANGS.includes(base) ? base : 'en';
}
function resolveBrowserUiLang() {
    try {
        if (chrome?.i18n?.getUILanguage)
            return toUiLang(chrome.i18n.getUILanguage());
    }
    catch {
        // ignore
    }
    return toUiLang(navigator.language || 'en');
}
function resolveUiLang(setting) {
    if (!setting || setting === 'auto')
        return resolveBrowserUiLang();
    return toUiLang(setting);
}
async function loadMessagesForUi(setting) {
    const lang = resolveUiLang(setting);
    // _locales folders use underscores (pt_BR, zh_CN, zh_TW).
    const folder = lang.replace('-', '_');
    try {
        const url = chrome.runtime.getURL(`_locales/${folder}/messages.json`);
        const resp = await fetch(url);
        const json = await resp.json();
        const map = {};
        for (const [key, val] of Object.entries(json || {})) {
            const msg = val?.message;
            if (typeof msg === 'string')
                map[key] = msg;
        }
        messages = map;
    }
    catch {
        messages = {};
    }
    return lang;
}
function readPrefsFromUi() {
    const modelMap = getSelectValue('model-map') || DEFAULT_PREFS.modelMap;
    const modelFinal = getSelectValue('model-final') || DEFAULT_PREFS.modelFinal;
    const promptCachingEnabled = getCheckboxValue('prompt-caching-enabled');
    const promptCachingTtl = getSelectValue('prompt-caching-ttl') || DEFAULT_PREFS.promptCachingTtl;
    const uiLanguage = getSelectValue('ui-language') || DEFAULT_PREFS.uiLanguage;
    const hardCostLimitUsd = parseNum(getInputValue('hard-limit'), DEFAULT_PREFS.hardCostLimitUsd, { min: 0.01 });
    const approvalThresholdUsd = parseNum(getInputValue('approval-usd'), DEFAULT_PREFS.approvalThresholdUsd, { min: 0 });
    const approvalThresholdChars = Math.floor(parseNum(getInputValue('approval-chars'), DEFAULT_PREFS.approvalThresholdChars, { min: 0 }));
    const minArticleChars = Math.floor(parseNum(getInputValue('min-article-chars'), DEFAULT_PREFS.minArticleChars, { min: 0 }));
    const maxArticleCharsToSend = Math.floor(parseNum(getInputValue('max-send-chars'), DEFAULT_PREFS.maxArticleCharsToSend, { min: 1_000 }));
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
function applyPrefsToUi(p) {
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
async function readPrefsFromStorage() {
    const keys = [STORAGE_KEYS.CLAUDE_API_KEY, ...SETTINGS_STORAGE_KEYS];
    return await new Promise((resolve) => {
        chrome.storage.local.get(keys, (res) => {
            const apiKeySet = Boolean(res?.[STORAGE_KEYS.CLAUDE_API_KEY]);
            const { settings, migration } = parseStoredSettings(res);
            if (migration)
                chrome.storage.local.set(migration);
            resolve({ prefs: settings, apiKeySet });
        });
    });
}
async function savePreferences(prefs, apiKeyMaybe) {
    const toSet = settingsToStorage(prefs);
    if (apiKeyMaybe) {
        toSet[STORAGE_KEYS.CLAUDE_API_KEY] = apiKeyMaybe;
    }
    await new Promise((resolve) => {
        chrome.storage.local.set(toSet, () => resolve());
    });
}
async function clearApiKey() {
    await new Promise((resolve) => {
        chrome.storage.local.remove([STORAGE_KEYS.CLAUDE_API_KEY], () => resolve());
    });
}
function applyI18n() {
    document.title = t('optionsTitle');
    const nodes = document.querySelectorAll('[data-i18n]');
    for (const el of Array.from(nodes)) {
        const key = el.dataset.i18n;
        if (!key)
            continue;
        el.textContent = t(key);
    }
    const htmlNodes = document.querySelectorAll('[data-i18n-html]');
    for (const el of Array.from(htmlNodes)) {
        const key = el.dataset.i18nHtml;
        if (!key)
            continue;
        el.innerHTML = t(key);
    }
}
function renderUiLanguageOptions(setting, displayLang) {
    const select = $('ui-language');
    if (!select)
        return;
    select.innerHTML = '';
    let languageNames = null;
    let regionNames = null;
    try {
        if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
            languageNames = new Intl.DisplayNames([displayLang], { type: 'language' });
            regionNames = new Intl.DisplayNames([displayLang], { type: 'region' });
        }
    }
    catch {
        languageNames = null;
        regionNames = null;
    }
    const labelFor = (lang) => {
        if (!languageNames)
            return lang;
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
        }
        catch {
            return lang;
        }
    };
    const resolved = resolveUiLang(setting);
    const autoOption = document.createElement('option');
    autoOption.value = 'auto';
    autoOption.textContent = t('uiLanguageAutoFormat', labelFor(resolved));
    select.appendChild(autoOption);
    for (const lang of SUPPORTED_UI_LANGS) {
        if (setting === 'auto' && lang === resolved)
            continue;
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = labelFor(lang);
        select.appendChild(opt);
    }
    select.value = setting && setting !== 'auto' ? setting : 'auto';
}
function wireUi(initialUiLanguage) {
    const saveBtn = $('save');
    const clearBtn = $('clear');
    const resetBtn = $('reset');
    saveBtn?.addEventListener('click', async () => {
        const apiKey = getInputValue('api-key');
        const prefs = readPrefsFromUi();
        await savePreferences(prefs, apiKey);
        if (apiKey)
            setInputValue('api-key', '');
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
    });
    clearBtn?.addEventListener('click', async () => {
        if (!confirm(t('confirmClearApiKey')))
            return;
        await clearApiKey();
        setInputValue('api-key', '');
        setApiKeyInputState(false);
        setStatus(t('statusClearedKey'));
    });
    resetBtn?.addEventListener('click', async () => {
        if (!confirm(t('confirmResetDefaults')))
            return;
        applyPrefsToUi(DEFAULT_PREFS);
        await savePreferences(DEFAULT_PREFS, '');
        const { apiKeySet } = await readPrefsFromStorage();
        setApiKeyInputState(apiKeySet);
        setStatus(t('statusResetDefaults'));
    });
}
document.addEventListener('DOMContentLoaded', async () => {
    const { prefs, apiKeySet } = await readPrefsFromStorage();
    const displayLang = await loadMessagesForUi(prefs.uiLanguage || 'auto');
    applyI18n();
    renderUiLanguageOptions(prefs.uiLanguage || 'auto', displayLang);
    applyPrefsToUi(prefs);
    wireUi(prefs.uiLanguage || 'auto');
    setApiKeyInputState(apiKeySet);
    setStatus(apiKeySet ? t('statusKeySet') : t('statusKeyMissing'));
});
