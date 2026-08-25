"use client";

import { demoData, demoOverview } from "./demo-data";
import { demoDailyPnL, demoTradeHistory } from "./demo-trades";
import type { ApiMode, ApiResult, BacktestCreateParams, ConsoleList, ConsoleResource, ConsoleRow, DailyPnLPoint, DailyPnLReport, EdgeDistribution, EdgeDistributionBin, EdgeDistributionSeries, LiveEvent, LiveFunnelStage, LiveHealth, LiveOperationsSnapshot, LiveOrder, LiveOrderStep, LivePosition, LiveRiskMetric, LiveStageState, LiveWalletSummary, LiveWorker, OverviewData, ServiceMetricsOverview, ServiceRuntimeHealth, ServiceRuntimeMetrics, TradeHistoryPage, TradeHistoryParams, TradeHistorySummary, TradeRecord, TradeSide } from "./types";

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

function mapServiceMetrics(item: RawRecord): ServiceRuntimeMetrics {
  const requests = record(item.requests);
  const cpu = record(item.cpu);
  const memory = record(item.memory);
  const runtimeData = record(item.runtime);
  const rawStatus = string(item.status, "unavailable");
  const status: ServiceRuntimeHealth = rawStatus === "healthy" || rawStatus === "degraded" ? rawStatus : "unavailable";
  return {
    service: item.service === "trading-execution" ? "trading-execution" : "prediction-infra",
    status,
    reason: optional(item.reason), version: optional(item.version), commit: optional(item.commit),
    observedAt: optionalTime(item.observed_at), startedAt: optionalTime(item.started_at), uptimeSeconds: number(item.uptime_seconds),
    requests: {
      total: number(requests.total), qps: number(requests.qps_1m), errorRate: number(requests.error_rate_1m),
      avgLatencyMs: number(requests.avg_latency_ms_1m), maxLatencyMs: number(requests.max_latency_ms_1m),
    },
    cpu: { usagePercent: number(cpu.usage_percent), gomaxprocs: number(cpu.gomaxprocs), logicalCpus: number(cpu.logical_cpus) },
    memory: {
      usageBytes: number(memory.usage_bytes), limitBytes: optionalNumber(memory.limit_bytes), usagePercent: optionalNumber(memory.usage_percent),
      heapInuseBytes: number(memory.heap_inuse_bytes), heapObjects: number(memory.heap_objects),
    },
    runtime: { goVersion: optional(runtimeData.go_version), goroutines: number(runtimeData.goroutines), gcCycles: number(runtimeData.gc_cycles) },
  };
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

function mapDailyPnLPoint(item: RawRecord): DailyPnLPoint {
  return {
    day: string(item.day), executionAccountId: string(item.execution_account_id),
    modelId: string(item.model_id), strategyId: string(item.strategy_id),
    realizedPnl: string(item.realized_pnl, "0"), closedTradeCount: number(item.closed_trade_count),
    closedShares: string(item.closed_shares, "0"),
  };
}

function mapDailyPnLReport(item: RawRecord): DailyPnLReport {
  const timezone = string(item.timezone, "UTC");
  if (timezone !== "UTC") throw new ConsoleApiError("每日盈亏接口返回了不支持的时区", "live");
  return {
    items: records(item.items).map(mapDailyPnLPoint), days: number(item.days),
    fromDay: string(item.from_day), toDay: string(item.to_day), timezone,
    generatedAt: optionalTime(item.generated_at) ?? new Date().toISOString(),
  };
}

/** 校验并映射一个 Edge 直方图分箱。 */
function mapEdgeBin(item: RawRecord): EdgeDistributionBin {
  const lower = requiredEdgeValue(item.lower, "bins.lower");
  const upper = requiredEdgeValue(item.upper, "bins.upper");
  if (lower >= upper) throw edgeContractError("bins 区间");
  return {
    lower,
    upper,
    count: requiredEdgeCount(item.count, "bins.count"),
    ratio: requiredEdgeRatio(item.ratio, "bins.ratio"),
  };
}

/** 校验并映射一个模型的 Edge 分布序列。 */
function mapEdgeSeries(item: RawRecord, rangeMin: number, rangeMax: number, binWidth: number): EdgeDistributionSeries {
  const sampleCount = requiredEdgeCount(item.sample_count, "series.sample_count");
  const bins = records(item.bins).map(mapEdgeBin);
  validateEdgeBins(bins, sampleCount, rangeMin, rangeMax, binWidth);
  const minimum = requiredEdgeValue(item.minimum, "series.minimum");
  const maximum = requiredEdgeValue(item.maximum, "series.maximum");
  if (sampleCount > 0 && minimum > maximum) throw edgeContractError("series 最值");
  return {
    modelId: requiredEdgeString(item.model_id, "series.model_id"),
    sampleCount,
    excludedCount: requiredEdgeCount(item.excluded_count, "series.excluded_count"),
    mean: requiredEdgeValue(item.mean, "series.mean"),
    median: requiredEdgeValue(item.median, "series.median"),
    standardDeviation: requiredEdgeRatio(item.standard_deviation, "series.standard_deviation"),
    minimum,
    maximum,
    positiveRatio: requiredEdgeRatio(item.positive_ratio, "series.positive_ratio"),
    bins,
  };
}

/** 校验并映射完整的 Edge 分布快照。 */
function mapEdgeDistribution(item: RawRecord): EdgeDistribution {
  const decisionAt = optionalTime(item.decision_at);
  const generatedAt = optionalTime(item.generated_at);
  if (!decisionAt || !generatedAt || item.price_basis !== "MIDPOINT" || item.outcome_scope !== "OUTCOME_0") {
    throw new ConsoleApiError("Edge 分布接口返回了不支持的数据口径", "live");
  }
  const rangeMin = requiredEdgeValue(item.range_min, "range_min");
  const rangeMax = requiredEdgeValue(item.range_max, "range_max");
  const binWidth = requiredEdgeNumber(item.bin_width, "bin_width");
  if (rangeMin >= 0 || rangeMax <= 0 || binWidth <= 0 || binWidth > rangeMax - rangeMin) throw edgeContractError("分布区间");
  const series = records(item.series).map((entry) => mapEdgeSeries(entry, rangeMin, rangeMax, binWidth));
  if (new Set(series.map((entry) => entry.modelId)).size !== series.length) throw edgeContractError("重复模型");
  return {
    decisionAt, generatedAt, priceBasis: "MIDPOINT", outcomeScope: "OUTCOME_0", binWidth, rangeMin, rangeMax,
    series,
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

function requiredLiveString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ConsoleApiError(`实盘聚合接口缺少 ${field}`, "live");
  return value.trim();
}

function requiredLiveNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new ConsoleApiError(`实盘聚合接口返回了无效的 ${field}`, "live");
  return parsed;
}

function requiredLiveBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new ConsoleApiError(`实盘聚合接口返回了无效的 ${field}`, "live");
  return value;
}

