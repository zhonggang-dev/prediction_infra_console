import { buildCustomWalletPnlView, type WalletPnlCustomRange, type WalletPnlSelection, type WalletPnlView } from "./wallet-pnl.ts";

export type KalshiPnlRange = "1d" | "1w" | "1m" | "1y" | "all";
export interface KalshiPnlPoint { timestamp: number; cumulativePnl: number; portfolioValue: number }
export interface KalshiPnlSeries {
  executionAccountId: string;
  range: KalshiPnlRange;
  periodIntervalMinutes: number;
  fetchedAt: string;
  processedThrough: string;
  points: KalshiPnlPoint[];
}
export interface KalshiPnlAccount { executionAccountId: string; marketSource: "KALSHI" }
export interface KalshiPnlView extends WalletPnlView { notice?: string; error?: string; approximate?: boolean }
const RANGES: KalshiPnlRange[] = ["1d", "1w", "1m", "1y", "all"];
const DAY = 86_400_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Kalshi 官方盈亏数据无效。");
  return value as Record<string, unknown>;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Kalshi 官方盈亏时间无效。");
  return value;
}
function accountId(value: unknown): string {
  if (typeof value !== "string" || !/^kalshi:[A-Za-z0-9._-]{1,120}$/.test(value)) throw new Error("Kalshi 官方盈亏账户无效。");
  return value;
}
function decimal(value: unknown): number {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error("Kalshi 官方盈亏金额无效。");
  return Number(value);
}
export function decodeKalshiPnlAccounts(value: unknown): KalshiPnlAccount[] {
  const data = record(value); instant(data.observed_at);
  if (!Array.isArray(data.accounts)) throw new Error("Kalshi 官方盈亏账户目录无效。");
  const seen = new Set<string>();
  return data.accounts.map(raw => {
    const item = record(raw), id = accountId(item.execution_account_id);
    if (item.market_source !== "KALSHI" || seen.has(id)) throw new Error("Kalshi 官方盈亏账户目录无效。");
    seen.add(id); return { executionAccountId: id, marketSource: "KALSHI" };
  });
}
export function decodeKalshiPnl(value: unknown, expected: { account: string; range: KalshiPnlRange }): KalshiPnlSeries {
  const data = record(value), id = accountId(data.execution_account_id);
  if (id !== expected.account || data.range !== expected.range || !RANGES.includes(data.range as KalshiPnlRange) || data.market_source !== "KALSHI" || data.metric !== "cumulative_pnl") throw new Error("Kalshi 官方盈亏与所选账户或周期不一致。");
  const fetchedAt = instant(data.fetched_at), processedThrough = instant(data.processed_through);
  const interval = data.period_interval_minutes;
  if (typeof interval !== "number" || ![10, 60, 1440].includes(interval) || Date.parse(processedThrough) > Date.parse(fetchedAt) + 60_000) throw new Error("Kalshi 官方盈亏采样精度无效。");
  if (!Array.isArray(data.points) || data.points.length > 10_000) throw new Error("Kalshi 官方盈亏采样点超出读取预算。");
  const points = new Map<number, KalshiPnlPoint>();
  for (const raw of data.points) {
    const p = record(raw), timestamp = p.timestamp;
    if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp * 1000 > Date.parse(fetchedAt) + 60_000) throw new Error("Kalshi 官方盈亏采样时间无效。");
    const point = { timestamp, cumulativePnl: decimal(p.cumulative_pnl), portfolioValue: decimal(p.portfolio_value) };
    if (point.portfolioValue < 0) throw new Error("Kalshi 官方账户总值无效。");
    const previous = points.get(timestamp);
    if (previous && (previous.cumulativePnl !== point.cumulativePnl || previous.portfolioValue !== point.portfolioValue)) throw new Error("Kalshi 官方盈亏采样点冲突。");
    points.set(timestamp, point);
  }
  return { executionAccountId: id, range: expected.range, periodIntervalMinutes: interval, fetchedAt, processedThrough, points: [...points.values()].sort((a, b) => a.timestamp - b.timestamp) };
}
async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/console/kalshi-pnl${path}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Kalshi 官方盈亏暂时不可用，请稍后重试。");
  return record(await response.json()).data;
}
export async function kalshiPnlAccounts(signal?: AbortSignal) { return decodeKalshiPnlAccounts(await read("/accounts", signal)); }
export async function kalshiPnl(account: string, range: KalshiPnlRange, signal?: AbortSignal) {
  const query = new URLSearchParams({ execution_account_id: account, range });
  return decodeKalshiPnl(await read(`?${query}`, signal), { account, range });
}

