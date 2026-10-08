// Per-model extra request parameters for the Messages API.
//
// Policy: keep each pipeline stage's thinking behavior unchanged across model upgrades.
// - Map/single-pass ran on Claude Haiku 4.5 without thinking, so Claude Haiku 5.5 (thinking on by
//   default) has it turned off. Otherwise thinking would consume the small max_tokens budgets
//   (e.g. 220 for map chunks) and trigger max_tokens retries.
// - Reduce/repair ran on Claude Sonnet 5 with adaptive thinking (its default), so Claude Sonnet 5.5
//   keeps adaptive thinking, with effort pinned below its `high` default to bound thinking tokens.
//
// Models not listed here get no extra parameters (their existing behavior is unchanged).
const MODEL_REQUEST_PARAMS = {
    // "disabled" is accepted only at effort high or below; the default effort (medium) qualifies.
    'claude-haiku-5-5': () => ({ thinking: { type: 'disabled' } }),
    // Sonnet 5.5 rejects thinking.type "disabled" with a 400; keep adaptive (the default) and set effort.
    'claude-sonnet-5-5': () => ({ output_config: { effort: 'medium' } })
};
export function modelRequestParams(model) {
    const build = MODEL_REQUEST_PARAMS[model];
    return build ? build() : {};
}
