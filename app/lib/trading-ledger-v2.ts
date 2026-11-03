import type { LedgerActivity, LedgerActivityPage, LedgerActivitySummary, LedgerActivityType } from "./types";

export type TradingLedgerActivityType = LedgerActivityType | "KALSHI_NETTING" | "KALSHI_SETTLEMENT";
export type TradingLedgerActivity = Omit<LedgerActivity, "activityType" | "confirmedAt" | "appliedAt"> & {
  activityType: TradingLedgerActivityType;
  marketSource?: "POLYMARKET" | "KALSHI";
  quantityUnit?: "shares" | "pairs";
  confirmedAt?: string;
  appliedAt?: string;
};
export type TradingLedgerSummary = LedgerActivitySummary & {
  nettingCount?: number; settlementCount?: number; nettingPayout?: string;
  settlementPayout?: string; nettingRealizedPnl?: string; settlementRealizedPnl?: string;
};
export type TradingLedgerPage = Omit<LedgerActivityPage, "items" | "summary"> & { items: TradingLedgerActivity[]; summary: TradingLedgerSummary };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function text(value: unknown, field: string) { if (typeof value !== "string") throw new Error(`账本字段无效：${field}`); return value; }
function decimal(value: unknown, field: string) { const result = text(value, field); if (!/^-?\d+(?:\.\d+)?$/.test(result) || !Number.isFinite(Number(result))) throw new Error(`账本金额无效：${field}`); return result; }
function count(value: unknown, field: string) { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`账本计数无效：${field}`); return value; }
function time(value: unknown, field: string) { const result = text(value, field); if (!result || !Number.isFinite(Date.parse(result))) throw new Error(`账本时间无效：${field}`); return result; }
const optionalText = (value: unknown) => typeof value === "string" && value ? value : undefined;
export function decodeTradingLedgerPage(payload: unknown): TradingLedgerPage {
  const data = record(record(payload).data);
  if (!Array.isArray(data.items)) throw new Error("账本列表无效");
  const items = data.items.map((raw): TradingLedgerActivity => {
    const item = record(raw);
    const activityType = text(item.activity_type, "activity_type") as TradingLedgerActivityType;
    if (!["BUY", "SELL", "EXTERNAL_SELL", "REDEEM", "KALSHI_NETTING", "KALSHI_SETTLEMENT"].includes(activityType)) throw new Error("未知账本活动类型");
    const marketSource = text(item.market_source, "market_source");
    if (marketSource !== "POLYMARKET" && marketSource !== "KALSHI") throw new Error("未知账本市场来源");
    const quantityUnit = text(item.quantity_unit, "quantity_unit");
    if (quantityUnit !== (activityType === "KALSHI_NETTING" ? "pairs" : "shares")) throw new Error("账本数量单位不匹配");
    return { activityKey: text(item.activity_key, "activity_key"), activityType, marketSource, quantityUnit,
      venue: text(item.venue, "venue"), executionAccountId: text(item.execution_account_id, "execution_account_id"),
      modelId: optionalText(item.model_id) ?? "", strategyId: optionalText(item.strategy_id) ?? "", marketId: optionalText(item.market_id) ?? "",
      marketLabel: optionalText(item.market_label), conditionId: optionalText(item.condition_id), tokenId: optionalText(item.token_id) ?? "",
      outcomeName: optionalText(item.outcome_name), lotId: optionalText(item.lot_id), orderId: optionalText(item.order_id),
      venueOrderId: optionalText(item.venue_order_id), venueTradeId: optionalText(item.venue_trade_id), orderStatus: optionalText(item.order_status), liquidityRole: optionalText(item.liquidity_role),
      shares: decimal(item.shares, "shares"), price: item.price == null || item.price === "" ? undefined : decimal(item.price, "price"),
      grossNotional: item.gross_notional == null || item.gross_notional === "" ? undefined : decimal(item.gross_notional, "gross_notional"),
      totalFee: decimal(item.total_fee, "total_fee"), netCashDelta: decimal(item.net_cash_delta, "net_cash_delta"),
      costBasis: item.cost_basis == null || item.cost_basis === "" ? undefined : decimal(item.cost_basis, "cost_basis"),
      settlementPayout: item.settlement_payout == null || item.settlement_payout === "" ? undefined : decimal(item.settlement_payout, "settlement_payout"),
      realizedPnl: decimal(item.realized_pnl, "realized_pnl"), transactionHash: optionalText(item.transaction_hash),
      occurredAt: time(item.occurred_at, "occurred_at"), confirmedAt: item.confirmed_at == null ? undefined : time(item.confirmed_at, "confirmed_at"), appliedAt: item.applied_at == null ? undefined : time(item.applied_at, "applied_at"),
    };
  });
  const rawSummary = record(data.summary);
  const summary: Record<string, number | string> = {};
  for (const key of ["activity_count", "trade_count", "redemption_count", "netting_count", "settlement_count"]) summary[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = count(rawSummary[key], key);
  for (const key of ["buy_notional", "sell_notional", "redeem_payout", "net_cash_flow", "total_fee", "realized_pnl", "sell_realized_pnl", "redeem_realized_pnl", "netting_payout", "settlement_payout", "netting_realized_pnl", "settlement_realized_pnl"]) summary[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = decimal(rawSummary[key], key);
  const limit = count(data.limit, "limit"); if (!limit) throw new Error("账本页长无效");
  time(data.observed_at, "observed_at");
  return { items, summary: summary as unknown as TradingLedgerSummary, total: count(data.total, "total"), limit, offset: count(data.offset, "offset") };
}

const ledgerMoneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
export function formatTradingLedgerMoney(value?: string, signed = false) {
  if (value === undefined || value === "") return "—";
  const amount = Number(value);
  return `${signed && amount > 0 ? "+" : ""}${ledgerMoneyFormatter.format(amount)}`;
}
