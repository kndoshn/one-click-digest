import type { BulletStyle } from '../shared/types.ts';
import { parseBulletStyle } from '../shared/settings.ts';
import { getUiLanguage, t } from './i18n.ts';
import {
  type BlockedState,
  BULLET_STYLE_OPTIONS,
  type ConfirmState,
  type DoneState,
  type ErrorState,
  type IdleState,
  isBusy,
  MODE_OPTIONS,
  type PreflightState,
  type SummarizingState,
  type UiState,
  type CostEstimate
} from './models.ts';
import { OVERLAY_CONTAINER_ID } from './runtime.ts';
import * as Format from './format.ts';

export type Instance = {
  // In the page DOM: page scripts can see it and dispatch events on it.
  host: HTMLDivElement;
  // UI events (as:*) for the controller. Not reachable from the page, unlike the host element:
  // with the closed shadow root this keeps page scripts from starting or approving runs.
  events: EventTarget;
  shadow: ShadowRoot;
  modeBar: HTMLDivElement;
  body: HTMLDivElement;
  footer: HTMLDivElement;
  banner: HTMLDivElement;
  toast: HTMLDivElement;
  backdrop: HTMLDivElement;
  languageSelect: HTMLSelectElement;
  settingsButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  titleLabel: HTMLDivElement;
};

const ANIM_DOTS_INTERVAL_MS = 450;

