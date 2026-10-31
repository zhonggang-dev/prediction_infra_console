import { isOfficialWalletPnlResponse, type WalletPnlSeries } from "./wallet-pnl.ts";

export interface OfficialPnlAccount { executionAccountId: string; marketSource: "POLYMARKET" }

async function read(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/console/${path}`, { signal, cache: "no-store" });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error("官方钱包盈亏暂时不可用，请稍后重试。");
  const root = record(payload);
  return record(root.data);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("官方钱包盈亏返回了无效数据。");
  return value as Record<string, unknown>;
}
function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("官方钱包盈亏缺少必要字段。");
  return value;
}
export function decodeOfficialPnlAccounts(data: Record<string, unknown>): OfficialPnlAccount[] {
  if (!Array.isArray(data.accounts) || typeof data.observed_at !== "string" || !Number.isFinite(Date.parse(data.observed_at))) throw new Error("官方盈亏账户目录无效。");
  const seen = new Set<string>();
  return data.accounts.map((raw) => {
    const value = record(raw);
    const executionAccountId = requiredText(value.execution_account_id);
    if (value.market_source !== "POLYMARKET" || seen.has(executionAccountId)) throw new Error("官方盈亏账户目录无效。");
    seen.add(executionAccountId);
    return { executionAccountId, marketSource: "POLYMARKET" as const };
  });
}
export async function officialPnlAccounts(signal?: AbortSignal) {
  return decodeOfficialPnlAccounts(await read("wallet-pnl/accounts", signal));
}
export function decodeWalletPnl(data: Record<string, unknown>): WalletPnlSeries {
  const executionAccountId = requiredText(data.execution_account_id);
  const walletAddress = requiredText(data.wallet_address);
  const fetchedAt = requiredText(data.fetched_at);
  const interval = data.interval;
  const fidelity = data.fidelity;
  if (!/^0x[0-9a-f]{40}$/i.test(walletAddress) || data.metric !== "trade_pnl" || !Number.isFinite(Date.parse(fetchedAt)) ||
    (interval !== "1d" && interval !== "1w" && interval !== "1m" && interval !== "all") ||
    (fidelity !== "1h" && fidelity !== "3h" && fidelity !== "12h" && fidelity !== "18h" && fidelity !== "1d") || !Array.isArray(data.points)) throw new Error("官方钱包盈亏返回了无效数据。");
  const points = new Map<number, number>();
  for (const raw of data.points) {
    const point = record(raw);
    if (!("timestamp" in point) || !("trade_pnl" in point)) throw new Error("官方钱包盈亏采样点不完整。");
    if (point.trade_pnl === null) continue;
    if ((typeof point.timestamp !== "number" && typeof point.timestamp !== "string") ||
      (typeof point.trade_pnl !== "number" && typeof point.trade_pnl !== "string") || String(point.trade_pnl).trim() === "") throw new Error("官方钱包盈亏采样点无效。");
    const timestamp = Number(point.timestamp);
    const tradePnl = Number(point.trade_pnl);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isFinite(tradePnl) || (points.has(timestamp) && points.get(timestamp) !== tradePnl)) throw new Error("官方钱包盈亏采样点无效。");
    points.set(timestamp, tradePnl);
  }
  return { executionAccountId, walletAddress, metric: "trade_pnl", interval, fidelity, fetchedAt, points: [...points.entries()].map(([timestamp, tradePnl]) => ({ timestamp, tradePnl })).sort((a, b) => a.timestamp - b.timestamp) };
}
export async function walletPnl(executionAccountId: string, interval: WalletPnlSeries["interval"], fidelity: WalletPnlSeries["fidelity"], signal?: AbortSignal) {
  const query = new URLSearchParams({ execution_account_id: executionAccountId, interval, fidelity });
  const data = decodeWalletPnl(await read(`wallet-pnl?${query}`, signal));
  if (!isOfficialWalletPnlResponse(data, { executionAccountId, interval, fidelity })) throw new Error("官方钱包盈亏与所选账户或周期不一致。");
  return data;
}
