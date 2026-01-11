"use strict";
var AS;
(function (AS) {
    let Estimate;
    (function (Estimate) {
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
        function countCjkChars(text) {
            let n = 0;
            for (let i = 0; i < text.length; i++) {
                const code = text.charCodeAt(i);
                // Rough CJK ranges: Hiragana, Katakana, CJK Unified Ideographs.
                if ((code >= 0x3040 && code <= 0x30ff) ||
                    (code >= 0x4e00 && code <= 0x9fff) ||
                    (code >= 0x3400 && code <= 0x4dbf)) {
                    n++;
                }
            }
            return n;
        }
        function roughTokenEstimate(text) {
            const chars = text.length;
            if (chars <= 0)
                return { low: 0, high: 0 };
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
        function estimateTokens(text) {
            return roughTokenEstimate(text);
        }
        Estimate.estimateTokens = estimateTokens;
        function costUsdInOut(inputTokens, outputTokens, pricing, inputMultiplier = 1) {
            const mult = Number.isFinite(inputMultiplier) && inputMultiplier > 0 ? inputMultiplier : 1;
            const input = (inputTokens / 1_000_000) * pricing.inputUsdPerMTok * mult;
            const output = (outputTokens / 1_000_000) * pricing.outputUsdPerMTok;
            return input + output;
        }
        function costUsdInTokens(inputTokens, pricing, inputMultiplier = 1) {
            return costUsdInOut(inputTokens, 0, pricing, inputMultiplier);
        }
        function costUsdOutTokens(outputTokens, pricing) {
            return costUsdInOut(0, outputTokens, pricing, 1);
        }
        function cacheWriteMultiplier() {
            return AS.PROMPT_CACHING_TTL === '1h' ? AS.CACHE_MULTIPLIERS.write1h : AS.CACHE_MULTIPLIERS.write5m;
        }
        function cacheMinTokensForModel(model) {
            // If unknown, assume caching could apply to avoid underestimating.
            return typeof AS.MODEL_CACHE_MIN_TOKENS[model] === 'number' ? AS.MODEL_CACHE_MIN_TOKENS[model] : 0;
        }
        function clampNonNeg(n) {
            return Number.isFinite(n) && n > 0 ? n : 0;
        }
        function computeChunkCount(inputTokens) {
            const t = clampNonNeg(inputTokens);
            return t > AS.CHUNK_TARGET_INPUT_TOKENS ? Math.ceil(t / AS.CHUNK_TARGET_INPUT_TOKENS) : 1;
        }
        function computeCostNoRepair(args) {
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
            const mapOutputTokensTotal = chunkCount * AS.MAP_CHUNK_MAX_OUTPUT_TOKENS;
            // Map stage repeats small metadata per chunk (title/url/chunk headers).
            const mapInputWithOverhead = totalInputTokens + chunkCount * MAP_PROMPT_OVERHEAD_TOKENS_PER_CHUNK;
            const mapCost = costUsdInOut(mapInputWithOverhead, mapOutputTokensTotal, args.mapPricing);
            // Reduce stage prompt includes chunk summaries + some overhead.
            const reduceInput = mapOutputTokensTotal + REDUCE_PROMPT_OVERHEAD_TOKENS;
            // Prompt caching: chunk summaries are marked cacheable in reduce/repair.
            // Worst-case (cost-wise) includes cache write cost when caching is enabled and the prefix is long enough.
            const useCaching = AS.PROMPT_CACHING_ENABLED;
            const cacheMin = cacheMinTokensForModel(args.finalModel);
            const cachingLikely = useCaching && reduceInput >= cacheMin;
            const writeMult = cachingLikely ? cacheWriteMultiplier() : 1;
            const reduceCost = costUsdInTokens(reduceInput, args.finalPricing, writeMult) + costUsdOutTokens(outMax, args.finalPricing);
            return mapCost + reduceCost;
        }
        function computeRepairCost(args) {
            const chunkCount = Math.max(1, Math.floor(args.chunkCount));
            const outMax = Math.max(0, Math.floor(args.modeMaxOutputTokens));
            if (chunkCount <= 1) {
                // Single-pass repair: repair prompt is based on the draft output.
                const repairInput = outMax + REPAIR_PROMPT_OVERHEAD_TOKENS;
                return costUsdInOut(repairInput, outMax, args.mapPricing);
            }
            // Chunked repair: a second reduce-style call. Conservative:
            // assume chunk summaries are re-sent and the same output length is generated.
            const mapOutputTokensTotal = chunkCount * AS.MAP_CHUNK_MAX_OUTPUT_TOKENS;
            // Repair (reduce2) includes the cached prefix (chunk summaries + overhead) plus the original output.
            // Conservative: assume no cache hit (i.e., full input is billed at normal rate).
            const reduceInput = mapOutputTokensTotal + REDUCE_PROMPT_OVERHEAD_TOKENS;
            const repairInput = reduceInput + outMax + REPAIR_PROMPT_OVERHEAD_TOKENS;
            return costUsdInOut(repairInput, outMax, args.finalPricing);
        }
        function modelLabel(chunkCount, mapModel, finalModel) {
            if (chunkCount > 1)
                return `map: ${mapModel} / final: ${finalModel}`;
            // Single-pass uses the map model.
            return mapModel;
        }
        function timeRangeSec(chunkCount) {
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
        function buildEstimate(args) {
            const extractedCharCount = clampNonNeg(args.extractedCharCount);
            const sentCharCount = args.textToSend.length;
            const token = estimateTokens(args.textToSend);
            const spec = AS.getModeRuntimeSpec(args.mode);
            const mapPricing = AS.PRICING[args.mapModel] || AS.PRICING[AS.MODEL_MAP];
            const finalPricing = AS.PRICING[args.finalModel] || AS.PRICING[AS.MODEL_FINAL];
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
        Estimate.buildEstimate = buildEstimate;
        function applyExactTokens(estimate, exactInputTokens) {
            // Token Count API counted a minimal prompt. Add a small overhead to reduce underestimation risk.
            const exact = Math.max(0, Math.floor(exactInputTokens)) + TOKEN_COUNT_PROMPT_OVERHEAD_TOKENS;
            const specMax = estimate.maxOutputTokens;
            const chunkCount = computeChunkCount(exact);
            const mapPricing = AS.PRICING[estimate.mapModel] || AS.PRICING[AS.MODEL_MAP];
            const finalPricing = AS.PRICING[estimate.finalModel] || AS.PRICING[AS.MODEL_FINAL];
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
        Estimate.applyExactTokens = applyExactTokens;
        function needsApproval(estimate) {
            if (estimate.truncated)
                return true;
            if (estimate.charCount >= AS.APPROVAL_THRESHOLD_CHARS)
                return true;
            if (estimate.costHighUsd >= AS.APPROVAL_THRESHOLD_USD)
                return true;
            return false;
        }
        Estimate.needsApproval = needsApproval;
        function isOverHardLimit(estimate) {
            return estimate.costWorstUsd > AS.HARD_COST_LIMIT_USD;
        }
        Estimate.isOverHardLimit = isOverHardLimit;
    })(Estimate = AS.Estimate || (AS.Estimate = {}));
})(AS || (AS = {}));
