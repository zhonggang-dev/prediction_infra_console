"use client";

import { useMemo, useState } from "react";
import type { DailyPnLPoint, DailyPnLReport } from "../lib/types";

type PnLSeries = {
  key: string;
  executionAccountId: string;
  modelId: string;
  strategyId: string;
  points: Map<string, DailyPnLPoint>;
  total: number;
};

type PnLChart = { days: string[]; rows: PnLSeries[]; maxAbs: number };

/** 实盘页的 UTC 日级收益视图；只展示账本已实现盈亏，不混入当前浮盈。 */
export function DailyPnLDashboard({ report, loading, days, onDays, preview = false }: { report?: DailyPnLReport; loading: boolean; days: number; onDays: (days: number) => void; preview?: boolean }) {
  const chart = useMemo(() => buildPnLChart(report), [report]);
  const today = chart.rows
    .map((row) => ({ ...row, point: row.points.get(report?.toDay ?? "") }))
    .sort((left, right) => sign(right.point?.realizedPnl) - sign(left.point?.realizedPnl));
  const todayNet = today.reduce((total, row) => total + sign(row.point?.realizedPnl), 0);
  const todayTrades = today.reduce((total, row) => total + (row.point?.closedTradeCount ?? 0), 0);
  const profitable = today.filter((row) => sign(row.point?.realizedPnl) > 0).length;
  const best = today.find((row) => sign(row.point?.realizedPnl) > 0);
  const worst = [...today].reverse().find((row) => sign(row.point?.realizedPnl) < 0);

  return <section className="section pnl-dashboard" aria-labelledby="daily-pnl-title">
    <div className="section-head pnl-section-head">
      <div><div className="pnl-title-line"><h2 className="section-title" id="daily-pnl-title">每日钱包策略盈亏</h2>{preview && <span className="pnl-preview-chip">预览数据</span>}</div><p className="section-caption">净已实现盈亏 · 手续费已计入 · UTC 自然日</p></div>
      <div className="pnl-range" aria-label="盈亏时间范围">{[7, 14, 30].map((value) => <button key={value} aria-pressed={days === value} className={days === value ? "active" : ""} onClick={() => onDays(value)}>{value} 天</button>)}</div>
    </div>
    {loading ? <DailyPnLSkeleton /> : !report || !chart.rows.length ? <div className="panel pnl-empty"><strong>还没有可展示的钱包策略</strong><span>启用策略绑定后，即使当天没有平仓也会在这里显示 $0.00。</span></div> : <>
      <div className="pnl-hero">
        <div className="pnl-net"><span>今日净已实现</span><strong className={todayNet < 0 ? "negative" : "positive"}>{signedMoney(String(todayNet))}</strong><small>{today.length} 个钱包策略 · {todayTrades} 笔平仓</small></div>
        <div className="pnl-hero-facts">
          <PnlFact label="盈利策略" value={`${profitable} / ${today.length}`} />
          <PnlFact label="今日领跑" value={best ? best.strategyId : "—"} meta={best ? signedMoney(best.point?.realizedPnl) : "暂无盈利"} tone="positive" />
          <PnlFact label="今日亏损最大" value={worst ? worst.strategyId : "—"} meta={worst ? signedMoney(worst.point?.realizedPnl) : "暂无亏损"} tone="negative" />
        </div>
      </div>
      <div className="pnl-layout">
        <DailyPnLLineChart chart={chart} report={report} />
        <div className="panel pnl-today-panel">
          <div className="pnl-panel-head"><div><strong>今日钱包明细</strong><span>{report.toDay} · UTC</span></div><span className="pnl-live-dot"><i />{preview ? "预览数据" : "账本数据"}</span></div>
          <div className="pnl-today-list">{today.map((row, index) => { const value = sign(row.point?.realizedPnl); return <div className="pnl-today-item" key={row.key}>
            <span className="pnl-rank">{String(index + 1).padStart(2, "0")}</span><div><strong>{row.strategyId}</strong><span>{row.modelId}</span><small title={row.executionAccountId}>{shortID(row.executionAccountId, 9)}</small></div><div><strong className={value < 0 ? "negative" : value > 0 ? "positive" : "muted"}>{signedMoney(String(value))}</strong><small>{row.point?.closedTradeCount ? `${row.point.closedTradeCount} 笔平仓 · ${quantity(row.point.closedShares)} shares` : "今日无平仓"}</small></div>
          </div>; })}</div>
        </div>
      </div>
    </>}
  </section>;
}