function dispatch(target: EventTarget, type: string, detail?: any): void {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

function css(): string {
  return `
    :host { all: initial; }
    .panel {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: #141414;
      border: 1px solid rgba(255,255,255,0.9);
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
    .modebarBtn.selected,
    .bulletStyleBtn.selected {
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
      font-size: 15px;
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
    .bulletStyles {
      display: flex;
      gap: 4px;
    }
    .bulletStyleBtn {
      min-width: 36px;
      padding: 6px 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
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
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: -1;
    }
    .backdrop[data-busy="true"] {
      pointer-events: none;
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

function fmtTokens(estimate: CostEstimate): string {
  return estimate.tokenExact != null
    ? fmtInt(estimate.tokenExact)
    : `${fmtInt(estimate.tokenLow)} - ${fmtInt(estimate.tokenHigh)}`;
}

function fmtCostRange(estimate: CostEstimate): string {
  return `${fmtUsd(estimate.costLowUsd)} - ${fmtUsd(estimate.costHighUsd)} (${t('labelWorst')}: ${fmtUsd(estimate.costWorstUsd)})`;
}

function fmtTimeRange(estimate: CostEstimate): string {
  return `${fmtInt(estimate.timeLowSec)} - ${fmtInt(estimate.timeHighSec)}s`;
}

// Appends a two-column key/value grid.
function appendKv(parent: HTMLElement, rows: Array<[string, string]>): void {
  const kv = el('div', 'kv');
  for (const [k, v] of rows) {
    const kk = el('div', 'k');
    kk.textContent = k;
    const vv = el('div', 'v');
    vv.textContent = v;
    kv.appendChild(kk);
    kv.appendChild(vv);
  }
  parent.appendChild(kv);
}

function appendNote(parent: HTMLElement, text: string): void {
  const note = el('div', 'note');
  setText(note, text);
  parent.appendChild(note);
}

function createDisplayNames(locale: string, type: 'language' | 'region'): Intl.DisplayNames | null {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      return new Intl.DisplayNames([locale], { type });
    }
  } catch {
    // ignore
  }
  return null;
}

export function mount(): Instance {
  const host = document.createElement('div');
  host.id = OVERLAY_CONTAINER_ID;
  host.style.position = 'fixed';
  host.style.top = '12px';
  host.style.right = '12px';
  host.style.zIndex = '2147483647';

  const events = new EventTarget();
  // Closed: page scripts cannot reach the controls through host.shadowRoot.
  const shadow = host.attachShadow({ mode: 'closed' });

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
  settingsButton.addEventListener('click', () => dispatch(events, 'as:openOptions'));

  const closeButton = el('button', 'close') as HTMLButtonElement;
  closeButton.id = 'as-close';
  closeButton.setAttribute('aria-label', t('closeAria'));
  closeButton.textContent = '×';
  closeButton.addEventListener('click', () => dispatch(events, 'as:close'));

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

  const backdrop = el('div', 'backdrop') as HTMLDivElement;
  backdrop.addEventListener('click', () => dispatch(events, 'as:close'));

  panel.appendChild(header);
  panel.appendChild(meta);
  panel.appendChild(controls);
  panel.appendChild(banner);
  panel.appendChild(modeBar);
  panel.appendChild(body);
  panel.appendChild(footer);

  shadow.appendChild(style);
  shadow.appendChild(backdrop);
  shadow.appendChild(panel);
  shadow.appendChild(toast);

  document.documentElement.appendChild(host);

  return {
    host,
    events,
    shadow,
    modeBar,
    body,
    footer,
    banner,
    toast,
    backdrop,
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
  const langDisplay = createDisplayNames(uiLang, 'language');
  const regionDisplay = createDisplayNames(uiLang, 'region');

  const labelFor = (code: string): string => {
    if (!code) return '';
    const parts = code.split('-');
    const base = parts[0] || code;
    const region = parts[1];
    if (langDisplay) {
      try {
        const name = langDisplay.of(base);
        if (typeof name === 'string' && name.trim()) {
          if (region && regionDisplay) {
            try {
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
  select.onchange = () => dispatch(inst.events, 'as:language', { language: select.value });
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
function startDots(base: string, targetEl: HTMLElement): void {
  stopDots();
  let dots = 0;
  // Show the label right away; the interval only adds the dots.
  targetEl.textContent = base;
  dotsTimer = setInterval(() => {
    // The overlay can be removed without unmount() (removeExistingOverlay on re-injection,
    // whose fresh Overlay functions cannot reach this timer); stop instead of animating a
    // detached node forever.
    if (!targetEl.isConnected) {
      stopDots();
      return;
    }
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
    btn.addEventListener('click', () => dispatch(inst.events, 'as:mode', { mode: opt.mode }));
    inst.modeBar.appendChild(btn);
  }
}

// `trailing` is pushed to the right edge of the footer.
function renderFooterButtons(
  inst: Instance,
  buttons: Array<{ key: string; primary?: boolean; disabled?: boolean; event: string }>,
  trailing?: HTMLElement
): void {
  inst.footer.innerHTML = '';
  for (const b of buttons) {
    const btn = el('button', b.primary ? 'primary' : '') as HTMLButtonElement;
    setText(btn, t(b.key));
    if (b.disabled) btn.disabled = true;
    btn.addEventListener('click', () => dispatch(inst.events, b.event));
    inst.footer.appendChild(btn);
  }
  if (trailing) {
    inst.footer.appendChild(el('div', 'spacer'));
    inst.footer.appendChild(trailing);
  }
}

function bulletStyleBar(inst: Instance, selected: BulletStyle): HTMLElement {
  const bar = el('div', 'bulletStyles');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', t('labelBulletStyle'));
  for (const opt of BULLET_STYLE_OPTIONS) {
    const btn = el('button', 'bulletStyleBtn') as HTMLButtonElement;
    setText(btn, opt.marker);
    btn.title = t(opt.labelKey);
    btn.setAttribute('aria-label', t(opt.labelKey));
    const isSelected = opt.style === selected;
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    if (isSelected) btn.classList.add('selected');
    btn.addEventListener('click', () => dispatch(inst.events, 'as:bulletStyle', { style: opt.style }));
    bar.appendChild(btn);
  }
  return bar;
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
    btn.addEventListener('click', () => dispatch(inst.events, 'as:mode', { mode: opt.mode }));
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
  startDots(t('statusExtracting'), msg);
  renderFooterButtons(inst, [{ key: 'buttonCancel', event: 'as:cancel' }]);
}

function renderPreflight(inst: Instance, state: PreflightState): void {
  clear(inst);

  const title = el('div', 'sectionTitle');
  setText(title, t('sectionEstimate'));
  inst.body.appendChild(title);

  const e = state.estimate;
  appendKv(inst.body, [
    [t('labelChars'), `${fmtInt(e.charCount)} (${t('labelSendChars')}: ${fmtInt(e.sentCharCount)})`],
    [t('labelTokens'), fmtTokens(e) + (state.refining ? ` (${t('labelRefining')})` : '')],
    [t('labelCost'), fmtCostRange(e)],
    [t('labelTime'), fmtTimeRange(e)],
    [t('labelModel'), e.model],
    [t('labelChunkCount'), fmtInt(e.chunkCount)],
    [t('labelLinkDensity'), fmtPct(state.article.linkDensity)]
  ]);

  if (e.truncated) appendNote(inst.body, t('noteTruncated'));

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

  // Approval screen: show the full set requested (chars/tokens/cost/time).
  const e = state.estimate;
  appendKv(inst.body, [
    [t('labelChars'), fmtInt(state.article.charCount)],
    [t('labelSendChars'), fmtInt(e.sentCharCount)],
    [t('labelTokens'), fmtTokens(e)],
    [t('labelCost'), fmtCostRange(e)],
    [t('labelTime'), fmtTimeRange(e)],
    [t('labelModel'), e.model],
    [t('labelChunkCount'), fmtInt(e.chunkCount)]
  ]);

  // What will be sent to Claude (privacy transparency).
  appendNote(inst.body, t('noteDataSent'));
  if (e.truncated) appendNote(inst.body, t('noteTruncated'));
  if (state.note) appendNote(inst.body, state.note);

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
  startDots(label, msg);
  renderFooterButtons(inst, [{ key: 'buttonCancel', event: 'as:cancel' }]);
}

function renderDone(inst: Instance, state: DoneState): void {
  clear(inst);

  const bulletStyle = parseBulletStyle(state.bulletStyle);
  const pre = el('div', 'summary');
  pre.textContent = Format.applyBulletStyle(state.summaryText, bulletStyle);
  inst.body.appendChild(pre);

  renderFooterButtons(
    inst,
    [{ key: 'buttonCopy', primary: true, event: 'as:copy' }],
    bulletStyleBar(inst, bulletStyle)
  );
}

function renderError(inst: Instance, state: ErrorState): void {
  clear(inst);

  const msg = el('div', 'alert');
  setText(msg, state.message);
  inst.body.appendChild(msg);

  renderFooterButtons(inst, [{ key: 'buttonBack', event: 'as:reset' }]);
}

function renderBlocked(inst: Instance, state: BlockedState): void {
  clear(inst);

  const msg = el('div', 'alert');
  setText(msg, `${t('errorBlocked')}${state.reason}`);
  inst.body.appendChild(msg);

  appendKv(inst.body, [[t('labelCostWorst'), fmtUsd(state.estimate.costWorstUsd)]]);

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
  inst.backdrop.dataset['busy'] = busy ? 'true' : 'false';
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
