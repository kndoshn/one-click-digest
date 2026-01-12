namespace AS {
  export namespace Overlay {
    export type Instance = {
      host: HTMLDivElement;
      shadow: ShadowRoot;
	      modeBar: HTMLDivElement;
      body: HTMLDivElement;
      footer: HTMLDivElement;
      banner: HTMLDivElement;
      toast: HTMLDivElement;
      languageSelect: HTMLSelectElement;
      settingsButton: HTMLButtonElement;
      closeButton: HTMLButtonElement;
      titleLabel: HTMLDivElement;
    };

    const ANIM_DOTS_INTERVAL_MS = 450;

    function dispatch(host: HTMLDivElement, type: string, detail?: any): void {
      host.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
    }

    function css(): string {
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

    function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
      const e = document.createElement(tag);
      if (className) e.className = className;
      return e;
    }

    function fmtUsd(n: number): string {
      if (!Number.isFinite(n)) return '-';
      return `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
    }

    function fmtInt(n: number): string {
      if (!Number.isFinite(n)) return '-';
      return `${Math.max(0, Math.floor(n))}`;
    }

    function fmtPct(n: number): string {
      if (!Number.isFinite(n)) return '-';
      return `${Math.round(n * 100)}%`;
    }

    function setText(node: HTMLElement, text: string): void {
      node.textContent = text;
    }

    export function mount(): Instance {
      const host = document.createElement('div');
      host.id = OVERLAY_CONTAINER_ID;
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
      setText(titleLabel, t('panelTitle'));

      const settingsButton = el('button', 'iconButton') as HTMLButtonElement;
      settingsButton.id = 'as-settings';
      settingsButton.setAttribute('aria-label', t('buttonSettings'));
      settingsButton.textContent = '⚙';
      settingsButton.addEventListener('click', () => dispatch(host, 'as:openOptions'));

      const closeButton = el('button', 'close') as HTMLButtonElement;
      closeButton.id = 'as-close';
      closeButton.setAttribute('aria-label', t('closeAria'));
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
      setText(langSpan, t('labelLanguage'));
      const languageSelect = el('select') as HTMLSelectElement;
      languageSelect.id = 'as-language';
      langLabel.appendChild(langSpan);
      langLabel.appendChild(languageSelect);

      controls.appendChild(langLabel);

      const banner = el('div', 'banner hidden');
      banner.id = 'as-banner';

	      const modeBar = el('div', 'modebar hidden');
	      modeBar.id = 'as-modebar';

      const body = el('div', 'body') as HTMLDivElement;
      body.id = 'as-body';

      const footer = el('div', 'footer') as HTMLDivElement;
      footer.id = 'as-footer';

      const toast = el('div', 'toast hidden') as HTMLDivElement;
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

    export function unmount(inst: Instance): void {
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

      if (inst.host && inst.host.parentNode) inst.host.parentNode.removeChild(inst.host);
    }

    export function setLanguageOptions(
      inst: Instance,
      optionLanguages: string[],
      selected: string,
      preferredLanguages: string[] = []
    ): void {
      const select = inst.languageSelect;
      select.innerHTML = '';

      // Display names are nicer than raw BCP-47 codes (e.g., "English (en-US)").
      // Fallback to the code itself when Intl.DisplayNames is unavailable.
      const uiLang = getUiLanguage();

      const langDisplay = (() => {
        try {
          // @ts-ignore - DisplayNames may not exist in older environments.
          if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
            // @ts-ignore
            return new Intl.DisplayNames([uiLang], { type: 'language' });
          }
        } catch {
          // ignore
        }
        return null;
      })();

      const regionDisplay = (() => {
        try {
          // @ts-ignore - DisplayNames may not exist in older environments.
          if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
            // @ts-ignore
            return new Intl.DisplayNames([uiLang], { type: 'region' });
          }
        } catch {
          // ignore
        }
        return null;
      })();

      const labelFor = (code: string): string => {
        if (!code) return '';
        const parts = code.split('-');
        const base = parts[0] || code;
        const region = parts[1];
        if (langDisplay) {
          try {
            // @ts-ignore
            const name = langDisplay.of(base);
            if (typeof name === 'string' && name.trim()) {
              if (region && regionDisplay) {
                try {
                  // @ts-ignore
                  const regionName = regionDisplay.of(region.toUpperCase());
                  if (typeof regionName === 'string' && regionName.trim()) return `${name} (${regionName})`;
                } catch {
                  // ignore
                }
              }
              return name;
            }
          } catch {
            // ignore
          }
        }
        if (base.toLowerCase() === 'ja') return '日本語';
        if (base.toLowerCase() === 'en') return '英語';
        return base;
      };

      const resolvedAuto = (() => {
        if (selected !== 'auto') return '';
        if (preferredLanguages && preferredLanguages.length > 0) return preferredLanguages[0];
        return navigator.language || 'en';
      })();

      const optAuto = document.createElement('option');
      optAuto.value = 'auto';
      optAuto.textContent = selected === 'auto' ? `${t('languageAuto')} (${labelFor(resolvedAuto)})` : t('languageAuto');
      select.appendChild(optAuto);

      const seen = new Set<string>();
      for (const lang of optionLanguages) {
        const key = String(lang || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = labelFor(key);
        select.appendChild(opt);
      }

      const desired = selected || 'auto';
      if (desired === 'auto') {
        select.value = 'auto';
      } else if (select.querySelector(`option[value="${CSS.escape(desired)}"]`)) {
        select.value = desired;
      } else {
        const desiredBase = desired.split('-')[0] || desired;
        const baseOption = Array.from(select.options).find((opt) => (opt.value || '').split('-')[0] === desiredBase);
        select.value = baseOption ? baseOption.value : 'auto';
      }

      // Make this idempotent (avoid duplicate listeners if setLanguageOptions is called again).
      select.onchange = () => dispatch(inst.host, 'as:language', { language: select.value });
    }

    export function setBanner(inst: Instance, text?: string): void {
      if (text && text.trim().length > 0) {
        inst.banner.classList.remove('hidden');
        inst.banner.textContent = text;
      } else {
        inst.banner.classList.add('hidden');
        inst.banner.textContent = '';
      }
    }

    let toastTimer: any = null;
    export function showToast(inst: Instance, text: string): void {
      if (toastTimer) clearTimeout(toastTimer);
      inst.toast.classList.remove('hidden');
      inst.toast.textContent = text;
      toastTimer = setTimeout(() => {
        inst.toast.classList.add('hidden');
        inst.toast.textContent = '';
      }, 1600);
    }

    let dotsTimer: any = null;
    function startDots(inst: Instance, base: string, targetEl: HTMLElement): void {
      stopDots();
      let dots = 0;
      dotsTimer = setInterval(() => {
        dots = (dots + 1) % 4;
        targetEl.textContent = base + '.'.repeat(dots);
      }, ANIM_DOTS_INTERVAL_MS);
    }

    function stopDots(): void {
      if (dotsTimer) {
        clearInterval(dotsTimer);
        dotsTimer = null;
      }
    }

    function clear(inst: Instance): void {
      inst.body.innerHTML = '';
      inst.footer.innerHTML = '';
      stopDots();
    }

	    function renderModeBar(inst: Instance, state: UiState): void {
	      const shouldShow = state.phase === 'DONE';
	      if (!shouldShow) {
	        inst.modeBar.classList.add('hidden');
	        inst.modeBar.innerHTML = '';
	        return;
	      }

	      inst.modeBar.classList.remove('hidden');
	      inst.modeBar.innerHTML = '';

	      for (const opt of MODE_OPTIONS) {
	        const btn = el('button', 'modebarBtn') as HTMLButtonElement;
	        setText(btn, t(opt.labelKey));
	        btn.title = t(opt.descKey);
	        btn.disabled = isBusy(state);
	        if (state.selectedMode === opt.mode) {
	          btn.classList.add('selected');
	        }
	        btn.addEventListener('click', () => dispatch(inst.host, 'as:mode', { mode: opt.mode }));
	        inst.modeBar.appendChild(btn);
	      }
	    }

    function renderFooterButtons(inst: Instance, buttons: Array<{ key: string; primary?: boolean; disabled?: boolean; event: string }>): void {
      inst.footer.innerHTML = '';
      for (const b of buttons) {
        const btn = el('button', b.primary ? 'primary' : '') as HTMLButtonElement;
        setText(btn, t(b.key));
        if (b.disabled) btn.disabled = true;
        btn.addEventListener('click', () => dispatch(inst.host, b.event));
        inst.footer.appendChild(btn);
      }
    }

    function renderIdle(inst: Instance, state: IdleState): void {
      clear(inst);

      const p = el('div');
      setText(p, t('promptChooseMode'));
      inst.body.appendChild(p);

      const modes = el('div', 'modes');
      for (const opt of MODE_OPTIONS) {
        const btn = el('button', 'modeBtn') as HTMLButtonElement;
        btn.dataset['mode'] = opt.mode;
        const label = el('span', 'modeLabel');
        setText(label, t(opt.labelKey));
        const desc = el('span', 'modeDesc');
        setText(desc, t(opt.descKey));
        btn.appendChild(label);
        btn.appendChild(desc);
        btn.addEventListener('click', () => dispatch(inst.host, 'as:mode', { mode: opt.mode }));
        modes.appendChild(btn);
      }
      inst.body.appendChild(modes);

      if (!state.apiKeySet) {
        const warn = el('div', 'alert');
        warn.style.marginTop = '10px';
        setText(warn, t('warningApiKeyMissing'));
        inst.body.appendChild(warn);
      }

      renderFooterButtons(inst, []);
    }

    function renderExtracting(inst: Instance): void {
      clear(inst);
      const msg = el('div', 'statusMessage');
      inst.body.appendChild(msg);
      startDots(inst, t('statusExtracting'), msg);
      renderFooterButtons(inst, [{ key: 'buttonCancel', event: 'as:cancel' }]);
    }

    function renderPreflight(inst: Instance, state: PreflightState): void {
      clear(inst);

      const title = el('div', 'sectionTitle');
      setText(title, t('sectionEstimate'));
      inst.body.appendChild(title);

      const kv = el('div', 'kv');
      const add = (k: string, v: string) => {
        const kk = el('div', 'k');
        kk.textContent = k;
        const vv = el('div', 'v');
        vv.textContent = v;
        kv.appendChild(kk);
        kv.appendChild(vv);
      };

      add(t('labelChars'), `${fmtInt(state.estimate.charCount)} (${t('labelSendChars')}: ${fmtInt(state.estimate.sentCharCount)})`);
      const tok = state.estimate.tokenExact != null ? fmtInt(state.estimate.tokenExact) : `${fmtInt(state.estimate.tokenLow)} - ${fmtInt(state.estimate.tokenHigh)}`;
      add(t('labelTokens'), tok + (state.refining ? ` (${t('labelRefining')})` : ''));
      add(t('labelCost'), `${fmtUsd(state.estimate.costLowUsd)} - ${fmtUsd(state.estimate.costHighUsd)} (${t('labelWorst')}: ${fmtUsd(state.estimate.costWorstUsd)})`);
      add(t('labelTime'), `${fmtInt(state.estimate.timeLowSec)} - ${fmtInt(state.estimate.timeHighSec)}s`);
      add(t('labelModel'), state.estimate.model);
      add(t('labelChunkCount'), fmtInt(state.estimate.chunkCount));
      add(t('labelLinkDensity'), fmtPct(state.article.linkDensity));

      inst.body.appendChild(kv);

      if (state.estimate.truncated) {
        const note = el('div', 'note');
        setText(note, t('noteTruncated'));
        inst.body.appendChild(note);
      }

      renderFooterButtons(inst, [
        { key: 'buttonCancel', event: 'as:cancel' },
        { key: 'buttonProceed', primary: true, event: 'as:proceed' }
      ]);
    }

    function renderConfirm(inst: Instance, state: ConfirmState): void {
      clear(inst);

      const p = el('div');
      setText(p, t('promptApprovalRequired'));
      inst.body.appendChild(p);

      const kv = el('div', 'kv');
      const add = (k: string, v: string) => {
        const kk = el('div', 'k');
        kk.textContent = k;
        const vv = el('div', 'v');
        vv.textContent = v;
        kv.appendChild(kk);
        kv.appendChild(vv);
      };

      // Approval screen: show the full set requested (chars/tokens/cost/time).
      add(t('labelChars'), fmtInt(state.article.charCount));
      add(t('labelSendChars'), fmtInt(state.estimate.sentCharCount));
      const tok = state.estimate.tokenExact != null
        ? fmtInt(state.estimate.tokenExact)
        : `${fmtInt(state.estimate.tokenLow)} - ${fmtInt(state.estimate.tokenHigh)}`;
      add(t('labelTokens'), tok);
      add(t('labelCost'), `${fmtUsd(state.estimate.costLowUsd)} - ${fmtUsd(state.estimate.costHighUsd)} (${t('labelWorst')}: ${fmtUsd(state.estimate.costWorstUsd)})`);
      add(t('labelTime'), `${fmtInt(state.estimate.timeLowSec)} - ${fmtInt(state.estimate.timeHighSec)}s`);
      add(t('labelModel'), state.estimate.model);
      add(t('labelChunkCount'), fmtInt(state.estimate.chunkCount));
      inst.body.appendChild(kv);

      // What will be sent to Claude (privacy transparency).
      const sent = el('div', 'note');
      setText(sent, t('noteDataSent'));
      inst.body.appendChild(sent);

      if (state.estimate.truncated) {
        const note = el('div', 'note');
        setText(note, t('noteTruncated'));
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

    function renderSummarizing(inst: Instance, state: SummarizingState): void {
      clear(inst);
      const msg = el('div', 'statusMessage');
      inst.body.appendChild(msg);
      const p = state.progress;
      let label = t('statusSummarizing');
      if (p?.stage === 'MAP') {
        label = t('statusSummarizingMap');
        if (p.total && p.current !== undefined) {
          label = `${label} (${p.current}/${p.total})`;
        }
      } else if (p?.stage === 'REDUCE') {
        label = t('statusSummarizingReduce');
      } else if (p?.stage === 'REPAIR') {
        label = t('statusSummarizingRepair');
      }
      startDots(inst, label, msg);
      renderFooterButtons(inst, [{ key: 'buttonCancel', event: 'as:cancel' }]);
    }

    function renderDone(inst: Instance, state: DoneState): void {
      clear(inst);

      const pre = el('div', 'summary');
      pre.textContent = state.summaryText;
      inst.body.appendChild(pre);

      renderFooterButtons(inst, [
        { key: 'buttonCopy', primary: true, event: 'as:copy' },
      ]);
    }

    function renderError(inst: Instance, state: ErrorState): void {
      clear(inst);

      const msg = el('div', 'alert');
      setText(msg, state.message);
      inst.body.appendChild(msg);

      renderFooterButtons(inst, [
        { key: 'buttonBack', event: 'as:reset' }
      ]);
    }

    function renderBlocked(inst: Instance, state: BlockedState): void {
      clear(inst);

      const msg = el('div', 'alert');
      setText(msg, `${t('errorBlocked')}${state.reason}`);
      inst.body.appendChild(msg);

      const kv = el('div', 'kv');
      const kk = el('div', 'k');
      kk.textContent = t('labelCostWorst');
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

    export function render(inst: Instance, state: UiState): void {
      // Banner (non-blocking)
      setBanner(inst, state.banner);

      // Disable controls while busy (avoid surprise reruns during a run).
      const busy = isBusy(state);
      inst.languageSelect.disabled = busy;
      inst.settingsButton.disabled = busy;
	      renderModeBar(inst, state);

      if (state.phase === 'IDLE') return renderIdle(inst, state);
      if (state.phase === 'EXTRACTING') return renderExtracting(inst);
      if (state.phase === 'PREFLIGHT') return renderPreflight(inst, state);
      if (state.phase === 'CONFIRM') return renderConfirm(inst, state);
      if (state.phase === 'SUMMARIZING') return renderSummarizing(inst, state);
      if (state.phase === 'DONE') return renderDone(inst, state);
      if (state.phase === 'BLOCKED') return renderBlocked(inst, state);
      if (state.phase === 'ERROR') return renderError(inst, state);
    }
  }
}
