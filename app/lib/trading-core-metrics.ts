/** System-managed account metrics; upstream prices never replace local quantities. */
export type CorePriceSource = "PM_CURRENT_PRICE" | "PM_CLOB_MID" | "KALSHI_BOOK_MID" | "KALSHI_LAST_TRADE" | "OFFICIAL_SETTLEMENT" | "HISTORY_HOURLY";
export type CorePriceReason = "missing_price" | "one_sided" | "invalid_price" | "identity_mismatch" | "stale" | "timeout" | "source_unavailable" | "unconfirmed_settlement" | "history_missing" | "history_not_synced";
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
const SOURCES: CorePriceSource[] = ["PM_CURRENT_PRICE", "PM_CLOB_MID", "KALSHI_BOOK_MID", "KALSHI_LAST_TRADE", "OFFICIAL_SETTLEMENT", "HISTORY_HOURLY"];
const REASONS: CorePriceReason[] = ["missing_price", "one_sided", "invalid_price", "identity_mismatch", "stale", "timeout", "source_unavailable", "unconfirmed_settlement", "history_missing", "history_not_synced"];
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
  if ((marketSource === "POLYMARKET" && (priceSource === "KALSHI_BOOK_MID" || priceSource === "KALSHI_LAST_TRADE")) || (marketSource === "KALSHI" && (priceSource === "PM_CURRENT_PRICE" || priceSource === "PM_CLOB_MID"))) throw invalid();
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


