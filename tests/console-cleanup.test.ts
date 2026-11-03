import assert from "node:assert/strict";
import test from "node:test";
import { canonicalConsoleQuery, mergeSharedQuery, predictionTasksRedirect } from "../app/lib/console-workspace.ts";
import { fixedPredictionBatch, matchingPredictionBatch, predictionBatchParentContext, predictionResultQuery } from "../app/lib/prediction-batch-scope.ts";
import { currentPredictionRange, predictionGenerationIds } from "../app/lib/prediction-scope.ts";
import type { ConsoleV2Overview } from "../app/lib/console-v2.ts";
import type { ConsoleV2PredictionBatchSummary } from "../app/lib/console-v2.ts";
import { decodeTradingLedgerPage, formatTradingLedgerMoney } from "../app/lib/trading-ledger-v2.ts";
import { consoleV2 } from "../app/lib/console-v2.ts";
import { GET } from "../app/api/console/v2/[...path]/route.ts";

const observed = "2026-11-03T08:00:00Z";
const summary = { activity_count: 1, trade_count: 0, redemption_count: 0, netting_count: 1, settlement_count: 0, buy_notional: "0", sell_notional: "0", redeem_payout: "0", total_fee: "0", net_cash_flow: "14", realized_pnl: "1", sell_realized_pnl: "0", redeem_realized_pnl: "0", netting_payout: "14", settlement_payout: "0", netting_realized_pnl: "1", settlement_realized_pnl: "0" };
const netting = { activity_key: "kalshi-netting:fill-one", activity_type: "KALSHI_NETTING", market_source: "KALSHI", quantity_unit: "pairs", venue: "KALSHI", execution_account_id: "kalshi:main", shares: "14", total_fee: "0", net_cash_delta: "14", realized_pnl: "1", cost_basis: "13", settlement_payout: "14", occurred_at: observed, confirmed_at: null, applied_at: observed };
const page = (item = netting) => ({ data: { items: [item], summary, limit: 20, offset: 0, total: 1, has_more: false, observed_at: observed } });

test("Kalshi对冲以14对读取，金额与收益分开，缺失确认时间保持未知", () => {
  const data = decodeTradingLedgerPage(page());
  assert.equal(data.items[0].shares, "14");
  assert.equal(data.items[0].quantityUnit, "pairs");
  assert.equal(data.items[0].confirmedAt, undefined);
  assert.equal(data.items[0].appliedAt, observed);
  assert.equal(data.items[0].price, undefined);
  assert.equal(data.summary.nettingPayout, "14");
  assert.equal(data.summary.nettingRealizedPnl, "1");
  assert.equal(data.summary.totalFee, "0");
});

test("零兑付可合法入账；错误类型/数量单位/金额/准确total不转为零", () => {
  const zero = { ...netting, activity_type: "KALSHI_SETTLEMENT", quantity_unit: "shares", shares: "0.000001", settlement_payout: "0", net_cash_delta: "0", realized_pnl: "-3.6" };
  assert.equal(decodeTradingLedgerPage(page(zero)).items[0].settlementPayout, "0");
  for (const item of [{ ...netting, activity_type: "UNKNOWN" }, { ...netting, quantity_unit: "shares" }, { ...netting, net_cash_delta: "" }]) assert.throws(() => decodeTradingLedgerPage(page(item)));
  for (const total of [null, false, "1", -1]) assert.throws(() => decodeTradingLedgerPage({ data: { ...page().data, total } }));
});

