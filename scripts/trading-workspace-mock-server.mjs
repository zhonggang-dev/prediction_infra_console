// 交易工作区本地只读 fixture：用于隔离预览和真实浏览器验收，不连接生产服务。
// 启动：node scripts/trading-workspace-mock-server.mjs
// 前端配置：TRADING_EXECUTION_BASE_URL=http://127.0.0.1:18993
//          PREDICTION_INFRA_BASE_URL=http://127.0.0.1:18993
//          TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN=mock-token
//          TRADING_EXECUTION_API_TOKEN=mock-token
//          CONSOLE_API_TOKEN=mock-token
// 测试故障开关（仅进程启动时读取，专供浏览器回归，不暴露生产端点）：
//          TRADING_WORKSPACE_MOCK_FAIL_RUNTIME=1
//          TRADING_WORKSPACE_MOCK_FAIL_LIVE_OPERATIONS=1
//          TRADING_WORKSPACE_MOCK_SERVICE=prediction-infra|trading-execution

import { createServer } from "node:http";

const PORT = Number(process.env.TRADING_WORKSPACE_MOCK_PORT ?? 18993);
const TOKEN = process.env.MOCK_TOKEN ?? "mock-token";
const FAIL_RUNTIME = process.env.TRADING_WORKSPACE_MOCK_FAIL_RUNTIME === "1";
const FAIL_LIVE_OPERATIONS = process.env.TRADING_WORKSPACE_MOCK_FAIL_LIVE_OPERATIONS === "1";
const MOCK_SERVICE = process.env.TRADING_WORKSPACE_MOCK_SERVICE === "prediction-infra" ? "prediction-infra" : "trading-execution";
const now = Date.now();
const iso = (minutesAgo = 0) => new Date(now - minutesAgo * 60_000).toISOString();
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const fail = (res, status, code, message) => json(res, status, { code, message });
const text = (value, fallback = "未知") => value === undefined || value === null || value === "" ? fallback : String(value);

const accounts = [
  { execution_account_id: "wallet-main", model_id: "echoz", strategy_id: "strategy-v4", source_mode: "DIRECT", configured_binding: true, database_binding_enabled: true, risk_policy_enabled: true, account_paused: false, strategy_input_state: "enabled", entry_gate_state: "enabled", order_submission_state: "enabled", last_cycle_at: iso(3), last_cycle_status: "OUTPUT_RECORDED", last_cycle_entry_block_reason: null, last_reconciliation_at: iso(12), last_reconciliation_status: "SUCCEEDED", open_issue_count: 0, open_order_count: 2 },
  { execution_account_id: "wallet-sell-only", model_id: "deepseek_masked", strategy_id: "strategy-v4", source_mode: "SANDBOX", configured_binding: true, database_binding_enabled: true, risk_policy_enabled: true, account_paused: false, strategy_input_state: "disabled", entry_gate_state: "sell_only", order_submission_state: "enabled", last_cycle_at: iso(5), last_cycle_status: "DELIVERY_ATTENTION", last_cycle_entry_block_reason: "预测覆盖不足", last_reconciliation_at: iso(22), last_reconciliation_status: "ATTENTION_REQUIRED", open_issue_count: 2, open_order_count: 1 },
  { execution_account_id: "wallet-unknown", model_id: "deepseek_masked", strategy_id: "legacy-v2", source_mode: "SANDBOX", configured_binding: null, database_binding_enabled: null, risk_policy_enabled: null, account_paused: null, strategy_input_state: "unknown", entry_gate_state: "unknown", order_submission_state: "unknown", last_cycle_at: null, last_cycle_status: null, last_cycle_entry_block_reason: null, last_reconciliation_at: null, last_reconciliation_status: null, open_issue_count: null, open_order_count: null },
];

const bindings = accounts.map(({ execution_account_id, model_id, strategy_id, source_mode }) => ({ execution_account_id, model_id, strategy_id, source_mode, prediction_model_id: model_id === "deepseek_masked" ? "deepseek" : model_id }));

