const moneyFormat = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
const percentFormat = new Intl.NumberFormat("zh-CN", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false, signDisplay: "exceptZero" });

const ratioFormat = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
export function formatCoreRatio(value: string | null): string { return value === null ? "—" : ratioFormat.format(Number(value)); }

export function formatCoreMoney(value: string | null, signed = false): string {
  if (value === null) return "—";
  const text = moneyFormat.format(Number(value));
  return signed ? text : text.replace(/^\+/, "");
}
export function formatCorePercent(value: string | null): string {
  return value === null ? "—" : percentFormat.format(Number(value));
}
/** Color follows the displayed precision, including values rounded to zero. */
export function coreMetricTone(value: string | null, kind: "money" | "percent" = "money"): "positive" | "negative" | "" {
  if (value === null) return "";
  const parts = (kind === "percent" ? percentFormat : moneyFormat).formatToParts(Number(value));
  return parts.some(part => part.type === "minusSign") ? "negative" : parts.some(part => part.type === "plusSign") ? "positive" : "";
}