/** 读取 Edge 协议中的有限数字。 */
function requiredEdgeNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed)) throw new ConsoleApiError(`Edge 分布接口返回了无效的 ${field}`, "live");
  return parsed;
}

/** 读取 Edge 协议中的非空字符串。 */
function requiredEdgeString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw edgeContractError(field);
  return value.trim();
}

/** 读取 Edge 协议中的非负安全整数。 */
function requiredEdgeCount(value: unknown, field: string): number {
  const parsed = requiredEdgeNumber(value, field);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw edgeContractError(field);
  return parsed;
}

/** 读取 Edge 协议中的零到一比例。 */
function requiredEdgeRatio(value: unknown, field: string): number {
  const parsed = requiredEdgeNumber(value, field);
  if (parsed < 0 || parsed > 1) throw edgeContractError(field);
  return parsed;
}

/** 读取 Edge 协议中的负一到一概率差。 */
function requiredEdgeValue(value: unknown, field: string): number {
  const parsed = requiredEdgeNumber(value, field);
  if (parsed < -1 || parsed > 1) throw edgeContractError(field);
  return parsed;
}

/** 校验分箱连续性、范围和样本总数是否一致。 */
function validateEdgeBins(bins: EdgeDistributionBin[], sampleCount: number, rangeMin: number, rangeMax: number, binWidth: number): void {
  if (!bins.length || !approximatelyEqual(bins[0].lower, rangeMin) || !approximatelyEqual(bins.at(-1)?.upper, rangeMax)) {
    throw edgeContractError("bins 范围");
  }
  let count = 0;
  for (let index = 0; index < bins.length; index += 1) {
    const bin = bins[index];
    const previous = bins[index - 1];
    if (!approximatelyEqual(bin.upper - bin.lower, binWidth) || (previous && !approximatelyEqual(previous.upper, bin.lower))) {
      throw edgeContractError("bins 连续性");
    }
    const expectedRatio = sampleCount > 0 ? bin.count / sampleCount : 0;
    if (!approximatelyEqual(bin.ratio, expectedRatio)) throw edgeContractError("bins 比例");
    count += bin.count;
  }
  if (count !== sampleCount) throw edgeContractError("bins 样本总数");
}