test("规范旧筛选只改变所属页面并按范围重置offset，维护身份和合法分页保留", () => {
  const input = new URLSearchParams("execution_account_id=kalshi%3Amain&model_id=old&strategy_id=old&from=2026-01-01&to=2026-01-02&offset=40&status=FILLED");
  const orders = canonicalConsoleQuery("/trading/orders", input);
  assert.equal(orders.get("execution_account_id"), "kalshi:main");
  assert.equal(orders.get("status"), "FILLED");
  for (const key of ["model_id", "strategy_id", "from", "to", "offset"]) assert.equal(orders.has(key), false);
  const ledger = canonicalConsoleQuery("/trading/ledger", input);
  assert.equal(ledger.get("from"), "2026-01-01");
  assert.equal(ledger.has("model_id"), false);
  assert.equal(canonicalConsoleQuery("/trading/positions", input).toString(), "execution_account_id=kalshi%3Amain&status=FILLED");
  assert.equal(canonicalConsoleQuery("/trading/positions", new URLSearchParams("position_view=redemptions&offset=20")).toString(), "position_view=redemptions&offset=20");
  const prediction = canonicalConsoleQuery("/predictions/tasks", new URLSearchParams("generation_id=468&source=KALSHI&selection_run_id=573&selected_market_id=1&offset=40"));
  assert.equal(prediction.toString(), "generation_id=468&source=KALSHI");
  assert.equal(canonicalConsoleQuery("/predictions", new URLSearchParams("source=GENERATED&offset=20")).toString(), "");
  assert.equal(canonicalConsoleQuery("/sandboxes", new URLSearchParams("source=GENERATED_QA&offset=40")).toString(), "source=GENERATED_QA&offset=40");
  assert.equal(canonicalConsoleQuery("/markets/running", new URLSearchParams("market_scope=pool&offset=20")).toString(), "market_scope=current");
  assert.equal(canonicalConsoleQuery("/markets/running", new URLSearchParams("generation_id=468&source=KALSHI&offset=40")).get("offset"), "40");
});

async function withFetch(payload: unknown, run: (calls: string[]) => Promise<void>) {
  const previous = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url) => { calls.push(String(url)); return Response.json(payload); }) as typeof fetch;
  try { await run(calls); } finally { globalThis.fetch = previous; }
}

test("真实账户目录保留平台身份，不从账户前缀推断或透传凭据", async () => {
  await withFetch({ data: { accounts: [{ execution_account_id: "kalshi:main", market_source: "KALSHI", wallet_address: "secret-api-key" }, { execution_account_id: "non-prefixed-account", market_source: "POLYMARKET" }], observed_at: observed } }, async () => {
    const result = await consoleV2.trading.accounts();
    assert.deepEqual(result.data.accounts, [{ executionAccountId: "kalshi:main", marketSource: "KALSHI" }, { executionAccountId: "non-prefixed-account", marketSource: "POLYMARKET" }]);
  });
  await withFetch({ data: { accounts: [{ execution_account_id: "main", market_source: "OTHER" }], observed_at: observed } }, async () => { await assert.rejects(consoleV2.trading.accounts()); });
});

test("双平台overview分别保留代际和观测时间，缺平台不捏造合计", async () => {
  const generation = (id: number, market_source: string, time: string) => ({ generation_id: id, source_selection_run_id: id + 100, market_source, status: "PUBLISHED", is_current: true, member_count: 20, prediction_enabled_count: 7, observed_at: time });
  await withFetch({ data: { observed_at: observed, sources: [{ market_source: "POLYMARKET", current_generation: generation(467, "POLYMARKET", observed), prediction_coverage: null }, { market_source: "KALSHI", current_generation: generation(468, "KALSHI", "2026-11-03T07:00:00Z"), prediction_coverage: null }], market_totals: { member_count: 40, prediction_enabled_count: 14, complete: true } } }, async () => {
    const { data } = await consoleV2.infra.overview();
    assert.equal(data.sources[0].currentGeneration?.generationId, "467");
    assert.equal(data.sources[1].currentGeneration?.generationId, "468");
    assert.equal(data.sources[1].currentGeneration?.observedAt, "2026-11-03T07:00:00Z");
    assert.equal(data.marketTotals?.predictionEnabledCount, 14);
  });
  await withFetch({ data: { observed_at: observed, sources: [{ market_source: "POLYMARKET", current_generation: null }, { market_source: "KALSHI", current_generation: null }], market_totals: { member_count: null, prediction_enabled_count: null, complete: false } } }, async () => { assert.equal((await consoleV2.infra.overview()).data.marketTotals?.memberCount, null); });
});

