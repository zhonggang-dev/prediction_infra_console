import assert from "node:assert/strict";
import test from "node:test";
import { accountCoreMetrics, decodeAccountCoreMetrics, accountCohortMetrics, decodeAccountCohortMetrics, cohortOpeningRangeError } from "../app/lib/trading-core-metrics.ts";
import { decodeWalletPnl } from "../app/lib/wallet-pnl-api.ts";
import { GET, POST } from "../app/api/console/v2/[...path]/route.ts";
import { GET as walletGet } from "../app/api/console/[...path]/route.ts";
import { orderedTradingAccounts, scopedTradingAccounts } from "../app/lib/trading-account-scope.ts";

const observed = "2026-11-04T12:00:00Z";
const asset = { execution_account_id: "kalshi:main", market_source: "KALSHI", market_id: "market", condition_id: "condition", token_id: "token", outcome_index: 1, outcome_name: "No", market_question: "Question?", remaining_shares: "2.000001", remaining_cost: "1.000001", price: "0.5", market_value: "1.0000005", state: "priced", price_source: "KALSHI_BOOK_MID", source_at: null, observed_at: observed, reason: null };
const item = { execution_account_id: "kalshi:main", market_source: "KALSHI", asset_count: 1, priced_asset_count: 1, current_cost: "1.000001", peak_holding_cost: "5", cumulative_invested_cost: "10", realized_pnl: "-2", market_value: "1.0000005", unrealized_pnl: "-0.0000005", total_pnl: "-2.0000005", return_rate: "-0.4000001", realized_drawdown_14d: "2", drawdown_from: "2026-10-22T00:00:00Z", drawdown_to: observed, ledger_observed_at: observed, quote_observed_from: observed, quote_observed_to: observed, valuation_state: "complete", has_reference_prices: true, valuation_assets: [asset] };
const data = (items: unknown[] = [item]) => ({ observed_at: observed, items });

test("核心指标保留完整资产/精确金额/参考来源，0价和0资产合法", () => {
  const decoded = decodeAccountCoreMetrics(data(), "kalshi:main").items[0];
  assert.equal(decoded.currentCost, "1.000001"); assert.equal(decoded.valuationAssets[0].remainingShares, "2.000001"); assert.equal(decoded.hasReferencePrices, true);
  const zeroQuote = { ...asset, price: "0", market_value: "0", price_source: "OFFICIAL_SETTLEMENT" };
  assert.equal(decodeAccountCoreMetrics(data([{ ...item, has_reference_prices: false, valuation_assets: [zeroQuote] }])).items[0].valuationAssets[0].price, "0");
  const zero = { ...item, asset_count: 0, priced_asset_count: 0, current_cost: "0", peak_holding_cost: "0", cumulative_invested_cost: "0", market_value: "0", unrealized_pnl: "0", total_pnl: "-2", return_rate: null, quote_observed_from: null, quote_observed_to: null, has_reference_prices: false, valuation_assets: [] };
  assert.equal(decodeAccountCoreMetrics(data([zero])).items[0].returnRate, null);
});

