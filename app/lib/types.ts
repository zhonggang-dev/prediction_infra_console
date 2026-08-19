export type ConsolePageName = "overview" | "markets" | "sandboxes" | "predictions" | "backtests" | "delivery" | "settings";
export type ApiMode = "live" | "demo" | "unavailable";
export type ConsoleResource = "selected-markets" | "sandboxes" | "predictions" | "backtest-datasets" | "orderbook-series" | "outbox-events";

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

export type TradeSide = "BUY" | "SELL";

/** 前端交易记录仅对应 Go 账本中已确认、已入账的真实 Fill。 */
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
  limit: number;
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
  workers: LiveWorker[];
  funnel: LiveFunnelStage[];
  risks: LiveRiskMetric[];
  orders: LiveOrder[];
  positions: LivePosition[];
  events: LiveEvent[];
  dataQuality: { id: string; name: string; status: LiveHealth; detail: string }[];
}