/** 比较 Edge 协议中的浮点边界。 */
function approximatelyEqual(left: number | undefined, right: number): boolean {
  return left !== undefined && Math.abs(left - right) <= 1e-8;
}

/** 创建统一的 Edge 协议错误。 */
function edgeContractError(field: string): ConsoleApiError {
  return new ConsoleApiError(`Edge 分布接口返回了无效的 ${field}`, "live");
}

/** 显式映射线程心跳，允许尚未上报的线程返回 null 时间。 */
function mapLiveWorker(item: RawRecord): LiveWorker {
  return { id: string(item.id, "unknown"), name: string(item.name, "未知线程"), purpose: string(item.purpose, "—"), cadence: string(item.cadence, "—"), status: liveHealth(item.status), lastHeartbeatAt: optionalTime(item.lastHeartbeatAt), currentTask: string(item.currentTask, "等待首次上报"), metricLabel: string(item.metricLabel, "状态"), metricValue: string(item.metricValue, "—") };
}

/** 显式映射当前周期漏斗。 */
function mapLiveFunnelStage(item: RawRecord): LiveFunnelStage {
  return { id: string(item.id), index: number(item.index), name: string(item.name), description: string(item.description), count: number(item.count), throughputLabel: string(item.throughputLabel), state: stageState(item.state) };
}

/** 解析服务端风险状态，未知值按危险展示。 */
function liveRiskState(value: unknown): LiveRiskMetric["state"] {
  return value === "safe" || value === "warning" || value === "danger" ? value : "danger";
}

/** 解析服务端阈值类型，拒绝把未知业务口径伪装成有效数据。 */
function liveRiskThresholdType(value: unknown): LiveRiskMetric["thresholdType"] {
  if (value === "hard_limit" || value === "target") return value;
  throw new ConsoleApiError("实盘聚合接口返回了未知的风险阈值类型", "live");
}