/** Select by how far back the start lies, not by the selected duration. */
export function chooseKalshiPnlRange(period: WalletPnlSelection, range?: WalletPnlCustomRange, now = Date.now()): KalshiPnlRange {
  if (period !== "CUSTOM") return ({ "1D": "1d", "1W": "1w", "1M": "1m", "1Y": "1y", YTD: "1y", ALL: "all" } as const)[period];
  if (!range) throw new Error("请选择自定义时间。");
  if (range.startMs >= now - DAY) return "1d";
  if (range.startMs >= now - 7 * DAY) return "1w";
  if (range.startMs >= now - 30 * DAY) return "1m";
  return "all";
}
function displayTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp * 1000);
}
export function buildKalshiPnlView(series: KalshiPnlSeries, period: WalletPnlSelection, range?: WalletPnlCustomRange): KalshiPnlView {
  const empty: KalshiPnlView = { period, points: [], amount: null, absolute: period === "ALL", baseline: null, startAt: null, endAt: null };
  const now = Date.parse(series.fetchedAt), points = series.points.filter(p => p.timestamp * 1000 <= now);
  if (points.length < 2) return { ...empty, error: "官方尚未提供足够的历史数据。" };
  if (now - points.at(-1)!.timestamp * 1000 > Math.max(series.periodIntervalMinutes * 60_000, 3_600_000)) return { ...empty, error: "官方序列尚未更新到当前周期，请稍后重试。" };
  if (period === "CUSTOM") {
    if (!range) return { ...empty, error: "请选择有效的起止时间。" };
    const view = buildCustomWalletPnlView(points.map(p => ({ timestamp: p.timestamp, tradePnl: p.cumulativePnl })), range, now);
    const tolerance = series.periodIntervalMinutes >= 1440 ? 26 * 3600 : series.periodIntervalMinutes * 60;
    if (view.points.some((p, i) => i > 0 && p.timestamp - view.points[i - 1].timestamp > tolerance * 1.5)) return { ...empty, error: "所选期间存在官方历史数据缺口，暂无法计算完整曲线。" };
    return view;
  }
  if (period === "YTD") {
    const date = new Date(now);
    const startMs = period === "YTD" ? new Date(date.getFullYear(), 0, 1).getTime() : range?.startMs;
    const endMs = period === "YTD" ? now : range?.endMs;
    if (startMs === undefined || endMs === undefined || startMs >= endMs || endMs > now) return { ...empty, error: "请选择有效的起止时间。" };
    const domain = { ...empty, startAt: startMs / 1000, endAt: endMs / 1000 };
    const beforeEnd = points.filter(p => p.timestamp * 1000 <= endMs);
    let baseline = beforeEnd.filter(p => p.timestamp * 1000 <= startMs).at(-1);
    let partialHistory = false;
    if (!baseline && period === "YTD") { baseline = beforeEnd[0]; partialHistory = true; }
    const last = beforeEnd.at(-1), daily = series.periodIntervalMinutes >= 1440;
    const tolerance = daily ? 26 * 3_600_000 : series.periodIntervalMinutes * 60_000;
    const exact = baseline?.timestamp === startMs / 1000 && last?.timestamp === endMs / 1000;
    if (daily && endMs - startMs <= DAY && !exact) return { ...domain, error: "该时间段仅有每日数据，请扩大范围或按整日查看。" };
    if (!baseline || !last || last.timestamp <= baseline.timestamp || (!partialHistory && startMs - baseline.timestamp * 1000 > tolerance) || endMs - last.timestamp * 1000 > tolerance) return { ...domain, error: "所选起止时间缺少对应的官方采样数据，暂无法计算期间盈亏。" };
    const selected = beforeEnd.filter(p => p.timestamp >= baseline.timestamp);
    if (selected.some((p, i) => i > 0 && (p.timestamp - selected[i - 1].timestamp) * 1000 > tolerance * 1.5)) return { ...domain, error: "所选期间存在官方历史数据缺口，暂无法计算完整曲线。" };
    const approximate = !partialHistory && (!exact && daily);
    const visible = selected.filter(p => p.timestamp * 1000 >= startMs);
    return { ...domain, baseline: baseline.cumulativePnl, baselineAt: baseline.timestamp, endSampleAt: last.timestamp, partialHistory, approximate,
      points: visible.map(p => ({ timestamp: p.timestamp, tradePnl: p.cumulativePnl, value: p.cumulativePnl - baseline.cumulativePnl })), amount: last.cumulativePnl - baseline.cumulativePnl,
      notice: partialHistory ? `历史从 ${displayTime(baseline.timestamp)} 开始，展示已有期间的变化。` : !exact ? `实际计算采用 ${displayTime(baseline.timestamp)} 至 ${displayTime(last.timestamp)} 的官方采样点（本地时间）。${daily ? "日级数据不代表小时收益。" : ""}` : undefined };
  }
  const first = points[0], last = points.at(-1)!, absolute = period === "ALL";
  return { ...empty, absolute, baseline: absolute ? null : first.cumulativePnl, baselineAt: first.timestamp, startAt: first.timestamp, endAt: last.timestamp, endSampleAt: last.timestamp,
    points: points.map(p => ({ timestamp: p.timestamp, tradePnl: p.cumulativePnl, value: absolute ? p.cumulativePnl : p.cumulativePnl - first.cumulativePnl })), amount: absolute ? last.cumulativePnl : last.cumulativePnl - first.cumulativePnl };
}