test("缺价资产保持具体原因及整账户四项null，状态/身份/来源/计数不容伪造", () => {
  const unknown = { ...asset, price: null, market_value: null, price_source: null, state: "unpriced", reason: "one_sided", observed_at: null };
  const incomplete = { ...item, priced_asset_count: 0, market_value: null, unrealized_pnl: null, total_pnl: null, return_rate: null, valuation_state: "incomplete", has_reference_prices: false, quote_observed_from: null, quote_observed_to: null, valuation_assets: [unknown] };
  assert.equal(decodeAccountCoreMetrics(data([incomplete])).items[0].valuationAssets[0].reason, "one_sided");
  for (const patch of [{ total_pnl: "0" }, { priced_asset_count: 1 }, { valuation_assets: [] }, { has_reference_prices: true }, { valuation_state: "complete" }]) assert.throws(() => decodeAccountCoreMetrics(data([{ ...incomplete, ...patch }])));
  for (const patch of [{ execution_account_id: "main" }, { market_source: "POLYMARKET" }, { reason: null }, { reason: "private sql" }, { price: "0" }]) assert.throws(() => decodeAccountCoreMetrics(data([{ ...incomplete, valuation_assets: [{ ...unknown, ...patch }] }])));
  for (const patch of [{ price_source: "PM_CURRENT_PRICE" }, { price: "1.000000000000000001" }, { price: "-0.0000000000000000001" }, { observed_at: undefined }, { remaining_shares: "0" }, { price: "NaN" }, { reason: "missing_price" }]) assert.throws(() => decodeAccountCoreMetrics(data([{ ...item, valuation_assets: [{ ...asset, ...patch }] }])));
  for (const patch of [{ realized_pnl: undefined }, { market_value: undefined }, { current_cost: "-0." + "0".repeat(400) + "1" }, { asset_count: "1" }, { priced_asset_count: 2 }, { ledger_observed_at: "bad" }, { quote_observed_to: null }]) assert.throws(() => decodeAccountCoreMetrics(data([{ ...item, ...patch }])));
  assert.throws(() => decodeAccountCoreMetrics(data([item, item])));
  assert.throws(() => decodeAccountCoreMetrics(data([item]), "main"));
  assert.throws(() => decodeAccountCoreMetrics(data([]), "main"));
  assert.throws(() => decodeAccountCoreMetrics(data([{ ...item, asset_count: 2, priced_asset_count: 2, valuation_assets: [asset, asset] }])));
});

test("核心指标客户端/BFF只允许账户范围，沿用只读凭据与取消", async () => {
  const previousFetch = globalThis.fetch, previousUrl = process.env.TRADING_EXECUTION_BASE_URL, previousToken = process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN;
  const controller = new AbortController(); let requested = "";
  try {
    globalThis.fetch = (async (input, init) => { requested = String(input); assert.equal(init?.signal, controller.signal); return Response.json({ data: data() }); }) as typeof fetch;
    await accountCoreMetrics("kalshi:main", controller.signal);
    assert.equal(requested, "/api/console/v2/trading/account-core-metrics?execution_account_id=kalshi%3Amain");
    process.env.TRADING_EXECUTION_BASE_URL = "http://trading.test"; process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = "fixture-read";
    let calls = 0;
    globalThis.fetch = (async (input, init) => { calls++; assert.equal(String(input), "http://trading.test/api/v1/console/v2/account-core-metrics?execution_account_id=kalshi%3Amain"); assert.equal((init?.headers as Record<string, string>).authorization, "Bearer fixture-read"); return Response.json({ data: data() }); }) as typeof fetch;
    const params = { params: Promise.resolve({ path: ["trading", "account-core-metrics"] }) };
    assert.equal((await GET(new Request("http://console.test/api/console/v2/trading/account-core-metrics?execution_account_id=kalshi%3Amain"), params)).status, 200);
    for (const q of ["?limit=1", "?from=2026-11-01", "?account=main", "?execution_account_id=", "?execution_account_id=main&execution_account_id=main", "?execution_account_id=%00", "?execution_account_id=%20main"]) assert.equal((await GET(new Request("http://console.test/api/console/v2/trading/account-core-metrics" + q), params)).status, 400);
    assert.equal(calls, 1); assert.equal((await POST()).status, 405);
    assert.equal((await GET(new Request("http://console.test/api/console/v2/trading/account-core-metrics/private"), { params: Promise.resolve({ path: ["trading", "account-core-metrics", "private"] }) })).status, 404);
  } finally { globalThis.fetch = previousFetch; if (previousUrl === undefined) delete process.env.TRADING_EXECUTION_BASE_URL; else process.env.TRADING_EXECUTION_BASE_URL = previousUrl; if (previousToken === undefined) delete process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN; else process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = previousToken; }
});

