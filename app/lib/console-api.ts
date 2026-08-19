"use client";

import { demoData, demoOverview } from "./demo-data";
import { demoTradeHistory } from "./demo-trades";
import type { ApiMode, ApiResult, BacktestCreateParams, ConsoleList, ConsoleResource, ConsoleRow, LiveEvent, LiveFunnelStage, LiveHealth, LiveOperationsSnapshot, LiveOrder, LiveOrderStep, LivePosition, LiveRiskMetric, LiveStageState, LiveWorker, OverviewData, TradeHistoryPage, TradeHistoryParams, TradeHistorySummary, TradeRecord, TradeSide } from "./types";

type RawRecord = Record<string, unknown>;
type ListPayload = { items?: RawRecord[]; total?: number; limit?: number; offset?: number };

export class ConsoleApiError extends Error {
  constructor(message: string, readonly mode: ApiMode = "unavailable") { super(message); }
}

/** 从同源 BFF 获取数据，令牌仅保留于服务端环境。 */
async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/console/${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  } catch {
    throw new ConsoleApiError("控制台网络不可用，请检查前端服务连接。", "unavailable");
  }
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string; message?: string; code?: string };
  if (!response.ok) throw new ConsoleApiError(payload.message ?? payload.error ?? "请求控制台接口失败", payload.code === "BACKEND_NOT_CONFIGURED" ? "unavailable" : "live");
  return { data: payload.data ?? (payload as T), mode: "live" };
}

/** 将后端 DTO 显式映射为页面摘要，避免 UI 依赖敏感字段。 */
function mapRow(resource: ConsoleResource, item: RawRecord): ConsoleRow {
  if (resource === "selected-markets") return { id: string(item.selected_market_id), kind: resource, title: string(item.question), secondary: string(item.condition_id), status: "selected", timestamp: optional(item.selected_at), domains: optional(item.primary_domain) ? [string(item.primary_domain)] : [], values: [{ label: "排名", value: string(item.rank) }, { label: "最佳买价", value: price(item.best_bid) }, { label: "最佳卖价", value: price(item.best_ask) }] };
  if (resource === "sandboxes") return { id: string(item.sandbox_id), kind: resource, title: `Sandbox ${string(item.sandbox_id)}`, secondary: `Market ${string(item.market_id)}`, status: item.committed_at ? "committed" : "pending", timestamp: optional(item.committed_at) ?? optional(item.decision_at), values: [{ label: "模式", value: string(item.mode) }, { label: "决策时间", value: string(item.decision_at) }, { label: "归档大小", value: bytes(item.archive_size_bytes) }] };
  if (resource === "predictions") return { id: string(item.prediction_id), kind: resource, title: string(item.model_name), secondary: string(item.condition_id), status: "received", timestamp: optional(item.received_at), values: [{ label: "执行模式", value: string(item.execution_mode) }, { label: string(item.outcome_0_name, "结果 1"), value: price(item.outcome_0_probability ?? item.probability) }, { label: string(item.outcome_1_name, "结果 2"), value: price(item.outcome_1_probability) }] };
  if (resource === "backtest-datasets") return { id: string(item.dataset_id), kind: resource, title: `回测数据集 ${string(item.dataset_id)}`, secondary: `${timeText(item.prediction_from)} → ${timeText(item.prediction_to)}`, status: string(item.status), timestamp: optional(item.requested_at), values: [{ label: "请求时间", value: timeText(item.requested_at) }] };
  if (resource === "orderbook-series") return { id: string(item.series_id), kind: resource, title: `${string(item.provider)} · ${number(item.resolution_ms) / 60_000} 分钟 · ${string(item.depth_limit)} 档`, secondary: string(item.sample_policy), status: "active", values: [{ label: "序列 ID", value: string(item.series_id) }] };
  return { id: string(item.outbox_event_id), kind: resource, title: string(item.event_type), secondary: string(item.aggregate_id), status: string(item.delivery_status), timestamp: optional(item.created_at), values: [{ label: "交付状态", value: string(item.delivery_status) }] };
}

