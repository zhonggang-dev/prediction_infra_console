import assert from "node:assert/strict";
import test from "node:test";
import { accountPerformance, decodeAccountPerformance } from "../app/lib/trading-performance.ts";
import { GET, POST } from "../app/api/console/v2/[...path]/route.ts";

const item = {
  execution_account_id: "kalshi:main", market_source: "KALSHI", asset_count: 2, priced_asset_count: 2,
  current_cost: "10.123456789", peak_holding_cost: "20.5", cumulative_invested_cost: "40.75", realized_pnl: "-2.25",
  market_value: "12.5", unrealized_pnl: "2.376543211", total_pnl: "0.126543211", return_rate: "0.00617283956",
  realized_drawdown_14d: "7.45", drawdown_from: "2026-10-22T00:00:00Z", drawdown_to: "2026-11-04T12:00:00Z",
  valuation_state: "complete", valuation_reasons: [], snapshot_decision_at: "2026-11-04T12:00:00Z", snapshot_observed_at: "2026-11-04T12:00:01Z",
};
const data = (items: unknown[] = [item]) => ({ observed_at: "2026-11-04T12:05:00Z", items });

test("绩效解码保留双平台Decimal、0值及未知，拒绝不完整估值伪总值", () => {
  const result = decodeAccountPerformance(data());
  assert.equal(result.items[0].marketSource, "KALSHI");
  assert.equal(result.items[0].currentCost, "10.123456789");
  const incomplete = { ...item, market_source: "POLYMARKET", execution_account_id: "main", priced_asset_count: 1, valuation_state: "incomplete", valuation_reasons: ["missing_quote"], market_value: null, unrealized_pnl: null, total_pnl: null, return_rate: null };
  assert.equal(decodeAccountPerformance(data([incomplete])).items[0].totalPnl, null);
  assert.throws(() => decodeAccountPerformance(data([{ ...incomplete, total_pnl: "0" }])));
  const zero = { ...item, asset_count: 0, priced_asset_count: 0, current_cost: "0", peak_holding_cost: "0", cumulative_invested_cost: "0", market_value: "0", unrealized_pnl: "0", total_pnl: "0", realized_pnl: "0", return_rate: null, snapshot_decision_at: null, snapshot_observed_at: null };
  assert.equal(decodeAccountPerformance(data([zero])).items[0].marketValue, "0");
  assert.equal(decodeAccountPerformance(data([zero])).items[0].returnRate, null);
});

test("绩效缺字段、非法金额、来源、计数、时间、覆盖状态及串账户均失败", () => {
  for (const patch of [
    { realized_pnl: null }, { realized_pnl: undefined }, { realized_pnl: 0 }, { realized_pnl: "" }, { realized_pnl: "Infinity" }, { realized_pnl: "1e2" },
    { market_value: undefined }, { market_source: "OTHER" }, { asset_count: "2" }, { priced_asset_count: 3 },
    { snapshot_observed_at: undefined }, { drawdown_from: "bad" }, { drawdown_to: "2026-01-01T00:00:00Z" },
    { valuation_state: "unknown" }, { valuation_reasons: ["private error"] }, { valuation_state: "incomplete" },
  ]) assert.throws(() => decodeAccountPerformance(data([{ ...item, ...patch }])));
  assert.throws(() => decodeAccountPerformance(data([item, item])));
  assert.throws(() => decodeAccountPerformance(data(), "main"));
  assert.throws(() => decodeAccountPerformance(data([]), "main"));
  assert.throws(() => decodeAccountPerformance({ items: [item] }));
});

test("绩效客户端只发账户范围并传递取消，不混官方曲线和账本日期", async () => {
  const previousFetch = globalThis.fetch; const controller = new AbortController();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => { calls.push({ url: String(input), init }); return Response.json({ data: data() }); }) as typeof fetch;
  try {
    const response = await accountPerformance("kalshi:main", controller.signal);
    assert.equal(response.items[0].executionAccountId, "kalshi:main");
    assert.equal(calls[0].url, "/api/console/v2/trading/account-performance?execution_account_id=kalshi%3Amain");
    assert.equal(calls[0].init?.signal, controller.signal);
    await accountPerformance();
    assert.equal(calls[1].url, "/api/console/v2/trading/account-performance");
    globalThis.fetch = (async () => Response.json({ error: "private" }, { status: 503 })) as typeof fetch;
    await assert.rejects(() => accountPerformance(), /账户绩效暂时不可用/);
  } finally { globalThis.fetch = previousFetch; }
});

test("绩效BFF固定路径、只读凭据与严格窄查询，非法请求不碰上游", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.TRADING_EXECUTION_BASE_URL; const previousToken = process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN;
  process.env.TRADING_EXECUTION_BASE_URL = "http://trading.test"; process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = "test-read-token";
  let calls = 0;
  globalThis.fetch = (async (input, init) => {
    calls += 1;
    assert.equal(String(input), "http://trading.test/api/v1/console/v2/account-performance?execution_account_id=kalshi%3Amain");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-read-token");
    return Response.json({ data: data() });
  }) as typeof fetch;
  const params = { params: Promise.resolve({ path: ["trading", "account-performance"] }) };
  try {
    const response = await GET(new Request("http://console.test/api/console/v2/trading/account-performance?execution_account_id=kalshi%3Amain"), params);
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    for (const query of ["?from=2026-01-01", "?limit=20", "?account=main", "?execution_account_id=", "?execution_account_id=main&execution_account_id=main", "?execution_account_id=%0A", "?execution_account_id=%20main"]) {
      assert.equal((await GET(new Request(`http://console.test/api/console/v2/trading/account-performance${query}`), params)).status, 400, query);
    }
    assert.equal(calls, 1);
    assert.equal((await POST()).status, 405);
    assert.equal((await GET(new Request("http://console.test/api/console/v2/trading/account-performance/private"), { params: Promise.resolve({ path: ["trading", "account-performance", "private"] }) })).status, 404);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.TRADING_EXECUTION_BASE_URL; else process.env.TRADING_EXECUTION_BASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN; else process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = previousToken;
  }
});
