// Abort registry for background requests.
//
// Why this exists:
// - Multiple requests can overlap for the same runId (e.g., COUNT_TOKENS running while
//   the user proceeds to summarization).
// - We need ABORT_RUN to cancel *all* in-flight network calls for that runId.
// - We must not implicitly abort a previous request when a new one starts.

export type AbortRegistry = {
  /** Register an AbortController as in-flight for the given runId. */
  register: (runId: string, controller: AbortController) => void;
  /** Unregister a previously registered AbortController. */
  unregister: (runId: string, controller: AbortController) => void;
  /** Abort all in-flight controllers for the given runId. Returns true if anything was aborted. */
  abortRun: (runId: string) => boolean;

  // Debug helpers (used only by tests).
  _debugCountControllers: (runId: string) => number;
  _debugCountRuns: () => number;
};

export function createAbortRegistry(): AbortRegistry {
  const byRunId = new Map<string, Set<AbortController>>();

  function ensureSet(runId: string): Set<AbortController> {
    let set = byRunId.get(runId);
    if (!set) {
      set = new Set<AbortController>();
      byRunId.set(runId, set);
    }
    return set;
  }

  function register(runId: string, controller: AbortController): void {
    if (!runId) return;
    ensureSet(runId).add(controller);
  }

  function unregister(runId: string, controller: AbortController): void {
    if (!runId) return;
    const set = byRunId.get(runId);
    if (!set) return;
    set.delete(controller);
    if (set.size === 0) byRunId.delete(runId);
  }

  function abortRun(runId: string): boolean {
    if (!runId) return false;
    const set = byRunId.get(runId);
    if (!set || set.size === 0) return false;

    for (const controller of Array.from(set)) {
      try {
        controller.abort();
      } catch {
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
    _debugCountControllers: (runId: string) => byRunId.get(runId)?.size || 0,
    _debugCountRuns: () => byRunId.size
  };
}