const orders = Array.from({ length: 43 }, (_, index) => {
  const account = accounts[index % accounts.length];
  const status = index % 11 === 0 ? "MANUAL_REVIEW" : index % 7 === 0 ? "ACKNOWLEDGED" : "FILLED";
  return { order_id: `ord-fixture-${String(index + 1).padStart(3, "0")}`, client_order_id: `client-${index + 1}`, venue_order_id: `venue-${index + 1}`, status, side: index % 3 === 0 ? "SELL" : "BUY", price: 0.31 + (index % 8) * 0.04, shares: 10 + index, filled_shares: status === "FILLED" ? 10 + index : 0, average_fill_price: status === "FILLED" ? 0.34 + (index % 5) * 0.03 : null, execution_account_id: account.execution_account_id, model_id: account.model_id, strategy_id: account.strategy_id, market_source: "POLYMARKET", source: "POLYMARKET", market_id: `market-${index % 9 + 1}`, market_question: index % 8 === 0 ? null : `Fixture market ${index % 9 + 1} question`, outcome_name: index % 10 === 0 ? null : (index % 2 ? "Yes" : "No"), condition_id: `condition-${index % 9 + 1}`, token_id: `token-${index % 9 + 1}`, created_at: iso(index * 4 + 2), updated_at: iso(index * 3), evidence_summary: { fill_evidence_state: status === "FILLED" ? "confirmed" : "none", accounting_state: status === "FILLED" ? "applied" : "not_applied", confirmed_fill_count: status === "FILLED" ? 1 : 0, applied_fill_count: status === "FILLED" ? 1 : 0, pending_fill_count: status === "FILLED" ? 0 : 1, open_issue_count: status === "MANUAL_REVIEW" ? 1 : 0, reservation_state: status === "FILLED" ? "released" : "reserved" } };
});

const cycles = Array.from({ length: 37 }, (_, index) => {
  const account = accounts[index % accounts.length];
  const status = index % 9 === 0 ? "DELIVERY_ATTENTION" : index % 6 === 0 ? "DELIVERY_PENDING" : "OUTPUT_RECORDED";
  return { cycle_id: `cycle-fixture-${String(index + 1).padStart(3, "0")}`, decision_at: iso(index * 6), model_id: account.model_id, prediction_model_id: account.model_id === "deepseek_masked" ? "deepseek" : account.model_id, strategy_id: account.strategy_id, execution_account_id: account.execution_account_id, input_id: `input-${index + 1}`, prediction_snapshot_id: `snapshot-${index + 1}`, orderbook_snapshot_set_id: `books-${index + 1}`, input_created_at: iso(index * 6 + 1), output_recorded_at: status === "OUTPUT_RECORDED" ? iso(index * 6 - 1) : null, order_submission_enabled: account.order_submission_state === "enabled", entry_submission_enabled: account.entry_gate_state === "enabled", entry_block_reason: account.entry_gate_state === "enabled" ? null : "账户当前仅允许退出", prediction_count: 20 + index, position_lot_count: 3 + index % 4, intent_count: index % 9 === 0 ? 0 : 2, delivery_pending_count: status === "DELIVERY_PENDING" ? 2 : 0, delivery_failed_count: status === "DELIVERY_ATTENTION" ? 1 : 0, status };
});

