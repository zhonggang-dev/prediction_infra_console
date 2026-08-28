"use client";

import { useMemo, useState } from "react";
import type { DailyPnLReport } from "../lib/types";

type WalletDailyPnL = {
  realizedPnl: number;
  closedTradeCount: number;
  closedShares: number;
};

type WalletPnLSeries = {
  key: string;
  executionAccountId: string;
  modelIds: string[];
  strategyIds: string[];
  points: Map<string, WalletDailyPnL>;
  total: number;
};

type PnLChart = { days: string[]; rows: WalletPnLSeries[] };

/** 实盘页的 UTC 日级收益视图；按钱包聚合账本收益，支持多钱包累计 PnL 对比。 */
export function DailyPnLDashboard({ report, loading, days, onDays, preview = false }: { report?: DailyPnLReport; loading: boolean; days: number; onDays: (days: number) => void; preview?: boolean }) {
  const allWalletsChart = useMemo(() => buildPnLChart(report), [report]);
  const walletIDs = allWalletsChart.rows.map((row) => row.executionAccountId);
  const [selectionOverride, setSelectionOverride] = useState<string[] | null>(null);
  const selectedWalletIDs = selectionOverride?.filter((id) => walletIDs.includes(id)) ?? walletIDs;
  const effectiveWalletIDs = selectedWalletIDs.length ? selectedWalletIDs : walletIDs;
  const selectedWalletSet = new Set(effectiveWalletIDs);
  const chart = { ...allWalletsChart, rows: allWalletsChart.rows.filter((row) => selectedWalletSet.has(row.executionAccountId)) };
  const today = chart.rows
    .map((row) => ({ ...row, point: row.points.get(report?.toDay ?? "") }))
    .sort((left, right) => numeric(right.point?.realizedPnl) - numeric(left.point?.realizedPnl));
  const todayNet = today.reduce((total, row) => total + numeric(row.point?.realizedPnl), 0);
  const todayTrades = today.reduce((total, row) => total + (row.point?.closedTradeCount ?? 0), 0);
  const profitable = today.filter((row) => numeric(row.point?.realizedPnl) > 0).length;
  const best = today.find((row) => numeric(row.point?.realizedPnl) > 0);
  const worst = [...today].reverse().find((row) => numeric(row.point?.realizedPnl) < 0);

  const toggleWallet = (executionAccountId: string) => {
    const next = new Set(effectiveWalletIDs);
    if (next.has(executionAccountId)) {
      if (next.size === 1) return;
      next.delete(executionAccountId);
    } else {
      next.add(executionAccountId);
    }
    const nextIDs = walletIDs.filter((id) => next.has(id));
    setSelectionOverride(nextIDs.length === walletIDs.length ? null : nextIDs);
  };

  return <section className="section pnl-dashboard" aria-labelledby="daily-pnl-title">
    <div className="section-head pnl-section-head">
      <div><div className="pnl-title-line"><h2 className="section-title" id="daily-pnl-title">钱包 PnL 对比</h2>{preview && <span className="pnl-preview-chip">预览数据</span>}</div><p className="section-caption">多选钱包比较累计已实现 PnL · 手续费已计入 · UTC 自然日</p></div>
      <div className="pnl-range" aria-label="盈亏时间范围">{[7, 14, 30].map((value) => <button key={value} aria-pressed={days === value} className={days === value ? "active" : ""} onClick={() => onDays(value)}>{value} 天</button>)}</div>
    </div>
    {loading ? <DailyPnLSkeleton /> : !report || !allWalletsChart.rows.length ? <div className="panel pnl-empty"><strong>还没有可展示的钱包 PnL</strong><span>启用策略绑定后，即使当天没有平仓也会在这里显示 $0.00。</span></div> : <>
      <WalletComparisonSelector rows={allWalletsChart.rows} selectedWalletIDs={selectedWalletSet} onToggle={toggleWallet} onSelectAll={() => setSelectionOverride(null)} />
      <div className="pnl-hero">
        <div className="pnl-net"><span>今日净已实现</span><strong className={todayNet < 0 ? "negative" : "positive"}>{signedMoney(todayNet)}</strong><small>{today.length} 个钱包 · {todayTrades} 笔平仓</small></div>
        <div className="pnl-hero-facts">
          <PnlFact label="盈利钱包" value={`${profitable} / ${today.length}`} />
          <PnlFact label="今日领跑钱包" value={best ? shortID(best.executionAccountId, 6) : "—"} meta={best ? signedMoney(best.point?.realizedPnl) : "暂无盈利"} tone="positive" />
          <PnlFact label="今日亏损最大钱包" value={worst ? shortID(worst.executionAccountId, 6) : "—"} meta={worst ? signedMoney(worst.point?.realizedPnl) : "暂无亏损"} tone="negative" />
        </div>
      </div>
      <div className="pnl-layout">
        <WalletPnLLineChart chart={chart} report={report} />
        <div className="panel pnl-today-panel">
          <div className="pnl-panel-head"><div><strong>今日钱包明细</strong><span>{report.toDay} · UTC</span></div><span className="pnl-live-dot"><i />{preview ? "预览数据" : "账本数据"}</span></div>
          <div className="pnl-today-list">{today.map((row, index) => { const value = numeric(row.point?.realizedPnl); return <div className="pnl-today-item" key={row.key}>
            <span className="pnl-rank">{String(index + 1).padStart(2, "0")}</span><div><strong title={row.executionAccountId}>{shortID(row.executionAccountId, 8)}</strong><span>{listLabel(row.strategyIds)}</span><small>{listLabel(row.modelIds)}</small></div><div><strong className={value < 0 ? "negative" : value > 0 ? "positive" : "muted"}>{signedMoney(value)}</strong><small>{row.point?.closedTradeCount ? `${row.point.closedTradeCount} 笔平仓 · ${quantity(row.point.closedShares)} shares` : "今日无平仓"}</small></div>
          </div>; })}</div>
        </div>
      </div>
    </>}
  </section>;
}

