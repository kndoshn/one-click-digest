"use strict";
var AS;
(function (AS) {
    let Overlay;
    (function (Overlay) {
        const ANIM_DOTS_INTERVAL_MS = 450;
        function dispatch(host, type, detail) {
            host.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
        }
        function css() {
            return `
        :host { all: initial; }
        .panel {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
          background: #141414;
          border: 1px solid rgba(200,200,200,0.7);
          border-radius: 12px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.45);
          width: 380px;
          max-width: 92vw;
          max-height: 72vh;
          overflow: hidden;
          color: #f5f5f5;
          display: flex;
          flex-direction: column;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .titleRow {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .title {
          font-weight: 700;
          font-size: 17px;
        }
        .close {
          border: none;
          background: transparent;
          font-size: 26px;
          line-height: 26px;
          cursor: pointer;
          padding: 6px 8px;
          border-radius: 8px;
          color: inherit;
        }
        .close:hover { background: rgba(255,255,255,0.08); }
        .meta {
          padding: 8px 12px 0 12px;
          font-size: 14px;
          color: rgba(255,255,255,0.7);
        }
        .controls {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 14px;
          color: rgba(255,255,255,0.7);
          flex: 1;
        }
        select {
          font-size: 14px;
          padding: 6px 8px;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px;
          background: #1f1f1f;
          color: #f5f5f5;
        }
        button {
          font-size: 14px;
          padding: 8px 10px;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 10px;
          background: #1f1f1f;
          color: #f5f5f5;
          cursor: pointer;
        }
        .iconButton {
          width: 36px;
          height: 36px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          line-height: 1;
        }
        button.primary {
          border-color: rgba(255,255,255,0.35);
          font-weight: 600;
        }
        button:hover { background: rgba(255,255,255,0.08); }
        button:disabled { opacity: 0.6; cursor: not-allowed; }
        .banner {
          margin: 0 12px 8px 12px;
          padding: 8px 10px;
          border-radius: 10px;
          background: rgba(255, 196, 0, 0.2);
          font-size: 14px;
          color: #ffe9a3;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
	        .modebar {
	          display: grid;
	          grid-template-columns: repeat(4, 1fr);
	          gap: 8px;
	          padding: 0 12px 8px 12px;
	        }
        .modebarBtn {
          padding: 6px 8px;
          border-radius: 10px;
          font-size: 14px;
          text-align: center;
        }
        .modebarBtn.selected {
          border-color: rgba(255,255,255,0.45);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2);
          font-weight: 700;
        }
        .hidden { display: none; }
        .body {
          padding: 10px 12px;
          overflow: auto;
          flex: 1 1 auto;
        }
        .modes {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 10px;
        }
        .modeBtn {
          text-align: left;
        }
        .modeLabel {
          display: block;
          font-weight: 700;
          margin-bottom: 2px;
        }
        .modeDesc {
          display: block;
          font-size: 14px;
          color: rgba(255,255,255,0.65);
        }
        .statusMessage {
          text-align: center;
        }
        .sectionTitle {
          font-size: 14px;
          font-weight: 700;
          margin: 10px 0 6px;
        }
        .kv {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 6px 10px;
          font-size: 14px;
        }
        .kv .k { color: rgba(0,0,0,0.7); }
        .kv .k { color: rgba(255,255,255,0.7); }
        .kv .v { color: rgba(255,255,255,0.92); }
        .summary {
          white-space: pre-wrap;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 14px;
          line-height: 1.45;
          border: 1px solid rgba(255,255,255,0.85);
          border-radius: 10px;
          padding: 10px;
          background: rgba(255,255,255,0.04);
        }
        .summaryNote {
          margin-top: 10px;
          font-size: 10px;
          color: rgba(255,255,255,0.7);
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .alert {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255, 196, 0, 0.35);
          background: rgba(255, 196, 0, 0.2);
          color: #ffe9a3;
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .note {
          margin-top: 10px;
          font-size: 12px;
          color: rgba(255,255,255,0.7);
          white-space: pre-wrap;
        }
        .footer {
          display: flex;
          gap: 8px;
          padding: 10px 12px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .footer .spacer { flex: 1; }
        .toast {
          position: absolute;
          bottom: 10px;
          right: 10px;
          padding: 8px 10px;
          border-radius: 10px;
          background: rgba(0,0,0,0.85);
          color: #fff;
          font-size: 14px;
        }
      `;
        }
        function el(tag, className) {
            const e = document.createElement(tag);
            if (className)
                e.className = className;
            return e;
        }
        function fmtUsd(n) {
            if (!Number.isFinite(n))
                return '-';
            return `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
        }
        function fmtInt(n) {
            if (!Number.isFinite(n))
                return '-';
            return `${Math.max(0, Math.floor(n))}`;
        }
        function fmtPct(n) {
            if (!Number.isFinite(n))
                return '-';
            return `${Math.round(n * 100)}%`;
        }
        function setText(node, text) {
            node.textContent = text;
        }
        function mount() {
            const host = document.createElement('div');
            host.id = AS.OVERLAY_CONTAINER_ID;
            host.style.position = 'fixed';
            host.style.top = '12px';
            host.style.right = '12px';
            host.style.zIndex = '2147483647';
            const shadow = host.attachShadow({ mode: 'open' });
            const style = document.createElement('style');
            style.textContent = css();
            const panel = el('div', 'panel');
            const header = el('div', 'header');
            const titleRow = el('div', 'titleRow');
            const titleLabel = el('div', 'title');
            titleLabel.id = 'as-title';
            setText(titleLabel, AS.t('panelTitle'));
            const settingsButton = el('button', 'iconButton');
            settingsButton.id = 'as-settings';
            settingsButton.setAttribute('aria-label', AS.t('buttonSettings'));
            settingsButton.textContent = '⚙';
            settingsButton.addEventListener('click', () => dispatch(host, 'as:openOptions'));
            const closeButton = el('button', 'close');
            closeButton.id = 'as-close';
            closeButton.setAttribute('aria-label', AS.t('closeAria'));
            closeButton.textContent = '×';
            closeButton.addEventListener('click', () => dispatch(host, 'as:close'));
            titleRow.appendChild(titleLabel);
            titleRow.appendChild(settingsButton);
            header.appendChild(titleRow);
            header.appendChild(closeButton);
            const meta = el('div', 'meta');
            const controls = el('div', 'controls');
            const langLabel = el('label');
            const langSpan = el('span');
            setText(langSpan, AS.t('labelLanguage'));
            const languageSelect = el('select');
            languageSelect.id = 'as-language';
            langLabel.appendChild(langSpan);
            langLabel.appendChild(languageSelect);
            controls.appendChild(langLabel);
            const banner = el('div', 'banner hidden');
            banner.id = 'as-banner';
            const modeBar = el('div', 'modebar hidden');
            modeBar.id = 'as-modebar';
            const body = el('div', 'body');
            body.id = 'as-body';
            const footer = el('div', 'footer');
            footer.id = 'as-footer';
            const toast = el('div', 'toast hidden');
            toast.id = 'as-toast';
            panel.appendChild(header);
            panel.appendChild(meta);
            panel.appendChild(controls);
            panel.appendChild(banner);
            panel.appendChild(modeBar);
            panel.appendChild(body);
            panel.appendChild(footer);
            shadow.appendChild(style);
            shadow.appendChild(panel);
            shadow.appendChild(toast);
            document.documentElement.appendChild(host);
            return {
                host,
                shadow,
                modeBar,
                body,
                footer,
                banner,
                toast,
                languageSelect,
                settingsButton,
                closeButton,
                titleLabel
            };
        }
        Overlay.mount = mount;
        function unmount(inst) {
            // Stop timers that might otherwise keep running after unmount.
            // (Important for CPU/memory: setInterval continues even if the DOM nodes are removed.)
            stopDots();
            if (toastTimer) {
                clearTimeout(toastTimer);
                toastTimer = null;
            }
            if (inst.toast) {
                inst.toast.classList.add('hidden');
                inst.toast.textContent = '';
            }
            if (inst.host && inst.host.parentNode)
                inst.host.parentNode.removeChild(inst.host);
        }
        Overlay.unmount = unmount;
        function setLanguageOptions(inst, optionLanguages, selected, preferredLanguages = []) {
            const select = inst.languageSelect;
            select.innerHTML = '';
            // Display names are nicer than raw BCP-47 codes (e.g., "English (en-US)").
            // Fallback to the code itself when Intl.DisplayNames is unavailable.
            const uiLang = AS.getUiLanguage();
            const langDisplay = (() => {
                try {
                    // @ts-ignore - DisplayNames may not exist in older environments.
                    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
                        // @ts-ignore
                        return new Intl.DisplayNames([uiLang], { type: 'language' });
                    }
                }
                catch {
                    // ignore
                }
                return null;
            })();
            const labelFor = (code) => {
                if (!code)
                    return '';
                const base = code.split('-')[0] || code;
                if (langDisplay) {
                    try {
                        // @ts-ignore
                        const name = langDisplay.of(base);
                        if (typeof name === 'string' && name.trim())
                            return name;
                    }
                    catch {
                        // ignore
                    }
                }
                if (base.toLowerCase() === 'ja')
                    return '日本語';
                if (base.toLowerCase() === 'en')
                    return '英語';
                return base;
            };
            const resolvedAuto = (() => {
                if (selected !== 'auto')
                    return '';
                if (preferredLanguages && preferredLanguages.length > 0)
                    return preferredLanguages[0];
                return navigator.language || 'en';
            })();
            const optAuto = document.createElement('option');
            optAuto.value = 'auto';
            optAuto.textContent = selected === 'auto' ? `${AS.t('languageAuto')} (${labelFor(resolvedAuto)})` : AS.t('languageAuto');
            select.appendChild(optAuto);
            const seen = new Set();
            for (const lang of optionLanguages) {
                const key = String(lang || '').trim();
                if (!key || seen.has(key))
                    continue;
                seen.add(key);
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = labelFor(key);
                select.appendChild(opt);
            }
            const desired = selected || 'auto';
            if (desired === 'auto') {
                select.value = 'auto';
            }
            else if (select.querySelector(`option[value="${CSS.escape(desired)}"]`)) {
                select.value = desired;
            }
            else {
                const desiredBase = desired.split('-')[0] || desired;
                const baseOption = Array.from(select.options).find((opt) => (opt.value || '').split('-')[0] === desiredBase);
                select.value = baseOption ? baseOption.value : 'auto';
            }
            // Make this idempotent (avoid duplicate listeners if setLanguageOptions is called again).
            select.onchange = () => dispatch(inst.host, 'as:language', { language: select.value });
        }
        Overlay.setLanguageOptions = setLanguageOptions;
        function setBanner(inst, text) {
            if (text && text.trim().length > 0) {
                inst.banner.classList.remove('hidden');
                inst.banner.textContent = text;
            }
            else {
                inst.banner.classList.add('hidden');
                inst.banner.textContent = '';
            }
        }
        Overlay.setBanner = setBanner;
        let toastTimer = null;
        function showToast(inst, text) {
            if (toastTimer)
                clearTimeout(toastTimer);
            inst.toast.classList.remove('hidden');
            inst.toast.textContent = text;
            toastTimer = setTimeout(() => {
                inst.toast.classList.add('hidden');
                inst.toast.textContent = '';
            }, 1600);
        }
        Overlay.showToast = showToast;
        let dotsTimer = null;
        function startDots(inst, base, targetEl) {
            stopDots();
            let dots = 0;
            dotsTimer = setInterval(() => {
                dots = (dots + 1) % 4;
                targetEl.textContent = base + '.'.repeat(dots);
            }, ANIM_DOTS_INTERVAL_MS);
        }
        function stopDots() {
            if (dotsTimer) {
                clearInterval(dotsTimer);
                dotsTimer = null;
            }
        }
        function clear(inst) {
            inst.body.innerHTML = '';
            inst.footer.innerHTML = '';
            stopDots();
        }
        function renderModeBar(inst, state) {
            const shouldShow = state.phase === 'DONE';
            if (!shouldShow) {
                inst.modeBar.classList.add('hidden');
                inst.modeBar.innerHTML = '';
                return;
            }
            inst.modeBar.classList.remove('hidden');
            inst.modeBar.innerHTML = '';
            for (const opt of AS.MODE_OPTIONS) {
                const btn = el('button', 'modebarBtn');
                setText(btn, AS.t(opt.labelKey));
                btn.title = AS.t(opt.descKey);
                btn.disabled = AS.isBusy(state);
                if (state.selectedMode === opt.mode) {
                    btn.classList.add('selected');
                }
                btn.addEventListener('click', () => dispatch(inst.host, 'as:mode', { mode: opt.mode }));
                inst.modeBar.appendChild(btn);
            }
        }
        function renderFooterButtons(inst, buttons) {
            inst.footer.innerHTML = '';
            for (const b of buttons) {
                const btn = el('button', b.primary ? 'primary' : '');
                setText(btn, AS.t(b.key));
                if (b.disabled)
                    btn.disabled = true;
                btn.addEventListener('click', () => dispatch(inst.host, b.event));
                inst.footer.appendChild(btn);
            }
        }
        function renderIdle(inst, state) {
            clear(inst);
            const p = el('div');
            setText(p, AS.t('promptChooseMode'));
            inst.body.appendChild(p);
            const modes = el('div', 'modes');
            for (const opt of AS.MODE_OPTIONS) {
                const btn = el('button', 'modeBtn');
                btn.dataset['mode'] = opt.mode;
                const label = el('span', 'modeLabel');
                setText(label, AS.t(opt.labelKey));
                const desc = el('span', 'modeDesc');
                setText(desc, AS.t(opt.descKey));
                btn.appendChild(label);
                btn.appendChild(desc);
                btn.addEventListener('click', () => dispatch(inst.host, 'as:mode', { mode: opt.mode }));
                modes.appendChild(btn);
            }
            inst.body.appendChild(modes);
            if (!state.apiKeySet) {
                const warn = el('div', 'alert');
                warn.style.marginTop = '10px';
                setText(warn, AS.t('warningApiKeyMissing'));
                inst.body.appendChild(warn);
            }
            renderFooterButtons(inst, []);
        }
        function renderExtracting(inst) {
            clear(inst);
            const msg = el('div', 'statusMessage');
            inst.body.appendChild(msg);
            startDots(inst, AS.t('statusExtracting'), msg);
            renderFooterButtons(inst, [{ key: 'buttonCancel', event: 'as:cancel' }]);
        }
        function renderPreflight(inst, state) {
            clear(inst);
            const title = el('div', 'sectionTitle');
            setText(title, AS.t('sectionEstimate'));
            inst.body.appendChild(title);
            const kv = el('div', 'kv');
            const add = (k, v) => {
                const kk = el('div', 'k');
                kk.textContent = k;
                const vv = el('div', 'v');
                vv.textContent = v;
                kv.appendChild(kk);
                kv.appendChild(vv);
            };
            add(AS.t('labelChars'), `${fmtInt(state.estimate.charCount)} (${AS.t('labelSendChars')}: ${fmtInt(state.estimate.sentCharCount)})`);
            const tok = state.estimate.tokenExact != null ? fmtInt(state.estimate.tokenExact) : `${fmtInt(state.estimate.tokenLow)} - ${fmtInt(state.estimate.tokenHigh)}`;
            add(AS.t('labelTokens'), tok + (state.refining ? ` (${AS.t('labelRefining')})` : ''));
            add(AS.t('labelCost'), `${fmtUsd(state.estimate.costLowUsd)} - ${fmtUsd(state.estimate.costHighUsd)} (${AS.t('labelWorst')}: ${fmtUsd(state.estimate.costWorstUsd)})`);
            add(AS.t('labelTime'), `${fmtInt(state.estimate.timeLowSec)} - ${fmtInt(state.estimate.timeHighSec)}s`);
            add(AS.t('labelModel'), state.estimate.model);
            add(AS.t('labelChunkCount'), fmtInt(state.estimate.chunkCount));
            add(AS.t('labelLinkDensity'), fmtPct(state.article.linkDensity));
            inst.body.appendChild(kv);
            if (state.estimate.truncated) {
                const note = el('div', 'note');
                setText(note, AS.t('noteTruncated'));
                inst.body.appendChild(note);
            }
            renderFooterButtons(inst, [
                { key: 'buttonCancel', event: 'as:cancel' },
                { key: 'buttonProceed', primary: true, event: 'as:proceed' }
            ]);
        }
        function renderConfirm(inst, state) {
            clear(inst);
            const p = el('div');
            setText(p, AS.t('promptApprovalRequired'));
            inst.body.appendChild(p);
            const kv = el('div', 'kv');
            const add = (k, v) => {
                const kk = el('div', 'k');
                kk.textContent = k;
                const vv = el('div', 'v');
                vv.textContent = v;
                kv.appendChild(kk);
                kv.appendChild(vv);
            };
            // Approval screen: show the full set requested (chars/tokens/cost/time).
            add(AS.t('labelChars'), fmtInt(state.article.charCount));
            add(AS.t('labelSendChars'), fmtInt(state.estimate.sentCharCount));
            const tok = state.estimate.tokenExact != null
                ? fmtInt(state.estimate.tokenExact)
                : `${fmtInt(state.estimate.tokenLow)} - ${fmtInt(state.estimate.tokenHigh)}`;
            add(AS.t('labelTokens'), tok);
            add(AS.t('labelCost'), `${fmtUsd(state.estimate.costLowUsd)} - ${fmtUsd(state.estimate.costHighUsd)} (${AS.t('labelWorst')}: ${fmtUsd(state.estimate.costWorstUsd)})`);
            add(AS.t('labelTime'), `${fmtInt(state.estimate.timeLowSec)} - ${fmtInt(state.estimate.timeHighSec)}s`);
            add(AS.t('labelModel'), state.estimate.model);
            add(AS.t('labelChunkCount'), fmtInt(state.estimate.chunkCount));
            inst.body.appendChild(kv);
            // What will be sent to Claude (privacy transparency).
            const sent = el('div', 'note');
            setText(sent, AS.t('noteDataSent'));
            inst.body.appendChild(sent);
            if (state.estimate.truncated) {
                const note = el('div', 'note');
                setText(note, AS.t('noteTruncated'));
                inst.body.appendChild(note);
            }
            if (state.note) {
                const note = el('div', 'note');
                setText(note, state.note);
                inst.body.appendChild(note);
            }
            renderFooterButtons(inst, [
                { key: 'buttonCancel', event: 'as:cancel' },
                { key: 'buttonRunLight', event: 'as:runLight' },
                { key: 'buttonRun', primary: true, event: 'as:run' }
            ]);
        }
        function renderSummarizing(inst, state) {
            clear(inst);
            const msg = el('div', 'statusMessage');
            inst.body.appendChild(msg);
            const p = state.progress;
            let label = AS.t('statusSummarizing');
            if (p?.stage === 'MAP') {
                label = AS.t('statusSummarizingMap');
                if (p.total && p.current !== undefined) {
                    label = `${label} (${p.current}/${p.total})`;
                }
            }
            else if (p?.stage === 'REDUCE') {
                label = AS.t('statusSummarizingReduce');
            }
            else if (p?.stage === 'REPAIR') {
                label = AS.t('statusSummarizingRepair');
            }
            startDots(inst, label, msg);
            renderFooterButtons(inst, [{ key: 'buttonCancel', event: 'as:cancel' }]);
        }
        function renderDone(inst, state) {
            clear(inst);
            const pre = el('div', 'summary');
            pre.textContent = state.summaryText;
            inst.body.appendChild(pre);
            const usage = state.usage;
            void usage;
            renderFooterButtons(inst, [
                { key: 'buttonCopy', primary: true, event: 'as:copy' },
            ]);
        }
        function renderError(inst, state) {
            clear(inst);
            const msg = el('div', 'alert');
            setText(msg, state.message);
            inst.body.appendChild(msg);
            renderFooterButtons(inst, [
                { key: 'buttonBack', event: 'as:reset' }
            ]);
        }
        function renderBlocked(inst, state) {
            clear(inst);
            const msg = el('div', 'alert');
            setText(msg, `${AS.t('errorBlocked')}${state.reason}`);
            inst.body.appendChild(msg);
            const kv = el('div', 'kv');
            const kk = el('div', 'k');
            kk.textContent = AS.t('labelCostWorst');
            const vv = el('div', 'v');
            vv.textContent = fmtUsd(state.estimate.costWorstUsd);
            kv.appendChild(kk);
            kv.appendChild(vv);
            inst.body.appendChild(kv);
            renderFooterButtons(inst, [
                { key: 'buttonBack', event: 'as:reset' },
                { key: 'buttonOpenOptions', event: 'as:openOptions' }
            ]);
        }
        function render(inst, state) {
            // Banner (non-blocking)
            setBanner(inst, state.banner);
            // Disable controls while busy (avoid surprise reruns during a run).
            const busy = AS.isBusy(state);
            inst.languageSelect.disabled = busy;
            inst.settingsButton.disabled = busy;
            renderModeBar(inst, state);
            if (state.phase === 'IDLE')
                return renderIdle(inst, state);
            if (state.phase === 'EXTRACTING')
                return renderExtracting(inst);
            if (state.phase === 'PREFLIGHT')
                return renderPreflight(inst, state);
            if (state.phase === 'CONFIRM')
                return renderConfirm(inst, state);
            if (state.phase === 'SUMMARIZING')
                return renderSummarizing(inst, state);
            if (state.phase === 'DONE')
                return renderDone(inst, state);
            if (state.phase === 'BLOCKED')
                return renderBlocked(inst, state);
            if (state.phase === 'ERROR')
                return renderError(inst, state);
        }
        Overlay.render = render;
    })(Overlay = AS.Overlay || (AS.Overlay = {}));
})(AS || (AS = {}));
