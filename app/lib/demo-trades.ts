import type { DailyPnLReport, LedgerActivity, LedgerActivityPage, LedgerActivityParams, TradeHistoryPage, TradeHistoryParams, TradeRecord } from "./types";

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

/** 演示用的链上赎回结算：不是 CLOB 卖出成交，因此没有成交价、订单 ID 与流动性角色。 */
const demoRedemptions: LedgerActivity[] = [{
  activityKey: "redemption:lot-redemption:0x9a3f5c71:lot-01K2Q7KA", activityType: "REDEEM", venue: "polymarket",
  executionAccountId: "acct-forecast-v2-multfactor-v2", modelId: "forecast-v2", strategyId: "multfactor_v2",
  marketId: "pm-7c21", marketLabel: "Will the July jobs report beat consensus?", conditionId: "0x8d7a7c21f01439c8", tokenId: "71300847c21",
  outcomeName: "NO", lotId: "lot-01K2Q7KA", shares: "40", totalFee: "0", netCashDelta: "40", costBasis: "2.08", settlementPayout: "40",
  realizedPnl: "37.92", transactionHash: "0x9a3f5c71e2b4d5f60a8c9e1d2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
  occurredAt: utc(320), confirmedAt: utc(322), appliedAt: utc(320),
}];

/** 把演示成交映射成统一账本活动；SELL 的成本 = 净收入 − 已实现盈亏。 */
function activityFromTrade(item: TradeRecord): LedgerActivity {
  return {
    activityKey: `fill:${item.fillKey}`, activityType: item.side, venue: item.venue,
    executionAccountId: item.executionAccountId, modelId: item.modelId, strategyId: item.strategyId,
    marketId: item.marketId, marketLabel: item.marketLabel, conditionId: item.conditionId, tokenId: item.tokenId,
    outcomeName: item.outcomeName, lotId: item.lotId, orderId: item.orderId, venueOrderId: item.venueOrderId,
    venueTradeId: item.venueTradeId, orderStatus: item.orderStatus, liquidityRole: item.liquidityRole,
    shares: item.shares, price: item.price, grossNotional: item.grossNotional, totalFee: item.totalFee, netCashDelta: item.netCashDelta,
    costBasis: item.side === "SELL" ? decimal(Number(item.netCashDelta) - Number(item.realizedPnl)) : undefined,
    realizedPnl: item.realizedPnl, transactionHash: item.transactionHash,
    occurredAt: item.matchedAt, confirmedAt: item.confirmedAt, appliedAt: item.confirmedAt,
  };
}

/** 演示账本活动遵循与服务端相同的过滤和汇总口径：已实现盈亏 = SELL 平仓 + REDEEM，赎回不计入卖出金额。 */
export function demoLedgerActivities(params: LedgerActivityParams = {}): LedgerActivityPage {
  const needle = params.query?.trim().toLowerCase();
  const from = params.from ? new Date(params.from).getTime() : undefined;
  const to = params.to ? new Date(params.to).getTime() : undefined;
  const filtered = [...demoTrades.map(activityFromTrade), ...demoRedemptions]
    .filter((item) => {
      const occurred = new Date(item.occurredAt).getTime();
      if (from !== undefined && occurred < from) return false;
      if (to !== undefined && occurred > to) return false;
      if (params.activityType && item.activityType !== params.activityType) return false;
      if (params.modelId && item.modelId !== params.modelId) return false;
      if (params.strategyId && item.strategyId !== params.strategyId) return false;
      if (params.executionAccountId && item.executionAccountId !== params.executionAccountId) return false;
      return !needle || Object.values(item).join(" ").toLowerCase().includes(needle);
    })
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 20;
  const sum = (pick: (item: LedgerActivity) => string | undefined, type?: LedgerActivity["activityType"]) =>
    decimal(filtered.reduce((total, item) => total + (type && item.activityType !== type ? 0 : Number(pick(item) ?? 0)), 0));
  const count = (type?: LedgerActivity["activityType"]) => filtered.filter((item) => (type ? item.activityType === type : true)).length;
  return {
    items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset,
    summary: {
      activityCount: filtered.length, tradeCount: count("BUY") + count("SELL"), redemptionCount: count("REDEEM"),
      buyNotional: sum((item) => item.grossNotional, "BUY"), sellNotional: sum((item) => item.grossNotional, "SELL"),
      redeemPayout: sum((item) => item.settlementPayout, "REDEEM"), netCashFlow: sum((item) => item.netCashDelta),
      totalFee: sum((item) => item.totalFee), realizedPnl: sum((item) => item.realizedPnl),
      sellRealizedPnl: sum((item) => item.realizedPnl, "SELL"), redeemRealizedPnl: sum((item) => item.realizedPnl, "REDEEM"),
    },
  };
}

const demoPnLSeries = [
  { account: "acct-forecast-v2-multfactor-v2", model: "forecast-v2", strategy: "multfactor_v2", today: 2.1837, cycle: [1.24, -0.42, 0, 2.71, 0.86, -1.18, 1.92] },
  { account: "acct-forecast-v2-multfactor-v1", model: "forecast-v2", strategy: "multfactor_v1", today: -0.7954, cycle: [-0.31, 0.72, 1.08, -1.44, 0, 0.48, -0.22] },
  { account: "acct-forecast-v3-multfactor-v1", model: "forecast-v3", strategy: "multfactor_v1", today: 1.248, cycle: [0.63, 1.16, -0.54, 0.92, 1.37, 0, -0.81] },
  { account: "acct-forecast-v1-multfactor-v1", model: "forecast-v1", strategy: "multfactor_v1", today: 0, cycle: [0.39, 0, -0.27, 0.58, 0.14, -0.62, 0] },
];

/** 生成连续、确定性的演示序列；每个启用绑定每天都有一条记录，包括零收益日。 */
export function demoDailyPnL(requestedDays = 14): DailyPnLReport {
  const days = Math.max(1, Math.min(90, requestedDays));
  const now = new Date();
  const toDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fromDay = new Date(toDay);
  fromDay.setUTCDate(fromDay.getUTCDate() - days + 1);
  const items = Array.from({ length: days }, (_, index) => {
    const day = new Date(fromDay);
    day.setUTCDate(day.getUTCDate() + index);
    const daysAgo = days - index - 1;
    return demoPnLSeries.map((series, seriesIndex) => {
      const value = daysAgo === 0 ? series.today : series.cycle[(daysAgo + seriesIndex * 2) % series.cycle.length];
      const trades = value === 0 ? 0 : 1 + ((daysAgo + seriesIndex) % 3);
      return {
        day: day.toISOString().slice(0, 10), executionAccountId: series.account,
        modelId: series.model, strategyId: series.strategy, realizedPnl: decimal(value),
        closedTradeCount: trades, closedShares: decimal(trades * (8.5 + seriesIndex * 2.25)),
        redemptionCount: 0, redemptionPnl: "0",
      };
    });
  }).flat();
  return {
    items, days, fromDay: fromDay.toISOString().slice(0, 10), toDay: toDay.toISOString().slice(0, 10),
    timezone: "UTC", generatedAt: now.toISOString(),
  };
}

const decimal = (value: number) => value.toFixed(4).replace(/\.?0+$/, "") || "0";