test("当前派发来自模型元数据，历史DeepSeek原ID与渠道分开", async () => {
  await withFetch({ data: { items: [{ model_id: "echoz", current_dispatch_channels: ["DIRECT"], result_count: 0 }, { model_id: "v4.1 flash", current_dispatch_channels: ["SANDBOX_NEW_READY"] }, { model_id: "deepseek-v4-flash", current_dispatch_channels: [] }], total: 3, limit: 20, offset: 0, observed_at: observed } }, async () => {
    const { data } = await consoleV2.infra.predictionModels();
    assert.equal(data.items[0].resultCount, 0);
    assert.deepEqual(data.items.map((item) => item.modelId), ["echoz", "v4.1 flash", "deepseek-v4-flash"]);
    assert.deepEqual(data.items[2].currentDispatchChannels, []);
  });
});

test("新增交易资源BFF只用服务端live token和固定路径", async () => {
  const names = ["TRADING_EXECUTION_BASE_URL", "TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN"];
  const old = names.map((name) => process.env[name]);
  process.env.TRADING_EXECUTION_BASE_URL = "http://trading.test";
  process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = "read-only";
  const fetch = globalThis.fetch;
  try {
    for (const resource of ["accounts", "ledger-activities", "settlements", "portfolio-holdings"]) {
      globalThis.fetch = (async (url, init) => { assert.equal(String(url), `http://trading.test/api/v1/console/v2/${resource}`); assert.equal(new Headers(init?.headers).get("authorization"), "Bearer read-only"); return Response.json({ data: {} }); }) as typeof fetch;
      assert.equal((await GET(new Request(`http://console.test/api/console/v2/trading/${resource}`), { params: Promise.resolve({ path: ["trading", resource] }) })).status, 200);
    }
  } finally { globalThis.fetch = fetch; names.forEach((name, i) => { if (old[i] === undefined) delete process.env[name]; else process.env[name] = old[i]; }); }
});

test("完整批次域内排名不会被旧全局序号或当前页重编号替代", async () => {
  await withFetch({ data: { items: [{ generation_id: 468, running_market_id: 99, source_selection_run_id: 573, source_selected_market_id: 100, market_source: "KALSHI", market_id: "KXTICKER", condition_id: "", question: "Question", primary_domain: "Economics", matched_domains: ["Economics"], domain_rank: 999, domain_volume_rank: 23, prediction_enabled: true, volume_24h: 100 }], limit: 20, offset: 20, total: 25, observed_at: observed } }, async (calls) => {
    const { data } = await consoleV2.infra.runningMarkets({ source: "KALSHI", generation_id: 468, prediction_enabled: "true", offset: 20 });
    assert.equal(data.items[0].domainVolumeRank, 23);
    assert.equal(data.items[0].domainRank, 999);
    assert.equal(data.items[0].marketSource, "KALSHI");
    assert.equal(data.items[0].conditionId, "");
    assert.equal(data.total, 25);
    assert.match(calls[0], /source=KALSHI/);
    assert.match(calls[0], /prediction_enabled=true/);
  });
});

test("统一结算只接受平台适用状态，0金额与缺链上证据保持真实", async () => {
  const settlement = { settlement_id: "zero-payout", market_source: "KALSHI", execution_account_id: "kalshi:main", market_id: "KXTICKER", condition_id: "", status: "APPLIED", payout: "0", created_at: observed, updated_at: observed, settled_at: observed, confirmed_at: null, applied_at: observed };
  const payload = (row: unknown) => ({ data: { items: [row], total: 1, limit: 20, offset: 0, observed_at: observed } });
  await withFetch(payload(settlement), async () => {
    const { data } = await consoleV2.trading.settlements();
    assert.equal(data.items[0].payout, "0");
    assert.equal(data.items[0].confirmedAt, undefined);
    assert.equal(data.items[0].transactionHash, undefined);
  });
  for (const change of [{ status: "CONFIRMED" }, { payout: false }, { payout: 0 }, { market_source: "OTHER" }]) await withFetch(payload({ ...settlement, ...change }), async () => { await assert.rejects(consoleV2.trading.settlements()); });
});


