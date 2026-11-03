import type { ConsoleV2Overview } from "./console-v2";

export const predictionSources = ["POLYMARKET", "KALSHI"] as const;

/** IDs remain strings: generation identity must not lose int64 precision. */
export function predictionGenerationIds(value: string) {
  const ids = value.split(",");
  if (ids.length > 2 || ids.some((id) => !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > BigInt("9223372036854775807")) || new Set(ids).size !== ids.length) return [];
  return ids;
}

export function currentPredictionRange(overview: ConsoleV2Overview | undefined, source: string, generationId: string, generationIds: string, provided = { single: Boolean(generationId), multiple: Boolean(generationIds) }): { generationId?: string; generationIds?: string; missingSources: string[]; error?: string } {
  const invalid = () => ({ generationId: undefined, generationIds: undefined, missingSources: [] as string[], error: "维护范围参数无效或与所选平台冲突；请重新读取当前维护范围。" });
  if ((provided.single && provided.multiple) || (provided.single && !generationId) || (provided.multiple && !generationIds)) return invalid();
  const frozen = predictionGenerationIds(source ? generationId || generationIds : generationIds);
  if (frozen.length === (source ? 1 : 2)) return { generationId: source ? frozen[0] : undefined, generationIds: source ? undefined : frozen.join(","), missingSources: [] as string[] };
  // An explicit frozen identity must fail closed. Replacing it with overview
  // would silently show a different maintenance range from the requested URL.
  if (generationId || generationIds) return invalid();
  const requested = source ? [source] : [...predictionSources];
  const current = requested.map((name) => overview?.sources.find((item) => item.marketSource === name)?.currentGeneration);
  const missingSources = requested.filter((_, index) => !current[index]);
  if (!overview || missingSources.length) return { generationId: undefined, generationIds: undefined, missingSources };
  const ids = current.map((item) => item!.generationId);
  return { generationId: source ? ids[0] : undefined, generationIds: source ? undefined : ids.join(","), missingSources };
}