function WalletComparisonSelector({ rows, selectedWalletIDs, onToggle, onSelectAll }: { rows: WalletPnLSeries[]; selectedWalletIDs: Set<string>; onToggle: (executionAccountId: string) => void; onSelectAll: () => void }) {
  const allSelected = selectedWalletIDs.size === rows.length;
  return <div className="panel wallet-comparison-selector">
    <div className="wallet-comparison-copy"><span>COMPARE WALLETS</span><strong>选择要同时展示的钱包</strong><small>至少保留一个钱包，曲线统一从区间起点 $0 开始累计。</small></div>
    <div className="wallet-comparison-options" role="group" aria-label="选择钱包 PnL 对比">
      {rows.map((row) => { const active = selectedWalletIDs.has(row.executionAccountId); const index = stableColorIndex(rows.map((item) => item.executionAccountId), row.executionAccountId); return <button type="button" className="wallet-comparison-option" key={row.key} aria-pressed={active} onClick={() => onToggle(row.executionAccountId)} title={row.executionAccountId}>
        <i className={active ? "selected" : ""}>{active ? "✓" : ""}</i><span><strong>{shortID(row.executionAccountId, 7)}</strong><small>{listLabel(row.strategyIds)}</small></span><b style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }} />
      </button>; })}
    </div>
    <button type="button" className="wallet-select-all" onClick={onSelectAll} disabled={allSelected}>全选 <span>{selectedWalletIDs.size}/{rows.length}</span></button>
  </div>;
}

const CHART_WIDTH = 900;
const CHART_HEIGHT = 322;
const CHART_PAD = { top: 24, right: 24, bottom: 42, left: 70 };
const SERIES_COLORS = ["#7ee8c4", "#ffbd69", "#8cabff", "#d894ff", "#ff858d", "#50d7ec"];