/** An opening cohort keeps its own lot quantities; a past range end is the snapshot instant (asOf). */
export type CohortDrawdownReason = "not_synced" | "syncing" | "missing_prices" | "stale_endpoint" | "budget_exceeded";
export interface CohortDrawdownCoverage {
  reason: CohortDrawdownReason | null; fidelitySeconds: 3600;
  from: string | null; to: string | null; computedAt: string | null;
  missingAssetCount: number | null; missingPointCount: number | null;
  lastComplete?: boolean;
}
export type SharpeReason = "not_synced" | "missing_prices" | "budget_exceeded" | "insufficient_samples" | "zero_variance" | "nonpositive_nav";
export interface SharpeCoverage { reason: SharpeReason | null; periodSeconds: 86400; sampleDays: number; dayTimezone?: "Asia/Shanghai"; from: string | null; to: string | null; computedAt: string | null; lastComplete?: boolean }
export interface AccountCohortMetrics extends AccountCoreMetrics {
  openedAssetCount: number; holdingAssetCount: number; closedAssetCount: number;
  roi: string | null; buyFees: string; sellFees: string;
  maxDrawdown: string | null; drawdownState: "available" | "history_unavailable";
  drawdownCoverage?: CohortDrawdownCoverage;
  sharpAnnual?: string | null; sharpAnnualCoverage?: SharpeCoverage;
}
const DRAWDOWN_REASONS: CohortDrawdownReason[] = ["not_synced", "syncing", "missing_prices", "stale_endpoint", "budget_exceeded"];
function coverageTime(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) throw invalid();
  const result = timestamp(value), date = value.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw invalid();
  return result;
}
function decodeDrawdownCoverage(value: unknown, state: AccountCohortMetrics["drawdownState"]): CohortDrawdownCoverage | undefined {
  if (value === undefined) return undefined;
  const raw = record(value);
  if (raw.last_complete !== undefined && (typeof raw.last_complete !== "boolean" || (raw.last_complete && state !== "available"))) throw invalid();
  const reason = raw.reason === null ? null : DRAWDOWN_REASONS.find(reason => reason === raw.reason);
  if (reason === undefined || raw.fidelity_seconds !== 3600 || (state === "available") !== (reason === null)) throw invalid();
  const from = coverageTime(raw.from), to = coverageTime(raw.to), computedAt = coverageTime(raw.computed_at);
  if (from !== null && to !== null && Date.parse(from) > Date.parse(to)) throw invalid();
  const missingAssetCount = raw.missing_asset_count === null ? null : count(raw.missing_asset_count);
  const missingPointCount = raw.missing_point_count === null ? null : count(raw.missing_point_count);
  if (state === "available" && ((missingAssetCount ?? 0) > 0 || (missingPointCount ?? 0) > 0)) throw invalid();
  return { reason, fidelitySeconds: 3600, from, to, computedAt, missingAssetCount, missingPointCount, ...(raw.last_complete !== undefined ? { lastComplete: raw.last_complete === true } : {}) };
}
function decodeSharpe(raw: Record<string, unknown>): Pick<AccountCohortMetrics, "sharpAnnual" | "sharpAnnualCoverage"> {
  if (!("sharp_annual" in raw) && !("sharp_annual_coverage" in raw)) return {};
  const sharpAnnual = nullableDecimal(raw.sharp_annual), c = record(raw.sharp_annual_coverage);
  const reasons: SharpeReason[] = ["not_synced", "missing_prices", "budget_exceeded", "insufficient_samples", "zero_variance", "nonpositive_nav"];
  const reason = c.reason === null ? null : reasons.find(item => item === c.reason);
  if (c.last_complete !== undefined && (typeof c.last_complete !== "boolean" || (c.last_complete && sharpAnnual === null))) throw invalid();
  if (reason === undefined || c.period_seconds !== 86400 || (sharpAnnual !== null) !== (reason === null)) throw invalid();
  if (c.day_timezone !== undefined && c.day_timezone !== "Asia/Shanghai") throw invalid();
  const sampleDays = count(c.sample_days), from = coverageTime(c.from), to = coverageTime(c.to), computedAt = coverageTime(c.computed_at);
  const dayOffsetMs = c.day_timezone === "Asia/Shanghai" ? 8 * 3_600_000 : 0;
  for (const time of [from, to]) if (time !== null && ((Date.parse(time) + dayOffsetMs) % 86_400_000 !== 0 || /[1-9]/.test(time.match(/\.(\d+)/)?.[1] ?? ""))) throw invalid();
  if (from !== null && to !== null && (Date.parse(from) > Date.parse(to) || sampleDays > (Date.parse(to) - Date.parse(from)) / 86_400_000)) throw invalid();
  if (sharpAnnual !== null && (sampleDays < 2 || from === null || to === null)) throw invalid();
  if (reason === "zero_variance" && sampleDays < 2) throw invalid();
  if (reason === "insufficient_samples" && sampleDays >= 2) throw invalid();
  return { sharpAnnual, sharpAnnualCoverage: { reason, periodSeconds: 86400, sampleDays, ...(c.day_timezone !== undefined ? { dayTimezone: c.day_timezone } : {}), from, to, computedAt, ...(c.last_complete !== undefined ? { lastComplete: c.last_complete === true } : {}) } };
}
export interface UnavailableCohortAccount {
  executionAccountId: string; marketSource: "POLYMARKET" | "KALSHI"; reason: "missing_disposition_evidence";
}
export interface AccountCohortMetricsResponse { observedAt: string; asOf: string; openingFrom: string | null; openingTo: string | null; items: AccountCohortMetrics[]; unavailableAccounts: UnavailableCohortAccount[] }
export interface AccountCohortQuery { execution_account_id?: string; account_scope?: "active" | "all"; opening_from?: string; opening_to?: string }
export function decodeAccountCohortMetrics(data: Record<string, unknown>, requested: AccountCohortQuery = {}): AccountCohortMetricsResponse {
  const core = decodeAccountCoreMetrics(data);
  if (!Array.isArray(data.unavailable_accounts)) throw invalid();
  const seen = new Set(core.items.map(item => item.executionAccountId));
  const unavailableAccounts = data.unavailable_accounts.map((raw): UnavailableCohortAccount => {
    const item = record(raw), executionAccountId = id(item.execution_account_id), marketSource = source(item.market_source);
    if (seen.has(executionAccountId) || item.reason !== "missing_disposition_evidence") throw invalid();
    seen.add(executionAccountId);
    return { executionAccountId, marketSource, reason: item.reason };
  });
  if (requested.execution_account_id && (seen.size !== 1 || !seen.has(requested.execution_account_id))) throw invalid();
  const openingFrom = nullableTime(data.opening_from), openingTo = nullableTime(data.opening_to);
  if ((openingFrom === null) !== (openingTo === null) || (openingFrom && openingTo && Date.parse(openingFrom) >= Date.parse(openingTo))) throw invalid();
  if ((requested.opening_from ? Date.parse(requested.opening_from) : null) !== (openingFrom ? Date.parse(openingFrom) : null) || (requested.opening_to ? Date.parse(requested.opening_to) : null) !== (openingTo ? Date.parse(openingTo) : null)) throw invalid();
  // Older backends omit as_of and always measure to now.
  const asOf = data.as_of === undefined ? core.observedAt : timestamp(data.as_of);
  if (Date.parse(asOf) > Date.parse(core.observedAt) || (data.as_of !== undefined && openingTo !== null && Date.parse(asOf) > Date.parse(openingTo))) throw invalid();
  const items = core.items.map((item, index): AccountCohortMetrics => {
    const raw = record((data.items as unknown[])[index]);
    const openedAssetCount = count(raw.opened_asset_count), holdingAssetCount = count(raw.holding_asset_count), closedAssetCount = count(raw.closed_asset_count);
    if (openedAssetCount !== holdingAssetCount + closedAssetCount || holdingAssetCount !== item.assetCount) throw invalid();
    const roi = nullableDecimal(raw.roi), buyFees = decimal(raw.buy_fees, true), sellFees = decimal(raw.sell_fees, true);
    if ((item.totalPnl === null || isZero(item.cumulativeInvestedCost)) ? roi !== null : roi === null) throw invalid();
    const maxDrawdown = nullableDecimal(raw.max_drawdown, true);
    if (raw.drawdown_state !== "available" && raw.drawdown_state !== "history_unavailable") throw invalid();
    if ((raw.drawdown_state === "available") !== (maxDrawdown !== null)) throw invalid();
    const drawdownCoverage = decodeDrawdownCoverage(raw.drawdown_coverage, raw.drawdown_state);
    const sharpe = decodeSharpe(raw);
    return { ...item, openedAssetCount, holdingAssetCount, closedAssetCount, roi, buyFees, sellFees, maxDrawdown, drawdownState: raw.drawdown_state, ...sharpe, ...(drawdownCoverage ? { drawdownCoverage } : {}) };
  });
  return { observedAt: core.observedAt, asOf, openingFrom, openingTo, items, unavailableAccounts };
}
/** Browser-local whole hours may map to :30 UTC in half-hour time zones. */
export function cohortOpeningRangeError(params: Pick<AccountCohortQuery, "opening_from" | "opening_to">): string | undefined {
  if (!params.opening_from && !params.opening_to) return undefined;
  const values = [params.opening_from, params.opening_to].map(value => value ? new Date(value) : undefined);
  if (values.some(value => !value || !Number.isFinite(value.getTime()))) return "开仓时间无效，请重新选择日期和小时后应用。";
  if (values.some(value => value!.getMinutes() !== 0 || value!.getSeconds() !== 0 || value!.getMilliseconds() !== 0)) return "开仓时间不是本地整点，请重新选择日期和小时后应用。";
  return undefined;
}
export async function accountCohortMetrics(params: AccountCohortQuery = {}, signal?: AbortSignal): Promise<AccountCohortMetricsResponse> {
  const rangeError = cohortOpeningRangeError(params);
  if (rangeError) throw new Error(rangeError);
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const response = await fetch(`/api/console/v2/trading/account-cohort-metrics${query.size ? `?${query}` : ""}`, { signal, cache: "no-store" });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error("账户核心指标暂时不可用，请稍后重试。");
  return decodeAccountCohortMetrics(record(record(payload).data), params);
}
