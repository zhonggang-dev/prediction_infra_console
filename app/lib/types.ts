export type ConsolePageName = "overview" | "markets" | "sandboxes" | "predictions" | "backtests" | "delivery" | "settings";
export type ApiMode = "live" | "demo" | "unavailable";
export type ConsoleResource = "selected-markets" | "sandboxes" | "predictions" | "backtest-datasets" | "orderbook-series" | "outbox-events";
export type QuestionStatus = "PENDING" | "RUNNING" | "RESOLVED" | "DEFERRED" | "UNRESOLVED" | "FINAL_UNRESOLVED" | "ANNUL" | "MECE_FAIL";

export interface ConsoleGeneratedMarket {
  generatedMarketId: string;
  marketId: string;
  conditionId: string;
  question: string;
  description: string;
  resolutionRules: string;
  outcomes: unknown[];
  primaryDomain: string;
  tags: string[];
  questionType: string;
  forecastTargetKind: string;
  endAt?: string;
  createdAt: string;
  updatedAt: string;
  generationRequestId?: string;
  sourceMarketId: string;
  eventInstanceId: string;
  status: QuestionStatus;
  phase: "PRE_END" | "POST_END" | string;
  nextRunAt?: string;
  attemptCount: number;
  lastReasonCode: string;
  lastFinishedAt?: string;
}

export interface GeneratedMarketList {
  items: ConsoleGeneratedMarket[];
  total: number;
  limit: number;
  offset: number;
  statusCounts: Record<string, number>;
}

export interface OverviewData {
  selectedMarketTotal: number;
  sandboxTotal: number;
  predictionTotal: number;
  backtestReadyTotal: number;
  outboxPendingTotal: number;
  currentSelectionRunID?: string;
  lastSelectedAt?: string;
  lastSandboxAt?: string;
  lastPredictionAt?: string;
}

/** 页面只使用经过映射的安全摘要字段。 */
export interface ConsoleRow {
  id: string;
  kind: ConsoleResource;
  title: string;
  secondary: string;
  status: string;
  timestamp?: string;
  domains?: string[];
  values: { label: string; value: string }[];
}