function mapOverview(item: RawRecord): OverviewData {
  return { selectedMarketTotal: number(item.selected_market_total), sandboxTotal: number(item.sandbox_total), predictionTotal: number(item.prediction_total), backtestReadyTotal: number(item.backtest_ready_total), outboxPendingTotal: number(item.outbox_pending_total), currentSelectionRunID: optional(item.current_selection_run_id), lastSelectedAt: optional(item.last_selected_at), lastSandboxAt: optional(item.last_sandbox_at), lastPredictionAt: optional(item.last_prediction_at) };
}

function mapTrade(item: RawRecord): TradeRecord {
  const rawSide = string(item.side, "BUY").toUpperCase();
  return {
    fillKey: string(item.fill_key), venue: string(item.venue), venueTradeId: string(item.venue_trade_id),
    orderId: string(item.order_id), venueOrderId: string(item.venue_order_id), orderStatus: string(item.order_status),
    executionAccountId: string(item.execution_account_id), modelId: string(item.model_id), strategyId: string(item.strategy_id),
    marketId: string(item.market_id), marketLabel: optional(item.market_label), conditionId: optional(item.condition_id),
    tokenId: string(item.token_id), outcomeName: optional(item.outcome_name), lotId: optional(item.lot_id),
    side: (rawSide === "SELL" ? "SELL" : "BUY") as TradeSide, liquidityRole: string(item.liquidity_role),
    shares: string(item.shares, "0"), price: string(item.price, "0"), grossNotional: string(item.gross_notional, "0"),
    totalFee: string(item.total_fee, "0"), netCashDelta: string(item.net_cash_delta, "0"), realizedPnl: string(item.realized_pnl, "0"),
    transactionHash: optional(item.transaction_hash), matchedAt: string(item.matched_at), confirmedAt: string(item.confirmed_at),
  };
}

function mapTradeSummary(item: RawRecord | undefined): TradeHistorySummary {
  return {
    tradeCount: number(item?.trade_count), buyNotional: string(item?.buy_notional, "0"),
    sellNotional: string(item?.sell_notional, "0"), netCashFlow: string(item?.net_cash_flow, "0"),
    totalFee: string(item?.total_fee, "0"), realizedPnl: string(item?.realized_pnl, "0"),
  };
}
const optional = (value: unknown) => typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;
const string = (value: unknown, fallback = "—") => value === undefined || value === null || value === "" ? fallback : String(value);
const number = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0) || 0;
const price = (value: unknown) => typeof value === "number" ? value.toFixed(4) : value === undefined || value === null ? "—" : String(value);
const bytes = (value: unknown) => typeof value === "number" ? `${(value / 1_048_576).toFixed(1)} MB` : "—";
const timeText = (value: unknown) => optional(value) ? new Date(String(value)).toISOString().replace("T", " ").replace(".000Z", " UTC") : "—";
const record = (value: unknown): RawRecord => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
const records = (value: unknown): RawRecord[] => Array.isArray(value) ? value.map(record) : [];
const optionalNumber = (value: unknown) => value === undefined || value === null || value === "" ? undefined : Number.isFinite(Number(value)) ? Number(value) : undefined;
const optionalTime = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined;
const liveHealth = (value: unknown): LiveHealth => value === "healthy" || value === "stopped" ? value : "degraded";
const stageState = (value: unknown): LiveStageState => value === "done" || value === "active" || value === "warning" ? value : "idle";
const tradeSide = (value: unknown): TradeSide => String(value).toUpperCase() === "SELL" ? "SELL" : "BUY";

/** 显式映射线程心跳，允许尚未上报的线程返回 null 时间。 */
function mapLiveWorker(item: RawRecord): LiveWorker {
  return { id: string(item.id, "unknown"), name: string(item.name, "未知线程"), purpose: string(item.purpose, "—"), cadence: string(item.cadence, "—"), status: liveHealth(item.status), lastHeartbeatAt: optionalTime(item.lastHeartbeatAt), currentTask: string(item.currentTask, "等待首次上报"), metricLabel: string(item.metricLabel, "状态"), metricValue: string(item.metricValue, "—") };
}

