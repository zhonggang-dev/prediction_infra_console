import type { DailyPnLReport } from "./types";

/**
 * 按 UTC 自然日汇总指定钱包的净已实现盈亏，并以 0 作为区间起点计算最大回撤。
 * 返回正数表示从历史高点回落的金额；没有该钱包数据时返回 null。
 */
export function calculateMaximumDrawdown(report: DailyPnLReport | undefined, executionAccountId: string | undefined): number | null {
  if (!report || !executionAccountId) return null;
  const dailyPnL = new Map<string, number>();
  for (const point of report.items) {
    if (point.executionAccountId !== executionAccountId) continue;
    dailyPnL.set(point.day, (dailyPnL.get(point.day) ?? 0) + numeric(point.realizedPnl));
  }
  if (!dailyPnL.size) return null;

  let cumulative = 0;
  let peak = 0;
  let maximumDrawdown = 0;
  for (const value of [...dailyPnL.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value)) {
    cumulative += value;
    peak = Math.max(peak, cumulative);
    maximumDrawdown = Math.max(maximumDrawdown, peak - cumulative);
  }
  return maximumDrawdown;
}

const numeric = (value: string) => Number(value) || 0;
