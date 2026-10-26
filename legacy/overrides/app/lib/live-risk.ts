import type { LiveRiskMetric } from "./types";

type RawRisk = Record<string, unknown>;

type RiskThresholds = Pick<LiveRiskMetric, "warningThreshold" | "hardLimit" | "usagePercentage" | "hardLimitEnforced" | "thresholdType" | "state">;

const WARNING_RATIO = 0.8;

/** LiveRiskContractError 表示 Trading 风险字段不满足前端展示契约。 */
export class LiveRiskContractError extends Error {}

/** normalizeLiveRisk 把新旧 Trading 风险响应统一为显式执行语义。 */
export function normalizeLiveRisk(item: RawRisk): LiveRiskMetric {
  const current = requiredRiskNumber(item.current, "risks.current");
  if (current < 0) throw contractError("实盘聚合接口返回了负数风险当前值");
  const thresholds = hasExplicitRiskContract(item) ? explicitRiskThresholds(item) : legacyRiskThresholds(item, current);
  return {
    id: riskText(item.id, "—"), name: riskText(item.name, "未知风险指标"), current,
    ...thresholds, unit: riskUnit(item.unit), hint: riskText(item.hint, "—"),
  };
}

/** hasExplicitRiskContract 判断响应是否已开始使用新版显式阈值字段。 */
function hasExplicitRiskContract(item: RawRisk): boolean {
  return ["warningThreshold", "hardLimit", "usagePercentage", "hardLimitEnforced", "thresholdType"].some((field) => field in item);
}

/** explicitRiskThresholds 校验并保留新版服务端计算的阈值和状态。 */
function explicitRiskThresholds(item: RawRisk): RiskThresholds {
  const warningThreshold = requiredRiskNumber(item.warningThreshold, "risks.warningThreshold");
  const hardLimit = requiredRiskNumber(item.hardLimit, "risks.hardLimit");
  const usagePercentage = optionalRiskNumber(item.usagePercentage, "risks.usagePercentage");
  const hardLimitEnforced = requiredRiskBoolean(item.hardLimitEnforced, "risks.hardLimitEnforced");
  const thresholdType = riskThresholdType(item.thresholdType);
  validateExplicitThresholds({ warningThreshold, hardLimit, usagePercentage, hardLimitEnforced, thresholdType });
  return { warningThreshold, hardLimit, usagePercentage, hardLimitEnforced, thresholdType, state: riskState(item.state) };
}

/** validateExplicitThresholds 拒绝负数、缺失占用率或执行语义互相矛盾的新版字段。 */
function validateExplicitThresholds(values: Omit<RiskThresholds, "state">): void {
  if (values.warningThreshold < 0 || values.hardLimit < 0 || (values.usagePercentage !== undefined && values.usagePercentage < 0)) {
    throw contractError("实盘聚合接口返回了负数风险阈值");
  }
  if (values.hardLimit > 0 && (values.warningThreshold > values.hardLimit || values.usagePercentage === undefined)) {
    throw contractError("实盘聚合接口返回了不一致的风险阈值");
  }
  if (values.hardLimit === 0 && values.usagePercentage !== undefined) {
    throw contractError("实盘聚合接口返回了无意义的零目标占用率");
  }
  const semanticsMatch = values.thresholdType === "hard_limit" ? values.hardLimitEnforced : !values.hardLimitEnforced;
  if (!semanticsMatch) throw contractError("实盘聚合接口返回了矛盾的风险执行语义");
}

/** legacyRiskThresholds 将旧版 limit 字段安全降级为不拦截交易的运营目标。 */
function legacyRiskThresholds(item: RawRisk, current: number): RiskThresholds {
  const hardLimit = requiredRiskNumber(item.limit, "risks.limit");
  if (hardLimit < 0) throw contractError("实盘聚合接口返回了负数风险目标");
  const warningThreshold = hardLimit * WARNING_RATIO;
  const usagePercentage = hardLimit > 0 ? current / hardLimit * 100 : undefined;
  return {
    warningThreshold, hardLimit, usagePercentage, hardLimitEnforced: false, thresholdType: "target",
    state: derivedTargetState(current, warningThreshold, hardLimit),
  };
}

/** derivedTargetState 根据旧版当前值和目标重新计算可信展示状态。 */
function derivedTargetState(current: number, warningThreshold: number, hardLimit: number): LiveRiskMetric["state"] {
  if (hardLimit === 0) return current > 0 ? "danger" : "safe";
  if (current >= hardLimit) return "danger";
  return current >= warningThreshold ? "warning" : "safe";
}

/** requiredRiskNumber 读取必填且有限的风险数字。 */
function requiredRiskNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw contractError(`实盘聚合接口返回了无效的 ${field}`);
  return parsed;
}

/** optionalRiskNumber 读取可选且有限的风险数字。 */
function optionalRiskNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw contractError(`实盘聚合接口返回了无效的 ${field}`);
  return parsed;
}

/** requiredRiskBoolean 读取必填的风险布尔值。 */
function requiredRiskBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw contractError(`实盘聚合接口返回了无效的 ${field}`);
  return value;
}

/** riskThresholdType 解析服务端声明的硬上限或运营目标类型。 */
function riskThresholdType(value: unknown): LiveRiskMetric["thresholdType"] {
  if (value === "hard_limit" || value === "target") return value;
  throw contractError("实盘聚合接口返回了未知的风险阈值类型");
}

/** riskState 解析新版服务端状态，未知值按危险展示。 */
function riskState(value: unknown): LiveRiskMetric["state"] {
  return value === "safe" || value === "warning" || value === "danger" ? value : "danger";
}

/** riskUnit 把未知单位降级成通用计数单位。 */
function riskUnit(value: unknown): LiveRiskMetric["unit"] {
  return value === "$" || value === "%" || value === "minutes" ? value : "count";
}

/** riskText 把可展示风险文本转换为非空字符串。 */
function riskText(value: unknown, fallback: string): string {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

/** contractError 创建统一的风险契约错误。 */
function contractError(message: string): LiveRiskContractError {
  return new LiveRiskContractError(message);
}