export interface ConsoleList {
  items: ConsoleRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface BacktestCreateParams {
  prediction_from: string;
  prediction_to: string;
  data_cutoff_at: string;
  orderbook: { series_id: number; lookback_minutes: number; horizon_hours: number };
  filters: { execution_modes: string[]; model_names: string[]; domains: string[]; condition_ids: string[] };
  sandbox_scope: "REFERENCED_BY_PREDICTIONS";
  sandbox_content: "REFERENCE";
  include_settlements: boolean;
}

export interface ApiResult<T> { data: T; mode: ApiMode; }

export type ServiceRuntimeHealth = "healthy" | "degraded" | "unavailable";

export interface ServiceRuntimeMetrics {
  service: "prediction-infra" | "trading-execution";
  status: ServiceRuntimeHealth;
  reason?: string;
  version?: string;
  commit?: string;
  observedAt?: string;
  startedAt?: string;
  uptimeSeconds: number;
  requests: {
    total: number;
    qps: number;
    errorRate: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
  };
  cpu: { usagePercent: number; gomaxprocs: number; logicalCpus: number };
  memory: {
    usageBytes: number;
    limitBytes?: number;
    usagePercent?: number;
    heapInuseBytes: number;
    heapObjects: number;
  };
  runtime: { goVersion?: string; goroutines: number; gcCycles: number };
}

export interface ServiceMetricsOverview {
  observedAt: string;
  services: ServiceRuntimeMetrics[];
}

export type TradeSide = "BUY" | "SELL";

/** 兼容保留：对应 Go 账本中已确认、已入账的真实 Fill（/trades）。 */
export interface TradeRecord {
  fillKey: string;
  venue: string;
  venueTradeId: string;
  orderId: string;
  venueOrderId: string;
  orderStatus: string;
  executionAccountId: string;
  modelId: string;
  strategyId: string;
  marketId: string;
  marketLabel?: string;
  conditionId?: string;
  tokenId: string;
  outcomeName?: string;
  lotId?: string;
  side: TradeSide;
  liquidityRole: string;
  shares: string;
  price: string;
  grossNotional: string;
  totalFee: string;
  netCashDelta: string;
  realizedPnl: string;
  transactionHash?: string;
  matchedAt: string;
  confirmedAt: string;
}

export interface TradeHistorySummary {
  tradeCount: number;
  buyNotional: string;
  sellNotional: string;
  netCashFlow: string;
  totalFee: string;
  realizedPnl: string;
}

export interface TradeHistoryPage {
  items: TradeRecord[];
  summary: TradeHistorySummary;
  total: number;
  limit: number;
  offset: number;
}

export interface TradeHistoryParams {
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
  side?: "" | TradeSide;
  modelId?: string;
  strategyId?: string;
  executionAccountId?: string;
  query?: string;
}

export type LedgerActivityType = "BUY" | "SELL" | "REDEEM";

/**
 * 统一账本活动：BUY / SELL 为已确认并入账的 CLOB 真实成交，REDEEM 为 auto redeem 入账后按原始批次拆分的赎回结算。
 * REDEEM 不是卖出成交，没有成交价、订单 ID 与流动性角色，这些字段为空并在页面上显示为 —。
 */
export interface LedgerActivity {
  activityKey: string;
  activityType: LedgerActivityType;
  venue: string;
  executionAccountId: string;
  modelId: string;
  strategyId: string;
  marketId: string;
  marketLabel?: string;
  conditionId?: string;
  tokenId: string;
  outcomeName?: string;
  lotId?: string;
  orderId?: string;
  venueOrderId?: string;
  venueTradeId?: string;
  orderStatus?: string;
  liquidityRole?: string;
  shares: string;
  price?: string;
  grossNotional?: string;
  totalFee: string;
  netCashDelta: string;
  costBasis?: string;
  settlementPayout?: string;
  realizedPnl: string;
  transactionHash?: string;
  occurredAt: string;
  confirmedAt: string;
  appliedAt: string;
}

/** 已实现盈亏 = SELL 平仓 PnL + REDEEM PnL；赎回到账单独统计，不计入卖出金额。 */
export interface LedgerActivitySummary {
  activityCount: number;
  tradeCount: number;
  redemptionCount: number;
  buyNotional: string;
  sellNotional: string;
  redeemPayout: string;
  netCashFlow: string;
  totalFee: string;
  realizedPnl: string;
  sellRealizedPnl: string;
  redeemRealizedPnl: string;
}

export interface LedgerActivityPage {
  items: LedgerActivity[];
  summary: LedgerActivitySummary;
  total: number;
  limit: number;
  offset: number;
}

export interface LedgerActivityParams {
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
  activityType?: "" | LedgerActivityType;
  modelId?: string;
  strategyId?: string;
  executionAccountId?: string;
  query?: string;
}

/** UTC 自然日内，按执行账户和开仓策略归因的净已实现盈亏（SELL 平仓 + REDEEM 赎回）。 */
export interface DailyPnLPoint {
  day: string;
  executionAccountId: string;
  modelId: string;
  strategyId: string;
  /** SELL 平仓 PnL + REDEEM 赎回 PnL。 */
  realizedPnl: string;
  /** 只统计 SELL 平仓笔数；赎回单独记入 redemptionCount。 */
  closedTradeCount: number;
  /** 包含赎回份额。 */
  closedShares: string;
  redemptionCount: number;
  redemptionPnl: string;
}

export interface DailyPnLReport {
  items: DailyPnLPoint[];
  days: number;
  fromDay: string;
  toDay: string;
  timezone: "UTC";
  generatedAt: string;
}

export interface EdgeDistributionBin {
  lower: number;
  upper: number;
  count: number;
  ratio: number;
}

export interface EdgeDistributionSeries {
  modelId: string;
  sampleCount: number;
  excludedCount: number;
  mean: number;
  median: number;
  standardDeviation: number;
  minimum: number;
  maximum: number;
  positiveRatio: number;
  bins: EdgeDistributionBin[];
}

/** 最新一次十分钟决策边界上的跨市场 outcome-0 edge 分布。 */
export interface EdgeDistribution {
  decisionAt: string;
  generatedAt: string;
  priceBasis: "MIDPOINT";
  outcomeScope: "OUTCOME_0";
  binWidth: number;
  rangeMin: number;
  rangeMax: number;
  series: EdgeDistributionSeries[];
}

export type LiveHealth = "healthy" | "degraded" | "stopped";
export type LiveStageState = "done" | "active" | "warning" | "idle";
export type LiveEventSeverity = "info" | "success" | "warning" | "error";

export interface LiveWorker {
  id: string;
  name: string;
  purpose: string;
  cadence: string;
  status: LiveHealth;
  lastHeartbeatAt?: string;
  currentTask: string;
  metricLabel: string;
  metricValue: string;
}

export interface LiveFunnelStage {
  id: string;
  index: number;
  name: string;
  description: string;
  count: number;
  throughputLabel: string;
  state: LiveStageState;
}

export interface LiveRiskMetric {
  id: string;
  name: string;
  current: number;
  warningThreshold: number;
  hardLimit: number;
  usagePercentage?: number;
  hardLimitEnforced: boolean;
  thresholdType: "hard_limit" | "target";
  unit: "$" | "%" | "count" | "minutes";
  hint: string;
  state: "safe" | "warning" | "danger";
}

export interface LiveOrderStep {
  name: string;
  status: "done" | "active" | "pending" | "warning";
  timestamp?: string;
  detail: string;
}

export interface LiveOrder {
  orderId: string;
  executionAccountId: string;
  marketId: string;
  marketLabel: string;
  outcomeName: string;
  side: TradeSide;
  status: string;
  price: number;
  shares: number;
  filledShares: number;
  ageSeconds: number;
  modelId: string;
  strategyId: string;
  triggeredBy: string;
  predictedProbability?: number;
  edge?: number;
  lifecycle: LiveOrderStep[];
}

export interface LivePosition {
  positionId: string;
  executionAccountId: string;
  managed: boolean;
  marketId: string;
  marketLabel: string;
  outcomeName: string;
  shares: number;
  averagePrice: number;
  markPrice: number;
  cost: number;
  marketValue: number;
  unrealizedPnl: number;
  exposurePct: number;
  strategyId: string;
  predictionAgeMinutes?: number;
}

/** 单个系统执行钱包的累计资金使用与收益摘要。 */
export interface LiveWalletSummary {
  executionAccountId: string;
  positionCount: number;
  peakCashUsed: number;
  cumulativeInvestedCost: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  return: number | null;
}

export interface LiveEvent {
  id: string;
  timestamp: string;
  severity: LiveEventSeverity;
  thread: string;
  section: string;
  title: string;
  detail: string;
  marketLabel?: string;
  orderId?: string;
}

export interface LiveOperationsSnapshot {
  observedAt: string;
  dataFreshnessSeconds: number;
  engine: {
    health: LiveHealth;
    runId: string;
    presetName: string;
    startedAt: string;
    venueName: string;
    venueStatus: LiveHealth;
    ledgerStatus: LiveHealth;
    reconciliationStatus: LiveHealth;
  };
  capital: {
    equity: number;
    availableCash: number;
    grossExposure: number;
    exposureLimit: number;
    realizedPnlToday: number;
    unrealizedPnl: number;
    feeToday: number;
  };
  wallets: LiveWalletSummary[];
  workers: LiveWorker[];
  funnel: LiveFunnelStage[];
  risks: LiveRiskMetric[];
  orders: LiveOrder[];
  positions: LivePosition[];
  events: LiveEvent[];
  dataQuality: { id: string; name: string; status: LiveHealth; detail: string }[];
}