function WalletPnLLineChart({ chart, report }: { chart: PnLChart; report: DailyPnLReport }) {
  const [hoverIndex, setHoverIndex] = useState(() => Math.max(0, chart.days.length - 1));
  const safeHoverIndex = Math.min(Math.max(0, hoverIndex), Math.max(0, chart.days.length - 1));
  const hoveredDay = chart.days[safeHoverIndex] ?? report.toDay;
  const plotWidth = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right;
  const plotHeight = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const x = (index: number) => CHART_PAD.left + (chart.days.length <= 1 ? plotWidth / 2 : index / (chart.days.length - 1) * plotWidth);
  const cumulativeRows = chart.rows.map((row) => {
    let cumulative = 0;
    return { row, points: chart.days.map((day, index) => { cumulative += numeric(row.points.get(day)?.realizedPnl); return { x: x(index), value: cumulative }; }) };
  });
  const maximum = cumulativeRows.reduce((extent, row) => Math.max(extent, ...row.points.map((point) => Math.abs(point.value))), 0);
  const extent = niceExtent(maximum);
  const y = (value: number) => CHART_PAD.top + (extent - value) / (extent * 2) * plotHeight;
  const zeroY = y(0);
  const lineData = cumulativeRows.map(({ row, points }) => ({ row, points: points.map((point) => ({ ...point, y: y(point.value) })) }));
  const labelStep = Math.max(1, Math.ceil(chart.days.length / 7));
  const hoverLeft = x(safeHoverIndex) / CHART_WIDTH * 100;
  const trackPointer = (event: React.PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX - bounds.left) / bounds.width * CHART_WIDTH;
    const ratio = Math.min(1, Math.max(0, (svgX - CHART_PAD.left) / plotWidth));
    setHoverIndex(Math.round(ratio * Math.max(0, chart.days.length - 1)));
  };

  return <div className="panel pnl-line-panel">
    <div className="pnl-chart-head">
      <div><span className="pnl-chart-kicker"><i /> WALLET COMPARISON</span><strong>累计已实现 P&amp;L</strong><small>{dateRange(report.fromDay, report.toDay)} · 悬浮查看累计值与当日变动</small></div>
      <div className="pnl-chart-signal"><i /><span>{chart.rows.length} 条钱包曲线</span></div>
    </div>
    <div className="pnl-series-legend" aria-label="已选钱包曲线图例">
      {chart.rows.map((row) => { const originalIndex = colorIndex(report, row.executionAccountId); return <div className="pnl-series-item" key={row.key} title={row.executionAccountId}>
        <i style={{ backgroundColor: SERIES_COLORS[originalIndex % SERIES_COLORS.length] }} /><span><strong>{shortID(row.executionAccountId, 7)}</strong><small>{listLabel(row.strategyIds)}</small></span><b className={row.total < 0 ? "negative" : "positive"}>{signedMoney(row.total)}</b>
      </div>; })}
    </div>
    <div className="pnl-chart-scroll">
      <div className="pnl-chart-stage">
        <svg className="pnl-line-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={`从 ${report.fromDay} 到 ${report.toDay} 的多钱包累计已实现盈亏折线图`}>
          <defs>
            <linearGradient id="pnl-leading-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7ee8c4" stopOpacity=".26" /><stop offset=".62" stopColor="#7ee8c4" stopOpacity=".06" /><stop offset="1" stopColor="#7ee8c4" stopOpacity="0" /></linearGradient>
          </defs>
          {[-1, -.5, 0, .5, 1].map((tick) => { const value = tick * extent; return <g key={tick}><line className={tick === 0 ? "pnl-zero-line" : "pnl-grid-line"} x1={CHART_PAD.left} x2={CHART_WIDTH - CHART_PAD.right} y1={y(value)} y2={y(value)} /><text className={tick === 0 ? "pnl-axis-zero" : ""} x={CHART_PAD.left - 13} y={y(value) + 4} textAnchor="end">{axisMoney(value)}</text></g>; })}
          {chart.days.map((day, index) => (index % labelStep === 0 || index === chart.days.length - 1) && <g key={day}><line className="pnl-x-tick" x1={x(index)} x2={x(index)} y1={CHART_PAD.top} y2={CHART_HEIGHT - CHART_PAD.bottom} /><text x={x(index)} y={CHART_HEIGHT - 15} textAnchor="middle">{shortDay(day)}</text></g>)}
          {lineData[0] && <path className="pnl-leading-area" d={areaPath(lineData[0].points, zeroY)} />}
          {lineData.map(({ row, points }) => { const index = colorIndex(report, row.executionAccountId); const color = SERIES_COLORS[index % SERIES_COLORS.length]; const path = smoothPath(points); return <g key={row.key}>
            <path className="pnl-line-glow" d={path} stroke={color} />
            <path className="pnl-line-path" d={path} stroke={color} />
            {points.map((point, pointIndex) => <circle key={chart.days[pointIndex]} className={pointIndex === safeHoverIndex ? "pnl-line-point active" : "pnl-line-point"} cx={point.x} cy={point.y} r={pointIndex === safeHoverIndex ? 4.2 : 2.3} fill={color} />)}
          </g>; })}
          <line className="pnl-hover-guide" x1={x(safeHoverIndex)} x2={x(safeHoverIndex)} y1={CHART_PAD.top} y2={CHART_HEIGHT - CHART_PAD.bottom} />
          <rect className="pnl-chart-hit" x={CHART_PAD.left} y={CHART_PAD.top} width={plotWidth} height={plotHeight} onPointerMove={trackPointer} onPointerLeave={() => setHoverIndex(Math.max(0, chart.days.length - 1))} />
        </svg>
        <div className={`pnl-chart-tooltip ${safeHoverIndex > chart.days.length / 2 ? "align-right" : ""}`} style={{ left: `${hoverLeft}%` }} role="status">
          <strong>{hoveredDay} <span>UTC · 累计</span></strong>
          {lineData.map(({ row, points }) => { const index = colorIndex(report, row.executionAccountId); const daily = row.points.get(hoveredDay); const cumulative = points[safeHoverIndex]?.value ?? 0; return <div key={row.key}><i style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }} /><span>{shortID(row.executionAccountId, 5)}<small>{listLabel(row.strategyIds)}</small></span><b className={cumulative < 0 ? "negative" : cumulative > 0 ? "positive" : ""}>{signedMoney(cumulative)}</b><em>当日 {signedMoney(daily?.realizedPnl)} · {daily?.closedTradeCount ?? 0} 笔</em></div>; })}
        </div>
      </div>
    </div>
  </div>;
}

