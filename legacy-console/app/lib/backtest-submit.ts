/** 提交标识的前端快检（infra 仍会完整校验）：标识段格式，以及 model_id 的专用规则。 */

import type { SubmissionKind } from "./backtest-platform.ts";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

export const IDENTITY_FIELDS: Record<SubmissionKind, string[]> = {
  strategy: ["策略标识", "版本"],
  factor_table: ["表名", "数据版本"],
  prediction: ["模型标识（model_id）", "训练版本", "预测版本"],
};

/** 返回错误文案列表；空数组表示通过。 */
export function validateIdentity(kind: SubmissionKind, parts: string[]): string[] {
  const labels = IDENTITY_FIELDS[kind];
  const errors: string[] = [];
  if (parts.length !== labels.length) return [`需要填写 ${labels.join("、")}`];
  parts.forEach((part, index) => {
    const value = part.trim();
    if (!value) errors.push(`${labels[index]}不能为空`);
    else if (!SEGMENT.test(value)) errors.push(`${labels[index]}只能含字母、数字、点、下划线和连字符，且以字母或数字开头`);
  });
  if (kind === "prediction" && parts[0].trim()) {
    const modelId = parts[0].trim();
    if (!MODEL_ID.test(modelId)) errors.push("model_id 只能含小写字母、数字、点、下划线和连字符（最长 64 位）");
    if (modelId.includes("_pred")) errors.push("model_id 不能含 _pred（脚本靠它识别预测文件）");
    if (modelId.includes("__")) errors.push("model_id 不能含 __（__ 是模型名里的版本分隔符）");
    if (modelId.includes("@")) errors.push("model_id 不能含 @（@ 是缓存文件名里的数据集分隔符）");
    for (const [index, label] of [[1, "训练版本"], [2, "预测版本"]] as const) {
      const part = parts[index]?.trim() ?? "";
      if (part.includes("__") || part.includes("@")) errors.push(`${label}不能含 __ 或 @`);
    }
  }
  return errors;
}
