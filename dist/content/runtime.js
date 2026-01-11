"use strict";
var AS;
(function (AS) {
    // A single overlay instance per tab injection.
    AS.OVERLAY_CONTAINER_ID = '__article_summarizer_overlay__';
    function safeNowMs() {
        return typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
    }
    AS.safeNowMs = safeNowMs;
    function makeRunId() {
        // Not crypto-grade; sufficient for correlating UI events.
        return `run_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    }
    AS.makeRunId = makeRunId;
    function removeExistingOverlay() {
        const existing = document.getElementById(AS.OVERLAY_CONTAINER_ID);
        if (existing && existing.parentNode)
            existing.parentNode.removeChild(existing);
    }
    AS.removeExistingOverlay = removeExistingOverlay;
    function getPageTitle() {
        const og = document.querySelector('meta[property="og:title"]');
        const title = (og && og.content) || document.title || '';
        return title.trim() || '(untitled)';
    }
    AS.getPageTitle = getPageTitle;
    function getPageUrl() {
        try {
            return String(location.href);
        }
        catch {
            return '';
        }
    }
    AS.getPageUrl = getPageUrl;
    function getDomain() {
        try {
            return new URL(getPageUrl()).hostname;
        }
        catch {
            return location.host || '';
        }
    }
    AS.getDomain = getDomain;
    async function getAcceptLanguages() {
        const fallback = [navigator.language || 'en'];
        try {
            // getAcceptLanguages exists in extension contexts; in some cases it may be unavailable.
            if (chrome?.i18n?.getAcceptLanguages) {
                const langs = await new Promise((resolve) => {
                    chrome.i18n.getAcceptLanguages((list) => resolve(Array.isArray(list) ? list : []));
                });
                return langs.length > 0 ? langs : fallback;
            }
        }
        catch {
            // ignore
        }
        return fallback;
    }
    AS.getAcceptLanguages = getAcceptLanguages;
    async function getSettings() {
        try {
            const resp = await sendMessage({ type: 'GET_SETTINGS' });
            if (resp && resp.ok === true) {
                return { apiKeySet: Boolean(resp.apiKeySet), settings: resp.settings };
            }
        }
        catch {
            // ignore
        }
        return { apiKeySet: false };
    }
    AS.getSettings = getSettings;
    async function sendMessage(msg) {
        return await new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(msg, (resp) => {
                    const err = chrome.runtime.lastError;
                    if (err)
                        reject(new Error(err.message));
                    else
                        resolve(resp);
                });
            }
            catch (e) {
                reject(e);
            }
        });
    }
    AS.sendMessage = sendMessage;
    async function openOptionsPage() {
        try {
            await sendMessage({ type: 'OPEN_OPTIONS' });
            return;
        }
        catch {
            // ignore
        }
        try {
            if (chrome?.runtime?.openOptionsPage) {
                await chrome.runtime.openOptionsPage();
            }
        }
        catch {
            // ignore
        }
    }
    AS.openOptionsPage = openOptionsPage;
    function clampText(text, maxChars) {
        if (maxChars <= 0)
            return { text: '', truncated: text.length > 0 };
        if (text.length <= maxChars)
            return { text, truncated: false };
        return { text: text.slice(0, maxChars), truncated: true };
    }
    AS.clampText = clampText;
    async function copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        }
        catch {
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
        }
        catch {
            return false;
        }
    }
    AS.copyToClipboard = copyToClipboard;
})(AS || (AS = {}));