test("官方小时源精度和精确来源区块穿透，不因日级元数据丢弃日内变化", () => {
  const d = { execution_account_id: "main", wallet_address: "0x" + "1".repeat(40), metric: "trade_pnl", interval: "1w", fidelity: "1h", source_fidelity: "1d", fetched_at: observed, points: [{ timestamp: 100, trade_pnl: "1.2", source_block: "9007199254740993123" }, { timestamp: 3700, trade_pnl: "2.4", source_block: "9007199254740993124" }] };
  const result = decodeWalletPnl(d); assert.equal(result.sourceFidelity, "1d"); assert.equal(result.points[0].sourceBlock, "9007199254740993123"); assert.equal(result.points[1].tradePnl, 2.4);
  assert.equal(decodeWalletPnl({ ...d, source_fidelity: null }).sourceFidelity, null);
  assert.equal(decodeWalletPnl({ ...d, source_fidelity: "future-grid" }).sourceFidelity, "future-grid");
  for (const patch of [{ source_fidelity: undefined }, { source_fidelity: 1 }, { points: [{ ...d.points[0], source_block: 1 }] }, { points: [{ ...d.points[0], source_block: "-1" }] }, { points: [d.points[0], { ...d.points[0], source_block: "12" }] }]) assert.throws(() => decodeWalletPnl({ ...d, ...patch }));
  assert.throws(() => decodeWalletPnl({ ...d, points: Array.from({ length: 10001 }, (_, i) => ({ timestamp: i + 1, trade_pnl: "0", source_block: null })) }), /预算/);
});

test("官方PnL窄BFF向下游传播调用方取消", async () => {
  const oldFetch = globalThis.fetch, oldUrl = process.env.TRADING_EXECUTION_BASE_URL, oldToken = process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN;
  process.env.TRADING_EXECUTION_BASE_URL = "http://trading.test"; process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = "fixture-read";
  const controller = new AbortController(); let seen: AbortSignal | undefined;
  globalThis.fetch = (async (_input, init) => { seen = init?.signal as AbortSignal; controller.abort(); assert.equal(seen.aborted, true); throw new Error("aborted"); }) as typeof fetch;
  try {
    const result = await walletGet(new Request("http://console.test/api/console/wallet-pnl?execution_account_id=main&interval=1d&fidelity=1h", { signal: controller.signal }), { params: Promise.resolve({ path: ["wallet-pnl"] }) });
    assert.equal(result.status, 502); assert.ok(seen?.aborted);
  } finally { globalThis.fetch = oldFetch; if (oldUrl === undefined) delete process.env.TRADING_EXECUTION_BASE_URL; else process.env.TRADING_EXECUTION_BASE_URL = oldUrl; if (oldToken === undefined) delete process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN; else process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = oldToken; }
});


test("Kalshi官方最近成交价保留来源且不冒充mid，拒绝串入PM", () => {
  const last = { ...asset, price_source: "KALSHI_LAST_TRADE", source_at: null };
  const result = decodeAccountCoreMetrics(data([{ ...item, has_reference_prices: false, valuation_assets: [last] }]));
  assert.equal(result.items[0].valuationAssets[0].priceSource, "KALSHI_LAST_TRADE");
  assert.equal(result.items[0].valuationAssets[0].sourceAt, null);
  assert.equal(result.items[0].hasReferencePrices, false);
  assert.throws(() => decodeAccountCoreMetrics(data([{ ...item, valuation_assets: [last] }])));
  assert.throws(() => decodeAccountCoreMetrics(data([{ ...item, market_source: "POLYMARKET", has_reference_prices: false, valuation_assets: [{ ...last, market_source: "POLYMARKET" }] }])));
});


const cohortItem = { ...item, opened_asset_count: 3, holding_asset_count: 1, closed_asset_count: 2, roi: "-0.20000005", buy_fees: "0.123456", sell_fees: "0.02", max_drawdown: null, drawdown_state: "history_unavailable" };
const cohortData = (patch: Record<string, unknown> = {}) => ({ observed_at: observed, opening_from: null, opening_to: null, items: [cohortItem], unavailable_accounts: [], ...patch });
test("开仓区间核心指标保留毛收益、独立费用与完整资产等式，不伪造总回撤", () => {
  const result = decodeAccountCohortMetrics(cohortData()).items[0];
  assert.equal(result.openedAssetCount, result.holdingAssetCount + result.closedAssetCount);
  assert.equal(result.buyFees, "0.123456"); assert.equal(result.sellFees, "0.02"); assert.equal(result.roi, "-0.20000005");
  assert.equal(result.maxDrawdown, null); assert.equal(result.drawdownState, "history_unavailable");
  for (const patch of [{ opened_asset_count: 2 }, { holding_asset_count: 2 }, { closed_asset_count: "2" }, { buy_fees: "-0.1" }, { sell_fees: null }, { roi: undefined }, { roi: null }, { drawdown_state: "available" }, { max_drawdown: "0" }, { drawdown_state: "realized_only" }]) assert.throws(() => decodeAccountCohortMetrics(cohortData({ items: [{ ...cohortItem, ...patch }] })));
  const noHistory = { ...cohortItem, cumulative_invested_cost: "0", roi: null };
  assert.equal(decodeAccountCohortMetrics(cohortData({ items: [noHistory] })).items[0].roi, null);
  assert.throws(() => decodeAccountCohortMetrics(cohortData({ items: [{ ...noHistory, roi: "0" }] })));
});