const cycleDetail = (cycle) => ({ ...cycle, predictions: [{ prediction_id: `prediction-${cycle.cycle_id}`, source_job_id: `job-${cycle.cycle_id}`, market_id: "market-1", condition_id: "condition-1" }], orderbook_snapshots: [{ market_source: "POLYMARKET", market_id: "market-1", token_id: "token-1", status: "AVAILABLE", observed_at: cycle.decision_at }], deliveries: [{ status: cycle.delivery_failed_count ? "FAILED" : "PUBLISHED", client_order_id: `client-${cycle.cycle_id}`, order_id: `ord-fixture-${cycle.cycle_id.slice(-3)}`, created_at: cycle.input_created_at, completed_at: cycle.output_recorded_at }], order_submission_enabled: cycle.order_submission_enabled, entry_submission_enabled: cycle.entry_submission_enabled, entry_block_reason: cycle.entry_block_reason, prediction_snapshot_id: cycle.prediction_snapshot_id, orderbook_snapshot_set_id: cycle.orderbook_snapshot_set_id });
const orderTrace = (order) => ({ observed_at: iso(1), order, deliveries: [{ status: order.status === "FILLED" ? "PUBLISHED" : "ATTENTION_REQUIRED", cycle_id: `cycle-fixture-${order.order_id.slice(-3)}`, order_id: order.order_id, created_at: order.created_at, completed_at: order.updated_at }], events: [{ to_status: order.status, trigger: "FIXTURE", reason_code: order.status === "MANUAL_REVIEW" ? "MANUAL_REVIEW" : null, occurred_at: order.updated_at }], attempts: [{ kind: "SUBMIT", outcome: order.status === "FILLED" ? "ACKNOWLEDGED" : "PENDING", error_code: order.status === "MANUAL_REVIEW" ? "REVIEW_REQUIRED" : null, started_at: order.created_at, completed_at: order.updated_at }], fills: order.status === "FILLED" ? [{ status: "CONFIRMED", shares: String(order.filled_shares), price: String(order.average_fill_price), matched_at: order.updated_at, confirmed_at: order.updated_at, applied_at: order.updated_at }] : [], position_lots: positionLots.filter((lot) => lot.opening_order_id === order.order_id), reconciliation_issues: order.status === "MANUAL_REVIEW" ? issues : [] });

const holdings = Array.from({ length: 28 }, (_, index) => {
  const account = accounts[index % accounts.length];
  const lotCount = index === 0 ? 26 : 1 + index % 4;
  const remainingShares = index === 0 ? "26.000000" : String(12 + index);
  const remainingCost = index === 0 ? "9.880000" : String((12 + index) * 0.38);
  const hasMark = index === 0 || index % 7 !== 0;
  return { model_id: index % 5 === 0 ? "legacy-v1" : account.model_id, strategy_id: index % 5 === 0 ? "old-strategy" : account.strategy_id, execution_account_id: account.execution_account_id, market_source: "POLYMARKET", market_id: `market-${index % 9 + 1}`, market_question: `Fixture market ${index % 9 + 1}`, condition_id: `condition-${index % 9 + 1}`, token_id: `token-${index % 9 + 1}`, outcome_index: index % 2, outcome_name: index % 2 ? "Yes" : "No", status: index % 13 === 0 ? "MIXED" : index % 6 === 0 ? "SETTLED_PENDING_REDEEM" : "OPEN", remaining_shares: remainingShares, remaining_cost: remainingCost, lot_count: lotCount, mark_price: hasMark ? "0.42" : null, market_value: hasMark ? String(Number(remainingShares) * 0.42) : null, unrealized_pnl: hasMark ? String(Number(remainingShares) * 0.04) : null, first_opened_at: iso(120 + index), last_opened_at: iso(90 + index), mark_observed_at: hasMark ? iso(2) : null };
});