const CHART_WIDTH = 900;
const CHART_HEIGHT = 322;
const CHART_PAD = { top: 24, right: 24, bottom: 42, left: 70 };
const SERIES_COLORS = ["#7ee8c4", "#ffbd69", "#8cabff", "#d894ff", "#ff858d", "#50d7ec"];

function DailyPnLLineChart({ chart, report }: { chart: PnLChart; report: DailyPnLReport }) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const [hoverIndex, setHoverIndex] = useState(() => Math.max(0, chart.days.length - 1));
  const visibleRows = chart.rows.filter((row) => !hiddenSeries.has(row.key));
  const safeHoverIndex = Math.min(Math.max(0, hoverIndex), Math.max(0, chart.days.length - 1));
  const hoveredDay = chart.days[safeHoverIndex] ?? report.toDay;
  const maxVisibleValue = visibleRows.reduce((maximum, row) => Math.max(maximum, ...chart.days.map((day) => Math.abs(sign(row.points.get(day)?.realizedPnl)))), 0);
  const extent = niceExtent(maxVisibleValue);
  const plotWidth = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right;
  const plotHeight = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const x = (index: number) => CHART_PAD.left + (chart.days.length <= 1 ? plotWidth / 2 : index / (chart.days.length - 1) * plotWidth);
  const y = (value: number) => CHART_PAD.top + (extent - value) / (extent * 2) * plotHeight;
  const zeroY = y(0);
  const lineData = visibleRows.map((row) => ({ row, points: chart.days.map((day, index) => ({ x: x(index), y: y(sign(row.points.get(day)?.realizedPnl)), value: sign(row.points.get(day)?.realizedPnl) })) }));
  const labelStep = Math.max(1, Math.ceil(chart.days.length / 7));
  const hoverLeft = x(safeHoverIndex) / CHART_WIDTH * 100;

  const toggleSeries = (key: string) => setHiddenSeries((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else if (chart.rows.length - next.size > 1) next.add(key);
    return next;
  });
  const trackPointer = (event: React.PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX - bounds.left) / bounds.width * CHART_WIDTH;
    const ratio = Math.min(1, Math.max(0, (svgX - CHART_PAD.left) / plotWidth));
    setHoverIndex(Math.round(ratio * Math.max(0, chart.days.length - 1)));
  };

  return <div className="panel pnl-line-panel">
    <div className="pnl-chart-head">
      <div><span className="pnl-chart-kicker"><i /> WALLET × STRATEGY</span><strong>每日净已实现 P&amp;L</strong><small>{dateRange(report.fromDay, report.toDay)} · 悬浮查看单日归因</small></div>
      <div className="pnl-chart-signal"><i /><span>UTC 日线</span></div>
    </div>
    <div className="pnl-series-legend" aria-label="钱包策略曲线开关">
      {chart.rows.map((row, index) => {
        const active = !hiddenSeries.has(row.key);
        return <button type="button" key={row.key} aria-pressed={active} onClick={() => toggleSeries(row.key)} title={`${row.executionAccountId} · ${row.modelId}`}>
          <i style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }} /><span><strong>{row.strategyId}</strong><small>{shortID(row.executionAccountId, 5)}</small></span><b className={row.total < 0 ? "negative" : "positive"}>{signedMoney(String(row.total))}</b>
        </button>;
      })}
    </div>
    <div className="pnl-chart-scroll">
      <div className="pnl-chart-stage">
        <svg className="pnl-line-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={`从 ${report.fromDay} 到 ${report.toDay} 的每日钱包策略已实现盈亏折线图`}>
          <defs>
            <linearGradient id="pnl-leading-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7ee8c4" stopOpacity=".26" /><stop offset=".62" stopColor="#7ee8c4" stopOpacity=".06" /><stop offset="1" stopColor="#7ee8c4" stopOpacity="0" /></linearGradient>
          </defs>
          {[-1, -.5, 0, .5, 1].map((tick) => { const value = tick * extent; return <g key={tick}><line className={tick === 0 ? "pnl-zero-line" : "pnl-grid-line"} x1={CHART_PAD.left} x2={CHART_WIDTH - CHART_PAD.right} y1={y(value)} y2={y(value)} /><text className={tick === 0 ? "pnl-axis-zero" : ""} x={CHART_PAD.left - 13} y={y(value) + 4} textAnchor="end">{axisMoney(value)}</text></g>; })}
          {chart.days.map((day, index) => (index % labelStep === 0 || index === chart.days.length - 1) && <g key={day}><line className="pnl-x-tick" x1={x(index)} x2={x(index)} y1={CHART_PAD.top} y2={CHART_HEIGHT - CHART_PAD.bottom} /><text x={x(index)} y={CHART_HEIGHT - 15} textAnchor="middle">{shortDay(day)}</text></g>)}
          {lineData[0] && <path className="pnl-leading-area" d={areaPath(lineData[0].points, zeroY)} />}
          {lineData.map(({ row, points }) => { const originalIndex = chart.rows.findIndex((item) => item.key === row.key); const color = SERIES_COLORS[originalIndex % SERIES_COLORS.length]; const path = smoothPath(points); return <g key={row.key}>
            <path className="pnl-line-glow" d={path} stroke={color} />
            <path className="pnl-line-path" d={path} stroke={color} />
            {points.map((point, index) => <circle key={chart.days[index]} className={index === safeHoverIndex ? "pnl-line-point active" : "pnl-line-point"} cx={point.x} cy={point.y} r={index === safeHoverIndex ? 4.2 : 2.3} fill={color} />)}
          </g>; })}
          <line className="pnl-hover-guide" x1={x(safeHoverIndex)} x2={x(safeHoverIndex)} y1={CHART_PAD.top} y2={CHART_HEIGHT - CHART_PAD.bottom} />
          <rect className="pnl-chart-hit" x={CHART_PAD.left} y={CHART_PAD.top} width={plotWidth} height={plotHeight} onPointerMove={trackPointer} onPointerLeave={() => setHoverIndex(Math.max(0, chart.days.length - 1))} />
        </svg>
        <div className={`pnl-chart-tooltip ${safeHoverIndex > chart.days.length / 2 ? "align-right" : ""}`} style={{ left: `${hoverLeft}%` }} role="status">
          <strong>{hoveredDay} <span>UTC</span></strong>
          {visibleRows.map((row) => { const originalIndex = chart.rows.findIndex((item) => item.key === row.key); const point = row.points.get(hoveredDay); const value = sign(point?.realizedPnl); return <div key={row.key}><i style={{ backgroundColor: SERIES_COLORS[originalIndex % SERIES_COLORS.length] }} /><span>{row.strategyId}<small>{shortID(row.executionAccountId, 4)}</small></span><b className={value < 0 ? "negative" : value > 0 ? "positive" : ""}>{signedMoney(String(value))}</b><em>{point?.closedTradeCount ? `${point.closedTradeCount} 笔` : "无平仓"}</em></div>; })}
        </div>
      </div>
    </div>
  </div>;
}

