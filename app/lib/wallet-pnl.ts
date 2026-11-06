export interface WalletPnlPoint { timestamp: number; tradePnl: number; sourceBlock?: string | null }
export interface WalletPnlSeries {
  executionAccountId: string;
  walletAddress: string;
  metric: "trade_pnl";
  interval: "1d" | "1w" | "1m" | "all";
  fidelity: "1h" | "3h" | "12h" | "18h" | "1d";
  fetchedAt: string;
  sourceFidelity?: string | null;
  points: WalletPnlPoint[];
}

export type WalletPnlPeriod = "1D" | "1W" | "1M" | "1Y" | "YTD" | "ALL";
export type WalletPnlSelection = WalletPnlPeriod | "CUSTOM";
export interface WalletPnlCustomRange { startDate: string; endDate: string; startMs: number; endMs: number; timeZone: string; startOffset: string; endOffset: string }

export type WalletPnlQuery = Pick<WalletPnlSeries, "interval" | "fidelity">;


export interface WalletPnlViewPoint extends WalletPnlPoint {
  value: number;
}

export interface WalletPnlView {
  period: WalletPnlSelection;
  partialHistory?: boolean;
  baselineAt?: number | null;
  endSampleAt?: number | null;
  points: WalletPnlViewPoint[];
  amount: number | null;
  absolute: boolean;
  baseline: number | null;
  startAt: number | null;
  endAt: number | null;
  /** A period may use approximate official sampling boundaries. */
  approximate?: boolean;
  error?: string;
}

export interface WalletPnlChartGeometry {
  width: number;
  height: number;
  left: number;
  top: number;
  bottom: number;
  plotWidth: number;
  plotHeight: number;
  points: { x: number; y: number }[];
  linePath: string;
  areaPath: string;
  domainStartAt: number;
  domainEndAt: number;
}

export function isOfficialWalletPnlResponse(series: Pick<WalletPnlSeries, "executionAccountId" | "interval" | "fidelity">, requested: { executionAccountId: string } & WalletPnlQuery): boolean {
  return series.executionAccountId === requested.executionAccountId
    && series.interval === requested.interval
    && series.fidelity === requested.fidelity;
}

const PERIOD_MS: Record<WalletPnlPeriod, number | null> = {
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
  "1Y": 365 * 24 * 60 * 60 * 1000,
  YTD: null,
  ALL: null,
};

// The 30-day window is the display window; the official page still treats a
// wallet with less than 31 days of history as a short-history absolute series.
const SHORT_HISTORY_THRESHOLD_MS: Record<WalletPnlPeriod, number | null> = {
  "1D": PERIOD_MS["1D"],
  "1W": PERIOD_MS["1W"],
  "1M": 31 * 24 * 60 * 60 * 1000,
  "1Y": PERIOD_MS["1Y"],
  YTD: null,
  ALL: null,
};

const DEFAULT_QUERIES: Record<WalletPnlPeriod, WalletPnlQuery> = {
  "1D": { interval: "1d", fidelity: "1h" },
  "1W": { interval: "1w", fidelity: "3h" },
  "1M": { interval: "1m", fidelity: "18h" },
  "1Y": { interval: "all", fidelity: "1d" },
  YTD: { interval: "all", fidelity: "1d" },
  ALL: { interval: "all", fidelity: "1d" },
};

const FIDELITY_CANDIDATES: Array<{ fidelity: WalletPnlQuery["fidelity"]; hours: number }> = [
  { fidelity: "1h", hours: 1 },
  { fidelity: "3h", hours: 3 },
  { fidelity: "12h", hours: 12 },
  { fidelity: "18h", hours: 18 },
  { fidelity: "1d", hours: 24 },
];

const TARGET_POINTS: Record<WalletPnlPeriod, number> = {
  "1D": 24,
  "1W": 56,
  "1M": 48,
  "1Y": 60,
  YTD: 60,
  ALL: 60,
};