const holdingIdentity = (holding) => JSON.stringify([holding.execution_account_id, holding.model_id, holding.strategy_id, holding.market_source, holding.market_id, holding.condition_id, holding.token_id, holding.outcome_index, holding.outcome_name]);
const positionLots = holdings.flatMap((holding, holdingIndex) => Array.from({ length: holding.lot_count }, (_, lotIndex) => {
  const shares = Number(holding.remaining_shares) / holding.lot_count;
  const cost = Number(holding.remaining_cost) / holding.lot_count;
  const lotStatus = holding.status === "MIXED" ? (lotIndex % 2 === 0 ? "OPEN" : "SETTLED_PENDING_REDEEM") : holding.status;
  return { lot_id: `lot-fixture-${holdingIndex + 1}-${lotIndex + 1}`, model_id: holding.model_id, strategy_id: holding.strategy_id, execution_account_id: holding.execution_account_id, market_id: holding.market_id, condition_id: holding.condition_id, token_id: holding.token_id, outcome_index: holding.outcome_index, outcome_name: holding.outcome_name, market_source: holding.market_source, status: lotStatus, opening_order_id: `ord-fixture-${holdingIndex % orders.length + 1}`, opening_fill_key: `fill-fixture-${holdingIndex + 1}-${lotIndex + 1}`, original_shares: String(shares), remaining_shares: String(shares), original_cost: String(cost), remaining_cost: String(cost), average_entry_price: "0.38", opened_at: holding.first_opened_at, closed_at: null, holding_identity: holdingIdentity(holding) };
}));

const ledgerActivities = Array.from({ length: 46 }, (_, index) => {
  const account = accounts[index % accounts.length];
  const activityType = index % 9 === 0 ? "REDEEM" : index % 3 === 0 ? "SELL" : "BUY";
  return { activity_key: `activity-fixture-${String(index + 1).padStart(3, "0")}`, activity_type: activityType, venue: "POLYMARKET", execution_account_id: account.execution_account_id, model_id: account.model_id, strategy_id: account.strategy_id, market_id: `market-${index % 9 + 1}`, market_label: `Fixture market ${index % 9 + 1}`, condition_id: `condition-${index % 9 + 1}`, token_id: `token-${index % 9 + 1}`, outcome_name: index % 2 ? "Yes" : "No", lot_id: `lot-fixture-${index + 1}`, order_id: activityType === "REDEEM" ? null : `ord-fixture-${index % orders.length + 1}`, venue_order_id: activityType === "REDEEM" ? null : `venue-${index % orders.length + 1}`, venue_trade_id: activityType === "REDEEM" ? null : `trade-${index + 1}`, order_status: "FILLED", liquidity_role: activityType === "REDEEM" ? null : "MAKER", shares: String(10 + index), price: activityType === "REDEEM" ? null : "0.42", gross_notional: activityType === "REDEEM" ? null : String((10 + index) * 0.42), total_fee: activityType === "REDEEM" ? "0" : "0.01", net_cash_delta: activityType === "BUY" ? "-4.2" : "4.0", cost_basis: activityType === "BUY" ? null : "3.6", settlement_payout: activityType === "REDEEM" ? "4.4" : null, realized_pnl: activityType === "BUY" ? "0" : activityType === "REDEEM" ? "0.8" : "0.4", transaction_hash: activityType === "REDEEM" ? "0xfixture" : null, occurred_at: iso(index * 4), confirmed_at: iso(index * 4 - 1), applied_at: iso(index * 4 - 2) };
});

const issues = [{ issue_id: "issue-fixture-001", run_id: "run-fixture-001", execution_account_id: "wallet-sell-only", issue_type: "BALANCE_DRIFT", resolution: null, severity: "HIGH", status: "OPEN", reason_code: "REMOTE_BALANCE_DIFF", order_id: "ord-fixture-007", venue_order_id: "venue-7", venue_trade_id: null, market_id: "market-2", condition_id: "condition-2", token_id: "token-2", local_value: "12.00", remote_value: "11.50", source: "POLYMARKET", observed_at: iso(8), first_observed_at: iso(23), impact_scope: "ACCOUNT", resolved_at: null }];
const runs = [{ run_id: "run-fixture-001", execution_account_id: "wallet-sell-only", trigger: "SCHEDULED", focus_order_id: "ord-fixture-007", status: "ATTENTION_REQUIRED", result: "BALANCE_DRIFT", started_at: iso(9), completed_at: iso(8) }, { run_id: "run-fixture-002", execution_account_id: "wallet-main", trigger: "SCHEDULED", focus_order_id: null, status: "SUCCEEDED", result: "MATCHED", started_at: iso(18), completed_at: iso(17) }];
const redemptions = [{ redemption_id: "redeem-fixture-001", condition_id: "condition-2", market_id: "market-2", execution_account_id: "wallet-sell-only", status: "CONFIRMED", transaction_hash: "0xfixture", payout_base_units: 1250000, receipt_block_number: 123456, confirmations: 8, created_at: iso(60), updated_at: iso(55), confirmed_at: iso(55), applied_at: null }];

