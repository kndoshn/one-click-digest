namespace AS {
  // A single overlay instance per tab injection.
  export const OVERLAY_CONTAINER_ID = '__article_summarizer_overlay__';

  export function safeNowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  export function makeRunId(): string {
    // Not crypto-grade; sufficient for correlating UI events.
    return `run_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }

  export function removeExistingOverlay(): void {
    const existing = document.getElementById(OVERLAY_CONTAINER_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  export function getPageTitle(): string {
    const og = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
    const title = (og && og.content) || document.title || '';
    return title.trim() || '(untitled)';
  }

  export function getPageUrl(): string {
    try {
      return String(location.href);
    } catch {
      return '';
    }
  }

  export function getDomain(): string {
    try {
      return new URL(getPageUrl()).hostname;
    } catch {
      return location.host || '';
    }
  }

  export async function getAcceptLanguages(): Promise<string[]> {
    const fallback = [navigator.language || 'en'];

    try {
      // getAcceptLanguages exists in extension contexts; in some cases it may be unavailable.
      if (chrome?.i18n?.getAcceptLanguages) {
        const langs = await new Promise<string[]>((resolve) => {
          chrome.i18n.getAcceptLanguages((list: string[]) => resolve(Array.isArray(list) ? list : []));
        });
        return langs.length > 0 ? langs : fallback;
      }
    } catch {
      // ignore
    }

    return fallback;
  }

  export type CacheTtl = '5m' | '1h';

  export type RuntimeSettings = {
    modelMap: string;
    modelFinal: string;
    promptCachingEnabled: boolean;
    promptCachingTtl: CacheTtl;
    hardCostLimitUsd: number;
    approvalThresholdUsd: number;
    approvalThresholdChars: number;
    minArticleChars: number;
    maxArticleCharsToSend: number;
    uiLanguage: string;
  };

  export async function getSettings(): Promise<{ apiKeySet: boolean; settings?: Partial<RuntimeSettings> }> {
    try {
      const resp = await sendMessage({ type: 'GET_SETTINGS' });
      if (resp && resp.ok === true) {
        return { apiKeySet: Boolean(resp.apiKeySet), settings: resp.settings };
      }
    } catch {
      // ignore
    }
    return { apiKeySet: false };
  }

  export async function sendMessage(msg: any): Promise<any> {
    return await new Promise<any>((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (resp: any) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(resp);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  export async function openOptionsPage(): Promise<void> {
    try {
      await sendMessage({ type: 'OPEN_OPTIONS' });
      return;
    } catch {
      // ignore
    }

    try {
      if (chrome?.runtime?.openOptionsPage) {
        await chrome.runtime.openOptionsPage();
      }
    } catch {
      // ignore
    }
  }

  export function clampText(text: string, maxChars: number): { text: string; truncated: boolean } {
    if (maxChars <= 0) return { text: '', truncated: text.length > 0 };
    if (text.length <= maxChars) return { text, truncated: false };
    return { text: text.slice(0, maxChars), truncated: true };
  }

  export async function copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // ignore
    }

    // Fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