/** 显式映射当前周期漏斗。 */
function mapLiveFunnelStage(item: RawRecord): LiveFunnelStage {
  return { id: string(item.id), index: number(item.index), name: string(item.name), description: string(item.description), count: number(item.count), throughputLabel: string(item.throughputLabel), state: stageState(item.state) };
}

/** 显式映射硬风控指标，未知状态按危险展示。 */
function mapLiveRisk(item: RawRecord): LiveRiskMetric {
  const state = item.state === "safe" || item.state === "warning" ? item.state : "danger";
  const rawUnit = string(item.unit, "count");
  const unit = rawUnit === "$" || rawUnit === "%" || rawUnit === "minutes" ? rawUnit : "count";
  return { id: string(item.id), name: string(item.name), current: number(item.current), limit: number(item.limit), unit, hint: string(item.hint), state };
}

/** 显式映射订单生命周期节点。 */
function mapLiveOrderStep(item: RawRecord): LiveOrderStep {
  const rawStatus = string(item.status, "idle");
  const status = rawStatus === "done" || rawStatus === "active" || rawStatus === "warning" ? rawStatus : "pending";
  return { name: string(item.name), status, timestamp: optionalTime(item.timestamp), detail: string(item.detail) };
}

/** 显式映射开放订单，保留 UNKNOWN、RECONCILING 等真实状态。 */
function mapLiveOrder(item: RawRecord): LiveOrder {
  return {
    orderId: string(item.orderId), marketId: string(item.marketId), marketLabel: string(item.marketLabel, "未知 Market"), outcomeName: string(item.outcomeName, "—"),
    side: tradeSide(item.side), status: string(item.status, "UNKNOWN"), price: number(item.price), shares: number(item.shares), filledShares: number(item.filledShares),
    ageSeconds: number(item.ageSeconds), modelId: string(item.modelId, "—"), strategyId: string(item.strategyId, "—"), triggeredBy: string(item.triggeredBy, "system"),
    predictedProbability: optionalNumber(item.predictedProbability), edge: optionalNumber(item.edge), lifecycle: records(item.lifecycle).map(mapLiveOrderStep),
  };
}

/** 显式映射链上仓位与账本成本的合并结果。 */
function mapLivePosition(item: RawRecord): LivePosition {
  return {
    positionId: string(item.positionId), marketId: string(item.marketId), marketLabel: string(item.marketLabel, "未知 Market"), outcomeName: string(item.outcomeName, "—"),
    shares: number(item.shares), averagePrice: number(item.averagePrice), markPrice: number(item.markPrice), cost: number(item.cost), marketValue: number(item.marketValue),
    unrealizedPnl: number(item.unrealizedPnl), exposurePct: number(item.exposurePct), strategyId: string(item.strategyId, "—"), predictionAgeMinutes: optionalNumber(item.predictionAgeMinutes),
  };
}

/** 显式映射最近的订单、成交、风险与系统事件。 */
function mapLiveEvent(item: RawRecord): LiveEvent {
  return { id: string(item.id), timestamp: optionalTime(item.timestamp) ?? new Date(0).toISOString(), severity: item.severity === "success" || item.severity === "warning" || item.severity === "error" ? item.severity : "info", thread: string(item.thread, "system"), section: string(item.section, "system"), title: string(item.title), detail: string(item.detail), marketLabel: optional(item.marketLabel), orderId: optional(item.orderId) };
}