/** 显式映射服务端计算的预警线、硬上限和真实占用率。 */
function mapLiveRisk(item: RawRecord): LiveRiskMetric {
  const rawUnit = string(item.unit, "count");
  const unit = rawUnit === "$" || rawUnit === "%" || rawUnit === "minutes" ? rawUnit : "count";
  const current = requiredLiveNumber(item.current, "risks.current");
  const warningThreshold = requiredLiveNumber(item.warningThreshold, "risks.warningThreshold");
  const hardLimit = requiredLiveNumber(item.hardLimit, "risks.hardLimit");
  const usagePercentage = optionalNumber(item.usagePercentage);
  const hardLimitEnforced = requiredLiveBoolean(item.hardLimitEnforced, "risks.hardLimitEnforced");
  const thresholdType = liveRiskThresholdType(item.thresholdType);
  if (current < 0 || warningThreshold < 0 || hardLimit < 0 || (usagePercentage !== undefined && usagePercentage < 0)) {
    throw new ConsoleApiError("实盘聚合接口返回了负数风险阈值", "live");
  }
  if (hardLimit > 0 && (warningThreshold > hardLimit || usagePercentage === undefined)) {
    throw new ConsoleApiError("实盘聚合接口返回了不一致的风险阈值", "live");
  }
  if (thresholdType === "hard_limit" && !hardLimitEnforced) {
    throw new ConsoleApiError("实盘聚合接口未执行声明的风险硬上限", "live");
  }
  return {
    id: string(item.id), name: string(item.name), current, warningThreshold, hardLimit,
    usagePercentage, hardLimitEnforced, thresholdType, unit, hint: string(item.hint), state: liveRiskState(item.state),
  };
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
    orderId: string(item.orderId), executionAccountId: requiredLiveString(item.executionAccountId, "orders.executionAccountId"),
    marketId: string(item.marketId), marketLabel: string(item.marketLabel, "未知 Market"), outcomeName: string(item.outcomeName, "—"),
    side: tradeSide(item.side), status: string(item.status, "UNKNOWN"), price: number(item.price), shares: number(item.shares), filledShares: number(item.filledShares),
    ageSeconds: number(item.ageSeconds), modelId: string(item.modelId, "—"), strategyId: string(item.strategyId, "—"), triggeredBy: string(item.triggeredBy, "system"),
    predictedProbability: optionalNumber(item.predictedProbability), edge: optionalNumber(item.edge), lifecycle: records(item.lifecycle).map(mapLiveOrderStep),
  };
}

/** 显式映射链上仓位与账本成本的合并结果。 */
function mapLivePosition(item: RawRecord): LivePosition {
  return {
    positionId: string(item.positionId), executionAccountId: requiredLiveString(item.executionAccountId, "positions.executionAccountId"),
    managed: requiredLiveBoolean(item.managed, "positions.managed"),
    marketId: string(item.marketId), marketLabel: string(item.marketLabel, "未知 Market"), outcomeName: string(item.outcomeName, "—"),
    shares: number(item.shares), averagePrice: number(item.averagePrice), markPrice: number(item.markPrice), cost: number(item.cost), marketValue: number(item.marketValue),
    unrealizedPnl: number(item.unrealizedPnl), exposurePct: number(item.exposurePct), strategyId: string(item.strategyId, "—"), predictionAgeMinutes: optionalNumber(item.predictionAgeMinutes),
  };
}