function PnlFact({ label, value, meta, tone = "" }: { label: string; value: string; meta?: string; tone?: string }) {
  return <div><span>{label}</span><strong>{value}</strong>{meta && <small className={tone}>{meta}</small>}</div>;
}

function DailyPnLSkeleton() {
  return <div className="pnl-skeleton"><div className="skeleton wallet-selector-skeleton" /><div className="pnl-hero"><div className="skeleton" /><div className="skeleton" /></div><div className="pnl-layout"><div className="panel panel-pad"><div className="skeleton tall" /></div><div className="panel panel-pad"><div className="skeleton tall" /></div></div></div>;
}

function buildPnLChart(report?: DailyPnLReport): PnLChart {
  if (!report) return { days: [], rows: [] };
  const daySet = new Set<string>();
  const series = new Map<string, { executionAccountId: string; modelIds: Set<string>; strategyIds: Set<string>; points: Map<string, WalletDailyPnL> }>();
  for (const point of report.items) {
    daySet.add(point.day);
    const row = series.get(point.executionAccountId) ?? { executionAccountId: point.executionAccountId, modelIds: new Set<string>(), strategyIds: new Set<string>(), points: new Map<string, WalletDailyPnL>() };
    const daily = row.points.get(point.day) ?? { realizedPnl: 0, closedTradeCount: 0, closedShares: 0 };
    daily.realizedPnl += numeric(point.realizedPnl);
    daily.closedTradeCount += point.closedTradeCount;
    daily.closedShares += numeric(point.closedShares);
    row.points.set(point.day, daily);
    row.modelIds.add(point.modelId);
    row.strategyIds.add(point.strategyId);
    series.set(point.executionAccountId, row);
  }
  const rows = [...series.values()].map((row) => ({
    key: row.executionAccountId,
    executionAccountId: row.executionAccountId,
    modelIds: [...row.modelIds].sort(),
    strategyIds: [...row.strategyIds].sort(),
    points: row.points,
    total: [...row.points.values()].reduce((sum, point) => sum + point.realizedPnl, 0),
  })).sort((left, right) => right.total - left.total || left.executionAccountId.localeCompare(right.executionAccountId));
  return { days: [...daySet].sort(), rows };
}

function colorIndex(report: DailyPnLReport, executionAccountId: string) {
  return stableColorIndex(report.items.map((point) => point.executionAccountId), executionAccountId);
}

function stableColorIndex(executionAccountIds: string[], executionAccountId: string) { return [...new Set(executionAccountIds)].sort().indexOf(executionAccountId); }

function smoothPath(points: { x: number; y: number }[]) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.reduce((path, point, index) => {
    if (!index) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
  }, "");
}
function areaPath(points: { x: number; y: number }[], zeroY: number) { return points.length ? `${smoothPath(points)} L ${points[points.length - 1].x} ${zeroY} L ${points[0].x} ${zeroY} Z` : ""; }
function niceExtent(value: number) { if (value <= 0) return 1; const magnitude = 10 ** Math.floor(Math.log10(value)); return Math.ceil(value / magnitude * 2) / 2 * magnitude; }
function axisMoney(value: number) { if (value === 0) return "$0"; const absolute = Math.abs(value); const amount = absolute >= 1000 ? `${(absolute / 1000).toFixed(1)}k` : absolute >= 10 ? absolute.toFixed(0) : absolute.toFixed(1); return `${value > 0 ? "+" : "−"}$${amount}`; }

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const quantityFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "UTC" });
const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" });
const numeric = (value?: string | number) => Number(value ?? 0) || 0;
const signedMoney = (value?: string | number) => `${numeric(value) > 0 ? "+" : ""}${moneyFormatter.format(numeric(value))}`;
const quantity = (value: string | number) => quantityFormatter.format(numeric(value));
const utcDay = (value: string) => new Date(`${value}T00:00:00Z`);
const shortDay = (value: string) => shortDateFormatter.format(utcDay(value));
const weekday = (value: string) => weekdayFormatter.format(utcDay(value));
const dateRange = (from: string, to: string) => `${shortDay(from)} — ${shortDay(to)} · ${weekday(to)}更新`;
const shortID = (value: string, edge = 8) => value.length > edge * 2 + 1 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value;
const listLabel = (values: string[]) => values.join(" / ");