function runtime() { return { data: { observed_at: iso(1), runner: { enabled: true, running: true, loop_started: true, in_flight: false, state: "running", interval_seconds: 600, loop_stopped_at: null, next_boundary: iso(-7), next_due_at: iso(-7), last_started_at: iso(4), last_completed_at: iso(3), last_succeeded_at: iso(3), has_last_error: false, last_error_code: null, skipped_boundaries: 0 }, bindings, submission: { order_submission_enabled: true, entry_submission_disabled: false, submission_disabled_accounts: [], entry_disabled_accounts: [], strategy_disabled_accounts: [], kalshi_strategy_input_enabled: null }, account_data_state: "available", accounts } };
}
function liveOperations() {
  const positionRows = holdings.filter((holding) => holding.mark_price !== null).slice(0, 8).map((holding, index) => ({ positionId: `holding-fixture-${index + 1}`, executionAccountId: holding.execution_account_id, managed: true, marketId: holding.market_id, marketLabel: holding.market_question, outcomeName: holding.outcome_name, shares: Number(holding.remaining_shares), averagePrice: 0.38, markPrice: Number(holding.mark_price), cost: Number(holding.remaining_cost), marketValue: Number(holding.market_value), unrealizedPnl: Number(holding.unrealized_pnl), exposurePct: 0.04, strategyId: holding.strategy_id }));
  const positionCounts = new Map(accounts.map((account) => [account.execution_account_id, positionRows.filter((position) => position.executionAccountId === account.execution_account_id).length]));
  return { data: { observedAt: iso(1), dataFreshnessSeconds: 61, engine: { health: "healthy", runId: "run-fixture", presetName: "fixture", startedAt: iso(300), venueName: "Polymarket", venueStatus: "healthy", ledgerStatus: "healthy", reconciliationStatus: "degraded" }, capital: { equity: 1000, availableCash: 420, grossExposure: 580, exposureLimit: 1000, realizedPnlToday: 12.5, unrealizedPnl: 8.2, feeToday: 0.42 }, wallets: accounts.map((account, index) => ({ executionAccountId: account.execution_account_id, positionCount: positionCounts.get(account.execution_account_id) ?? 0, peakCashUsed: 100 + index * 10, cumulativeInvestedCost: 220 + index * 15, realizedPnl: index === 1 ? -3.5 : 5 + index, unrealizedPnl: 2.1 + index, totalPnl: index === 1 ? -1.4 : 7 + index, return: index === 2 ? null : 0.03 + index * 0.01 })), workers: [], funnel: [], risks: [{ id: "exposure", name: "总敞口", current: 580, warningThreshold: 700, hardLimit: 1000, usagePercentage: 0.58, hardLimitEnforced: true, thresholdType: "hard_limit", unit: "$", hint: "fixture", state: "safe" }], orders: orders.slice(0, 4).map((order) => ({ orderId: order.order_id, executionAccountId: order.execution_account_id, marketId: order.market_id, marketLabel: order.market_id, outcomeName: "Yes", side: order.side, status: order.status, price: order.price, shares: order.shares, filledShares: order.filled_shares, averageFillPrice: order.average_fill_price, createdAt: order.created_at, updatedAt: order.updated_at, lifecycle: [] })), positions: positionRows, events: [], dataQuality: [{ id: "snapshot", name: "实盘快照", status: "healthy", detail: "fixture" }] } };
}
function dailyPnl(url) {
  const requestedDays = Number(url.searchParams.get("days") ?? 14);
  const days = requestedDays === 7 || requestedDays === 30 ? requestedDays : 14;
  const items = accounts.flatMap((account, accountIndex) => Array.from({ length: days }, (_, day) => {
    const redemption = day === Math.min(10, days - 1) && accountIndex === 1;
    return { day: new Date(now - (days - 1 - day) * 86_400_000).toISOString().slice(0, 10), execution_account_id: account.execution_account_id, model_id: account.model_id, strategy_id: account.strategy_id, realized_pnl: String((accountIndex - 1) * 0.8 + day * 0.1), closed_trade_count: day % 3, closed_shares: String(day + 1), redemption_count: redemption ? 1 : 0, redemption_pnl: redemption ? "1.2" : "0" };
  }));
  return { data: { items, days, from_day: items[0]?.day, to_day: items.at(-1)?.day, timezone: "UTC", generated_at: iso(1) } };
}
function edge() { return { data: { decision_at: iso(3), generated_at: iso(2), price_basis: "MIDPOINT", outcome_scope: "OUTCOME_0", bin_width: 0.1, range_min: -0.5, range_max: 0.5, series: ["echoz", "deepseek_masked"].map((model_id, index) => { const sampleCount = 12 + index; const peakCount = 3 + index; return { model_id, sample_count: sampleCount, excluded_count: index, mean: index ? 0.04 : 0.02, median: 0.03, standard_deviation: 0.1, minimum: -0.2, maximum: 0.3, positive_ratio: 0.58, bins: Array.from({ length: 10 }, (_, bin) => { const count = bin === 5 ? peakCount : 1; return { lower: -0.5 + bin * 0.1, upper: -0.4 + bin * 0.1, count, ratio: count / sampleCount }; }) }; }) } };
}
function serviceMetrics(service = "trading-execution") { return { data: { service, observed_at: iso(1), uptime_seconds: 86400, runtime: { goroutines: 12, go_version: "go1.27" }, memory: { heap_alloc_bytes: 1024 * 1024 * 20, heap_inuse_bytes: 1024 * 1024 * 24, sys_bytes: 1024 * 1024 * 40 }, availability: { console_v2: "available", ledger: "available" } } }; }
const outbox = Array.from({ length: 24 }, (_, index) => ({ outbox_event_id: `outbox-fixture-${index + 1}`, event_type: index % 5 === 0 ? "TRADE_ATTENTION" : "TRADE_RECORDED", aggregate_type: "order", aggregate_id: `ord-fixture-${index % orders.length + 1}`, delivery_status: index % 7 === 0 ? "FAILED" : "PUBLISHED", attempt_count: index % 7 === 0 ? 2 : 1, last_attempt_at: iso(index * 5), created_at: iso(index * 5 + 2), published_at: index % 7 === 0 ? null : iso(index * 5 + 1), has_last_error: index % 7 === 0 }));
function redisMonitor() { return { data: { status: "degraded", sampled_at: iso(1), stale: false, instance: { used_memory_bytes: 5242880, used_memory_dataset_bytes: 4194304, used_memory_rss_bytes: 7340032, max_memory_bytes: 16777216, usage_percent: 31.25, max_memory_configured: true, level: "normal", eviction_policy: "noeviction" }, keys: { total_keys: 18, scanned_keys: 18, scan_complete: true, categories: [{ name: "trading:cache", kind: "cache", key_count: 8, estimated_bytes: 1048576 }, { name: "prediction:stream", kind: "stream", key_count: 2, estimated_bytes: 2097152 }] }, streams: [{ key: "prediction:events", category: "prediction:stream", length: 12, estimated_bytes: 2097152, groups: [{ name: "trading-consumer", consumers: 1, lag: 2, pending: 1 }] }], cleanup: { status: "not_enabled", retention_days: 0, message: "fixture" }, errors: ["fixture：消费组存在少量 lag"] } }; }