test("开仓区间响应须与请求时间一致，账户切换不能接受串范围响应", () => {
  const range = { opening_from: "2026-11-01T00:00:00Z", opening_to: "2026-11-03T00:00:00Z" };
  assert.equal(decodeAccountCohortMetrics(cohortData(range), range).openingFrom, range.opening_from);
  assert.throws(() => decodeAccountCohortMetrics(cohortData(range)));
  assert.throws(() => decodeAccountCohortMetrics(cohortData(), range));
  assert.throws(() => decodeAccountCohortMetrics(cohortData({ opening_from: range.opening_from })));
  assert.throws(() => decodeAccountCohortMetrics(cohortData({ ...range, opening_to: range.opening_from }), range));
  assert.throws(() => decodeAccountCohortMetrics(cohortData(), { execution_account_id: "main" }));
});

test("活跃账户只含ACTIVE或SELL_ONLY，暂停账户保留可选并稳定排末尾", () => {
  const accounts = [{ executionAccountId: "paused-1", marketSource: "POLYMARKET" as const, mode: "PAUSED" as const }, { executionAccountId: "main", marketSource: "POLYMARKET" as const, mode: "ACTIVE" as const }, { executionAccountId: "unknown", marketSource: "POLYMARKET" as const }, { executionAccountId: "sell-only", marketSource: "KALSHI" as const, mode: "SELL_ONLY" as const }, { executionAccountId: "paused-2", marketSource: "POLYMARKET" as const, mode: "PAUSED" as const }];
  assert.deepEqual(scopedTradingAccounts(accounts, "active").map(a => a.executionAccountId), ["main", "sell-only"]);
  assert.deepEqual(orderedTradingAccounts(accounts).map(a => a.executionAccountId), ["main", "unknown", "sell-only", "paused-1", "paused-2"]);
  assert.equal(scopedTradingAccounts(accounts, "all").length, 5);
});

test("cohort客户端与固定BFF传递开仓范围、活跃账户以及取消，拒绝混合或畸形范围", async () => {
  const previousFetch = globalThis.fetch, previousUrl = process.env.TRADING_EXECUTION_BASE_URL, previousToken = process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN;
  const controller = new AbortController();
  const range = { opening_from: "2026-11-01T00:00:00Z", opening_to: "2026-11-03T00:00:00Z" };
  const query = { account_scope: "active" as const, ...range };
  try {
    globalThis.fetch = (async (input, init) => { const url = new URL(String(input), "http://console.test"); assert.equal(url.pathname, "/api/console/v2/trading/account-cohort-metrics"); assert.equal(url.searchParams.get("account_scope"), "active"); assert.equal(url.searchParams.get("opening_from"), range.opening_from); assert.equal(init?.signal, controller.signal); return Response.json({ data: cohortData(range) }); }) as typeof fetch;
    await accountCohortMetrics(query, controller.signal);
    process.env.TRADING_EXECUTION_BASE_URL = "http://trading.test"; process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = "fixture-read";
    let calls = 0;
    globalThis.fetch = (async (input, init) => { calls++; const url = new URL(String(input)); assert.equal(url.pathname, "/api/v1/console/v2/account-cohort-metrics"); assert.equal(url.searchParams.get("account_scope"), "active"); assert.equal((init?.headers as Record<string, string>).authorization, "Bearer fixture-read"); return Response.json({ data: cohortData(range) }); }) as typeof fetch;
    const params = { params: Promise.resolve({ path: ["trading", "account-cohort-metrics"] }) };
    assert.equal((await GET(new Request(`http://console.test/api/console/v2/trading/account-cohort-metrics?${new URLSearchParams(query)}`), params)).status, 200);
    for (const q of ["?account_scope=enabled", "?account_scope=", "?account_scope=active&account_scope=all", "?account_scope=active&execution_account_id=main", "?opening_from=2026-11-01T00%3A00%3A00Z", "?opening_from=2026-11-01&opening_to=2026-11-02", "?opening_from=2026-11-03T00%3A00%3A00Z&opening_to=2026-11-01T00%3A00%3A00Z", "?limit=20", "?execution_account_id=%00"]) assert.equal((await GET(new Request("http://console.test/api/console/v2/trading/account-cohort-metrics" + q), params)).status, 400, q);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previousFetch; if (previousUrl === undefined) delete process.env.TRADING_EXECUTION_BASE_URL; else process.env.TRADING_EXECUTION_BASE_URL = previousUrl; if (previousToken === undefined) delete process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN; else process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = previousToken; }
});


