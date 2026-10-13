namespace AS {
  export namespace Controller {
    type ControllerCtx = {
      overlay: Overlay.Instance;
      state: UiState;
      acceptLanguages: string[];
      activeRunId?: string;
    };

    const ctx: ControllerCtx = {
      overlay: null as any,
      state: null as any,
      acceptLanguages: []
    };

    // Output languages offered in the overlay's language select.
    const OUTPUT_LANGUAGES = ['en', 'ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko'];

    function setState(next: UiState, render: boolean = true): void {
      ctx.state = next;
      if (render) Overlay.render(ctx.overlay, ctx.state);
    }

    function reduce(event: UiEvent, render: boolean = true): void {
      const next = StateMachine.reduce(ctx.state, event);
      setState(next, render);
    }

    function resolvedLanguage(): string {
      const sel = ctx.state.selectedLanguage || 'auto';
      if (sel !== 'auto') return sel;
      // Auto = first preferred language.
      if (ctx.acceptLanguages && ctx.acceptLanguages.length > 0) return ctx.acceptLanguages[0];
      return (globalThis as any)?.navigator?.language || 'en';
    }

    function currentMode(): SummaryMode {
      return ctx.state.selectedMode || DEFAULT_MODE;
    }

    function modeLabel(mode: SummaryMode): string {
      const opt = MODE_OPTIONS.find((o) => o.mode === mode);
      return opt ? t(opt.labelKey) : String(mode);
    }

    function adjustModeForContentLength(selected: SummaryMode, textToSend: string): SummaryMode {
      // Heuristic: if the content is not long enough to support the selected
      // granularity, fall back to a shorter mode to reduce hallucination risk.
      const tokenHigh = Estimate.estimateTokens(textToSend).high;

      // Minimum input tokens to attempt each mode.
      // (Values are deliberately conservative; tune via feedback.)
      const min: Record<SummaryMode, number> = {
        BULLETS_3: 0,
        BULLETS_5: 180,
        BULLETS_10: 420,
        TLDR_12_CONCLUSION: 900
      };

      if (tokenHigh >= min[selected]) return selected;

      // Fall back to the longest mode supported by this input size.
      const order: SummaryMode[] = ['TLDR_12_CONCLUSION', 'BULLETS_10', 'BULLETS_5', 'BULLETS_3'];
      for (const m of order) {
        if (tokenHigh >= min[m]) return m;
      }
      return 'BULLETS_3';
    }

    function formatBackgroundError(resp: any): string {
      const status = typeof resp?.status === 'number' && resp.status > 0 ? resp.status : undefined;
      const code = resp?.code ? String(resp.code) : '';
      const msg = resp?.message ? String(resp.message) : '';

      // Prefer a friendly localized message, with optional minimal diagnostics.
      let base = '';

      if (code === 'api_key_missing') {
        base = t('errorApiKeyMissing');
      } else if (code === 'refusal') {
        base = t('errorRefused');
      } else if (status === 401 || code.includes('authentication')) {
        base = t('errorAuth');
      } else if (status === 429 || status === 529 || code.includes('rate_limit') || code.includes('overloaded')) {
        base = t('errorRateLimit');
      } else if (status === 400 || code.includes('invalid_request')) {
        base = t('errorBadRequest');
      } else if (code === 'timeout') {
        base = t('errorTimeout');
      } else if (code === 'network_error') {
        base = t('errorNetwork');
      } else if (typeof status === 'number' && status >= 500) {
        base = t('errorServer');
      } else {
        base = msg || t('errorUnknown');
      }

      // Add a compact diagnostics suffix for engineering triage.
      const diag: string[] = [];
      if (code) diag.push(`code=${code}`);
      if (typeof status === 'number') diag.push(`status=${status}`);

      if (diag.length > 0) {
        return `${base}\n(${diag.join(', ')})`;
      }
      return base;
    }

    function isRunActive(runId: string): boolean {
      return ctx.activeRunId === runId;
    }

    function isTextResponse(resp: any): resp is { ok: true; text: string; usage?: any } {
      return Boolean(resp && resp.ok === true && typeof resp.text === 'string');
    }

    function abortInFlight(): void {
      const runId = ctx.activeRunId;
      if (!runId) return;
      // Fire-and-forget.
      sendMessage({ type: 'ABORT_RUN', payload: { runId } }).catch(() => {
        // ignore
      });
    }

    function cancelActiveRun(reasonBanner?: string): void {
      abortInFlight();
      ctx.activeRunId = undefined;
      reduce({ type: 'RESET', banner: reasonBanner }, true);
    }

    async function refineTokensIfPossible(runId: string, estimate: Estimate, article: ExtractOk): Promise<void> {
      if (!isRunActive(runId)) return;

      try {
        const resp = await sendMessage({
          type: 'COUNT_TOKENS',
          payload: {
            runId,
            title: article.title,
            url: article.url,
            articleText: article.text,
            model: MODEL_TOKEN_COUNT
          }
        });

        if (!isRunActive(runId)) return;

        if (resp && resp.ok === true && typeof resp.inputTokens === 'number') {
          const updated = Estimate.applyExactTokens(estimate, resp.inputTokens);
          reduce({ type: 'TOKENS_REFINED', runId, estimate: updated }, true);

          // If refinement pushes us over the hard limit, block immediately.
          if (Estimate.isOverHardLimit(updated)) {
            reduce({ type: 'BLOCKED', runId, estimate: updated, reason: t('reasonHardLimit') }, true);
          }

          return;
        }

        // Token refinement is best-effort. If it fails (e.g., API key missing, network issue),
        // stop showing the "refining" indicator and keep the rough estimate.
        reduce({ type: 'PREFLIGHT_READY', runId, estimate, refining: false }, true);
      } catch {
        // Ignore refinement failures (UX: keep rough estimate)
        if (!isRunActive(runId)) return;
        // Stop showing "refining" UI if we're still in PREFLIGHT.
        reduce({ type: 'PREFLIGHT_READY', runId, estimate, refining: false }, true);
      }
    }

    type RepairContext = {
      title: string;
      url: string;
      // Map-reduce runs pass the chunk summaries so the repair pass can reuse the reduce prompt cache.
      chunkSummaries?: string[];
    };

    // Asks the background to rewrite `text`. Keeps `text` unless the rewrite passes format validation.
    async function requestRepair(
      runId: string,
      mode: SummaryMode,
      language: string,
      text: string,
      repairModel: string,
      repairContext: RepairContext,
      fixTruncation: boolean
    ): Promise<string> {
      reduce({ type: 'SUMMARY_PROGRESS', runId, stage: 'REPAIR' }, true);

      const resp = await sendMessage({
        type: 'RUN_SUMMARY_REPAIR',
        payload: {
          runId,
          language,
          mode,
          badOutput: text,
          model: repairModel,
          title: repairContext.title,
          url: repairContext.url,
          chunkSummaries: repairContext.chunkSummaries,
          ...(fixTruncation ? { fixTruncation: true } : {})
        }
      });

      if (!isRunActive(runId)) return text;

      if (isTextResponse(resp) && Format.validate(mode, resp.text).ok) return resp.text;
      return text;
    }

    // Final step shared by single-pass and map-reduce runs: repair the format if invalid, then
    // repair a likely-truncated ending, then show the result.
    async function finishSummary(
      runId: string,
      mode: SummaryMode,
      language: string,
      draft: string,
      repairModel: string,
      repairContext: RepairContext,
      usage: any
    ): Promise<void> {
      let text = draft;
      if (!Format.validate(mode, text).ok) {
        text = await requestRepair(runId, mode, language, text, repairModel, repairContext, false);
        if (!isRunActive(runId)) return;
      }
      if (Format.isLikelyTruncatedOutput(text, language)) {
        text = await requestRepair(runId, mode, language, text, repairModel, repairContext, true);
      }
      if (!isRunActive(runId)) return;
      reduce({ type: 'SUMMARY_DONE', runId, summaryText: Format.normalizeSummaryText(text), usage }, true);
    }

    async function runMapReduce(
      runId: string,
      article: ExtractOk,
      chunks: string[],
      mode: SummaryMode,
      language: string
    ): Promise<void> {
      const total = chunks.length;
      const chunkSummaries: string[] = [];
      for (let i = 0; i < total; i++) {
        if (!isRunActive(runId)) return;
        reduce({ type: 'SUMMARY_PROGRESS', runId, stage: 'MAP', current: i + 1, total }, true);

        const resp = await sendMessage({
          type: 'RUN_SUMMARY_MAP',
          payload: {
            runId,
            title: article.title,
            url: article.url,
            language,
            chunkText: chunks[i],
            chunkIndex: i + 1,
            chunkCount: total,
            model: MODEL_MAP
          }
        });

        if (!isRunActive(runId)) return;
        if (!isTextResponse(resp)) {
          reduce({ type: 'SUMMARY_ERROR', runId, message: formatBackgroundError(resp) }, true);
          return;
        }
        chunkSummaries.push(resp.text);
      }

      if (!isRunActive(runId)) return;
      reduce({ type: 'SUMMARY_PROGRESS', runId, stage: 'REDUCE' }, true);

      const reduced = await sendMessage({
        type: 'RUN_SUMMARY_REDUCE',
        payload: {
          runId,
          title: article.title,
          url: article.url,
          language,
          mode,
          chunkSummaries,
          model: MODEL_FINAL
        }
      });

      if (!isRunActive(runId)) return;
      if (!isTextResponse(reduced)) {
        reduce({ type: 'SUMMARY_ERROR', runId, message: formatBackgroundError(reduced) }, true);
        return;
      }

      await finishSummary(
        runId,
        mode,
        language,
        reduced.text,
        MODEL_FINAL,
        { title: article.title, url: article.url, chunkSummaries },
        reduced.usage
      );
    }

    async function runSinglePass(runId: string, article: ExtractOk, mode: SummaryMode, language: string): Promise<void> {
      reduce({ type: 'SUMMARY_PROGRESS', runId, stage: 'SINGLE' }, true);
      const resp = await sendMessage({
        type: 'RUN_SUMMARY_SINGLE',
        payload: {
          runId,
          title: article.title,
          url: article.url,
          language,
          mode,
          articleText: article.text,
          // Must match our cost model assumptions: single-pass uses the map model.
          model: MODEL_MAP
        }
      });

      if (!isRunActive(runId)) return;
      if (!isTextResponse(resp)) {
        reduce({ type: 'SUMMARY_ERROR', runId, message: formatBackgroundError(resp) }, true);
        return;
      }

      await finishSummary(runId, mode, language, resp.text, MODEL_MAP, { title: article.title, url: article.url }, resp.usage);
    }

    async function runSummary(runId: string, article: ExtractOk): Promise<void> {
      if (!isRunActive(runId)) return;

      const language = resolvedLanguage();
      const mode = currentMode();

      try {
        const chunks = Chunker.chunkText(article.text, CHUNK_TARGET_INPUT_TOKENS);
        if (chunks.length > 1) {
          await runMapReduce(runId, article, chunks, mode, language);
        } else {
          await runSinglePass(runId, article, mode, language);
        }
      } catch (err: any) {
        if (!isRunActive(runId)) return;
        reduce({ type: 'SUMMARY_ERROR', runId, message: err?.message || t('errorUnknown') }, true);
      }
    }

    // User-facing message for each extraction failure reason.
    const EXTRACT_ERROR_KEYS: Record<ExtractFail['code'], string> = {
      TOO_SHORT: 'errorTooShort',
      LINK_HEAVY: 'errorNotArticle',
      NO_MAIN_TEXT: 'errorNoMainText',
      UNKNOWN: 'errorExtractionFailed'
    };

    async function doExtractAndMaybeRun(runId: string): Promise<void> {
      if (!isRunActive(runId)) return;

      const r = Extract.extractArticle();
      if (!isRunActive(runId)) return;

      if (!r.ok) {
        reduce({ type: 'EXTRACT_FAIL', runId, message: t(EXTRACT_ERROR_KEYS[r.code] || 'errorExtractionFailed') }, true);
        return;
      }

      // Clamp for send safety.
      const clamped = clampText(r.text, MAX_ARTICLE_CHARS_TO_SEND);
      const articleTextToSend = clamped.text;

      // Auto-fallback: if the content is too short for the selected mode,
      // downgrade to a shorter mode.
      const beforeMode = currentMode();
      const adjustedMode = adjustModeForContentLength(beforeMode, articleTextToSend);
      if (adjustedMode !== beforeMode) {
        // Update mode in state (no render yet) and show a small toast.
        reduce({ type: 'MODE_CHANGED', mode: adjustedMode }, false);
        const msg = t('toastModeAdjusted', modeLabel(adjustedMode));
        setState({ ...ctx.state, banner: msg }, false);
      }

      // Store a clamped copy in state (avoid holding the full raw extraction for huge pages).
      const articleForState: ExtractOk = {
        ...r,
        text: articleTextToSend,
        // Keep the extracted char count (from the extractor), not the sent count.
        charCount: r.charCount
      };

      // Build estimate from clamped content.
      const estimate = Estimate.buildEstimate({
        extractedCharCount: r.charCount,
        textToSend: articleTextToSend,
        truncated: clamped.truncated,
        mode: currentMode(),
        mapModel: MODEL_MAP,
        finalModel: MODEL_FINAL
      });

      // Decide next state without flicker: batch transitions and render once.
      setState(StateMachine.reduce(ctx.state, { type: 'EXTRACT_OK', runId, article: articleForState }), false);
      setState(StateMachine.reduce(ctx.state, {
        type: 'PREFLIGHT_READY',
        runId,
        estimate,
        refining: false
      }), false);

      if (Estimate.isOverHardLimit(estimate)) {
        setState(StateMachine.reduce(ctx.state, { type: 'BLOCKED', runId, estimate, reason: t('reasonHardLimit') }), true);
        return;
      }

      if (Estimate.needsApproval(estimate)) {
        // Show preflight first, refine tokens in background.
        setState(StateMachine.reduce(ctx.state, {
          type: 'PREFLIGHT_READY',
          runId,
          estimate,
          refining: true
        }), true);
        refineTokensIfPossible(runId, estimate, articleForState).catch(() => {
          // ignore
        });
        return;
      }

      // No approval needed: run immediately.
      setState(StateMachine.reduce(ctx.state, { type: 'START_SUMMARY', runId }), true);
      await runSummary(runId, articleForState);
    }

    function startRun(mode: SummaryMode): void {
      const runId = makeRunId();
      ctx.activeRunId = runId;

      // Update selection and enter EXTRACTING.
      reduce({ type: 'MODE_CHANGED', mode }, false);
      reduce({ type: 'START_RUN', runId }, true);

      // Kick async extraction after the UI renders.
      setTimeout(() => {
        doExtractAndMaybeRun(runId).catch((err) => {
          if (!isRunActive(runId)) return;
          reduce({ type: 'EXTRACT_FAIL', runId, message: err?.message || t('errorExtractionFailed') }, true);
        });
      }, 0);
    }

    function handleProceed(): void {
      const s = ctx.state;
      if (s.phase !== 'PREFLIGHT') return;

      if (Estimate.isOverHardLimit(s.estimate)) {
        reduce({ type: 'BLOCKED', runId: s.runId, estimate: s.estimate, reason: t('reasonHardLimit') }, true);
        return;
      }

      const note = s.estimate.chunkCount > 1 ? t('noteChunking') : undefined;
      reduce({ type: 'NEEDS_CONFIRM', runId: s.runId, estimate: s.estimate, note }, true);
    }

    function handleRun(): void {
      const s = ctx.state;
      if (s.phase !== 'CONFIRM') return;

      reduce({ type: 'START_SUMMARY', runId: s.runId }, true);
      runSummary(s.runId, s.article).catch(() => {
        // ignore
      });
    }

    function handleCopy(): void {
      const s = ctx.state;
      if (s.phase !== 'DONE') return;
      copyToClipboard(s.summaryText).then((ok) => {
        Overlay.showToast(ctx.overlay, ok ? t('toastCopied') : t('toastCopyFailed'));
      });
    }

    function handleRunLight(): void {
      // Convenience: in CONFIRM, allow running a lightweight mode (3 bullets) to reduce cost/time.
      if (ctx.state.phase !== 'CONFIRM') return;

      const runId = ctx.state.runId;
      const lightMode: SummaryMode = 'BULLETS_3';

      // Update selected mode.
      reduce({ type: 'MODE_CHANGED', mode: lightMode }, true);

      // Recompute estimate for the new mode (use rough tokens; refined token count can be re-run later).
      const a = ctx.state.article;
      const est = Estimate.buildEstimate({
        extractedCharCount: a.charCount,
        textToSend: a.text,
        truncated: ctx.state.estimate.truncated,
        mode: lightMode,
        mapModel: MODEL_MAP,
        finalModel: MODEL_FINAL
      });

      reduce({ type: 'TOKENS_REFINED', runId, estimate: est }, true);

      if (Estimate.isOverHardLimit(est)) {
        reduce({ type: 'BLOCKED', runId, estimate: est, reason: t('reasonHardLimit') }, true);
        return;
      }

      reduce({ type: 'START_SUMMARY', runId }, true);
      runSummary(runId, a).catch((err) => {
        console.error('[ArticleSummarizer] runSummary (light) failed', err);
        if (isRunActive(runId)) {
          reduce({ type: 'SUMMARY_ERROR', runId, message: t('errorUnknown') }, true);
        }
      });
    }

    function handleCancel(): void {
      // If nothing is running, just close.
      if (!isBusy(ctx.state)) {
        Overlay.unmount(ctx.overlay);
        return;
      }
      cancelActiveRun(t('bannerCancelled'));
    }

    function handleClose(): void {
      if (!isBusy(ctx.state)) {
        Overlay.unmount(ctx.overlay);
        return;
      }

      const ok = confirm(t('confirmCloseWhileRunning'));
      if (!ok) return;
      abortInFlight();
      ctx.activeRunId = undefined;
      Overlay.unmount(ctx.overlay);
    }

    function handleReset(): void {
      cancelActiveRun();
    }

    async function bootstrapInternal(): Promise<void> {
      // New injection should start from a clean slate.
      ctx.activeRunId = undefined;

      // Mount UI immediately.
      const settings = await getSettings();
      await setUiLanguage(settings.settings?.uiLanguage || 'auto');
      applyRuntimeSettings(settings.settings);

      const overlay = Overlay.mount();
      ctx.overlay = overlay;

      const initialLang = 'auto';
      const initialMode = DEFAULT_MODE;
      ctx.state = StateMachine.initialState(initialLang, initialMode);

      // Initial render.
      Overlay.render(ctx.overlay, ctx.state);

      // Wire events.
      overlay.host.addEventListener('as:close', () => handleClose());
      overlay.host.addEventListener('as:openOptions', () => openOptionsPage());
      overlay.host.addEventListener('as:cancel', () => handleCancel());
      overlay.host.addEventListener('as:reset', () => handleReset());
      overlay.host.addEventListener('as:copy', () => handleCopy());
      overlay.host.addEventListener('as:proceed', () => handleProceed());
      overlay.host.addEventListener('as:run', () => handleRun());
      overlay.host.addEventListener('as:runLight', () => handleRunLight());

      overlay.host.addEventListener('as:language', (ev: any) => {
        const next = String(ev?.detail?.language || 'auto');
        reduce({ type: 'LANGUAGE_CHANGED', language: next }, true);

        // Spec decision: In DONE, language change triggers full re-run.
        if (ctx.state.phase === 'DONE') {
          startRun(currentMode());
        }
      });

      overlay.host.addEventListener('as:mode', (ev: any) => {
        const mode = ev?.detail?.mode as SummaryMode;
        if (!mode) return;
        startRun(mode);
      });

      // Populate languages.
      ctx.acceptLanguages = await getAcceptLanguages();
      Overlay.setLanguageOptions(ctx.overlay, OUTPUT_LANGUAGES, ctx.state.selectedLanguage, ctx.acceptLanguages);

      try {
        if (chrome?.storage?.onChanged?.addListener) {
          chrome.storage.onChanged.addListener((changes: { [key: string]: { newValue?: unknown; oldValue?: unknown } }, areaName: string) => {
            if (areaName !== 'local') return;
            if (!changes || !Object.prototype.hasOwnProperty.call(changes, 'uiLanguage')) return;
            if (!ctx.overlay) return;
            const next = changes.uiLanguage?.newValue;
            setUiLanguage(typeof next === 'string' ? next : 'auto')
              .then(() => {
                Overlay.setLanguageOptions(ctx.overlay, OUTPUT_LANGUAGES, ctx.state.selectedLanguage, ctx.acceptLanguages);
                Overlay.render(ctx.overlay, ctx.state);
              })
              .catch(() => {
                // ignore
              });
          });
        }
      } catch {
        // ignore
      }

      // Reflect default mode preference on the start screen (doesn't auto-run).
      reduce({ type: 'MODE_CHANGED', mode: DEFAULT_MODE }, true);
      reduce({ type: 'SETTINGS_LOADED', apiKeySet: settings.apiKeySet }, true);
    }

    export function bootstrap(): void {
      try {
        removeExistingOverlay();
        bootstrapInternal().catch((err) => {
          console.error('[ArticleSummarizer] bootstrap failed', err);
        });
      } catch (err) {
        console.error('[ArticleSummarizer] bootstrap failed', err);
      }
    }
  }
}
