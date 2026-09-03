import assert from "node:assert/strict";
import test from "node:test";

import { calculateMaximumDrawdown } from "../app/lib/pnl-metrics.ts";
import type { DailyPnLPoint, DailyPnLReport } from "../app/lib/types.ts";

const wallet = "acct-wallet-a";

test("最大回撤按钱包聚合多策略的累计日收益", () => {
  const report = pnlReport([
    point("2026-08-24", 6, "alpha"), point("2026-08-24", 4, "beta"),
    point("2026-08-25", -3, "alpha"), point("2026-08-25", -1, "beta"),
    point("2026-08-26", 1, "alpha"),
    point("2026-08-27", -10, "alpha"),
    { ...point("2026-08-27", -100, "ignored"), executionAccountId: "acct-wallet-b" },
  ]);

  assert.equal(calculateMaximumDrawdown(report, wallet), 13);
});

test("区间初始亏损从零净值起点计入回撤", () => {
  assert.equal(calculateMaximumDrawdown(pnlReport([point("2026-08-24", -5, "alpha")]), wallet), 5);
});

test("钱包没有账本数据时不伪造零回撤", () => {
  assert.equal(calculateMaximumDrawdown(pnlReport([point("2026-08-24", 3, "alpha")]), "acct-missing"), null);
});

function point(day: string, realizedPnl: number, strategyId: string): DailyPnLPoint {
  return { day, executionAccountId: wallet, modelId: "forecast-v2", strategyId, realizedPnl: String(realizedPnl), closedTradeCount: 1, closedShares: "1", redemptionCount: 0, redemptionPnl: "0" };
}

function pnlReport(items: DailyPnLPoint[]): DailyPnLReport {
  return { items, days: 4, fromDay: "2026-08-24", toDay: "2026-08-27", timezone: "UTC", generatedAt: "2026-08-27T00:00:00.000Z" };
}