test("外部URL的非本地整点不发送查询，半小时时区本地整点合法", async () => {
  const previousTz = process.env.TZ, previousFetch = globalThis.fetch;
  let requests = 0;
  try {
    process.env.TZ = "Asia/Shanghai";
    globalThis.fetch = (async () => { requests++; return Response.json({ data: cohortData() }); }) as typeof fetch;
    for (const opening_from of ["2026-11-01T03:30:00Z", "2026-11-01T03:00:01Z", "2026-11-01T03:00:00.001Z"]) await assert.rejects(accountCohortMetrics({ opening_from, opening_to: "2026-11-03T03:00:00Z" }), /不是本地整点/);
    assert.equal(requests, 0);
    process.env.TZ = "Asia/Kolkata";
    const range = { opening_from: "2026-11-01T05:30:00Z", opening_to: "2026-11-03T05:30:00Z" };
    assert.equal(cohortOpeningRangeError(range), undefined);
    globalThis.fetch = (async () => { requests++; return Response.json({ data: cohortData(range) }); }) as typeof fetch;
    await accountCohortMetrics(range);
    assert.equal(requests, 1);
    assert.match(cohortOpeningRangeError({ ...range, opening_from: "2026-11-01T05:00:00Z" }) ?? "", /不是本地整点/);
  } finally { globalThis.fetch = previousFetch; if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; }
});


test("缺平仓证据账户隔离返回，成功账户与失败账户严格互斥且单账户并集准确", () => {
  const unavailable = { execution_account_id: "wallet-1", market_source: "POLYMARKET", reason: "missing_disposition_evidence" };
  const mixed = cohortData({ unavailable_accounts: [unavailable] });
  const result = decodeAccountCohortMetrics(mixed);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].executionAccountId, "kalshi:main");
  assert.deepEqual(result.unavailableAccounts, [{ executionAccountId: "wallet-1", marketSource: "POLYMARKET", reason: "missing_disposition_evidence" }]);
  const single = decodeAccountCohortMetrics(cohortData({ items: [], unavailable_accounts: [unavailable] }), { execution_account_id: "wallet-1" });
  assert.equal(single.items.length, 0); assert.equal(single.unavailableAccounts.length, 1);
  for (const unavailable_accounts of [undefined, null, {}, [unavailable, unavailable], [{ ...unavailable, execution_account_id: "kalshi:main" }], [{ ...unavailable, market_source: "OTHER" }], [{ ...unavailable, reason: "raw SQL error" }], [{ ...unavailable, execution_account_id: "" }]]) assert.throws(() => decodeAccountCohortMetrics(cohortData({ unavailable_accounts })));
  assert.throws(() => decodeAccountCohortMetrics(mixed, { execution_account_id: "wallet-1" }));
  assert.throws(() => decodeAccountCohortMetrics(cohortData({ items: [], unavailable_accounts: [unavailable] }), { execution_account_id: "main" }));
  assert.throws(() => decodeAccountCohortMetrics(cohortData({ items: [] }), { execution_account_id: "wallet-1" }));
});
