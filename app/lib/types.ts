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
