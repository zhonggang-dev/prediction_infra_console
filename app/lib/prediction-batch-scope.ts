import type { ConsoleV2PredictionBatchSummary } from "./console-v2";

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
  return JSON.stringify({ model: String(params.model || ""), source: String(params.source || ""), scope: String(params.scope || "history"), generation_id: params.scope === "current" ? "" : String(params.generation_id || ""), prediction_as_of: String(params.prediction_as_of || "") });
}

export function fixedPredictionBatch(params: Params): FixedPredictionBatch | undefined {
  if (params.batch_context && params.batch_context !== predictionBatchParentContext(params)) return undefined;
  if (!params.batch_model || !params.batch_source || !params.batch_prediction_as_of || !params.batch_max_result_id) return undefined;
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
    query.prediction_as_of = fixed.predictionAsOf;
    query.max_result_id = fixed.maxResultId;
    if (fixed.generationId) query.generation_id = fixed.generationId;
  }
  for (const key of predictionBatchQueryKeys) delete query[key];
  delete query.scope;
  return query;
}
