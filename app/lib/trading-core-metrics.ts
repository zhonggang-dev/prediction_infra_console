/** System-managed account metrics; upstream prices never replace local quantities. */
export type CorePriceSource = "PM_CURRENT_PRICE" | "PM_CLOB_MID" | "KALSHI_BOOK_MID" | "OFFICIAL_SETTLEMENT";
export type CorePriceReason = "missing_price" | "one_sided" | "invalid_price" | "identity_mismatch" | "stale" | "timeout" | "source_unavailable" | "unconfirmed_settlement";
export interface CoreValuationAsset {
  executionAccountId: string; marketSource: "POLYMARKET" | "KALSHI";
  marketId: string; conditionId: string; tokenId: string; outcomeIndex: number | null; outcomeName: string | null; marketQuestion: string | null;
  remainingShares: string; remainingCost: string; price: string | null; marketValue: string | null;
  state: "priced" | "unpriced"; priceSource: CorePriceSource | null; sourceAt: string | null; observedAt: string | null; reason: CorePriceReason | null;
}
export interface AccountCoreMetrics {
  executionAccountId: string; marketSource: "POLYMARKET" | "KALSHI";
  assetCount: number; pricedAssetCount: number; currentCost: string; peakHoldingCost: string; cumulativeInvestedCost: string; realizedPnl: string;
  marketValue: string | null; unrealizedPnl: string | null; totalPnl: string | null; returnRate: string | null;
  realizedDrawdown14d: string; drawdownFrom: string; drawdownTo: string; ledgerObservedAt: string;
  valuationState: "complete" | "incomplete"; quoteObservedFrom: string | null; quoteObservedTo: string | null;
  hasReferencePrices: boolean; valuationAssets: CoreValuationAsset[];
}
export interface AccountCoreMetricsResponse { observedAt: string; items: AccountCoreMetrics[] }
const SOURCES: CorePriceSource[] = ["PM_CURRENT_PRICE", "PM_CLOB_MID", "KALSHI_BOOK_MID", "OFFICIAL_SETTLEMENT"];
const REASONS: CorePriceReason[] = ["missing_price", "one_sided", "invalid_price", "identity_mismatch", "stale", "timeout", "source_unavailable", "unconfirmed_settlement"];
const isZero = (value: string) => /^-?0+(?:\.0+)?$/.test(value);
const invalid = () => new Error("账户核心指标数据无效，请稍后重试。");
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; }
function text(value: unknown, empty = false): string { if (typeof value !== "string" || (!empty && !value) || value.length > 4096 || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw invalid(); return value; }
function id(value: unknown): string { const result = text(value); if (result.length > 128 || result.trim() !== result) throw invalid(); return result; }
function timestamp(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw invalid(); return value; }
function nullableTime(value: unknown): string | null { return value === null ? null : timestamp(value); }
function nullableText(value: unknown): string | null { if (value === null) return null; if (typeof value !== "string" || value.length > 4096 || value.includes("\0")) throw invalid(); return value; }
function decimal(value: unknown, nonNegative = false): string { if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || (nonNegative && value.startsWith("-") && !isZero(value))) throw invalid(); return value; }
function nullableDecimal(value: unknown, nonNegative = false): string | null { return value === null ? null : decimal(value, nonNegative); }
function count(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid(); return value; }
function source(value: unknown): "POLYMARKET" | "KALSHI" { if (value !== "POLYMARKET" && value !== "KALSHI") throw invalid(); return value; }
function decodeAsset(raw: unknown, account: string, marketSource: AccountCoreMetrics["marketSource"]): CoreValuationAsset {
  const a = record(raw);
  if (a.execution_account_id !== account || a.market_source !== marketSource || (a.outcome_index !== null && a.outcome_index !== 0 && a.outcome_index !== 1)) throw invalid();
  if (a.state !== "priced" && a.state !== "unpriced") throw invalid();
  const price = nullableDecimal(a.price, true), marketValue = nullableDecimal(a.market_value, true);
  if (price !== null) { const [whole, fraction = ""] = price.replace(/^-/, "").split("."); const integer = whole.replace(/^0+/, "") || "0"; if (integer !== "0" && (integer !== "1" || /[1-9]/.test(fraction))) throw invalid(); }
  const priceSource = a.price_source === null ? null : SOURCES.find(s => s === a.price_source);
  const reason = a.reason === null ? null : REASONS.find(r => r === a.reason);
  if (priceSource === undefined || reason === undefined) throw invalid();
  const observedAt = nullableTime(a.observed_at), sourceAt = nullableTime(a.source_at);
  if (a.state === "priced" ? (price === null || marketValue === null || priceSource === null || reason !== null || observedAt === null) : (price !== null || marketValue !== null || priceSource !== null || reason === null)) throw invalid();
  if ((marketSource === "POLYMARKET" && priceSource === "KALSHI_BOOK_MID") || (marketSource === "KALSHI" && (priceSource === "PM_CURRENT_PRICE" || priceSource === "PM_CLOB_MID"))) throw invalid();
  const remainingShares = decimal(a.remaining_shares, true); if (Number(remainingShares) <= 0) throw invalid();
  return { executionAccountId: account, marketSource, marketId: text(a.market_id, true), conditionId: text(a.condition_id, true), tokenId: text(a.token_id), outcomeIndex: a.outcome_index, outcomeName: nullableText(a.outcome_name), marketQuestion: nullableText(a.market_question), remainingShares, remainingCost: decimal(a.remaining_cost, true), price, marketValue, state: a.state, priceSource, sourceAt, observedAt, reason };
}
export function decodeAccountCoreMetrics(data: Record<string, unknown>, requestedAccount = ""): AccountCoreMetricsResponse {
  if (!Array.isArray(data.items)) throw invalid();
  const seen = new Set<string>(); let assetTotal = 0;
  const items = data.items.map((raw): AccountCoreMetrics => {
    const a = record(raw), executionAccountId = id(a.execution_account_id), marketSource = source(a.market_source);
    if (seen.has(executionAccountId) || (requestedAccount && executionAccountId !== requestedAccount)) throw invalid(); seen.add(executionAccountId);
    const assetCount = count(a.asset_count), pricedAssetCount = count(a.priced_asset_count); assetTotal += assetCount;
    if (assetTotal > 2000 || !Array.isArray(a.valuation_assets) || a.valuation_assets.length !== assetCount) throw invalid();
    const valuationAssets = a.valuation_assets.map(asset => decodeAsset(asset, executionAccountId, marketSource));
    const identities = valuationAssets.map(v => JSON.stringify([v.executionAccountId, v.marketSource, v.marketId, v.conditionId, v.tokenId, v.outcomeIndex, v.outcomeName]));
    if (new Set(identities).size !== identities.length || valuationAssets.filter(v => v.state === "priced").length !== pricedAssetCount) throw invalid();
    const marketValue = nullableDecimal(a.market_value, true), unrealizedPnl = nullableDecimal(a.unrealized_pnl), totalPnl = nullableDecimal(a.total_pnl), returnRate = nullableDecimal(a.return_rate);
    const peakHoldingCost = decimal(a.peak_holding_cost, true), complete = pricedAssetCount === assetCount;
    if (a.valuation_state !== (complete ? "complete" : "incomplete") || (complete ? [marketValue, unrealizedPnl, totalPnl].some(v => v === null) : [marketValue, unrealizedPnl, totalPnl, returnRate].some(v => v !== null))) throw invalid();
    if ((isZero(peakHoldingCost) && returnRate !== null) || (complete && !isZero(peakHoldingCost) && returnRate === null)) throw invalid();
    const hasReferencePrices = valuationAssets.some(v => v.priceSource === "PM_CLOB_MID" || v.priceSource === "KALSHI_BOOK_MID");
    if (typeof a.has_reference_prices !== "boolean" || a.has_reference_prices !== hasReferencePrices) throw invalid();
    const drawdownFrom = timestamp(a.drawdown_from), drawdownTo = timestamp(a.drawdown_to), quoteObservedFrom = nullableTime(a.quote_observed_from), quoteObservedTo = nullableTime(a.quote_observed_to);
    if (Date.parse(drawdownFrom) > Date.parse(drawdownTo) || (quoteObservedFrom === null) !== (quoteObservedTo === null) || (quoteObservedFrom && quoteObservedTo && Date.parse(quoteObservedFrom) > Date.parse(quoteObservedTo))) throw invalid();
    return { executionAccountId, marketSource, assetCount, pricedAssetCount, currentCost: decimal(a.current_cost, true), peakHoldingCost, cumulativeInvestedCost: decimal(a.cumulative_invested_cost, true), realizedPnl: decimal(a.realized_pnl), marketValue, unrealizedPnl, totalPnl, returnRate, realizedDrawdown14d: decimal(a.realized_drawdown_14d, true), drawdownFrom, drawdownTo, ledgerObservedAt: timestamp(a.ledger_observed_at), valuationState: complete ? "complete" : "incomplete", quoteObservedFrom, quoteObservedTo, hasReferencePrices, valuationAssets };
  });
  if (requestedAccount && items.length !== 1) throw invalid();
  return { observedAt: timestamp(data.observed_at), items };
}
export async function accountCoreMetrics(account = "", signal?: AbortSignal): Promise<AccountCoreMetricsResponse> {
  const query = account ? `?${new URLSearchParams({ execution_account_id: account })}` : "";
  const response = await fetch(`/api/console/v2/trading/account-core-metrics${query}`, { signal, cache: "no-store" });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error("账户核心指标暂时不可用，请稍后重试。");
  return decodeAccountCoreMetrics(record(record(payload).data), account);
}
