"use strict";
var AS;
(function (AS) {
    let Controller;
    (function (Controller) {
        const ctx = {
            overlay: null,
            state: null,
            acceptLanguages: [],
        };
        function setState(next, render = true) {
            ctx.state = next;
            if (render)
                AS.Overlay.render(ctx.overlay, ctx.state);
        }
        function reduce(event, render = true) {
            const next = AS.StateMachine.reduce(ctx.state, event);
            setState(next, render);
        }
        function resolvedLanguage() {
            const sel = ctx.state.selectedLanguage || 'auto';
            if (sel !== 'auto')
                return sel;
            // Auto = first preferred language.
            if (ctx.acceptLanguages && ctx.acceptLanguages.length > 0)
                return ctx.acceptLanguages[0];
            return globalThis?.navigator?.language || 'en';
        }
        function currentMode() {
            return ctx.state.selectedMode || AS.DEFAULT_MODE;
        }
        function modeLabel(mode) {
            const opt = AS.MODE_OPTIONS.find((o) => o.mode === mode);
            return opt ? AS.t(opt.labelKey) : String(mode);
        }
        function adjustModeForContentLength(selected, textToSend) {
            // Heuristic: if the content is not long enough to support the selected
            // granularity, fall back to a shorter mode to reduce hallucination risk.
            const tokenHigh = AS.Estimate.estimateTokens(textToSend).high;
            // Minimum input tokens to attempt each mode.
            // (Values are deliberately conservative; tune via feedback.)
            const min = {
                BULLETS_3: 0,
                BULLETS_5: 180,
                BULLETS_10: 420,
                TLDR_12_CONCLUSION: 900
            };
            if (tokenHigh >= min[selected])
                return selected;
            // Fall back to the longest mode supported by this input size.
            const order = ['TLDR_12_CONCLUSION', 'BULLETS_10', 'BULLETS_5', 'BULLETS_3'];
            for (const m of order) {
                if (tokenHigh >= min[m])
                    return m;
            }
            return 'BULLETS_3';
        }
        function formatBackgroundError(resp) {
            const status = typeof resp?.status === 'number' && resp.status > 0 ? resp.status : undefined;
            const code = resp?.code ? String(resp.code) : '';
            const msg = resp?.message ? String(resp.message) : '';
            // Prefer a friendly localized message, with optional minimal diagnostics.
            let base = '';
            if (code === 'api_key_missing') {
                base = AS.t('errorApiKeyMissing');
            }
            else if (status === 401 || code.includes('authentication')) {
                base = AS.t('errorAuth');
            }
            else if (status === 429 || status === 529 || code.includes('rate_limit') || code.includes('overloaded')) {
                base = AS.t('errorRateLimit');
            }
            else if (status === 400 || code.includes('invalid_request')) {
                base = AS.t('errorBadRequest');
            }
            else if (code === 'timeout') {
                base = AS.t('errorTimeout');
            }
            else if (code === 'network_error') {
                base = AS.t('errorNetwork');
            }
            else if (typeof status === 'number' && status >= 500) {
                base = AS.t('errorServer');
            }
            else {
                base = msg || AS.t('errorUnknown');
            }
            // Add a compact diagnostics suffix for engineering triage.
            const diag = [];
            if (code)
                diag.push(`code=${code}`);
            if (typeof status === 'number')
                diag.push(`status=${status}`);
            if (diag.length > 0) {
                return `${base}\n(${diag.join(', ')})`;
            }
            return base;
        }
        function isRunActive(runId) {
            return ctx.activeRunId === runId;
        }
        async function sendToBackground(_runId, _purpose, message) {
            // NOTE: The background worker maintains an AbortController registry per runId.
            // We keep this wrapper for future observability instrumentation.
            return await AS.sendMessage(message);
        }
        function abortInFlight() {
            const runId = ctx.activeRunId;
            if (!runId)
                return;
            // Fire-and-forget.
            AS.sendMessage({ type: 'ABORT_RUN', payload: { runId } }).catch(() => {
                // ignore
            });
        }
        function cancelActiveRun(reasonBanner) {
            abortInFlight();
            ctx.activeRunId = undefined;
            reduce({ type: 'RESET', banner: reasonBanner }, true);
        }
        async function refineTokensIfPossible(runId, estimate, article) {
            if (!isRunActive(runId))
                return;
            try {
                const resp = await sendToBackground(runId, 'count_tokens', {
                    type: 'COUNT_TOKENS',
                    payload: {
                        runId,
                        title: article.title,
                        url: article.url,
                        articleText: article.text,
                        model: AS.MODEL_TOKEN_COUNT
                    }
                });
                if (!isRunActive(runId))
                    return;
                if (resp && resp.ok === true && typeof resp.inputTokens === 'number') {
                    const updated = AS.Estimate.applyExactTokens(estimate, resp.inputTokens);
                    reduce({ type: 'TOKENS_REFINED', runId, estimate: updated }, true);
                    // If refinement pushes us over the hard limit, block immediately.
                    if (AS.Estimate.isOverHardLimit(updated)) {
                        reduce({ type: 'BLOCKED', runId, estimate: updated, reason: AS.t('reasonHardLimit') }, true);
                    }
                    return;
                }
                // Token refinement is best-effort. If it fails (e.g., API key missing, network issue),
                // stop showing the "refining" indicator and keep the rough estimate.
                reduce({ type: 'PREFLIGHT_READY', runId, estimate, refining: false }, true);
            }
            catch {
                // Ignore refinement failures (UX: keep rough estimate)
                if (!isRunActive(runId))
                    return;
                // Stop showing "refining" UI if we're still in PREFLIGHT.
                reduce({ type: 'PREFLIGHT_READY', runId, estimate, refining: false }, true);
            }
        }
        async function maybeRepairFormat(runId, mode, language, text, repairModel, repairContext) {
            const v = AS.Format.validate(mode, text);
            if (v.ok)
                return text;
            reduce({ type: 'SUMMARY_PROGRESS', runId, stage: 'REPAIR' }, true);
            const resp = await sendToBackground(runId, 'repair', {
                type: 'RUN_SUMMARY_REPAIR',
                payload: {
                    runId,
                    language,
                    mode,
                    badOutput: text,
                    model: repairModel,
                    title: repairContext?.title,
                    url: repairContext?.url,
                    chunkSummaries: repairContext?.chunkSummaries
                }
            });
            if (!isRunActive(runId))
                return text;
            if (resp && resp.ok === true && typeof resp.text === 'string') {
                const repaired = resp.text;
                return AS.Format.validate(mode, repaired).ok ? repaired : text;
            }
            return text;
        }
        function isLikelyTruncatedOutput(text) {
            const lines = String(text || '')
                .replace(/\r\n/g, '\n')
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
            if (lines.length === 0)
                return false;
            const lastLine = lines[lines.length - 1].replace(/^[-*•・]\s+/, '').trim();
            if (lastLine.length === 0)
                return false;
            const lastChar = lastLine.slice(-1);
            const punctuation = new Set(['.', '!', '?', '。', '！', '？', '…', '」', '』', '）', ')', '】', ']', '”', '"']);
            if (punctuation.has(lastChar))
                return false;
            return /[A-Za-z0-9\u3040-\u30ff\u4e00-\u9faf]$/.test(lastChar);
        }
        async function maybeRepairTruncation(runId, mode, language, text, repairModel, repairContext) {
            if (!isLikelyTruncatedOutput(text))
                return text;
            reduce({ type: 'SUMMARY_PROGRESS', runId, stage: 'REPAIR' }, true);
            const resp = await sendToBackground(runId, 'repair_truncation', {
                type: 'RUN_SUMMARY_REPAIR',
                payload: {
                    runId,
                    language,
                    mode,
                    badOutput: text,
                    model: repairModel,
                    title: repairContext?.title,
                    url: repairContext?.url,
                    chunkSummaries: repairContext?.chunkSummaries,
                    fixTruncation: true
                }
            });
            if (!isRunActive(runId))
                return text;
            if (resp && resp.ok === true && typeof resp.text === 'string') {
                const repaired = resp.text;
                return AS.Format.validate(mode, repaired).ok ? repaired : text;
            }
            return text;
        }
        async function runSummary(runId, article, estimate) {
            if (!isRunActive(runId))
                return;
            const language = resolvedLanguage();
            const mode = currentMode();
            const normalizeSummaryText = (input) => {
                const lines = String(input || '').replace(/\r\n/g, '\n').split('\n');
                const out = [];
                const isBullet = (line) => AS.Format.isBulletLine(line);
                const isSummary = (line) => AS.Format.isSummaryLine(line);
                const isConclusion = (line) => AS.Format.isConclusionLine(line);
                const lastNonEmptyIndex = () => {
                    for (let i = out.length - 1; i >= 0; i--) {
                        if (out[i].trim().length > 0)
                            return i;
                    }
                    return -1;
                };
                for (const raw of lines) {
                    const line = raw.trim();
                    if (line.length === 0) {
                        out.push('');
                        continue;
                    }
                    if (isBullet(line) || isSummary(line) || isConclusion(line)) {
                        out.push(line);
                        continue;
                    }
                    const prevIndex = lastNonEmptyIndex();
                    if (prevIndex >= 0 && isBullet(out[prevIndex])) {
                        out[prevIndex] = `${out[prevIndex]} ${line}`;
                    }
                    else {
                        out.push(line);
                    }
                }
                return out.join('\n').trim();
            };
            try {
                const chunks = AS.Chunker.chunkText(article.text, AS.CHUNK_TARGET_INPUT_TOKENS);
                const total = chunks.length;
                if (total > 1) {
                    const chunkSummaries = [];
                    for (let i = 0; i < total; i++) {
                        if (!isRunActive(runId))
                            return;
                        reduce({ type: 'SUMMARY_PROGRESS', runId, stage: 'MAP', current: i + 1, total }, true);
                        const resp = await sendToBackground(runId, `map_${i + 1}`, {
                            type: 'RUN_SUMMARY_MAP',
                            payload: {
                                runId,
                                title: article.title,
                                url: article.url,
                                language,
                                chunkText: chunks[i],
                                chunkIndex: i + 1,
                                chunkCount: total,
                                model: AS.MODEL_MAP
                            }
                        });
                        if (!isRunActive(runId))
                            return;
                        if (resp && resp.ok === true && typeof resp.text === 'string') {
                            chunkSummaries.push(resp.text);
                            continue;
                        }
                        reduce({ type: 'SUMMARY_ERROR', runId, message: formatBackgroundError(resp) }, true);
                        return;
                    }
                    if (!isRunActive(runId))
                        return;
                    reduce({ type: 'SUMMARY_PROGRESS', runId, stage: 'REDUCE' }, true);
                    const reduced = await sendToBackground(runId, 'reduce', {
                        type: 'RUN_SUMMARY_REDUCE',
                        payload: {
                            runId,
                            title: article.title,
                            url: article.url,
                            language,
                            mode,
                            chunkSummaries,
                            model: AS.MODEL_FINAL
                        }
                    });
                    if (!isRunActive(runId))
                        return;
                    if (reduced && reduced.ok === true && typeof reduced.text === 'string') {
                        let finalText = await maybeRepairFormat(runId, mode, language, reduced.text, AS.MODEL_FINAL, {
                            title: article.title,
                            url: article.url,
                            // Enable prompt caching reuse for repair by providing the same chunk summaries.
                            chunkSummaries
                        });
                        finalText = await maybeRepairTruncation(runId, mode, language, finalText, AS.MODEL_FINAL, {
                            title: article.title,
                            url: article.url,
                            chunkSummaries
                        });
                        if (!isRunActive(runId))
                            return;
                        reduce({ type: 'SUMMARY_DONE', runId, summaryText: normalizeSummaryText(finalText), usage: reduced.usage }, true);
                        return;
                    }
                    reduce({ type: 'SUMMARY_ERROR', runId, message: formatBackgroundError(reduced) }, true);
                    return;
                }
                // Single pass.
                reduce({ type: 'SUMMARY_PROGRESS', runId, stage: 'SINGLE' }, true);
                const resp = await sendToBackground(runId, 'single', {
                    type: 'RUN_SUMMARY_SINGLE',
                    payload: {
                        runId,
                        title: article.title,
                        url: article.url,
                        language,
                        mode,
                        articleText: article.text,
                        // Must match our cost model assumptions: single-pass uses the map model.
                        model: AS.MODEL_MAP
                    }
                });
                if (!isRunActive(runId))
                    return;
                if (resp && resp.ok === true && typeof resp.text === 'string') {
                    let finalText = await maybeRepairFormat(runId, mode, language, resp.text, AS.MODEL_MAP, {
                        title: article.title,
                        url: article.url
                    });
                    finalText = await maybeRepairTruncation(runId, mode, language, finalText, AS.MODEL_MAP, {
                        title: article.title,
                        url: article.url
                    });
                    if (!isRunActive(runId))
                        return;
                    reduce({ type: 'SUMMARY_DONE', runId, summaryText: normalizeSummaryText(finalText), usage: resp.usage }, true);
                    return;
                }
                reduce({ type: 'SUMMARY_ERROR', runId, message: formatBackgroundError(resp) }, true);
            }
            catch (err) {
                if (!isRunActive(runId))
                    return;
                reduce({ type: 'SUMMARY_ERROR', runId, message: err?.message || AS.t('errorUnknown') }, true);
            }
        }
        async function doExtractAndMaybeRun(runId) {
            if (!isRunActive(runId))
                return;
            const r = AS.Extract.extractArticle();
            if (!isRunActive(runId))
                return;
            if (!r.ok) {
                // Map reason to user-facing message.
                let msg = '';
                if (r.code === 'TOO_SHORT')
                    msg = AS.t('errorTooShort');
                else if (r.code === 'LINK_HEAVY')
                    msg = AS.t('errorNotArticle');
                else if (r.code === 'NO_MAIN_TEXT')
                    msg = AS.t('errorNoMainText');
                else
                    msg = AS.t('errorExtractionFailed');
                reduce({ type: 'EXTRACT_FAIL', runId, message: msg }, true);
                return;
            }
            // Clamp for send safety.
            const clamped = AS.clampText(r.text, AS.MAX_ARTICLE_CHARS_TO_SEND);
            const articleTextToSend = clamped.text;
            // Auto-fallback: if the content is too short for the selected mode,
            // downgrade to a shorter mode.
            const beforeMode = currentMode();
            const adjustedMode = adjustModeForContentLength(beforeMode, articleTextToSend);
            if (adjustedMode !== beforeMode) {
                // Update mode in state (no render yet) and show a small toast.
                reduce({ type: 'MODE_CHANGED', mode: adjustedMode }, false);
                const msg = AS.t('toastModeAdjusted', modeLabel(adjustedMode));
                setState({ ...ctx.state, banner: msg }, false);
            }
            // Store a clamped copy in state (avoid holding the full raw extraction for huge pages).
            const articleForState = {
                ...r,
                text: articleTextToSend,
                // Keep the extracted char count (from the extractor), not the sent count.
                charCount: r.charCount
            };
            // Build estimate from clamped content.
            const estimate = AS.Estimate.buildEstimate({
                extractedCharCount: r.charCount,
                textToSend: articleTextToSend,
                truncated: clamped.truncated,
                mode: currentMode(),
                mapModel: AS.MODEL_MAP,
                finalModel: AS.MODEL_FINAL
            });
            // Decide next state without flicker: batch transitions and render once.
            setState(AS.StateMachine.reduce(ctx.state, { type: 'EXTRACT_OK', runId, article: articleForState }), false);
            setState(AS.StateMachine.reduce(ctx.state, {
                type: 'PREFLIGHT_READY',
                runId,
                estimate,
                refining: false
            }), false);
            if (AS.Estimate.isOverHardLimit(estimate)) {
                setState(AS.StateMachine.reduce(ctx.state, { type: 'BLOCKED', runId, estimate, reason: AS.t('reasonHardLimit') }), true);
                return;
            }
            if (AS.Estimate.needsApproval(estimate)) {
                // Show preflight first, refine tokens in background.
                setState(AS.StateMachine.reduce(ctx.state, {
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
            setState(AS.StateMachine.reduce(ctx.state, { type: 'START_SUMMARY', runId }), true);
            await runSummary(runId, articleForState, estimate);
        }
        function startRun(mode) {
            const runId = AS.makeRunId();
            ctx.activeRunId = runId;
            // Update selection and enter EXTRACTING.
            reduce({ type: 'MODE_CHANGED', mode }, false);
            reduce({ type: 'START_RUN', runId }, true);
            // Kick async extraction after the UI renders.
            setTimeout(() => {
                doExtractAndMaybeRun(runId).catch((err) => {
                    if (!isRunActive(runId))
                        return;
                    reduce({ type: 'EXTRACT_FAIL', runId, message: err?.message || AS.t('errorExtractionFailed') }, true);
                });
            }, 0);
        }
        function handleProceed() {
            const s = ctx.state;
            if (s.phase !== 'PREFLIGHT')
                return;
            if (AS.Estimate.isOverHardLimit(s.estimate)) {
                reduce({ type: 'BLOCKED', runId: s.runId, estimate: s.estimate, reason: AS.t('reasonHardLimit') }, true);
                return;
            }
            const note = s.estimate.chunkCount > 1 ? AS.t('noteChunking') : undefined;
            reduce({ type: 'NEEDS_CONFIRM', runId: s.runId, estimate: s.estimate, note }, true);
        }
        function handleRun() {
            const s = ctx.state;
            if (s.phase !== 'CONFIRM')
                return;
            reduce({ type: 'START_SUMMARY', runId: s.runId }, true);
            runSummary(s.runId, s.article, s.estimate).catch(() => {
                // ignore
            });
        }
        function handleCopy() {
            const s = ctx.state;
            if (s.phase !== 'DONE')
                return;
            AS.copyToClipboard(s.summaryText).then((ok) => {
                AS.Overlay.showToast(ctx.overlay, ok ? AS.t('toastCopied') : AS.t('toastCopyFailed'));
            });
        }
        function handleRunLight() {
            // Convenience: in CONFIRM, allow running a lightweight mode (3 bullets) to reduce cost/time.
            if (ctx.state.phase !== 'CONFIRM')
                return;
            const runId = ctx.state.runId;
            const lightMode = 'BULLETS_3';
            // Update selected mode.
            reduce({ type: 'MODE_CHANGED', mode: lightMode }, true);
            // Recompute estimate for the new mode (use rough tokens; refined token count can be re-run later).
            const a = ctx.state.article;
            const est = AS.Estimate.buildEstimate({
                extractedCharCount: a.charCount,
                textToSend: a.text,
                truncated: ctx.state.estimate.truncated,
                mode: lightMode,
                mapModel: AS.MODEL_MAP,
                finalModel: AS.MODEL_FINAL
            });
            reduce({ type: 'TOKENS_REFINED', runId, estimate: est }, true);
            if (AS.Estimate.isOverHardLimit(est)) {
                reduce({ type: 'BLOCKED', runId, estimate: est, reason: AS.t('reasonHardLimit') }, true);
                return;
            }
            reduce({ type: 'START_SUMMARY', runId }, true);
            runSummary(runId, a, est).catch((err) => {
                console.error('[ArticleSummarizer] runSummary (light) failed', err);
                if (isRunActive(runId)) {
                    reduce({ type: 'SUMMARY_ERROR', runId, message: AS.t('errorUnknown') }, true);
                }
            });
        }
        function handleCancel() {
            // If nothing is running, just close.
            if (!AS.isBusy(ctx.state)) {
                AS.Overlay.unmount(ctx.overlay);
                return;
            }
            cancelActiveRun(AS.t('bannerCancelled'));
        }
        function handleClose() {
            if (!AS.isBusy(ctx.state)) {
                AS.Overlay.unmount(ctx.overlay);
                return;
            }
            const ok = confirm(AS.t('confirmCloseWhileRunning'));
            if (!ok)
                return;
            abortInFlight();
            ctx.activeRunId = undefined;
            AS.Overlay.unmount(ctx.overlay);
        }
        function handleReset() {
            cancelActiveRun();
        }
        async function bootstrapInternal() {
            // New injection should start from a clean slate.
            ctx.activeRunId = undefined;
            // Mount UI immediately.
            const settings = await AS.getSettings();
            await AS.setUiLanguage(settings.settings?.uiLanguage || 'auto');
            AS.applyRuntimeSettings(settings.settings);
            const overlay = AS.Overlay.mount();
            ctx.overlay = overlay;
            const initialLang = 'auto';
            const initialMode = AS.DEFAULT_MODE;
            ctx.state = AS.StateMachine.initialState(initialLang, initialMode);
            // Initial render.
            AS.Overlay.render(ctx.overlay, ctx.state);
            // Wire events.
            overlay.host.addEventListener('as:close', () => handleClose());
            overlay.host.addEventListener('as:openOptions', () => AS.openOptionsPage());
            overlay.host.addEventListener('as:cancel', () => handleCancel());
            overlay.host.addEventListener('as:reset', () => handleReset());
            overlay.host.addEventListener('as:copy', () => handleCopy());
            overlay.host.addEventListener('as:proceed', () => handleProceed());
            overlay.host.addEventListener('as:run', () => handleRun());
            overlay.host.addEventListener('as:runLight', () => handleRunLight());
            overlay.host.addEventListener('as:language', (ev) => {
                const next = String(ev?.detail?.language || 'auto');
                reduce({ type: 'LANGUAGE_CHANGED', language: next }, true);
                // Spec decision: In DONE, language change triggers full re-run.
                if (ctx.state.phase === 'DONE') {
                    startRun(currentMode());
                }
            });
            overlay.host.addEventListener('as:mode', (ev) => {
                const mode = ev?.detail?.mode;
                if (!mode)
                    return;
                startRun(mode);
            });
            const OUTPUT_LANGUAGES = ['en', 'ja', 'fr', 'de', 'es', 'it', 'pt-BR', 'zh-CN', 'zh-TW', 'ko'];
            // Populate languages.
            ctx.acceptLanguages = await AS.getAcceptLanguages();
            AS.Overlay.setLanguageOptions(ctx.overlay, OUTPUT_LANGUAGES, ctx.state.selectedLanguage, ctx.acceptLanguages);
            try {
                if (chrome?.storage?.onChanged?.addListener) {
                    chrome.storage.onChanged.addListener((changes, areaName) => {
                        if (areaName !== 'local')
                            return;
                        if (!changes || !Object.prototype.hasOwnProperty.call(changes, 'uiLanguage'))
                            return;
                        if (!ctx.overlay)
                            return;
                        const next = changes.uiLanguage?.newValue;
                        AS.setUiLanguage(typeof next === 'string' ? next : 'auto')
                            .then(() => {
                            AS.Overlay.setLanguageOptions(ctx.overlay, OUTPUT_LANGUAGES, ctx.state.selectedLanguage, ctx.acceptLanguages);
                            AS.Overlay.render(ctx.overlay, ctx.state);
                        })
                            .catch(() => {
                            // ignore
                        });
                    });
                }
            }
            catch {
                // ignore
            }
            // Reflect default mode preference on the start screen (doesn't auto-run).
            reduce({ type: 'MODE_CHANGED', mode: AS.DEFAULT_MODE }, true);
            reduce({ type: 'SETTINGS_LOADED', apiKeySet: settings.apiKeySet }, true);
        }
        function bootstrap() {
            try {
                AS.removeExistingOverlay();
                bootstrapInternal().catch((err) => {
                    console.error('[ArticleSummarizer] bootstrap failed', err);
                });
            }
            catch (err) {
                console.error('[ArticleSummarizer] bootstrap failed', err);
            }
        }
        Controller.bootstrap = bootstrap;
    })(Controller = AS.Controller || (AS.Controller = {}));
})(AS || (AS = {}));
