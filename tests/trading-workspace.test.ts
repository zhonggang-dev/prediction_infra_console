import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { decodeTradingHolding, holdingIdentity } from "../app/lib/trading-holdings.ts";
import { consoleV2 } from "../app/lib/console-v2.ts";
import { deriveAccountPermission } from "../app/lib/trading-permissions.ts";
import { filterUnmanagedPositions, formatTradingDisplayValue, normalizeOverviewSources, summarizeAttention } from "../app/lib/trading-display.ts";

const helpers = {
  requiredText(value: unknown, field: string) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`missing ${field}`);
    return value;
  },
  optionalText(value: unknown) { return typeof value === "string" && value.trim() ? value : undefined; },
  optionalTime(value: unknown) { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined; },
};

test("holdings decoder preserves decimal strings and complete historical identity", () => {
  const item = decodeTradingHolding({
    execution_account_id: "wallet-a", model_id: "legacy-v1", strategy_id: "old", market_source: "POLYMARKET", market_id: "m-1", condition_id: "c-1", token_id: "t-1", outcome_index: 0, outcome_name: "Yes", status: "MIXED", market_question: "Will fixture resolve?", remaining_shares: "12.340000", remaining_cost: "4.567890", lot_count: 2, first_opened_at: "2026-10-20T00:00:00Z", last_opened_at: "2026-10-22T00:00:00Z", mark_price: null, mark_observed_at: null, market_value: null, unrealized_pnl: null,
  }, helpers);
  assert.equal(item.remainingShares, "12.340000");
  assert.equal(item.remainingCost, "4.567890");
  assert.equal(item.markPrice, null);
  assert.match(holdingIdentity(item), /legacy-v1/);
  assert.match(holdingIdentity({ ...item, outcomeIndex: 1 }), /1/);
});

test("holdings decoder does not coerce booleans or hexadecimal strings into numbers", () => {
  const item = decodeTradingHolding({
    execution_account_id: "wallet-a", model_id: "model", strategy_id: "strategy", market_id: "market", condition_id: "condition", token_id: "token", status: "OPEN",
    outcome_index: "0x10", remaining_shares: false, remaining_cost: "0x10", lot_count: false, mark_price: "0x1", market_value: true, unrealized_pnl: "NaN",
  }, helpers);
  assert.equal(item.outcomeIndex, null);
  assert.equal(item.remainingShares, null);
  assert.equal(item.remainingCost, null);
  assert.equal(item.lotCount, null);
  assert.equal(item.markPrice, null);
  assert.equal(item.marketValue, null);
  assert.equal(item.unrealizedPnl, null);
});

test("console V2 holdings page decodes exact totals and decimal fields", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [{ execution_account_id: "wallet-a", model_id: "echoz", strategy_id: "s", market_source: "POLYMARKET", market_id: "m", condition_id: "c", token_id: "t", outcome_index: 0, outcome_name: "Yes", market_question: "fixture", status: "OPEN", remaining_shares: "1.230000", remaining_cost: "0.450000", lot_count: 1, first_opened_at: "2026-10-22T00:00:00Z", last_opened_at: "2026-10-22T00:00:00Z", mark_price: null, mark_observed_at: null, market_value: null, unrealized_pnl: null }], limit: 20, offset: 0, total: 1, has_more: false, observed_at: "2026-10-22T00:00:00Z" } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const result = await consoleV2.trading.holdings({ execution_account_id: "wallet-a" });
    assert.equal(result.data.total, 1);
    assert.equal(result.data.items[0]?.remainingShares, "1.230000");
    assert.equal(result.data.items[0]?.markPrice, null);
  } finally { globalThis.fetch = previousFetch; }
});

test("holding lot detail requests the complete identity without sharing parent pagination", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ data: { items: [], limit: 5, offset: 5, total: 6, has_more: false, observed_at: "2026-10-23T00:00:00Z" } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const item = decodeTradingHolding({ execution_account_id: "wallet-a", model_id: "model", strategy_id: "strategy", market_source: "POLYMARKET", market_id: "market", condition_id: "condition", token_id: "token", outcome_index: 0, outcome_name: "Yes", status: "OPEN", remaining_shares: "1", remaining_cost: "0.5", lot_count: 1 }, helpers);
    await consoleV2.trading.holdingLots(item, { limit: 5, offset: 5 });
    const url = new URL(calls[0], "http://console.test");
    assert.equal(url.pathname, "/api/console/v2/trading/holdings/lots");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.get("offset"), "5");
    assert.deepEqual(JSON.parse(url.searchParams.get("holding_identity") ?? "null"), ["wallet-a", "model", "strategy", "POLYMARKET", "market", "condition", "token", 0, "Yes"]);
  } finally { globalThis.fetch = previousFetch; }
});