test("nullable账本金额显示未知，合法零兑付保留零", () => {
  const item = decodeTradingLedgerPage(page({ ...netting, cost_basis: null, settlement_payout: null } as unknown as typeof netting)).items[0];
  assert.equal(formatTradingLedgerMoney(item.costBasis), "—");
  assert.equal(formatTradingLedgerMoney(item.settlementPayout, true), "—");
  assert.equal(formatTradingLedgerMoney("0"), "$0.00");
  assert.equal(formatTradingLedgerMoney("14", true), "+$14.00");
});

test("晚回传更新目录后固定批次保持原水位、完整身份和代际，不冒用新批次统计", () => {
  const applied = { sources: "POLYMARKET,KALSHI", batch_model: "v4.1 flash", batch_source: "KALSHI", batch_prediction_as_of: "2026-11-03T07:00:00.123456Z", batch_max_result_id: "9007199254741001", batch_generation_id: "468", limit: 20, offset: 20, q: "question" };
  const scope = fixedPredictionBatch(applied);
  assert.deepEqual(scope, { modelId: "v4.1 flash", marketSource: "KALSHI", predictionAsOf: applied.batch_prediction_as_of, maxResultId: applied.batch_max_result_id, generationId: "468" });
  const original: ConsoleV2PredictionBatchSummary = { modelId: "v4.1 flash", marketSource: "KALSHI", predictionAsOf: applied.batch_prediction_as_of, maxResultId: applied.batch_max_result_id, generationIds: ["468"], resultCount: 300, sandboxCount: 297, sandboxResultCount: 300, directResultCount: 0, unknownResultCount: 0, sourceKinds: ["SANDBOX"] };
  assert.equal(matchingPredictionBatch([original], scope), original);
  const updated = { ...original, maxResultId: "9007199254741002", resultCount: 301, sandboxCount: 298 };
  assert.equal(matchingPredictionBatch([updated], scope), undefined);
  assert.equal(matchingPredictionBatch([], scope), undefined);
  const request = predictionResultQuery(applied);
  assert.deepEqual(request, { model: "v4.1 flash", source: "KALSHI", prediction_as_of: applied.batch_prediction_as_of, max_result_id: applied.batch_max_result_id, generation_id: "468", limit: 20, offset: 20, q: "question" });
  assert.deepEqual(predictionResultQuery({ ...applied, batch_generation_id: undefined, generation_id: "467" }).generation_id, "467");
  assert.equal(predictionResultQuery({ ...applied, batch_generation_id: undefined }).generation_id, undefined);
});


test("共享范围变更后不复活旧批次，未变更时保留固定身份与分页", () => {
  const keys = ["scope", "model", "source", "generation_id", "prediction_as_of"];
  const fixed = "scope=history&model=echoz&source=KALSHI&generation_id=468&batch_model=echoz&batch_source=KALSHI&batch_prediction_as_of=2026-11-03T07%3A00%3A00Z&batch_max_result_id=9999&batch_generation_id=468&offset=20";
  const current = new URLSearchParams("scope=history&model=echoz&source=KALSHI&generation_id=468");
  const unchanged = new URLSearchParams(mergeSharedQuery(fixed, current, keys));
  assert.equal(unchanged.get("batch_max_result_id"), "9999");
  assert.equal(unchanged.get("offset"), "20");
  for (const [key, value] of [["model", "v4.1 flash"], ["model", ""], ["source", "POLYMARKET"], ["source", ""], ["generation_id", "469"], ["scope", "current"]]) {
    const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key);
    const restored = new URLSearchParams(mergeSharedQuery(fixed, next, keys));
    assert.equal(restored.has("batch_max_result_id"), false, key);
    assert.equal(restored.has("batch_model"), false, key);
    assert.equal(restored.has("offset"), false, key);
    assert.equal(restored.get(key), value || null, key);
  }
  const currentScope = fixed.replace("scope=history", "scope=current");
  const currentWithoutId = new URLSearchParams("scope=current&model=echoz&source=KALSHI");
  assert.equal(new URLSearchParams(mergeSharedQuery(currentScope, currentWithoutId, keys)).has("batch_max_result_id"), false);
});


