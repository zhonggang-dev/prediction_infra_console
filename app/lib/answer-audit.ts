export interface AnswerAudit {
  grade: string;
  gradeLabel: string;
  gate: string;
  error: string;
  grading?: unknown;
  coverage?: unknown;
}

const gradeLabels: Record<string, string> = {
  A: "A · 权威来源",
  B: "B · 多个独立来源",
  C: "C · 单一来源或存在分歧",
};

const gateLabels: Record<string, string> = {
  passed: "已通过",
  answer_valid: "答案不合法",
  quote_grounded: "引文不在抓取内容中",
  agent_outcome: "Agent 未给出终态答案",
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const label = (labels: Record<string, string>, key: string): string => (Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : key);

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** 从最近一次判定（attempt.decision）中取出证据等级与门禁诊断；字段缺失时返回空串，旧数据照常展示。 */
export function readAnswerAudit(latestResult: unknown): AnswerAudit {
  const decision = record(latestResult);
  const diagnostics = record(decision.diagnostics);
  const grade = str(decision.answer_grade);
  const gate = str(diagnostics.gate);
  return {
    grade,
    gradeLabel: grade ? label(gradeLabels, grade) : "",
    gate: gate ? label(gateLabels, gate) : "",
    error: str(diagnostics.error),
    grading: diagnostics.grading,
    coverage: diagnostics.coverage,
  };
}