/** 把后端快照转换为 UI 契约，并在核心时间缺失时拒绝伪装成实时数据。 */
function mapLiveOperations(item: RawRecord): LiveOperationsSnapshot {
  const observedAt = optionalTime(item.observedAt);
  const engine = record(item.engine);
  const startedAt = optionalTime(engine.startedAt);
  if (!observedAt || !startedAt) throw new ConsoleApiError("实盘聚合接口返回了无效时间字段", "live");
  const capital = record(item.capital);
  return {
    observedAt, dataFreshnessSeconds: number(item.dataFreshnessSeconds),
    engine: { health: liveHealth(engine.health), runId: string(engine.runId, "—"), presetName: string(engine.presetName, "—"), startedAt, venueName: string(engine.venueName, "Polymarket CLOB"), venueStatus: liveHealth(engine.venueStatus), ledgerStatus: liveHealth(engine.ledgerStatus), reconciliationStatus: liveHealth(engine.reconciliationStatus) },
    capital: { equity: number(capital.equity), availableCash: number(capital.availableCash), grossExposure: number(capital.grossExposure), exposureLimit: number(capital.exposureLimit), realizedPnlToday: number(capital.realizedPnlToday), unrealizedPnl: number(capital.unrealizedPnl), feeToday: number(capital.feeToday) },
    workers: records(item.workers).map(mapLiveWorker), funnel: records(item.funnel).map(mapLiveFunnelStage), risks: records(item.risks).map(mapLiveRisk),
    orders: records(item.orders).map(mapLiveOrder), positions: records(item.positions).map(mapLivePosition), events: records(item.events).map(mapLiveEvent),
    dataQuality: records(item.dataQuality).map((quality) => ({ id: string(quality.id), name: string(quality.name), status: liveHealth(quality.status), detail: string(quality.detail) })),
  };
}

export const consoleApi = {
  capabilities: () => request<{ console_read: boolean; trade_read: boolean; live_read: boolean; backtest_create: boolean }>("capabilities"),
  async overview() { const result = await request<RawRecord>("overview"); return { data: mapOverview(result.data), mode: result.mode }; },
  async list(resource: ConsoleResource, params: { limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams({ limit: String(params.limit ?? 20), offset: String(params.offset ?? 0) });
    const result = await request<ListPayload>(`${resource}?${query}`);
    const data: ConsoleList = { items: (result.data.items ?? []).map((item) => mapRow(resource, item)), total: number(result.data.total), limit: number(result.data.limit) || 20, offset: number(result.data.offset) };
    return { data, mode: result.mode };
  },
  async tradeHistory(params: TradeHistoryParams = {}) {
    const query = new URLSearchParams({ limit: String(params.limit ?? 20), offset: String(params.offset ?? 0) });
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    if (params.side) query.set("side", params.side);
    if (params.modelId) query.set("model_id", params.modelId);
    if (params.strategyId) query.set("strategy_id", params.strategyId);
    if (params.executionAccountId) query.set("execution_account_id", params.executionAccountId);
    if (params.query) query.set("q", params.query);
    const result = await request<RawRecord>(`trades?${query}`);
    const items = Array.isArray(result.data.items) ? result.data.items as RawRecord[] : [];
    const data: TradeHistoryPage = {
      items: items.map(mapTrade), summary: mapTradeSummary(result.data.summary as RawRecord | undefined),
      total: number(result.data.total), limit: number(result.data.limit) || 20, offset: number(result.data.offset),
    };
    return { data, mode: result.mode };
  },
  async liveOperations() { const result = await request<RawRecord>("live-operations"); return { data: mapLiveOperations(result.data), mode: result.mode }; },
  createBacktest: (params: BacktestCreateParams) => request<RawRecord>("backtest-datasets", { method: "POST", body: JSON.stringify(params), headers: { "Idempotency-Key": crypto.randomUUID() } }),
  demoOverview: (): ApiResult<OverviewData> => ({ data: demoOverview, mode: "demo" }),
  demoTradeHistory: (params: TradeHistoryParams = {}): ApiResult<TradeHistoryPage> => ({ data: demoTradeHistory(params), mode: "demo" }),
  demoList: (resource: ConsoleResource, params: { limit?: number; offset?: number } = {}): ApiResult<ConsoleList> => {
    const all = demoData[resource]; const offset = params.offset ?? 0; const limit = params.limit ?? 20;
    return { data: { items: all.slice(offset, offset + limit), total: all.length, limit, offset }, mode: "demo" };
  },
};