function PnlFact({ label, value, meta, tone = "" }: { label: string; value: string; meta?: string; tone?: string }) {
  return <div><span>{label}</span><strong>{value}</strong>{meta && <small className={tone}>{meta}</small>}</div>;
}

function DailyPnLSkeleton() {
  return <div className="pnl-skeleton"><div className="pnl-hero"><div className="skeleton" /><div className="skeleton" /></div><div className="pnl-layout"><div className="panel panel-pad"><div className="skeleton tall" /></div><div className="panel panel-pad"><div className="skeleton tall" /></div></div></div>;
}

function buildPnLChart(report?: DailyPnLReport): PnLChart {
  if (!report) return { days: [], rows: [], maxAbs: 0 };
  const daySet = new Set<string>();
  const series = new Map<string, PnLSeries>();
  let maxAbs = 0;
  for (const point of report.items) {
    daySet.add(point.day);
    const key = `${point.executionAccountId}\u0000${point.modelId}\u0000${point.strategyId}`;
    const row = series.get(key) ?? { key, executionAccountId: point.executionAccountId, modelId: point.modelId, strategyId: point.strategyId, points: new Map(), total: 0 };
    row.points.set(point.day, point);
    row.total += sign(point.realizedPnl);
    maxAbs = Math.max(maxAbs, Math.abs(sign(point.realizedPnl)));
    series.set(key, row);
  }
  const rows = [...series.values()].sort((left, right) => right.total - left.total || left.executionAccountId.localeCompare(right.executionAccountId));
  return { days: [...daySet].sort(), rows, maxAbs };
}

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
const sign = (value?: string) => Number(value ?? 0) || 0;
const signedMoney = (value?: string) => `${sign(value) > 0 ? "+" : ""}${moneyFormatter.format(sign(value))}`;
const quantity = (value: string) => quantityFormatter.format(sign(value));
const utcDay = (value: string) => new Date(`${value}T00:00:00Z`);
const shortDay = (value: string) => shortDateFormatter.format(utcDay(value));
const weekday = (value: string) => weekdayFormatter.format(utcDay(value));
const dateRange = (from: string, to: string) => `${shortDay(from)} — ${shortDay(to)} · ${weekday(to)}更新`;
const shortID = (value: string, edge = 8) => value.length > edge * 2 + 1 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value;
