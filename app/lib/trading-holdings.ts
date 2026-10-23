export interface ConsoleV2Holding {
  modelId?: string;
  strategyId?: string;
  executionAccountId?: string;
  marketSource?: string;
  marketId?: string;
  marketQuestion?: string;
  conditionId?: string;
  tokenId?: string;
  outcomeIndex: number | null;
  outcomeName?: string;
  status: string;
  remainingShares: string | null;
  remainingCost: string | null;
  lotCount: number | null;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
  markPrice: string | null;
  markObservedAt?: string;
  marketValue: string | null;
  unrealizedPnl: string | null;
}

type RawRecord = Record<string, unknown>;
type DecoderHelpers = {
  requiredText: (value: unknown, field: string) => string;
  optionalText: (value: unknown) => string | undefined;
  optionalTime: (value: unknown) => string | undefined;
};

/** Decode the additive holdings contract without coercing decimal strings to JS numbers. */
export function decodeTradingHolding(value: RawRecord, helpers: DecoderHelpers): ConsoleV2Holding {
  return {
    modelId: helpers.optionalText(value.model_id),
    strategyId: helpers.optionalText(value.strategy_id),
    executionAccountId: helpers.optionalText(value.execution_account_id),
    marketSource: helpers.optionalText(value.market_source),
    marketId: helpers.optionalText(value.market_id),
    marketQuestion: helpers.optionalText(value.market_question),
    conditionId: helpers.optionalText(value.condition_id),
    tokenId: helpers.optionalText(value.token_id),
    outcomeIndex: nullableIndex(value.outcome_index),
    outcomeName: helpers.optionalText(value.outcome_name),
    status: helpers.requiredText(value.status, "holding.status"),
    remainingShares: decimalText(value.remaining_shares),
    remainingCost: decimalText(value.remaining_cost),
    lotCount: nullableCount(value.lot_count),
    firstOpenedAt: helpers.optionalTime(value.first_opened_at),
    lastOpenedAt: helpers.optionalTime(value.last_opened_at),
    markPrice: decimalText(value.mark_price),
    markObservedAt: helpers.optionalTime(value.mark_observed_at),
    marketValue: decimalText(value.market_value),
    unrealizedPnl: decimalText(value.unrealized_pnl),
  };
}

export function holdingIdentity(item: ConsoleV2Holding): string {
  return JSON.stringify([
    item.executionAccountId ?? null,
    item.modelId ?? null,
    item.strategyId ?? null,
    item.marketSource ?? null,
    item.marketId ?? null,
    item.conditionId ?? null,
    item.tokenId ?? null,
    item.outcomeIndex,
    item.outcomeName ?? null,
  ]);
}

function decimalText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text && DECIMAL_TEXT.test(text) && Number.isFinite(Number(text)) ? text : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function nullableIndex(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" && DECIMAL_TEXT.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nullableCount(value: unknown): number | null {
  return nullableIndex(value);
}

// PostgreSQL numeric::text is decimal text. Keep the decoder from accepting
// JavaScript's broader Number() grammar (for example hexadecimal strings or
// booleans) as valid contract values.
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
