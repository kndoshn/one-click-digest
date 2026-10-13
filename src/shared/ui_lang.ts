// UI languages with bundled messages (public/_locales), shared by the options page and the overlay.

export const SUPPORTED_UI_LANGS = ['en', 'ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko'] as const;

export type UiLang = (typeof SUPPORTED_UI_LANGS)[number];

// Maps a browser or user language tag to a supported UI language (English when unsupported).
export function toUiLang(input: string): UiLang {
  const lower = String(input || '')
    .trim()
    .toLowerCase();
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('zh')) {
    if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo')) return 'zh-TW';
    return 'zh-CN';
  }
  const base = lower.split('-')[0];
  return (SUPPORTED_UI_LANGS as readonly string[]).includes(base) ? (base as UiLang) : 'en';
}