function ledgerPage(url) {
  const q = text(url.searchParams.get("q"), "").toLowerCase();
  const activityType = url.searchParams.get("activity_type");
  const account = url.searchParams.get("execution_account_id");
  const model = url.searchParams.get("model_id");
  const strategy = url.searchParams.get("strategy_id");
  const from = Date.parse(url.searchParams.get("from") ?? "");
  const to = Date.parse(url.searchParams.get("to") ?? "");
  const filtered = ledgerActivities.filter((item) => {
    if (activityType && item.activity_type !== activityType) return false;
    if (account && item.execution_account_id !== account) return false;
    if (model && item.model_id !== model) return false;
    if (strategy && item.strategy_id !== strategy) return false;
    const occurred = Date.parse(item.occurred_at);
    if (Number.isFinite(from) && occurred < from) return false;
    if (Number.isFinite(to) && occurred >= to) return false;
    return !q || JSON.stringify(item).toLowerCase().includes(q);
  });
  const sum = (selector) => filtered.reduce((total, item) => total + Number(selector(item) ?? 0), 0).toFixed(6);
  const summary = { activity_count: filtered.length, trade_count: filtered.filter((item) => item.activity_type !== "REDEEM").length, redemption_count: filtered.filter((item) => item.activity_type === "REDEEM").length, buy_notional: sum((item) => item.activity_type === "BUY" ? item.gross_notional : 0), sell_notional: sum((item) => item.activity_type === "SELL" || item.activity_type === "EXTERNAL_SELL" ? item.gross_notional : 0), redeem_payout: sum((item) => item.settlement_payout), net_cash_flow: sum((item) => item.net_cash_delta), total_fee: sum((item) => item.total_fee), realized_pnl: sum((item) => item.realized_pnl), sell_realized_pnl: sum((item) => item.activity_type === "SELL" || item.activity_type === "EXTERNAL_SELL" ? item.realized_pnl : 0), redeem_realized_pnl: sum((item) => item.activity_type === "REDEEM" ? item.realized_pnl : 0) };
  return page(filtered, url, { allowQuery: false, summary });
}

