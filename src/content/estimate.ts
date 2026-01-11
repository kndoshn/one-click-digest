namespace AS {
  export namespace Estimate {
    export type TokenEstimate = { low: number; high: number };

    // Conservative overhead constants (tokens).
    // Notes:
    // - roughTokenEstimate() only sees the article body, not the full prompt.
    // - COUNT_TOKENS uses a minimal prompt (title/url + body) for speed.
    // These constants reduce the risk of under-estimating cost.
    const TOKEN_COUNT_PROMPT_OVERHEAD_TOKENS = 256;
    const SINGLE_PROMPT_OVERHEAD_TOKENS = 256;
    const MAP_PROMPT_OVERHEAD_TOKENS_PER_CHUNK = 96;
    const REDUCE_PROMPT_OVERHEAD_TOKENS = 256;
    const REPAIR_PROMPT_OVERHEAD_TOKENS = 256;

    function countCjkChars(text: string): number {
      let n = 0;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        // Rough CJK ranges: Hiragana, Katakana, CJK Unified Ideographs.
        if (
          (code >= 0x3040 && code <= 0x30ff) ||
          (code >= 0x4e00 && code <= 0x9fff) ||
          (code >= 0x3400 && code <= 0x4dbf)
        ) {
          n++;
        }
      }
      return n;
    }

    function roughTokenEstimate(text: string): TokenEstimate {
      const chars = text.length;
      if (chars <= 0) return { low: 0, high: 0 };

      const cjk = countCjkChars(text);
      const cjkRatio = cjk / Math.max(1, chars);

      // These ratios are intentionally coarse.
      if (cjkRatio >= 0.25) {
        return {
          low: Math.ceil(chars / 2.2),
          high: Math.ceil(chars / 1.4)
        };
      }

      return {
        low: Math.ceil(chars / 4.6),
        high: Math.ceil(chars / 3.3)
      };
    }

    /**
     * Public token estimate helper (rough). Useful for chunk sizing.
     */
    export function estimateTokens(text: string): TokenEstimate {
      return roughTokenEstimate(text);
    }

    function costUsdInOut(inputTokens: number, outputTokens: number, pricing: ModelPricing, inputMultiplier = 1): number {
      const mult = Number.isFinite(inputMultiplier) && inputMultiplier > 0 ? inputMultiplier : 1;
      const input = (inputTokens / 1_000_000) * pricing.inputUsdPerMTok * mult;
      const output = (outputTokens / 1_000_000) * pricing.outputUsdPerMTok;
      return input + output;
    }

    function costUsdInTokens(inputTokens: number, pricing: ModelPricing, inputMultiplier = 1): number {
      return costUsdInOut(inputTokens, 0, pricing, inputMultiplier);
    }

    function costUsdOutTokens(outputTokens: number, pricing: ModelPricing): number {
      return costUsdInOut(0, outputTokens, pricing, 1);
    }

    function cacheWriteMultiplier(): number {
      return PROMPT_CACHING_TTL === '1h' ? CACHE_MULTIPLIERS.write1h : CACHE_MULTIPLIERS.write5m;
    }

    function cacheMinTokensForModel(model: string): number {
      // If unknown, assume caching could apply to avoid underestimating.
      return typeof MODEL_CACHE_MIN_TOKENS[model] === 'number' ? MODEL_CACHE_MIN_TOKENS[model] : 0;
    }

    function clampNonNeg(n: number): number {
      return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function computeChunkCount(inputTokens: number): number {
      const t = clampNonNeg(inputTokens);
      return t > CHUNK_TARGET_INPUT_TOKENS ? Math.ceil(t / CHUNK_TARGET_INPUT_TOKENS) : 1;
    }

    function computeCostNoRepair(args: {
      totalInputTokens: number;
      chunkCount: number;
      modeMaxOutputTokens: number;
      mapPricing: ModelPricing;
      finalPricing: ModelPricing;
      finalModel: string;
    }): number {
      const totalInputTokens = clampNonNeg(args.totalInputTokens);
      const chunkCount = Math.max(1, Math.floor(args.chunkCount));
      const outMax = Math.max(0, Math.floor(args.modeMaxOutputTokens));

      if (chunkCount <= 1) {
        // Single-pass summary uses the map model (cheapest sufficient default).
        // The final model is reserved for reduce/repair in chunked runs.
        return costUsdInOut(totalInputTokens + SINGLE_PROMPT_OVERHEAD_TOKENS, outMax, args.mapPricing);
      }

      // Map-reduce:
      // - Map: each chunk -> small bullet summary (map model)
      // - Reduce: combine chunk summaries into final summary (final model)
      const mapOutputTokensTotal = chunkCount * MAP_CHUNK_MAX_OUTPUT_TOKENS;

      // Map stage repeats small metadata per chunk (title/url/chunk headers).
      const mapInputWithOverhead = totalInputTokens + chunkCount * MAP_PROMPT_OVERHEAD_TOKENS_PER_CHUNK;
      const mapCost = costUsdInOut(mapInputWithOverhead, mapOutputTokensTotal, args.mapPricing);

      // Reduce stage prompt includes chunk summaries + some overhead.
      const reduceInput = mapOutputTokensTotal + REDUCE_PROMPT_OVERHEAD_TOKENS;

      // Prompt caching: chunk summaries are marked cacheable in reduce/repair.
      // Worst-case (cost-wise) includes cache write cost when caching is enabled and the prefix is long enough.
      const useCaching = PROMPT_CACHING_ENABLED;
      const cacheMin = cacheMinTokensForModel(args.finalModel);
      const cachingLikely = useCaching && reduceInput >= cacheMin;
      const writeMult = cachingLikely ? cacheWriteMultiplier() : 1;

      const reduceCost = costUsdInTokens(reduceInput, args.finalPricing, writeMult) + costUsdOutTokens(outMax, args.finalPricing);
      return mapCost + reduceCost;
    }

    function computeRepairCost(args: {
      chunkCount: number;
      modeMaxOutputTokens: number;
      mapPricing: ModelPricing;
      finalPricing: ModelPricing;
      finalModel: string;
    }): number {
      const chunkCount = Math.max(1, Math.floor(args.chunkCount));
      const outMax = Math.max(0, Math.floor(args.modeMaxOutputTokens));

      if (chunkCount <= 1) {
        // Single-pass repair: repair prompt is based on the draft output.
        const repairInput = outMax + REPAIR_PROMPT_OVERHEAD_TOKENS;
        return costUsdInOut(repairInput, outMax, args.mapPricing);
      }

      // Chunked repair: a second reduce-style call. Conservative:
      // assume chunk summaries are re-sent and the same output length is generated.
      const mapOutputTokensTotal = chunkCount * MAP_CHUNK_MAX_OUTPUT_TOKENS;

      // Repair (reduce2) includes the cached prefix (chunk summaries + overhead) plus the original output.
      // Conservative: assume no cache hit (i.e., full input is billed at normal rate).
      const reduceInput = mapOutputTokensTotal + REDUCE_PROMPT_OVERHEAD_TOKENS;
      const repairInput = reduceInput + outMax + REPAIR_PROMPT_OVERHEAD_TOKENS;
      return costUsdInOut(repairInput, outMax, args.finalPricing);
    }

    function modelLabel(chunkCount: number, mapModel: string, finalModel: string): string {
      if (chunkCount > 1) return `map: ${mapModel} / final: ${finalModel}`;
      // Single-pass uses the map model.
      return mapModel;
    }

    function timeRangeSec(chunkCount: number): { low: number; high: number } {
      const perReqLow = 3;
      const perReqHigh = 12;

      // map = chunkCount requests, reduce = 1 request
      const reqCount = chunkCount <= 1 ? 1 : chunkCount + 1;
      // Worst-case includes one additional repair request.
      const worstReqCount = reqCount + 1;

      const low = reqCount * perReqLow + 1;
      const high = worstReqCount * perReqHigh + 2;

      return { low, high };
    }

    export function buildEstimate(args: {
      extractedCharCount: number;
      textToSend: string;
      truncated: boolean;
      mode: SummaryMode;
      mapModel: string;
      finalModel: string;
    }): Estimate {
      const extractedCharCount = clampNonNeg(args.extractedCharCount);
      const sentCharCount = args.textToSend.length;
      const token = estimateTokens(args.textToSend);
      const spec = getModeRuntimeSpec(args.mode);

      const mapPricing = PRICING[args.mapModel] || PRICING[MODEL_MAP];
      const finalPricing = PRICING[args.finalModel] || PRICING[MODEL_FINAL];

      const chunkCountLow = computeChunkCount(token.low);
      const chunkCountHigh = computeChunkCount(token.high);
      const chunkCount = Math.max(chunkCountLow, chunkCountHigh);

      const costLow = computeCostNoRepair({
        totalInputTokens: token.low,
        chunkCount: chunkCountLow,
        modeMaxOutputTokens: spec.maxOutputTokens,
        mapPricing,
        finalPricing,
        finalModel: args.finalModel
      });

      const costHigh = computeCostNoRepair({
        totalInputTokens: token.high,
        chunkCount: chunkCountHigh,
        modeMaxOutputTokens: spec.maxOutputTokens,
        mapPricing,
        finalPricing,
        finalModel: args.finalModel
      });

      const repairCost = computeRepairCost({
        chunkCount: chunkCountHigh,
        modeMaxOutputTokens: spec.maxOutputTokens,
        mapPricing,
        finalPricing,
        finalModel: args.finalModel
      });
      const costWorst = costHigh + repairCost;

      const time = timeRangeSec(chunkCount);

      return {
        charCount: extractedCharCount,
        tokenLow: token.low,
        tokenHigh: token.high,
        chunkCount,
        costLowUsd: costLow,
        costHighUsd: costHigh,
        costWorstUsd: costWorst,
        timeLowSec: time.low,
        timeHighSec: time.high,
        model: modelLabel(chunkCount, args.mapModel, args.finalModel),
        mapModel: args.mapModel,
        finalModel: args.finalModel,
        maxOutputTokens: spec.maxOutputTokens,
        truncated: args.truncated,
        sentCharCount
      };
    }

    export function applyExactTokens(estimate: Estimate, exactInputTokens: number): Estimate {
      // Token Count API counted a minimal prompt. Add a small overhead to reduce underestimation risk.
      const exact = Math.max(0, Math.floor(exactInputTokens)) + TOKEN_COUNT_PROMPT_OVERHEAD_TOKENS;

      const specMax = estimate.maxOutputTokens;
      const chunkCount = computeChunkCount(exact);
      const mapPricing = PRICING[estimate.mapModel] || PRICING[MODEL_MAP];
      const finalPricing = PRICING[estimate.finalModel] || PRICING[MODEL_FINAL];

      const cost = computeCostNoRepair({
        totalInputTokens: exact,
        chunkCount,
        modeMaxOutputTokens: specMax,
        mapPricing,
        finalPricing,
        finalModel: estimate.finalModel
      });
      const repairCost = computeRepairCost({
        chunkCount,
        modeMaxOutputTokens: specMax,
        mapPricing,
        finalPricing,
        finalModel: estimate.finalModel
      });
      const time = timeRangeSec(chunkCount);

      return {
        ...estimate,
        tokenExact: exact,
        tokenLow: exact,
        tokenHigh: exact,
        chunkCount,
        costLowUsd: cost,
        costHighUsd: cost,
        costWorstUsd: cost + repairCost,
        timeLowSec: time.low,
        timeHighSec: time.high,
        model: modelLabel(chunkCount, estimate.mapModel, estimate.finalModel)
      };
    }

    export function needsApproval(estimate: Estimate): boolean {
      if (estimate.truncated) return true;
      if (estimate.charCount >= APPROVAL_THRESHOLD_CHARS) return true;
      if (estimate.costHighUsd >= APPROVAL_THRESHOLD_USD) return true;
      return false;
    }

    export function isOverHardLimit(estimate: Estimate): boolean {
      return estimate.costWorstUsd > HARD_COST_LIMIT_USD;
    }
  }
}
