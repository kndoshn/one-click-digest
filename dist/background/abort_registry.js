// Abort registry for background requests.
//
// Why this exists:
// - Multiple requests can overlap for the same runId (e.g., COUNT_TOKENS running while
//   the user proceeds to summarization).
// - We need ABORT_RUN to cancel *all* in-flight network calls for that runId.
// - We must not implicitly abort a previous request when a new one starts.
export function createAbortRegistry() {
    const byRunId = new Map();
    function ensureSet(runId) {
        let set = byRunId.get(runId);
        if (!set) {
            set = new Set();
            byRunId.set(runId, set);
        }
        return set;
    }
    function register(runId, controller) {
        if (!runId)
            return;
        ensureSet(runId).add(controller);
    }
    function unregister(runId, controller) {
        if (!runId)
            return;
        const set = byRunId.get(runId);
        if (!set)
            return;
        set.delete(controller);
        if (set.size === 0)
            byRunId.delete(runId);
    }
    function abortRun(runId) {
        if (!runId)
            return false;
        const set = byRunId.get(runId);
        if (!set || set.size === 0)
            return false;
        for (const controller of Array.from(set)) {
            try {
                controller.abort();
            }
            catch {
                // ignore
            }
        }
        byRunId.delete(runId);
        return true;
    }
    return {
        register,
        unregister,
        abortRun,
        _debugCountControllers: (runId) => byRunId.get(runId)?.size || 0,
        _debugCountRuns: () => byRunId.size
    };
}