function page(items, url, options = {}) {
  const q = options.allowQuery === false ? "" : text(url.searchParams.get("q"), "").toLowerCase();
  const account = url.searchParams.get("execution_account_id") ?? url.searchParams.get("account");
  const model = url.searchParams.get("model_id") ?? url.searchParams.get("model");
  const strategy = url.searchParams.get("strategy_id") ?? url.searchParams.get("strategy");
  const source = url.searchParams.get("market_source") ?? url.searchParams.get("source");
  const status = url.searchParams.get("status");
  const filtered = items.filter((item) => {
    if (q && !JSON.stringify(item).toLowerCase().includes(q)) return false;
    if (account && item.execution_account_id !== account) return false;
    if (model && item.model_id !== model) return false;
    if (strategy && item.strategy_id !== strategy) return false;
    if (source && item.market_source !== source) return false;
    if (status && status !== "ALL" && item.status !== status) return false;
    return true;
  });
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  return { data: { items: filtered.slice(offset, offset + limit), limit, offset, total: filtered.length, has_more: offset + limit < filtered.length, observed_at: iso(1), ...(options.summary ? { summary: options.summary } : {}) } };
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://mock");
  if (url.pathname === "/health/ready") return json(res, 200, { status: "ok", version: "fixture", commit: "fixture" });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return fail(res, 401, "UNAUTHORIZED", "fixture token required");
  if (req.method !== "GET") return fail(res, 405, "READ_ONLY", "fixture is read-only");
  if (url.pathname === "/api/v1/console/v2/runtime") return FAIL_RUNTIME ? fail(res, 503, "MOCK_RUNTIME_FAILURE", "fixture runtime failure enabled") : json(res, 200, runtime());
  if (url.pathname === "/api/v1/console/v2/service-metrics") return json(res, 200, serviceMetrics(MOCK_SERVICE));
  if (url.pathname === "/api/v1/service-metrics") return json(res, 200, serviceMetrics(MOCK_SERVICE));
  if (url.pathname === "/api/v1/console/service-metrics") return json(res, 200, serviceMetrics("prediction-infra"));
  if (url.pathname === "/api/v1/console/v2/decision-cycles") return json(res, 200, page(cycles, url));
  if (url.pathname.startsWith("/api/v1/console/v2/decision-cycles/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/v1/console/v2/decision-cycles/".length));
    const cycle = cycles.find((item) => item.cycle_id === id);
    return cycle ? json(res, 200, { data: cycleDetail(cycle) }) : fail(res, 404, "CONSOLE_V2_NOT_FOUND", "cycle not found");
  }
  if (url.pathname === "/api/v1/console/v2/orders") return json(res, 200, page(orders, url));
  if (url.pathname.startsWith("/api/v1/console/v2/orders/") && url.pathname.endsWith("/trace")) {
    const id = decodeURIComponent(url.pathname.slice("/api/v1/console/v2/orders/".length, -"/trace".length));
    const order = orders.find((item) => item.order_id === id);
    return order ? json(res, 200, { data: orderTrace(order) }) : fail(res, 404, "CONSOLE_V2_NOT_FOUND", "order not found");
  }
  if (url.pathname === "/api/v1/console/v2/holdings") return json(res, 200, page(holdings, url));
  if (url.pathname === "/api/v1/console/v2/holdings/lots") {
    const rawIdentity = url.searchParams.get("holding_identity");
    if (!rawIdentity || [...url.searchParams.keys()].some((key) => !["holding_identity", "limit", "offset"].includes(key))) return fail(res, 400, "INVALID_CONSOLE_V2_FILTER", "holding_identity is required");
    let identity;
    try { identity = JSON.parse(rawIdentity); } catch { return fail(res, 400, "INVALID_CONSOLE_V2_FILTER", "holding_identity must be JSON"); }
    if (!Array.isArray(identity) || identity.length !== 9) return fail(res, 400, "INVALID_CONSOLE_V2_FILTER", "holding_identity must contain nine fields");
    const normalized = JSON.stringify(identity.map((value, index) => index === 3 || index === 8 ? (value === "" ? null : value) : value));
    const matchingLots = positionLots.filter((lot) => lot.holding_identity === normalized);
    return json(res, 200, page(matchingLots, url, { allowQuery: false }));
  }
  if (url.pathname === "/api/v1/console/v2/reconciliation-issues") return json(res, 200, page(issues, url));
  if (url.pathname === "/api/v1/console/v2/reconciliation-runs") return json(res, 200, page(runs, url));
  if (url.pathname === "/api/v1/console/v2/redemptions") return json(res, 200, page(redemptions, url));
  if (url.pathname === "/api/v1/live-operations") return FAIL_LIVE_OPERATIONS ? fail(res, 503, "MOCK_LIVE_OPERATIONS_FAILURE", "fixture live-operations failure enabled") : json(res, 200, liveOperations());
  if (url.pathname === "/api/v1/daily-pnl") return json(res, 200, dailyPnl(url));
  if (url.pathname === "/api/v1/edge-distribution") return json(res, 200, edge());
  if (url.pathname === "/api/v1/ledger-activities") return json(res, 200, ledgerPage(url));
  if (url.pathname === "/api/v1/console/outbox-events") return json(res, 200, page(outbox, url));
  if (url.pathname === "/api/v1/console/redis-monitor") return json(res, 200, redisMonitor());
  return fail(res, 404, "NOT_FOUND", `fixture 未实现 ${url.pathname}`);
}).listen(PORT, "127.0.0.1", () => console.log(`trading workspace mock on http://127.0.0.1:${PORT} (token: ${TOKEN})`));
