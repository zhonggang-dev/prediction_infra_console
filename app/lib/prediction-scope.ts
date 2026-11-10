import type { ConsoleV2Overview } from "./console-v2";
import { predictionGenerations } from "./market-rounds.ts";

export const predictionSources = ["POLYMARKET", "KALSHI"] as const;

/** Each platform has one current generation per domain lane (two platforms × nine domains, plus a legacy one each). */
export const MAX_PREDICTION_GENERATIONS = 20;

/** IDs remain strings: generation identity must not lose int64 precision. */
export function predictionGenerationIds(value: string) {
  const ids = value.split(",");
  if (ids.length > MAX_PREDICTION_GENERATIONS || ids.some((id) => !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > BigInt("9223372036854775807")) || new Set(ids).size !== ids.length) return [];
  return ids;
}

/**
 * The current prediction range is every current generation with prediction
 * members of the requested platforms (including carried domains), read as one
 * generation_ids set. A scalar generation_id deep link of one platform and an
 * explicit generation_ids set stay frozen; an invalid one fails closed.
 */
export function currentPredictionRange(overview: ConsoleV2Overview | undefined, source: string, generationId: string, generationIds: string, provided = { single: Boolean(generationId), multiple: Boolean(generationIds) }): { generationId?: string; generationIds?: string; missingSources: string[]; error?: string } {
  const invalid = () => ({ generationId: undefined, generationIds: undefined, missingSources: [] as string[], error: "维护范围参数无效或与所选平台冲突；请重新读取当前维护范围。" });
  if ((provided.single && provided.multiple) || (provided.single && !generationId) || (provided.multiple && !generationIds)) return invalid();
  if (generationId) {
    // Older single-platform links carry one scalar generation.
    return source && predictionGenerationIds(generationId).length === 1 ? { generationId, generationIds: undefined, missingSources: [] } : invalid();
  }
  if (generationIds) {
    const frozen = predictionGenerationIds(generationIds);
    return frozen.length ? { generationId: undefined, generationIds: frozen.join(","), missingSources: [] } : invalid();
  }
  const requested = source ? [source] : [...predictionSources];
  if (!overview) return { generationId: undefined, generationIds: undefined, missingSources: requested };
  const generations = predictionGenerations(overview, source);
  const missingSources = requested.filter((name) => !generations.some((generation) => generation.marketSource === name));
  if (missingSources.length || generations.length > MAX_PREDICTION_GENERATIONS) return { generationId: undefined, generationIds: undefined, missingSources };
  return { generationId: undefined, generationIds: generations.map((generation) => generation.generationId).join(","), missingSources };
}