test("新增双平台合计与域内名次拒绝布尔、字符串和来源错配，避免伪零", async () => {
  for (const value of [false, "0", -1, 1.5]) {
    await withFetch({ data: { observed_at: observed, sources: [], market_totals: { complete: true, member_count: value, prediction_enabled_count: 0 } } }, async () => { await assert.rejects(consoleV2.infra.overview()); });
  }
  for (const sources of [[{ market_source: "OTHER" }], [{ market_source: "KALSHI" }, { market_source: "KALSHI" }], [{ market_source: "KALSHI", current_generation: { generation_id: 468, source_selection_run_id: 573, market_source: "POLYMARKET", status: "PUBLISHED" } }]]) {
    await withFetch({ data: { observed_at: observed, sources } }, async () => { await assert.rejects(consoleV2.infra.overview()); });
  }
});


test("隐藏结果metadata虽随父模型改变，批次保存的父范围仍阻止旧模型覆盖和清空模型复活", () => {
  const context = predictionBatchParentContext({ model: "echoz", source: "KALSHI", scope: "history", generation_id: "468" });
  const selected = { scope: "history", model: "echoz", source: "KALSHI", generation_id: "468", batch_model: "echoz", batch_source: "KALSHI", batch_prediction_as_of: observed, batch_max_result_id: "9999", batch_context: context };
  for (const model of ["v4.1 flash", ""]) {
    const updatedMetadata = { ...selected, model };
    assert.equal(fixedPredictionBatch(updatedMetadata), undefined);
    const target = new URLSearchParams(updatedMetadata).toString();
    const current = new URLSearchParams({ scope: "history", model, source: "KALSHI", generation_id: "468" });
    const restored = new URLSearchParams(mergeSharedQuery(target, current, ["scope", "model", "source", "generation_id", "prediction_as_of"]));
    assert.equal(restored.has("batch_model"), false);
    assert.equal(restored.has("batch_context"), false);
    assert.equal(predictionResultQuery(updatedMetadata).model, model);
    assert.equal(predictionResultQuery(updatedMetadata).max_result_id, undefined);
  }
  const allModels = { ...selected, model: "", batch_context: predictionBatchParentContext({ model: "", source: "KALSHI", scope: "history", generation_id: "468" }) };
  assert.equal(fixedPredictionBatch(allModels)?.modelId, "echoz");
});

test("当前范围只依赖两平台各自current，不依赖Direct coverage，缺任一平台不得退为全历史", () => {
  const overview = { sources: [{ marketSource: "POLYMARKET", currentGeneration: { generationId: "467", observedAt: observed }, predictionCoverage: null }, { marketSource: "KALSHI", currentGeneration: { generationId: "468", observedAt: "2026-11-03T07:00:00.123456Z" }, predictionCoverage: null }] } as unknown as ConsoleV2Overview;
  assert.deepEqual(currentPredictionRange(overview, "", "", ""), { generationId: undefined, generationIds: "467,468", missingSources: [] });
  assert.deepEqual(currentPredictionRange(overview, "KALSHI", "", ""), { generationId: "468", generationIds: undefined, missingSources: [] });
  assert.equal(currentPredictionRange(undefined, "", "", "").generationIds, undefined);
  const incomplete = { ...overview, sources: overview.sources.slice(0, 1) };
  assert.deepEqual(currentPredictionRange(incomplete, "", "", "").missingSources, ["KALSHI"]);
  assert.equal(currentPredictionRange(incomplete, "", "", "").generationIds, undefined);
  // URL replay retains a frozen snapshot even after another maintenance run.
  assert.equal(currentPredictionRange(overview, "", "", "465,466").generationIds, "465,466");
  assert.equal(currentPredictionRange(undefined, "KALSHI", "466", "").generationId, "466");
  for (const value of ["", "0", "1,1", "1,2,3", "1,", "-1", "9223372036854775808", "1e2"]) assert.deepEqual(predictionGenerationIds(value), [], value);
  assert.deepEqual(predictionGenerationIds("9007199254741001,9223372036854775807"), ["9007199254741001", "9223372036854775807"]);
});

