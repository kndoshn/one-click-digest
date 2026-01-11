"use strict";
var AS;
(function (AS) {
    const SUPPORTED_UI_LANGS = ['en', 'ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko'];
    let overrideMessages = null;
    let overrideLang = null;
    function toUiLang(input) {
        const raw = String(input || '').trim();
        if (!raw)
            return 'en';
        const lower = raw.toLowerCase();
        if (lower.startsWith('pt'))
            return 'pt-BR';
        if (lower.startsWith('zh')) {
            if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo'))
                return 'zh-TW';
            return 'zh-CN';
        }
        const base = lower.split('-')[0];
        if (base === 'ja')
            return 'ja';
        if (base === 'fr')
            return 'fr';
        if (base === 'de')
            return 'de';
        if (base === 'es')
            return 'es';
        if (base === 'it')
            return 'it';
        if (base === 'ko')
            return 'ko';
        return 'en';
    }
    function uiLangToLocaleFolder(lang) {
        if (lang === 'pt-BR')
            return 'pt_BR';
        if (lang === 'zh-CN')
            return 'zh_CN';
        if (lang === 'zh-TW')
            return 'zh_TW';
        return lang;
    }
    function uiLangToBcp(lang) {
        if (lang === 'pt-BR')
            return 'pt-BR';
        if (lang === 'zh-CN')
            return 'zh-CN';
        if (lang === 'zh-TW')
            return 'zh-TW';
        return lang;
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
        if (overrideLang)
            return uiLangToBcp(overrideLang);
        return uiLangToBcp(resolveBrowserUiLang());
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
        const folder = uiLangToLocaleFolder(lang);
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
