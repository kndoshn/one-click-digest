import { toUiLang, type UiLang } from '../shared/ui_lang.ts';

export type I18nSubstitutions = string | string[];

type MessagesMap = Record<string, string>;

let overrideMessages: MessagesMap | null = null;
let overrideLang: UiLang | null = null;

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
  return overrideLang || resolveBrowserUiLang();
}

export async function setUiLanguage(value: string): Promise<void> {
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
