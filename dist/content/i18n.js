"use strict";
var AS;
(function (AS) {
    const SUPPORTED_UI_LANGS = ['en', 'ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko'];
    let overrideMessages = null;
    let overrideLang = null;
    // Keep in sync with toUiLang in src/options/index.ts.
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
        if (overrideMessages && overrideMessages[messageName]) {
            return applySubstitutions(overrideMessages[messageName], substitutions);
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
        // Fallback: return the key to make missing i18n visible in dev.
        return messageName;
    }
    AS.t = t;
    function getUiLanguage() {
        return overrideLang || resolveBrowserUiLang();
    }
    AS.getUiLanguage = getUiLanguage;
    async function setUiLanguage(value) {
        const raw = String(value || '').trim();
        if (!raw || raw === 'auto') {
            overrideMessages = null;
            overrideLang = null;
            return;
        }
        const lang = toUiLang(raw);
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
            overrideMessages = map;
            overrideLang = lang;
        }
        catch {
            overrideMessages = null;
            overrideLang = null;
        }
    }
    AS.setUiLanguage = setUiLanguage;
})(AS || (AS = {}));
