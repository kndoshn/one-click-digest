// Overlay behavior (dist/content/overlay.js) in a fake DOM with fake timers: what each phase
// renders, which events its controls dispatch, and that animation/toast timers are cleaned up.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CustomEventPolyfill, createClassicContext, runClassicScripts } from './helpers/classic_context.js';
import { FakeDocument } from './helpers/fake_dom.js';

function fakeTimers() {
  let nextId = 1;
  const intervals = new Map();
  const timeouts = new Map();
  return {
    intervals,
    timeouts,
    setInterval: (fn) => {
      const id = nextId++;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn) => {
      const id = nextId++;
      timeouts.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
    tickIntervals() {
      for (const fn of [...intervals.values()]) fn();
    },
    runTimeouts() {
      for (const [id, fn] of [...timeouts]) {
        timeouts.delete(id);
        fn();
      }
    }
  };
}

function setup() {
  const doc = new FakeDocument();
  const timers = fakeTimers();
  const ctx = createClassicContext({
    document: doc,
    navigator: { language: 'en-US' },
    chrome: { i18n: { getMessage: (k) => k, getUILanguage: () => 'en-US' } },
    CustomEvent: CustomEventPolyfill,
    CSS: { escape: (s) => String(s).replace(/["\\]/g, '\\$&') },
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  });
  runClassicScripts(ctx, [
    'dist/content/runtime.js',
    'dist/content/i18n.js',
    'dist/content/models.js',
    'dist/content/format.js',
    'dist/content/overlay.js'
  ]);
  const AS = ctx.AS;
  const inst = AS.Overlay.mount();
  const events = [];
  for (const type of ['as:close', 'as:openOptions', 'as:cancel', 'as:reset', 'as:copy', 'as:proceed', 'as:run', 'as:runLight', 'as:mode', 'as:language', 'as:bulletStyle']) {
    inst.events.addEventListener(type, (ev) => events.push([type, ev.detail == null ? null : JSON.parse(JSON.stringify(ev.detail))]));
  }
  const hostEvents = [];
  for (const type of ['as:close', 'as:openOptions', 'as:cancel', 'as:reset', 'as:copy', 'as:proceed', 'as:run', 'as:runLight', 'as:mode', 'as:language', 'as:bulletStyle']) {
    inst.host.addEventListener(type, () => hostEvents.push(type));
  }
  return { AS, doc, inst, timers, events, hostEvents };
}

const footerButtons = (inst) => inst.footer.children.map((b) => b.textContent);
const clickFooter = (inst, label) => inst.footer.children.find((b) => b.textContent === label).click();

function kvRows(container) {
  const cells = container.querySelector('.kv').children.map((c) => c.textContent);
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push([cells[i], cells[i + 1]]);
  return rows;
}

const ARTICLE = { ok: true, title: 'T', url: 'u', text: 'x', charCount: 12_345, linkDensity: 0.104 };
const ESTIMATE = {
  charCount: 12_345,
  tokenLow: 2000,
  tokenHigh: 3000.7,
  chunkCount: 1,
  costLowUsd: 0.0123,
  costHighUsd: 0.25,
  costWorstUsd: 0.5,
  timeLowSec: 4,
  timeHighSec: 26,
  model: 'claude-haiku-5-5',
  mapModel: 'claude-haiku-5-5',
  finalModel: 'claude-sonnet-5-5',
  maxOutputTokens: 700,
  truncated: false,
  sentCharCount: 12_000
};
const base = { selectedLanguage: 'auto', selectedMode: 'BULLETS_5', apiKeySet: true };

test('mount attaches a shadow-DOM overlay with header controls and a backdrop', () => {
  const { AS, doc, inst, events } = setup();
  assert.equal(doc.getElementById(AS.OVERLAY_CONTAINER_ID), inst.host);
  assert.equal(inst.host.style.position, 'fixed');
  assert.equal(inst.host.style.zIndex, '2147483647');
  assert.ok(inst.shadow.children.some((c) => c.tagName === 'STYLE'));
  assert.equal(inst.settingsButton.getAttribute('aria-label'), 'buttonSettings');

  inst.settingsButton.click();
  inst.closeButton.click();
  inst.backdrop.click();
  assert.deepEqual(events, [
    ['as:openOptions', null],
    ['as:close', null],
    ['as:close', null]
  ]);
});

test('IDLE: mode buttons start a run; a missing API key shows a warning', () => {
  const { AS, inst, events } = setup();
  AS.Overlay.render(inst, { ...base, phase: 'IDLE', apiKeySet: false });

  const modeButtons = inst.body.querySelectorAll('.modeBtn');
  assert.deepEqual(
    modeButtons.map((b) => b.dataset.mode),
    ['BULLETS_3', 'BULLETS_5', 'BULLETS_10', 'TLDR_12_CONCLUSION']
  );
  assert.equal(modeButtons[0].textContent, 'mode3Labelmode3Desc');
  assert.equal(inst.body.querySelector('.alert').textContent, 'warningApiKeyMissing');
  assert.deepEqual(footerButtons(inst), []);
  assert.equal(inst.languageSelect.disabled, false);
  assert.equal(inst.settingsButton.disabled, false);
  assert.equal(inst.backdrop.dataset.busy, 'false');
  assert.equal(inst.modeBar.classList.contains('hidden'), true);

  modeButtons[3].click();
  assert.deepEqual(events, [['as:mode', { mode: 'TLDR_12_CONCLUSION' }]]);

  AS.Overlay.render(inst, { ...base, phase: 'IDLE' });
  assert.equal(inst.body.querySelector('.alert'), null);
});

test('busy phases disable the language select and settings button and let clicks through the backdrop', () => {
  const { AS, inst, events } = setup();
  AS.Overlay.render(inst, { ...base, phase: 'EXTRACTING', runId: 'r' });
  assert.equal(inst.languageSelect.disabled, true);
  assert.equal(inst.settingsButton.disabled, true);
  assert.equal(inst.backdrop.dataset.busy, 'true');
  assert.deepEqual(footerButtons(inst), ['buttonCancel']);
  clickFooter(inst, 'buttonCancel');
  assert.deepEqual(events, [['as:cancel', null]]);

  // A disabled control does not fire.
  inst.settingsButton.click();
  assert.equal(events.length, 1);
});

test('PREFLIGHT: estimate rows and Cancel/Proceed', () => {
  const { AS, inst, events } = setup();
  AS.Overlay.render(inst, { ...base, phase: 'PREFLIGHT', runId: 'r', article: ARTICLE, estimate: ESTIMATE, refining: true });

  assert.equal(inst.body.querySelector('.sectionTitle').textContent, 'sectionEstimate');
  assert.deepEqual(kvRows(inst.body), [
    ['labelChars', '12345 (labelSendChars: 12000)'],
    ['labelTokens', '2000 - 3000 (labelRefining)'],
    ['labelCost', '$0.012 - $0.25 (labelWorst: $0.50)'],
    ['labelTime', '4 - 26s'],
    ['labelModel', 'claude-haiku-5-5'],
    ['labelChunkCount', '1'],
    ['labelLinkDensity', '10%']
  ]);
  assert.equal(inst.body.querySelector('.note'), null);
  assert.deepEqual(footerButtons(inst), ['buttonCancel', 'buttonProceed']);
  assert.equal(inst.footer.children[1].classList.contains('primary'), true);
  clickFooter(inst, 'buttonProceed');
  assert.deepEqual(events, [['as:proceed', null]]);

  // Exact tokens, truncation note, and non-finite values.
  AS.Overlay.render(inst, {
    ...base,
    phase: 'PREFLIGHT',
    runId: 'r',
    article: { ...ARTICLE, linkDensity: NaN },
    estimate: { ...ESTIMATE, tokenExact: 2500, truncated: true, costHighUsd: Infinity },
    refining: false
  });
  const rows = Object.fromEntries(kvRows(inst.body));
  assert.equal(rows.labelTokens, '2500');
  assert.equal(rows.labelCost, '$0.012 - - (labelWorst: $0.50)');
  assert.equal(rows.labelLinkDensity, '-');
  assert.equal(inst.body.querySelector('.note').textContent, 'noteTruncated');
});

test('CONFIRM: approval details, data-sent note, and Cancel/Run light/Run', () => {
  const { AS, inst, events } = setup();
  AS.Overlay.render(inst, {
    ...base,
    phase: 'CONFIRM',
    runId: 'r',
    article: ARTICLE,
    estimate: { ...ESTIMATE, chunkCount: 3, truncated: true },
    note: 'noteChunking'
  });

  assert.equal(inst.body.children[0].textContent, 'promptApprovalRequired');
  assert.deepEqual(kvRows(inst.body).map(([k]) => k), [
    'labelChars',
    'labelSendChars',
    'labelTokens',
    'labelCost',
    'labelTime',
    'labelModel',
    'labelChunkCount'
  ]);
  assert.deepEqual(
    inst.body.querySelectorAll('.note').map((n) => n.textContent),
    ['noteDataSent', 'noteTruncated', 'noteChunking']
  );
  assert.deepEqual(footerButtons(inst), ['buttonCancel', 'buttonRunLight', 'buttonRun']);
  clickFooter(inst, 'buttonRunLight');
  clickFooter(inst, 'buttonRun');
  assert.deepEqual(events, [
    ['as:runLight', null],
    ['as:run', null]
  ]);
});

test('SUMMARIZING: progress label per stage, animated dots, Cancel', () => {
  const { AS, inst, timers } = setup();
  const render = (progress) => {
    AS.Overlay.render(inst, { ...base, phase: 'SUMMARIZING', runId: 'r', article: ARTICLE, estimate: ESTIMATE, progress });
    return inst.body.querySelector('.statusMessage');
  };

  assert.equal(render(undefined).textContent, 'statusSummarizing');
  assert.equal(render({ stage: 'SINGLE' }).textContent, 'statusSummarizing');
  assert.equal(render({ stage: 'MAP', current: 2, total: 5 }).textContent, 'statusSummarizingMap (2/5)');
  assert.equal(render({ stage: 'MAP' }).textContent, 'statusSummarizingMap');
  assert.equal(render({ stage: 'REDUCE' }).textContent, 'statusSummarizingReduce');
  const msg = render({ stage: 'REPAIR' });
  assert.equal(msg.textContent, 'statusSummarizingRepair');
  assert.deepEqual(footerButtons(inst), ['buttonCancel']);

  // Each render replaces the previous animation: exactly one interval is alive.
  assert.equal(timers.intervals.size, 1);
  timers.tickIntervals();
  timers.tickIntervals();
  assert.equal(msg.textContent, 'statusSummarizingRepair..');
  timers.tickIntervals();
  timers.tickIntervals();
  assert.equal(msg.textContent, 'statusSummarizingRepair');
});

test('DONE: the summary, Copy, and a mode bar that re-runs in another mode', () => {
  const { AS, inst, events, timers } = setup();
  AS.Overlay.render(inst, { ...base, phase: 'SUMMARIZING', runId: 'r', article: ARTICLE, estimate: ESTIMATE });
  AS.Overlay.render(inst, { ...base, phase: 'DONE', runId: 'r', article: ARTICLE, summaryText: '- A.\n\n- B.' });
  assert.equal(timers.intervals.size, 0, 'leaving SUMMARIZING stops the animation');

  assert.equal(inst.body.querySelector('.summary').textContent, '- A.\n\n- B.');
  assert.deepEqual(footerButtons(inst), ['buttonCopy', '', '-・1.']);
  clickFooter(inst, 'buttonCopy');

  assert.equal(inst.modeBar.classList.contains('hidden'), false);
  const modeButtons = inst.modeBar.children;
  assert.deepEqual(
    modeButtons.map((b) => [b.textContent, b.title, b.classList.contains('selected'), b.disabled]),
    [
      ['mode3Label', 'mode3Desc', false, false],
      ['mode5Label', 'mode5Desc', true, false],
      ['mode10Label', 'mode10Desc', false, false],
      ['modeDLabel', 'modeDDesc', false, false]
    ]
  );
  modeButtons[2].click();
  assert.deepEqual(events, [
    ['as:copy', null],
    ['as:mode', { mode: 'BULLETS_10' }]
  ]);

  AS.Overlay.render(inst, { ...base, phase: 'IDLE' });
  assert.equal(inst.modeBar.classList.contains('hidden'), true);
  assert.equal(inst.modeBar.children.length, 0);
});

test('DONE: the bullet style buttons pick how the summary is shown, without re-running', () => {
  const { AS, inst, events } = setup();
  const done = { ...base, phase: 'DONE', runId: 'r', article: ARTICLE, summaryText: 'Summary: S\n\n- A.\n\n- B.\n\nConclusion: C' };
  const styleButtons = () => inst.footer.querySelector('.bulletStyles').children;

  AS.Overlay.render(inst, { ...done, bulletStyle: 'number' });
  assert.equal(inst.body.querySelector('.summary').textContent, 'Summary: S\n\n1. A.\n\n2. B.\n\nConclusion: C');
  const group = inst.footer.querySelector('.bulletStyles');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'labelBulletStyle');
  assert.deepEqual(
    styleButtons().map((b) => [b.textContent, b.getAttribute('aria-label'), b.title, b.getAttribute('aria-pressed'), b.classList.contains('selected')]),
    [
      ['-', 'bulletStyleDash', 'bulletStyleDash', 'false', false],
      ['・', 'bulletStyleDot', 'bulletStyleDot', 'false', false],
      ['1.', 'bulletStyleNumber', 'bulletStyleNumber', 'true', true]
    ]
  );

  styleButtons()[1].click();
  assert.deepEqual(events, [['as:bulletStyle', { style: 'dot' }]]);

  AS.Overlay.render(inst, { ...done, bulletStyle: 'dot' });
  assert.equal(inst.body.querySelector('.summary').textContent, 'Summary: S\n\n・A.\n\n・B.\n\nConclusion: C');
  assert.deepEqual(styleButtons().map((b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false']);

  // Other screens have no bullet style buttons.
  AS.Overlay.render(inst, { ...base, phase: 'ERROR', message: 'm' });
  assert.equal(inst.footer.querySelector('.bulletStyles'), null);
});

test('ERROR and BLOCKED: message, Back, and Open options', () => {
  const { AS, inst, events } = setup();
  AS.Overlay.render(inst, { ...base, phase: 'ERROR', message: 'errorAuth\n(code=x)' });
  assert.equal(inst.body.querySelector('.alert').textContent, 'errorAuth\n(code=x)');
  assert.deepEqual(footerButtons(inst), ['buttonBack']);
  clickFooter(inst, 'buttonBack');

  AS.Overlay.render(inst, { ...base, phase: 'BLOCKED', runId: 'r', estimate: ESTIMATE, reason: 'reasonHardLimit' });
  assert.equal(inst.body.querySelector('.alert').textContent, 'errorBlockedreasonHardLimit');
  assert.deepEqual(kvRows(inst.body), [['labelCostWorst', '$0.50']]);
  assert.deepEqual(footerButtons(inst), ['buttonBack', 'buttonOpenOptions']);
  clickFooter(inst, 'buttonOpenOptions');
  assert.deepEqual(events, [
    ['as:reset', null],
    ['as:openOptions', null]
  ]);
});

test('the banner is shown only for non-blank text', () => {
  const { AS, inst } = setup();
  AS.Overlay.render(inst, { ...base, phase: 'IDLE', banner: 'toastModeAdjusted' });
  assert.equal(inst.banner.classList.contains('hidden'), false);
  assert.equal(inst.banner.textContent, 'toastModeAdjusted');
  AS.Overlay.render(inst, { ...base, phase: 'IDLE', banner: '   ' });
  assert.equal(inst.banner.classList.contains('hidden'), true);
  assert.equal(inst.banner.textContent, '');
});

test('language options: auto shows the resolved language, duplicates are dropped, selection falls back to the base language', () => {
  const { AS, inst, events } = setup();
  const languageName = (code) => new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
  const regionName = (code) => new Intl.DisplayNames(['en'], { type: 'region' }).of(code);

  AS.Overlay.setLanguageOptions(inst, ['en', 'ja', 'ja', ' ', 'zh-TW'], 'auto', ['ja-JP', 'en']);
  const select = inst.languageSelect;
  assert.deepEqual(
    select.options.map((o) => [o.value, o.textContent]),
    [
      ['auto', `languageAuto (${languageName('ja')} (${regionName('JP')}))`],
      ['en', languageName('en')],
      ['ja', languageName('ja')],
      ['zh-TW', `${languageName('zh')} (${regionName('TW')})`]
    ]
  );
  assert.equal(select.value, 'auto');

  // Calling again rebuilds the list instead of appending to it.
  AS.Overlay.setLanguageOptions(inst, ['en', 'pt-BR'], 'pt', []);
  assert.deepEqual(
    select.options.map((o) => o.value),
    ['auto', 'en', 'pt-BR']
  );
  assert.equal(select.options[0].textContent, 'languageAuto');
  assert.equal(select.value, 'pt-BR', 'pt selects pt-BR');

  AS.Overlay.setLanguageOptions(inst, ['en'], 'xx-YY', []);
  assert.equal(select.value, 'auto');
  AS.Overlay.setLanguageOptions(inst, ['en', 'ja'], 'ja', []);
  assert.equal(select.value, 'ja');

  select.value = 'en';
  select.dispatchEvent(new Event('change'));
  assert.deepEqual(events, [['as:language', { language: 'en' }]]);
});

test('toasts hide themselves after a delay; a new toast replaces the pending one', () => {
  const { AS, inst, timers } = setup();
  AS.Overlay.showToast(inst, 'toastCopied');
  AS.Overlay.showToast(inst, 'toastCopyFailed');
  assert.equal(timers.timeouts.size, 1);
  assert.equal(inst.toast.classList.contains('hidden'), false);
  assert.equal(inst.toast.textContent, 'toastCopyFailed');
  timers.runTimeouts();
  assert.equal(inst.toast.classList.contains('hidden'), true);
  assert.equal(inst.toast.textContent, '');
});

test('unmount stops timers and removes the overlay', () => {
  const { AS, doc, inst, timers } = setup();
  AS.Overlay.render(inst, { ...base, phase: 'EXTRACTING', runId: 'r' });
  AS.Overlay.showToast(inst, 'toastCopied');
  assert.equal(timers.intervals.size, 1);
  assert.equal(timers.timeouts.size, 1);

  AS.Overlay.unmount(inst);
  assert.equal(timers.intervals.size, 0);
  assert.equal(timers.timeouts.size, 0);
  assert.equal(inst.toast.classList.contains('hidden'), true);
  assert.equal(doc.getElementById(AS.OVERLAY_CONTAINER_ID), null);
});

test('the progress animation stops by itself once the overlay is detached without unmount()', () => {
  // removeExistingOverlay() on re-injection removes the previous overlay; the fresh Overlay
  // functions cannot reach the previous instance's timer.
  const { AS, inst, timers } = setup();
  AS.Overlay.render(inst, { ...base, phase: 'SUMMARIZING', runId: 'r', article: ARTICLE, estimate: ESTIMATE });
  const msg = inst.body.querySelector('.statusMessage');
  timers.tickIntervals();
  assert.equal(msg.textContent, 'statusSummarizing.');

  AS.removeExistingOverlay();
  assert.equal(inst.host.isConnected, false);
  timers.tickIntervals();
  assert.equal(timers.intervals.size, 0);
  assert.equal(msg.textContent, 'statusSummarizing.');
});

test('page scripts cannot reach the controls: closed shadow root, and no UI events on the host element', () => {
  const { AS, inst, events, hostEvents } = setup();
  assert.equal(inst.host.shadowRoot, null, 'the shadow root is closed');

  AS.Overlay.render(inst, { ...base, phase: 'CONFIRM', runId: 'r', article: ARTICLE, estimate: ESTIMATE });
  clickFooter(inst, 'buttonRun');
  inst.closeButton.click();
  assert.deepEqual(events, [
    ['as:run', null],
    ['as:close', null]
  ]);
  // A page script can observe or dispatch events on the host, so nothing is sent through it.
  assert.deepEqual(hostEvents, []);
});