/** 选择官方页面使用的采样精度：候选点数最接近目标点数者优先。 */
export function chooseWalletPnlQuery(period: WalletPnlPeriod, historyStartTimestamp?: number, asOfMs = Date.now()): WalletPnlQuery {
  const fallback = DEFAULT_QUERIES[period];
  if (historyStartTimestamp === undefined || !Number.isFinite(historyStartTimestamp) || !Number.isFinite(asOfMs)) return fallback;
  const historyHours = Math.max(0, (asOfMs - historyStartTimestamp * 1000) / (60 * 60 * 1000));
  const maxHours = period === "1D"
    ? 24
    : period === "1W"
      ? 7 * 24
      : period === "1M"
        ? 30 * 24
        : period === "1Y"
          ? 365 * 24
          : period === "YTD"
            ? Math.max(0, asOfMs - localYearStart(asOfMs)) / (60 * 60 * 1000)
            : Number.POSITIVE_INFINITY;
  const availableHours = Math.min(historyHours, maxHours);
  const chosen = FIDELITY_CANDIDATES.reduce((best, candidate) => {
    const bestDistance = Math.abs(availableHours / best.hours - TARGET_POINTS[period]);
    const candidateDistance = Math.abs(availableHours / candidate.hours - TARGET_POINTS[period]);
    return candidateDistance < bestDistance ? candidate : best;
  });
  const interval = period === "1Y" || period === "YTD" || period === "ALL" || (period === "1M" && historyHours < 31 * 24)
    ? "all"
    : fallback.interval;
  return { interval, fidelity: chosen.fidelity };
}

/** 按实际时间轴寻找最近采样点，避免缺采样时按数组下标偏移。 */
export function nearestWalletPnlPointIndex(points: Array<{ timestamp: number }>, ratio: number, domain?: { startAt: number; endAt: number }): number {
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  const first = domain?.startAt ?? points[0]?.timestamp ?? 0;
  const last = domain?.endAt ?? points[points.length - 1]?.timestamp ?? first;
  const target = first + (last - first) * boundedRatio;
  return points.reduce((best, point, index) => Math.abs(point.timestamp - target) < Math.abs(points[best].timestamp - target) ? index : best, 0);
}

export function formatWalletPnlUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function buildWalletPnlChartGeometry(view: WalletPnlView, width = 720, height = 210): WalletPnlChartGeometry | undefined {
  if (!view.points.length) return undefined;
  const left = 10; const right = 10; const top = 18; const bottom = height - 30;
  const plotWidth = width - left - right; const plotHeight = bottom - top;
  const values = view.points.map((point) => point.value); const min = Math.min(...values); const max = Math.max(...values); const pad = Math.max((max - min) * 0.08, 0.01);
  const low = min - pad; const high = max + pad; const range = high - low || 1;
  const firstTimestamp = view.period === "CUSTOM" ? view.startAt ?? view.points[0].timestamp : view.points[0].timestamp; const lastTimestamp = view.period === "CUSTOM" ? view.endAt ?? view.points.at(-1)!.timestamp : view.points.at(-1)!.timestamp; const timeRange = Math.max(1, lastTimestamp - firstTimestamp);
  const points = view.points.map((point) => ({ x: left + ((point.timestamp - firstTimestamp) / timeRange) * plotWidth, y: top + (1 - (point.value - low) / range) * plotHeight }));
  const linePath = points.length === 1 ? `M ${points[0].x} ${points[0].y}` : monotonePath(points); const areaPath = points.length === 1 ? "" : `${linePath} L ${points[points.length - 1].x} ${bottom} L ${points[0].x} ${bottom} Z`;
  return { width, height, left, top, bottom, plotWidth, plotHeight, points, linePath, areaPath, domainStartAt: firstTimestamp, domainEndAt: lastTimestamp };
}