test("显式非法或冲突的current维护范围不能被overview静默替换", () => {
  const overview = { sources: [{ marketSource: "POLYMARKET", currentGeneration: { generationId: "467" } }, { marketSource: "KALSHI", currentGeneration: { generationId: "468" } }] } as unknown as ConsoleV2Overview;
  for (const [source, single, multiple] of [["", "", "1,1"], ["", "", "1,"], ["", "", "9223372036854775808,468"], ["", "467", "467,468"], ["KALSHI", "468", "467,468"], ["KALSHI", "", "467,468"]]) {
    for (const data of [undefined, overview]) {
      const range = currentPredictionRange(data, source, single, multiple);
      assert.ok(range.error, `${source}/${single}/${multiple}`);
      assert.equal(range.generationId, undefined);
      assert.equal(range.generationIds, undefined);
    }
  }
  assert.equal(currentPredictionRange(overview, "KALSHI", "", "466").generationId, "466");
  for (const provided of [{ single: true, multiple: false }, { single: false, multiple: true }, { single: true, multiple: true }]) assert.ok(currentPredictionRange(overview, "", "", "", provided).error);
});

test("集合身份参与固定批次父范围；选中后结果使用单来源/代际且保持精确asof与原水位", () => {
  const parent = { scope: "current", model: "v4.1 flash", sources: "POLYMARKET,KALSHI", generation_ids: "467,468" };
  const selected = { ...parent, batch_model: "v4.1 flash", batch_source: "KALSHI", batch_generation_id: "468", batch_prediction_as_of: "2026-11-03T07:00:00.123456Z", batch_max_result_id: "9007199254741001", batch_context: predictionBatchParentContext(parent), offset: 20 };
  assert.equal(fixedPredictionBatch(selected)?.generationId, "468");
  assert.deepEqual(predictionResultQuery(selected), { model: "v4.1 flash", source: "KALSHI", generation_id: "468", prediction_as_of: selected.batch_prediction_as_of, max_result_id: selected.batch_max_result_id, offset: 20 });
  assert.equal(fixedPredictionBatch({ ...selected, generation_ids: "468,467" })?.generationId, "468");
  for (const changed of [{ generation_ids: "469,470" }, { generation_ids: "467,470" }, { model: "echoz" }, { model: "" }, { source: "POLYMARKET", sources: undefined, generation_ids: undefined, generation_id: "467" }]) {
    assert.equal(fixedPredictionBatch({ ...selected, ...changed }), undefined);
    assert.equal(predictionResultQuery({ ...selected, ...changed }).max_result_id, undefined);
  }
  const legacyContext = JSON.stringify({ model: "v4.1 flash", source: "KALSHI", scope: "current", generation_id: "", prediction_as_of: "" });
  const legacy = { ...selected, source: "KALSHI", sources: undefined, generation_id: "468", generation_ids: undefined, batch_context: legacyContext };
  assert.equal(fixedPredictionBatch(legacy)?.maxResultId, selected.batch_max_result_id);
  assert.equal(fixedPredictionBatch({ ...legacy, generation_id: "470" }), undefined);
});