/** 钱包累计收益字段缺失时拒绝用零值冒充真实数据。 */
function mapLiveWallet(item: RawRecord): LiveWalletSummary {
  if (!("return" in item)) throw new ConsoleApiError("实盘聚合接口缺少 wallets.return", "live");
  const positionCount = requiredLiveNumber(item.positionCount, "wallets.positionCount");
  if (!Number.isSafeInteger(positionCount) || positionCount < 0) throw new ConsoleApiError("实盘聚合接口返回了无效的 wallets.positionCount", "live");
  return {
    executionAccountId: requiredLiveString(item.executionAccountId, "wallets.executionAccountId"),
    positionCount,
    peakCashUsed: requiredLiveNumber(item.peakCashUsed, "wallets.peakCashUsed"),
    cumulativeInvestedCost: requiredLiveNumber(item.cumulativeInvestedCost, "wallets.cumulativeInvestedCost"),
    realizedPnl: requiredLiveNumber(item.realizedPnl, "wallets.realizedPnl"),
    unrealizedPnl: requiredLiveNumber(item.unrealizedPnl, "wallets.unrealizedPnl"),
    totalPnl: requiredLiveNumber(item.totalPnl, "wallets.totalPnl"),
    return: item.return === null ? null : requiredLiveNumber(item.return, "wallets.return"),
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
  const wallets = records(item.wallets).map(mapLiveWallet);
  if (!wallets.length) throw new ConsoleApiError("实盘聚合接口没有返回任何钱包", "live");
  const walletIDs = new Set(wallets.map((wallet) => wallet.executionAccountId));
  if (walletIDs.size !== wallets.length) throw new ConsoleApiError("实盘聚合接口返回了重复钱包", "live");
  const orders = records(item.orders).map(mapLiveOrder);
  const positions = records(item.positions).map(mapLivePosition);
  if ([...orders, ...positions].some((entry) => !walletIDs.has(entry.executionAccountId))) {
    throw new ConsoleApiError("实盘订单或持仓引用了未知钱包", "live");
  }
  for (const wallet of wallets) {
    const managedCount = positions.filter((position) => position.executionAccountId === wallet.executionAccountId && position.managed).length;
    if (wallet.positionCount !== managedCount) throw new ConsoleApiError(`钱包 ${wallet.executionAccountId} 的系统管理持仓数量与明细不一致`, "live");
  }
  return {
    observedAt, dataFreshnessSeconds: number(item.dataFreshnessSeconds),
    engine: { health: liveHealth(engine.health), runId: string(engine.runId, "—"), presetName: string(engine.presetName, "—"), startedAt, venueName: string(engine.venueName, "Polymarket CLOB"), venueStatus: liveHealth(engine.venueStatus), ledgerStatus: liveHealth(engine.ledgerStatus), reconciliationStatus: liveHealth(engine.reconciliationStatus) },
    capital: { equity: number(capital.equity), availableCash: number(capital.availableCash), grossExposure: number(capital.grossExposure), exposureLimit: number(capital.exposureLimit), realizedPnlToday: number(capital.realizedPnlToday), unrealizedPnl: number(capital.unrealizedPnl), feeToday: number(capital.feeToday) },
    wallets,
    workers: records(item.workers).map(mapLiveWorker), funnel: records(item.funnel).map(mapLiveFunnelStage), risks: records(item.risks).map(mapLiveRisk),
    orders, positions, events: records(item.events).map(mapLiveEvent),
    dataQuality: records(item.dataQuality).map((quality) => ({ id: string(quality.id), name: string(quality.name), status: liveHealth(quality.status), detail: string(quality.detail) })),
  };
}

export const consoleApi = {
  capabilities: () => request<{ console_read: boolean; trade_read: boolean; live_read: boolean; backtest_create: boolean }>("capabilities"),
  async overview() { const result = await request<RawRecord>("overview"); return { data: mapOverview(result.data), mode: result.mode }; },
  async serviceMetrics() {
    const result = await request<RawRecord>("service-metrics");
    const data: ServiceMetricsOverview = { observedAt: optionalTime(result.data.observed_at) ?? new Date().toISOString(), services: records(result.data.services).map(mapServiceMetrics) };
    return { data, mode: result.mode };
  },
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
  async dailyPnL(days = 14) {
    const result = await request<RawRecord>(`daily-pnl?${new URLSearchParams({ days: String(days) })}`);
    return { data: mapDailyPnLReport(result.data), mode: result.mode };
  },
  /** 读取并校验最新 Edge 分布，可选按模型过滤。 */
  async edgeDistribution(modelId?: string) {
    const query = new URLSearchParams();
    if (modelId) query.set("model_id", modelId);
    const result = await request<RawRecord>(`edge-distribution${query.size ? `?${query}` : ""}`);
    return { data: mapEdgeDistribution(result.data), mode: result.mode };
  },
  async liveOperations() { const result = await request<RawRecord>("live-operations"); return { data: mapLiveOperations(result.data), mode: result.mode }; },
  createBacktest: (params: BacktestCreateParams) => request<RawRecord>("backtest-datasets", { method: "POST", body: JSON.stringify(params), headers: { "Idempotency-Key": crypto.randomUUID() } }),
  demoOverview: (): ApiResult<OverviewData> => ({ data: demoOverview, mode: "demo" }),
  demoTradeHistory: (params: TradeHistoryParams = {}): ApiResult<TradeHistoryPage> => ({ data: demoTradeHistory(params), mode: "demo" }),
  demoDailyPnL: (days = 14): ApiResult<DailyPnLReport> => ({ data: demoDailyPnL(days), mode: "demo" }),
  demoList: (resource: ConsoleResource, params: { limit?: number; offset?: number } = {}): ApiResult<ConsoleList> => {
    const all = demoData[resource]; const offset = params.offset ?? 0; const limit = params.limit ?? 20;
    return { data: { items: all.slice(offset, offset + limit), total: all.length, limit, offset }, mode: "demo" };
  },
};
