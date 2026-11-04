/** Account-ledger performance. Decimal strings remain exact until display formatting. */
export interface AccountPerformance {
  executionAccountId: string;
  marketSource: "POLYMARKET" | "KALSHI";
  assetCount: number;
  pricedAssetCount: number;
  currentCost: string;
  peakHoldingCost: string;
  cumulativeInvestedCost: string;
  realizedPnl: string;
  marketValue: string | null;
  unrealizedPnl: string | null;
  totalPnl: string | null;
  returnRate: string | null;
  realizedDrawdown14d: string;
  drawdownFrom: string;
  drawdownTo: string;
  valuationState: "complete" | "incomplete";
  valuationReasons: ValuationReason[];
  snapshotDecisionAt: string | null;
  snapshotObservedAt: string | null;
}
export type ValuationReason = "missing_batch" | "missing_quote" | "invalid_quote" | "stale_quote" | "future_quote";
export interface AccountPerformanceResponse { observedAt: string; items: AccountPerformance[] }

const REASONS: ValuationReason[] = ["missing_batch", "missing_quote", "invalid_quote", "stale_quote", "future_quote"];
const isZero = (value: string) => /^-?0+(?:\.0+)?$/.test(value);
const invalid = () => new Error("账户绩效数据无效，请稍后重试。");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 128 || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || value.trim() !== value) throw invalid();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw invalid();
  return value;
}
function nullableTime(value: unknown): string | null { return value === null ? null : timestamp(value); }
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid();
  return value;
}
function decimal(value: unknown, nonNegative = false): string {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || (nonNegative && value.startsWith("-") && !isZero(value))) throw invalid();
  return value;
}
function nullableDecimal(value: unknown, nonNegative = false): string | null { return value === null ? null : decimal(value, nonNegative); }

export function decodeAccountPerformance(data: Record<string, unknown>, requestedAccount = ""): AccountPerformanceResponse {
  if (!Array.isArray(data.items)) throw invalid();
  const seen = new Set<string>();
  const items = data.items.map((raw): AccountPerformance => {
    const item = record(raw);
    const executionAccountId = id(item.execution_account_id);
    if (seen.has(executionAccountId) || (requestedAccount && executionAccountId !== requestedAccount)) throw invalid();
    seen.add(executionAccountId);
    if (item.market_source !== "POLYMARKET" && item.market_source !== "KALSHI") throw invalid();
    if (item.valuation_state !== "complete" && item.valuation_state !== "incomplete") throw invalid();
    if (!Array.isArray(item.valuation_reasons) || item.valuation_reasons.some((reason) => !REASONS.includes(reason as ValuationReason))) throw invalid();
    const assetCount = count(item.asset_count); const pricedAssetCount = count(item.priced_asset_count);
    const marketValue = nullableDecimal(item.market_value, true); const unrealizedPnl = nullableDecimal(item.unrealized_pnl);
    const totalPnl = nullableDecimal(item.total_pnl); const returnRate = nullableDecimal(item.return_rate);
    const peakHoldingCost = decimal(item.peak_holding_cost, true);
    const complete = item.valuation_state === "complete";
    if (pricedAssetCount > assetCount || (complete && (pricedAssetCount !== assetCount || item.valuation_reasons.length || marketValue === null || unrealizedPnl === null || totalPnl === null)) || (!complete && (pricedAssetCount === assetCount || !item.valuation_reasons.length || [marketValue, unrealizedPnl, totalPnl, returnRate].some((value) => value !== null))) || (isZero(peakHoldingCost) && returnRate !== null) || (complete && !isZero(peakHoldingCost) && returnRate === null)) throw invalid();
    const drawdownFrom = timestamp(item.drawdown_from); const drawdownTo = timestamp(item.drawdown_to);
    if (Date.parse(drawdownFrom) > Date.parse(drawdownTo)) throw invalid();
    return {
      executionAccountId, marketSource: item.market_source, assetCount, pricedAssetCount,
      currentCost: decimal(item.current_cost, true), peakHoldingCost,
      cumulativeInvestedCost: decimal(item.cumulative_invested_cost, true), realizedPnl: decimal(item.realized_pnl),
      marketValue, unrealizedPnl, totalPnl, returnRate,
      realizedDrawdown14d: decimal(item.realized_drawdown_14d, true), drawdownFrom, drawdownTo,
      valuationState: item.valuation_state, valuationReasons: [...new Set(item.valuation_reasons)] as ValuationReason[],
      snapshotDecisionAt: nullableTime(item.snapshot_decision_at), snapshotObservedAt: nullableTime(item.snapshot_observed_at),
    };
  });
  if (requestedAccount && items.length !== 1) throw invalid();
  return { observedAt: timestamp(data.observed_at), items };
}

export async function accountPerformance(account = "", signal?: AbortSignal): Promise<AccountPerformanceResponse> {
  const query = account ? `?${new URLSearchParams({ execution_account_id: account })}` : "";
  const response = await fetch(`/api/console/v2/trading/account-performance${query}`, { signal, cache: "no-store" });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error("账户绩效暂时不可用，请稍后重试。");
  return decodeAccountPerformance(record(record(payload).data), account);
}
