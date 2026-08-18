import type { TradeHistoryPage, TradeHistoryParams, TradeRecord } from "./types";

const utc = (offsetMinutes: number) => new Date(Date.now() - offsetMinutes * 60_000).toISOString();

const demoTrades: TradeRecord[] = [
  trade({ id: "pm-fill-92d1", order: "ord-01K32M5X", side: "SELL", outcome: "YES", model: "forecast-v2", strategy: "multfactor_v2", account: "acct-forecast-v2-multfactor-v2", shares: "18.5", price: "0.684", gross: "12.654", fee: "0.0253", cash: "12.6287", pnl: "2.1837", minutes: 16, lot: "lot-01K2Q7KA", label: "Will the Federal Reserve cut rates in September?" }),
  trade({ id: "pm-fill-92a8", order: "ord-01K32JFA", side: "BUY", outcome: "NO", model: "forecast-v3", strategy: "multfactor_v1", account: "acct-forecast-v3-multfactor-v1", shares: "23.1481", price: "0.432", gross: "10", fee: "0.02", cash: "-10.02", pnl: "0", minutes: 48, lot: "lot-01K32JHB", label: "Will Bitcoin close above $120,000 this month?" }),
  trade({ id: "pm-fill-919f", order: "ord-01K31YQ2", side: "SELL", outcome: "NO", model: "forecast-v2", strategy: "multfactor_v1", account: "acct-forecast-v2-multfactor-v1", shares: "10", price: "0.271", gross: "2.71", fee: "0.0054", cash: "2.7046", pnl: "-0.7954", minutes: 155, lot: "lot-01K18AF2", label: "Will the S&P 500 finish the week higher?" }),
  trade({ id: "pm-fill-914c", order: "ord-01K30N8K", side: "BUY", outcome: "YES", model: "forecast-v2", strategy: "multfactor_v2", account: "acct-forecast-v2-multfactor-v2", shares: "14.5348", price: "0.688", gross: "10", fee: "0.02", cash: "-10.02", pnl: "0", minutes: 390, lot: "lot-01K30NA4", label: "Will the Federal Reserve cut rates in September?" }),
  trade({ id: "pm-fill-8fe1", order: "ord-01K2VK7Q", side: "BUY", outcome: "YES", model: "forecast-v1", strategy: "multfactor_v1", account: "acct-forecast-v1-multfactor-v1", shares: "12.1951", price: "0.41", gross: "5", fee: "0.01", cash: "-5.01", pnl: "0", minutes: 1450, lot: "lot-01K2VK91", label: "Will Ethereum trade above $5,000 in August?" }),
  trade({ id: "pm-fill-8b70", order: "ord-01K2M10A", side: "SELL", outcome: "YES", model: "forecast-v1", strategy: "multfactor_v1", account: "acct-forecast-v1-multfactor-v1", shares: "8", price: "0.55", gross: "4.4", fee: "0.0088", cash: "4.3912", pnl: "0.3912", minutes: 9200, lot: "lot-01K18D82", label: "Will US CPI be below 3% in July?" }),
];

type TradeSeed = { id: string; order: string; side: "BUY" | "SELL"; outcome: string; model: string; strategy: string; account: string; shares: string; price: string; gross: string; fee: string; cash: string; pnl: string; minutes: number; lot: string; label: string };

function trade(seed: TradeSeed): TradeRecord {
  return {
    fillKey: `polymarket:${seed.id}:${seed.order}`, venue: "polymarket", venueTradeId: seed.id,
    orderId: seed.order, venueOrderId: `0x${seed.order.slice(-8).toLowerCase()}d8a2`, orderStatus: "FILLED",
    executionAccountId: seed.account, modelId: seed.model, strategyId: seed.strategy,
    marketId: `pm-${seed.id.slice(-4)}`, marketLabel: seed.label,
    conditionId: `0x8d7a${seed.id.slice(-4)}f01439c8`, tokenId: `7130084${seed.id.slice(-4)}`,
    outcomeName: seed.outcome, lotId: seed.lot, side: seed.side, liquidityRole: "TAKER",
    shares: seed.shares, price: seed.price, grossNotional: seed.gross, totalFee: seed.fee,
    netCashDelta: seed.cash, realizedPnl: seed.pnl, transactionHash: `0x4fc1${seed.id.slice(-4)}e72a`,
    matchedAt: utc(seed.minutes), confirmedAt: utc(seed.minutes - 1),
  };
}

/** 演示数据遵循与服务端相同的过滤和汇总口径。 */
export function demoTradeHistory(params: TradeHistoryParams = {}): TradeHistoryPage {
  const needle = params.query?.trim().toLowerCase();
  const from = params.from ? new Date(params.from).getTime() : undefined;
  const to = params.to ? new Date(params.to).getTime() : undefined;
  const filtered = demoTrades.filter((item) => {
    const matched = new Date(item.matchedAt).getTime();
    if (from !== undefined && matched < from) return false;
    if (to !== undefined && matched > to) return false;
    if (params.side && item.side !== params.side) return false;
    if (params.modelId && item.modelId !== params.modelId) return false;
    if (params.strategyId && item.strategyId !== params.strategyId) return false;
    if (params.executionAccountId && item.executionAccountId !== params.executionAccountId) return false;
    return !needle || Object.values(item).join(" ").toLowerCase().includes(needle);
  });
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 20;
  const sum = (field: "grossNotional" | "netCashDelta" | "totalFee" | "realizedPnl", side?: "BUY" | "SELL") => decimal(filtered.reduce((total, item) => total + (side && item.side !== side ? 0 : Number(item[field])), 0));
  return {
    items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset,
    summary: {
      tradeCount: filtered.length, buyNotional: sum("grossNotional", "BUY"), sellNotional: sum("grossNotional", "SELL"),
      netCashFlow: sum("netCashDelta"), totalFee: sum("totalFee"), realizedPnl: sum("realizedPnl"),
    },
  };
}

const decimal = (value: number) => value.toFixed(4).replace(/\.?0+$/, "") || "0";
