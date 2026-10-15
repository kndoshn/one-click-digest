import type { Request, ResponseFor } from '../shared/messages.ts';
import type { BulletStyle, RuntimeSettings } from '../shared/types.ts';

// A single overlay instance per tab injection.
export const OVERLAY_CONTAINER_ID = '__article_summarizer_overlay__';

export function makeRunId(): string {
  // Not crypto-grade; sufficient for correlating UI events.
  return `run_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

// Dispatched on an overlay host right before removeExistingOverlay() removes it. Clicking the
// toolbar button again re-runs every content script, and the new controller cannot reach the
// previous one's closures; this event lets the previous controller abort its run and clean up.
export const OVERLAY_DISPOSE_EVENT = 'as:dispose';

export function removeExistingOverlay(): void {
  const existing = document.getElementById(OVERLAY_CONTAINER_ID);
  if (!existing) return;
  try {
    existing.dispatchEvent(new CustomEvent(OVERLAY_DISPOSE_EVENT));
  } catch {
    // ignore
  }
  if (existing.parentNode) existing.parentNode.removeChild(existing);
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

export async function getSettings(): Promise<{
  apiKeySet: boolean;
  settings?: Partial<RuntimeSettings>;
  bulletStyle?: unknown;
}> {
  try {
    const resp = await sendMessage({ type: 'GET_SETTINGS' });
    if (resp && resp.ok === true) {
      return { apiKeySet: Boolean(resp.apiKeySet), settings: resp.settings, bulletStyle: resp.bulletStyle };
    }
  } catch {
    // ignore
  }
  return { apiKeySet: false };
}

// Sends a request to the background worker. Rejects when the worker cannot be reached; failures
// reported by the worker resolve to an ErrorResponse ({ ok: false, ... }).
export async function sendMessage<T extends Request>(msg: T): Promise<ResponseFor<T['type']>> {
  return await new Promise<ResponseFor<T['type']>>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (resp: ResponseFor<T['type']>) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(resp);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Remembers the bullet style picked in the result screen for the next summary (best-effort).
export async function saveBulletStyle(style: BulletStyle): Promise<void> {
  try {
    await sendMessage({ type: 'SET_BULLET_STYLE', payload: { style } });
  } catch {
    // ignore
  }
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

// Unifies line endings, collapses runs of spaces and tabs, and keeps at most one blank line.
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
