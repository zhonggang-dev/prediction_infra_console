import type { ConsoleV2PredictionBatchSummary } from "./console-v2";
import { predictionGenerationIds } from "./prediction-scope.ts";

type Params = Record<string, string | number | undefined>;
export const predictionBatchQueryKeys = ["batch_prediction_as_of", "batch_max_result_id", "batch_generation_id", "batch_model", "batch_source", "batch_context"];
export interface FixedPredictionBatch {
  modelId: string;
  marketSource: string;
  predictionAsOf: string;
  maxResultId: string;
  generationId?: string;
}

export function predictionBatchParentContext(params: Params) {
  return JSON.stringify({ model: String(params.model || ""), source: String(params.source || ""), sources: params.source ? "" : String(params.sources || "POLYMARKET,KALSHI"), scope: String(params.scope || "history"), generation_id: String(params.generation_id || ""), generation_ids: predictionGenerationIds(String(params.generation_ids || "")).sort().join(","), prediction_as_of: String(params.prediction_as_of || "") });
}

export function fixedPredictionBatch(params: Params): FixedPredictionBatch | undefined {
  if (params.batch_context) {
    try {
      const saved = JSON.parse(String(params.batch_context));
      // Older single-platform current links omitted the parent generation.
      // Migrate only when the saved batch independently proves that exact ID.
      if (saved.scope === "current" && !saved.generation_id && !saved.generation_ids && params.generation_id && params.batch_generation_id === params.generation_id) saved.generation_id = params.generation_id;
      if (predictionBatchParentContext(saved) !== predictionBatchParentContext(params)) return undefined;
    } catch { return undefined; }
  }
  if (!params.batch_model || !params.batch_source || !params.batch_prediction_as_of || !params.batch_max_result_id) return undefined;
  if (params.model && params.model !== params.batch_model) return undefined;
  if (params.source && params.source !== params.batch_source) return undefined;
  if (params.generation_id && params.batch_generation_id && params.generation_id !== params.batch_generation_id) return undefined;
  if (params.generation_ids && (!params.batch_generation_id || !predictionGenerationIds(String(params.generation_ids)).includes(String(params.batch_generation_id)))) return undefined;
  return { modelId: String(params.batch_model), marketSource: String(params.batch_source), predictionAsOf: String(params.batch_prediction_as_of), maxResultId: String(params.batch_max_result_id), generationId: params.batch_generation_id ? String(params.batch_generation_id) : params.generation_id ? String(params.generation_id) : undefined };
}

/** A newer directory entry must never replace the selected snapshot's watermark. */
export function matchingPredictionBatch(batches: ConsoleV2PredictionBatchSummary[], scope: FixedPredictionBatch | undefined) {
  return scope && batches.find((item) => item.modelId === scope.modelId && item.marketSource === scope.marketSource && item.predictionAsOf === scope.predictionAsOf && item.maxResultId === scope.maxResultId);
}

export function predictionResultQuery(params: Params) {
  const query = { ...params };
  const fixed = fixedPredictionBatch(params);
  if (fixed) {
    query.model = fixed.modelId;
    query.source = fixed.marketSource;
    delete query.sources;
    delete query.generation_ids;
    delete query.generation_id;
    query.prediction_as_of = fixed.predictionAsOf;
    query.max_result_id = fixed.maxResultId;
    if (fixed.generationId) query.generation_id = fixed.generationId;
  }
  for (const key of predictionBatchQueryKeys) delete query[key];
  delete query.scope;
  return query;
}