test("旧任务入口只保留可解释结果范围，剥任务私有状态/搜索/分页与旧批次", () => {
  const input = new URLSearchParams("model=v4.1+flash&sources=POLYMARKET,KALSHI&scope=current&generation_ids=467,468&status=PENDING&q=private&offset=40&limit=50&batch_model=echoz&batch_max_result_id=99");
  const target = new URL(predictionTasksRedirect(input), "http://console.test");
  assert.equal(target.pathname, "/predictions");
  assert.equal(target.searchParams.get("model"), "v4.1 flash");
  assert.equal(target.searchParams.get("generation_ids"), "467,468");
  for (const key of ["status", "q", "offset", "limit", "batch_model", "batch_max_result_id"]) assert.equal(target.searchParams.has(key), false);
  assert.equal(predictionTasksRedirect(new URLSearchParams("source=KALSHI&generation_id=468&prediction_as_of=2026-11-03T07%3A00%3A00.123456Z")), "/predictions?source=KALSHI&generation_id=468&prediction_as_of=2026-11-03T07%3A00%3A00.123456Z");
});


test("账户目录读取真实配置，缺失模式不推定启用，拒绝未知模式", async () => {
  const row = { execution_account_id: "wallet-new", market_source: "POLYMARKET", strategy_id: "current-strategy", mode: "PAUSED", prediction_model_id: "v4.1 flash", source_mode: "SANDBOX", wallet_address: "secret", private_key_path: "secret", api_key_id: "secret" };
  await withFetch({ data: { accounts: [row], observed_at: observed } }, async () => {
    const account = (await consoleV2.trading.accounts()).data.accounts[0];
    assert.deepEqual(account, { executionAccountId: "wallet-new", marketSource: "POLYMARKET", strategyId: "current-strategy", mode: "PAUSED", predictionModelId: "v4.1 flash", sourceMode: "SANDBOX" });
    assert.equal(JSON.stringify(account).includes("secret"), false);
  });
  for (const mode of [undefined, null, ""]) await withFetch({ data: { accounts: [{ ...row, mode }], observed_at: observed } }, async () => { assert.equal((await consoleV2.trading.accounts()).data.accounts[0].mode, undefined); });
  for (const change of [{ mode: "enabled" }, { mode: "NOT_ACTIVE" }, { source_mode: "LIVE" }, { mode: false }, { prediction_model_id: true }, { strategy_id: 2 }]) await withFetch({ data: { accounts: [{ ...row, ...change }], observed_at: observed } }, async () => { await assert.rejects(consoleV2.trading.accounts()); });
});

test("新资产成员BFF限定固定路径与只读token，不开放任意子资源", async () => {
  const oldBase = process.env.TRADING_EXECUTION_BASE_URL;
  const oldToken = process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.TRADING_EXECUTION_BASE_URL = "http://trading.test";
  process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = "read-only";
  const identity = '["wallet-a","POLYMARKET","m","c","t",0,"Yes"]';
  try {
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/api/v1/console/v2/portfolio-holdings/lots");
      assert.equal(url.searchParams.get("holding_identity"), identity);
      assert.equal(url.searchParams.get("offset"), "5");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer read-only");
      return Response.json({ data: {} });
    }) as typeof fetch;
    const params = new URLSearchParams({ holding_identity: identity, limit: "5", offset: "5" });
    assert.equal((await GET(new Request(`http://console.test/api/console/v2/trading/portfolio-holdings/lots?${params}`), { params: Promise.resolve({ path: ["trading", "portfolio-holdings", "lots"] }) })).status, 200);
    for (const path of [["trading", "portfolio-holdings", "arbitrary"], ["trading", "portfolio-holdings", "lots", "extra"]]) assert.equal((await GET(new Request("http://console.test/"), { params: Promise.resolve({ path }) })).status, 404);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldBase === undefined) delete process.env.TRADING_EXECUTION_BASE_URL; else process.env.TRADING_EXECUTION_BASE_URL = oldBase;
    if (oldToken === undefined) delete process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN; else process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = oldToken;
  }
});