function monotonePath(points: { x: number; y: number }[]): string {
  const intervals = points.slice(0, -1).map((point, index) => ({ h: Math.max(Number.EPSILON, points[index + 1].x - point.x), d: (points[index + 1].y - point.y) / Math.max(Number.EPSILON, points[index + 1].x - point.x) }));
  const slopes = new Array<number>(points.length).fill(0);
  slopes[0] = endpointSlope(intervals[0].h, intervals[1]?.h ?? intervals[0].h, intervals[0].d, intervals[1]?.d ?? intervals[0].d);
  slopes[slopes.length - 1] = endpointSlope(intervals[intervals.length - 1].h, intervals[intervals.length - 2]?.h ?? intervals[intervals.length - 1].h, intervals[intervals.length - 1].d, intervals[intervals.length - 2]?.d ?? intervals[intervals.length - 1].d);
  for (let index = 1; index < points.length - 1; index += 1) {
    const left = intervals[index - 1]; const right = intervals[index];
    if (left.d * right.d <= 0) continue;
    const weightLeft = (2 * right.h + left.h) / (left.h + right.h); const weightRight = (right.h + 2 * left.h) / (left.h + right.h);
    slopes[index] = (weightLeft + weightRight) / (weightLeft / left.d + weightRight / right.d);
  }
  return points.slice(0, -1).reduce((path, point, index) => {
    const next = points[index + 1]; const dx = (next.x - point.x) / 3;
    return `${path} C ${point.x + dx} ${point.y + slopes[index] * dx}, ${next.x - dx} ${next.y - slopes[index + 1] * dx}, ${next.x} ${next.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function endpointSlope(h0: number, h1: number, d0: number, d1: number): number {
  const slope = ((2 * h0 + h1) * d0 - h0 * d1) / Math.max(Number.EPSILON, h0 + h1);
  if (Math.sign(slope) !== Math.sign(d0)) return 0;
  if (Math.sign(d0) !== Math.sign(d1) && Math.abs(slope) > Math.abs(3 * d0)) return 3 * d0;
  return slope;
}

/** 将接口累计 trade_pnl 转成官方个人页的周期展示值。 */
export function buildWalletPnlView(points: WalletPnlPoint[], period: WalletPnlPeriod, asOf = Date.now(), historyStartTimestamp?: number): WalletPnlView {
  const normalized = normalizePoints(points);
  if (!normalized.length) return emptyView(period);
  const reference = asOf;
  const windowStart = period === "YTD"
    ? localYearStart(reference)
    : period === "ALL"
      ? Number.NEGATIVE_INFINITY
      : reference - (PERIOD_MS[period] ?? 0);
  const filtered = normalized.filter((point) => point.timestamp * 1000 >= windowStart && point.timestamp * 1000 <= reference);
  if (!filtered.length) return emptyView(period);
  const selected = filtered;
  const first = selected[0];
  const last = selected[selected.length - 1];
  const historyStart = historyStartTimestamp && Number.isFinite(historyStartTimestamp) ? historyStartTimestamp * 1000 : normalized[0].timestamp * 1000;
  const historyMs = Math.max(0, reference - historyStart);
  const thresholdMs = period === "YTD" ? reference - localYearStart(reference) : SHORT_HISTORY_THRESHOLD_MS[period] ?? 0;
  const absolute = period === "ALL" || selected.length < 2 || historyMs < thresholdMs;
  const amount = selected.length < 2 ? null : absolute ? last.tradePnl : last.tradePnl - first.tradePnl;
  return {
    period,
    points: selected.map((point) => ({ ...point, value: absolute ? point.tradePnl : point.tradePnl - first.tradePnl })),
    amount,
    absolute,
    baseline: absolute ? null : first.tradePnl,
    startAt: first.timestamp,
    endAt: last.timestamp,
  };
}

export function normalizePoints(points: WalletPnlPoint[]): WalletPnlPoint[] {
  const byTimestamp = new Map<number, WalletPnlPoint>();
  for (const point of points) {
    if (!Number.isSafeInteger(point.timestamp) || point.timestamp <= 0 || !Number.isFinite(point.tradePnl)) continue;
    const previous = byTimestamp.get(point.timestamp);
    if (previous && previous.tradePnl !== point.tradePnl) throw new Error("官方钱包盈亏接口返回了冲突的重复时间点");
    byTimestamp.set(point.timestamp, point);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function localYearStart(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), 0, 1).getTime();
}

function emptyView(period: WalletPnlSelection): WalletPnlView {
  return { period, points: [], amount: null, absolute: period === "ALL", baseline: null, startAt: null, endAt: null };
}


/** Calendar dates belong to the browser timezone, including DST day lengths. */
export function walletPnlLocalDate(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function walletPnlLocalHour(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${walletPnlLocalDate(timestamp)}T${String(date.getHours()).padStart(2, "0")}:00`;
}

export function formatWalletPnlOffset(timestamp: number): string {
  const offset = -new Date(timestamp).getTimezoneOffset();
  return `UTC${offset < 0 ? "−" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}

/** Returns both instants for a repeated DST hour; nonexistent hours have no candidates. */
export function walletPnlHourCandidates(value: string): number[] {
  const match = /^([1-9]\d{3})-(\d{2})-(\d{2})T(\d{2}):00$/.exec(value);
  if (!match) return [];
  const [year, month, day, hour] = match.slice(1).map(Number);
  const first = new Date(year, month - 1, day, hour).getTime();
  const matches = (timestamp: number) => { const d = new Date(timestamp); return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day && d.getHours() === hour && d.getMinutes() === 0; };
  if (!matches(first)) return [];
  const candidates: number[] = [];
  for (let delta = -3 * 60; delta <= 3 * 60; delta += 15) { const timestamp = first + delta * 60_000; if (matches(timestamp)) candidates.push(timestamp); }
  return candidates;
}

export function validateWalletPnlRange(startDate: string, endDate: string, now = Date.now(), selected: { startMs?: number; endMs?: number } = {}): { range: WalletPnlCustomRange; error?: never } | { error: string; range?: never } {
  if (!startDate || !endDate) return { error: "请选择开始时间和结束时间。" };
  if (![startDate, endDate].every(value => /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:00$/.test(value))) return { error: "请选择日期和小时，时间仅支持整点。" };
  const starts = walletPnlHourCandidates(startDate), ends = walletPnlHourCandidates(endDate);
  if (!starts.length || !ends.length) return { error: "所选日期或小时在本地时区不存在，请重新选择。" };
  if ((starts.length > 1 && !starts.includes(selected.startMs ?? NaN)) || (ends.length > 1 && !ends.includes(selected.endMs ?? NaN))) return { error: "该本地小时重复，请明确选择对应的时区偏移。" };
  const startMs = starts.length === 1 ? starts[0] : selected.startMs!, endMs = ends.length === 1 ? ends[0] : selected.endMs!;
  if (startMs >= endMs) return { error: "结束时间必须晚于开始时间。" };
  if (endMs > now) return { error: "结束时间不能晚于当前时间。" };
  return { range: { startDate, endDate, startMs, endMs, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, startOffset: formatWalletPnlOffset(startMs), endOffset: formatWalletPnlOffset(endMs) } };
}

/** Use the official hourly grid, choosing only the window that covers the requested start. */
export function chooseCustomWalletPnlQuery(range: WalletPnlCustomRange, asOf = Date.now(), historyStartTimestamp?: number): WalletPnlQuery {
  const hours = Math.max(0, (asOf - range.startMs) / 3_600_000);
  const interval = hours <= 24 ? "1d" : hours <= 7 * 24 ? "1w" : hours <= 30 * 24 ? "1m" : "all";
  if (interval === "all" && historyStartTimestamp !== undefined && (asOf / 1000 - historyStartTimestamp) / 3600 + 1 > 10_000) throw new Error("该历史范围超出官方小时序列的读取预算；可查看近30天小时数据或使用长期快捷周期。");
  return { interval, fidelity: "1h" };
}

/** Rebase only real samples inside the selection; axes use those same sample times. */
export function buildCustomWalletPnlView(points: WalletPnlPoint[], range: WalletPnlCustomRange, asOf = Date.now()): WalletPnlView {
  const view = emptyView("CUSTOM");
  if (!Number.isFinite(asOf) || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.startMs >= range.endMs || range.endMs > asOf) return view;
  const selected = normalizePoints(points).filter(point => point.timestamp * 1000 >= range.startMs && point.timestamp * 1000 <= range.endMs);
  if (selected.length < 2) return { ...view, error: "所选区间内不足两个官方采样点，请扩大时间范围。" };
  const first = selected[0], last = selected.at(-1)!;
  return { ...view, absolute: false, baseline: first.tradePnl, baselineAt: first.timestamp, endSampleAt: last.timestamp,
    startAt: first.timestamp, endAt: last.timestamp,
    points: selected.map(point => ({ ...point, value: point.tradePnl - first.tradePnl })),
    amount: last.tradePnl - first.tradePnl };
}
