/**
 * 同一模型对同一市场可预测多次（prediction_run 1～3）。后端字段尚在逐步上线：
 * 缺失、非整数或超出范围一律视为未提供，不报错也不猜测为第 1 次。
 */
export const PREDICTION_RUNS = [1, 2, 3] as const;
export const MAX_PREDICTION_RUN = PREDICTION_RUNS[PREDICTION_RUNS.length - 1];

export function predictionRunValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_PREDICTION_RUN ? value : undefined;
}

/** URL/筛选里的 run 只认 "1"～"3"，其他值当作「全部」。 */
export function predictionRunFilter(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return PREDICTION_RUNS.some((run) => String(run) === text) ? text : "";
}

export function predictionRunLabel(run: number | undefined): string | undefined {
  return run === undefined ? undefined : `第 ${run} 次`;
}

/** "v4.1 flash · 第 2 次"；序号缺失时只返回模型名。 */
export function modelWithRunLabel(model: string, run: number | undefined): string {
  const label = predictionRunLabel(run);
  return label ? `${model} · ${label}` : model;
}
