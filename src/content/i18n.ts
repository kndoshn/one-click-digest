namespace AS {
  export type I18nSubstitutions = string | string[];

  type MessagesMap = Record<string, string>;

  const SUPPORTED_UI_LANGS = ['en', 'ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko'] as const;
  type UiLang = (typeof SUPPORTED_UI_LANGS)[number];

  let overrideMessages: MessagesMap | null = null;
  let overrideLang: UiLang | null = null;

  function toUiLang(input: string): UiLang {
    const raw = String(input || '').trim();
    if (!raw) return 'en';
    const lower = raw.toLowerCase();
    if (lower.startsWith('pt')) return 'pt-BR';
    if (lower.startsWith('zh')) {
      if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo')) return 'zh-TW';
      return 'zh-CN';
    }
    const base = lower.split('-')[0];
    if (base === 'ja') return 'ja';
    if (base === 'fr') return 'fr';
    if (base === 'de') return 'de';
    if (base === 'es') return 'es';
    if (base === 'it') return 'it';
    if (base === 'ko') return 'ko';
    return 'en';
  }

  function uiLangToLocaleFolder(lang: UiLang): string {
    if (lang === 'pt-BR') return 'pt_BR';
    if (lang === 'zh-CN') return 'zh_CN';
    if (lang === 'zh-TW') return 'zh_TW';
    return lang;
  }

  function uiLangToBcp(lang: UiLang): string {
    if (lang === 'pt-BR') return 'pt-BR';
    if (lang === 'zh-CN') return 'zh-CN';
    if (lang === 'zh-TW') return 'zh-TW';
    return lang;
  }

  function resolveBrowserUiLang(): UiLang {
    try {
      if (chrome?.i18n?.getUILanguage) return toUiLang(chrome.i18n.getUILanguage());
    } catch {
      // ignore
    }
    return toUiLang(navigator.language || 'en');
  }

  function applySubstitutions(message: string, substitutions?: I18nSubstitutions): string {
    if (!substitutions) return message;
    const list = Array.isArray(substitutions) ? substitutions : [substitutions];
    return message.replace(/\$(\d+)/g, (_m, idx) => {
      const i = Number(idx) - 1;
      return typeof list[i] === 'string' ? list[i] : '';
    });
  }

  export function t(messageName: string, substitutions?: I18nSubstitutions): string {
    if (overrideMessages && overrideMessages[messageName]) {
      return applySubstitutions(overrideMessages[messageName], substitutions);
    }

    try {
      if (chrome?.i18n?.getMessage) {
        const msg = chrome.i18n.getMessage(messageName, substitutions as any);
        if (typeof msg === 'string' && msg.trim().length > 0) return msg;
      }
    } catch {
      // ignore
    }

    // Fallback: return the key to make missing i18n visible in dev.
    return messageName;
  }

  export function getUiLanguage(): string {
    if (overrideLang) return uiLangToBcp(overrideLang);
    return uiLangToBcp(resolveBrowserUiLang());
  }

  export async function setUiLanguage(value: string): Promise<void> {
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
      const map: MessagesMap = {};
      for (const [key, val] of Object.entries(json || {})) {
        const msg = (val as any)?.message;
        if (typeof msg === 'string') map[key] = msg;
      }
      overrideMessages = map;
      overrideLang = lang;
    } catch {
      overrideMessages = null;
      overrideLang = null;
    }
  }
}