test("order decoder preserves frozen market question and outcome labels", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [{ order_id: "order-1", client_order_id: "client-1", status: "FILLED", execution_account_id: "wallet-a", market_id: "market-1", token_id: "token-1", market_question: "Will the fixture resolve?", outcome_name: "Yes", price: "0.42", shares: "2", filled_shares: "2", created_at: "2026-10-23T00:00:00Z", updated_at: "2026-10-23T00:01:00Z", evidence_summary: {} }], limit: 20, offset: 0, total: 1, has_more: false, observed_at: "2026-10-23T00:01:00Z" } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const result = await consoleV2.trading.orders();
    assert.equal(result.data.items[0]?.marketQuestion, "Will the fixture resolve?");
    assert.equal(result.data.items[0]?.outcomeName, "Yes");
  } finally { globalThis.fetch = previousFetch; }
});

test("交易 workspace only shares account and keeps PnL/ledger in the ledger view", async () => {
  const source = await readFile(new URL("../app/components/trading-v2-page.tsx", import.meta.url), "utf8");
  assert.match(source, /sharedQueryKeys: \["execution_account_id"\]/);
  assert.match(source, /<TradeRecordsPage embedded sharedAccountOnly showPnL \/>/);
  assert.doesNotMatch(source, /<LiveTradingPage/);
  assert.match(source, /LatestEdgeSnapshot/);
});

test("account permission display separates current switches from the historical cycle gate", () => {
  const account = {
    executionAccountId: "wallet-a", modelId: "model", strategyId: "strategy", sourceMode: "LIVE",
    configuredBinding: true, databaseBindingEnabled: true, riskPolicyEnabled: true, accountPaused: false,
    strategyInputState: "enabled", entryGateState: "enabled", orderSubmissionState: "enabled",
    lastCycleStatus: "OUTPUT_RECORDED", lastCycleEntryBlockReason: "coverage below threshold", openIssueCount: 0, openOrderCount: 0,
  } as Parameters<typeof deriveAccountPermission>[0];
  const submission = { orderSubmissionEnabled: true, entrySubmissionDisabled: false, submissionDisabledAccounts: [], entryDisabledAccounts: [], strategyDisabledAccounts: [], kalshiStrategyInputEnabled: null };
  assert.equal(deriveAccountPermission(account, submission).currentLabel, "当前入场开关已开启");
  assert.match(deriveAccountPermission(account, submission).currentReasons[0], /本轮许可见最近周期/);
  const disabled = deriveAccountPermission(account, { ...submission, strategyDisabledAccounts: ["wallet-a"] });
  assert.equal(disabled.currentLabel, "当前不可入场");
  assert.match(disabled.currentReasons.join(" "), /策略已关闭/);
  assert.match(disabled.historyLabel, /曾允许入场/);
  const unknown = deriveAccountPermission({ ...account, accountPaused: null }, { ...submission, orderSubmissionEnabled: null });
  assert.equal(unknown.currentLabel, "当前状态未知");
  const compositeUnknown = deriveAccountPermission({ ...account, strategyInputState: "not_enabled", entryGateState: "not_enabled" }, submission);
  assert.equal(compositeUnknown.currentLabel, "当前状态未知");
  assert.match(compositeUnknown.historyLabel, /未知/);
  const historicalSellOnly = deriveAccountPermission({ ...account, entryGateState: "sell_only" }, submission);
  assert.match(historicalSellOnly.historyLabel, /仅允许退出/);
});

test("empty risk and quality sources remain unknown instead of looking healthy", () => {
  assert.equal(summarizeAttention([], () => true), "未采集");
  assert.equal(summarizeAttention([{ state: "healthy" }], (item) => item.state !== "healthy"), "无");
  assert.equal(summarizeAttention([{ status: "healthy" }], (item) => item.status !== "healthy", "未采集", "正常"), "正常");
});

test("risk and quality summaries keep non-empty diagnostics, unmanaged positions stay account-scoped", () => {
  assert.equal(summarizeAttention([{ state: "danger" }, { state: "safe" }], (item) => item.state !== "safe"), "1 项");
  assert.equal(summarizeAttention([{ status: "degraded" }], (item) => item.status !== "healthy", "未采集", "正常"), "1 项");
  const positions = [
    { positionId: "managed", executionAccountId: "wallet-a", managed: true },
    { positionId: "external-a", executionAccountId: "wallet-a", managed: false },
    { positionId: "external-b", executionAccountId: "wallet-b", managed: false },
  ] as unknown as Parameters<typeof filterUnmanagedPositions>[0];
  assert.deepEqual(filterUnmanagedPositions(positions, "wallet-a").map((item) => item.positionId), ["external-a"]);
  assert.deepEqual(filterUnmanagedPositions(positions).map((item) => item.positionId), ["external-a", "external-b"]);
  assert.equal(formatTradingDisplayValue(0.003, "count"), "0.003");
  assert.equal(formatTradingDisplayValue(0.000001, "count"), "0.000001");
});

test("overview source failure clears the failed runtime snapshot instead of retaining running state", () => {
  const previous = { state: "running" };
  const failed = normalizeOverviewSources({ status: "rejected", reason: new Error("runtime down") }, { status: "fulfilled", value: { data: { observed: true }, mode: "live" } });
  assert.equal(failed.runtime, undefined);
  assert.deepEqual(failed.snapshot, { observed: true });
  assert.deepEqual(failed.errors, ["运行状态暂不可用"]);
  assert.notEqual(failed.runtime, previous);
});
