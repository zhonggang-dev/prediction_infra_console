"use client";

/**
 * 回测结果的手写 SVG 图表（不引入图表库）：多折线 / 散点（含误差线与点大小）、条形 + 误差棒 + 参考线、热力图。
 * 风格沿用 DailyPnLDashboard / EdgeDistributionPanel 的手写 SVG 写法与站点配色。
 */

import { useMemo, useState } from "react";
import type { BarsSection, MatrixSection, SeriesLine, SeriesPoint, SeriesSection } from "../../lib/backtest-platform";
import { formatNumber } from "../../lib/backtest-table";

export const SERIES_COLORS = ["#1d8d75", "#4a78d4", "#a569c9", "#c9524a", "#2a9fb5", "#7c8c2f", "#8a6f5c", "#d98a1f"];
const MARKET_COLOR = "#F28E2B";

function colorFor(line: SeriesLine, index: number): string {
  if (line.color) return line.color;
  if (line.highlight) return MARKET_COLOR;
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

/** 同一 group（例如同一个 策略 × 模型 的 Realised / MTM 两条）共用一个颜色。 */
function groupIndexes(lines: SeriesLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) { const key = line.group ?? line.name; if (!map.has(key)) map.set(key, map.size); }
  return map;
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) { const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1; min -= pad; max += pad; }
  const raw = (max - min) / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function formatAxis(value: number, format: "money" | "number" | "percent" | undefined, span: number): string {
  const digits = span >= 10 ? 0 : span >= 1 ? 1 : span >= 0.1 ? 2 : 3;
  if (format === "money") return `${value < 0 ? "-" : ""}$${formatNumber(Math.abs(value), span >= 100 ? 0 : digits)}`;
  if (format === "percent") return `${formatNumber(value, digits)}%`;
  return formatNumber(value, digits);
}

/** 图例里的「最后一个值」：按量级取小数位，避免 0.03 显示成 0.0。 */
function formatLast(value: number, format: "money" | "number" | "percent" | undefined): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  if (format === "money") return `${value < 0 ? "-" : ""}$${formatNumber(abs, abs >= 100 ? 0 : 2)}`;
  return `${formatNumber(value, digits)}${format === "percent" ? "%" : ""}`;
}

function beijingTick(ms: number, withTime: boolean): string {
  const iso = new Date(ms + 8 * 3600 * 1000).toISOString();
  return withTime ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : iso.slice(5, 10);
}

const W = 900;
const PAD = { top: 20, right: 28, bottom: 44, left: 72 };

type Hover = { x: number; px: number } | undefined;

/** 多折线 / 散点图。点可带 size（点大小）、lower/upper（误差线）、lowSample（灰色空心点）。 */
export function SeriesChart({ section, height = 340, title, heading }: { section: SeriesSection; height?: number; title?: string; heading?: string }) {
  const [isolated, setIsolated] = useState<string>();
  const [hover, setHover] = useState<Hover>();
  const lines = section.series;
  const visible = lines.filter((line) => !isolated || line.name === isolated);
  const groups = useMemo(() => groupIndexes(lines), [lines]);
  const model = useMemo(() => {
    const pts = visible.flatMap((line) => line.points.filter((p) => p.y !== null));
    if (pts.length === 0) return undefined;
    const xs = pts.map((p) => p.x);
    const ys = [...pts.map((p) => p.y as number), ...pts.flatMap((p) => [p.lower, p.upper].filter((v): v is number => v !== undefined)), ...section.references.filter((r) => r.axis === "y" && r.value !== undefined).map((r) => r.value as number)];
    let xMin = Math.min(...xs); let xMax = Math.max(...xs);
    if (section.references.some((r) => r.axis === "diagonal")) { xMin = Math.min(xMin, 0); xMax = Math.max(xMax, 1); ys.push(0, 1); }
    if (xMin === xMax) { xMin -= 1; xMax += 1; }
    const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 5);
    return { xMin, xMax, yMin: yTicks[0], yMax: yTicks[yTicks.length - 1], yTicks };
  }, [visible, section.references]);

  if (!model) return <div className="bt-chart-empty" role="status">没有可绘制的数据点。</div>;
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (v: number) => PAD.left + (v - model.xMin) / (model.xMax - model.xMin) * plotW;
  const y = (v: number) => PAD.top + (model.yMax - v) / (model.yMax - model.yMin) * plotH;
  const isTime = section.xKind === "time";
  const xTicks = isTime
    ? Array.from({ length: 6 }, (_, i) => model.xMin + (model.xMax - model.xMin) * i / 5)
    : niceTicks(model.xMin, model.xMax, 6).filter((t) => t >= model.xMin - 1e-9 && t <= model.xMax + 1e-9);
  const withTime = isTime && model.xMax - model.xMin < 3 * 86400000;
  const sizeValues = visible.flatMap((line) => line.points.map((p) => p.size).filter((s): s is number => s !== undefined));
  const sizeMax = sizeValues.length ? Math.max(...sizeValues) : 0;
  const radius = (p: SeriesPoint) => p.size !== undefined && sizeMax > 0 ? 3 + 7 * Math.sqrt(p.size / sizeMax) : section.mode === "scatter" ? 4 : 2.2;

  const nearest = (line: SeriesLine, target: number) => {
    let best: SeriesPoint | undefined;
    for (const p of line.points) if (p.y !== null && (!best || Math.abs(p.x - target) < Math.abs(best.x - target))) best = p;
    return best;
  };
  const trackPointer = (event: React.PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX - bounds.left) / bounds.width * plotW + PAD.left;
    const value = model.xMin + Math.min(1, Math.max(0, (svgX - PAD.left) / plotW)) * (model.xMax - model.xMin);
    setHover({ x: value, px: svgX });
  };
  const hoverRows = hover ? visible.map((line) => ({ line, point: nearest(line, hover.x), index: lines.indexOf(line) })).filter((row) => row.point) : [];
  const hoverX = hoverRows.length ? hoverRows.reduce((best, row) => Math.abs((row.point as SeriesPoint).x - (hover as NonNullable<Hover>).x) < Math.abs(best - (hover as NonNullable<Hover>).x) ? (row.point as SeriesPoint).x : best, (hoverRows[0].point as SeriesPoint).x) : undefined;
  const xLabel = (v: number) => isTime ? beijingTick(v, true) : formatNumber(v, 3);

  return <div className="bt-chart">
    {heading && <strong className="bt-chart-title">{heading}</strong>}
    {lines.length > 1 && <div className="bt-legend" role="group" aria-label="图例：点击只看该曲线，再点恢复">
      {lines.map((line, index) => {
        const off = isolated !== undefined && isolated !== line.name;
        const last = [...line.points].reverse().find((p) => p.y !== null);
        return <button type="button" key={`${index}-${line.name}`} className={`bt-legend-item ${off ? "off" : ""}`} aria-pressed={isolated === line.name} onClick={() => setIsolated(isolated === line.name ? undefined : line.name)} title={line.name}>
          <i style={{ borderTopColor: colorFor(line, groups.get(line.group ?? line.name) ?? index), borderTopStyle: line.dashed ? "dashed" : "solid" }} /><span>{line.name}</span>{last && section.mode === "line" && <b>{formatLast(last.y as number, section.yFormat)}</b>}
        </button>;
      })}
    </div>}
    <div className="bt-chart-stage">
      <svg className="bt-svg" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title ?? section.title ?? "折线图"}>
        {model.yTicks.map((tick) => <g key={tick}><line className={tick === 0 ? "bt-zero" : "bt-grid"} x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} /><text className="bt-axis" x={PAD.left - 10} y={y(tick) + 4} textAnchor="end">{formatAxis(tick, section.yFormat, model.yMax - model.yMin)}</text></g>)}
        {xTicks.map((tick) => <g key={tick}><line className="bt-grid-x" x1={x(tick)} x2={x(tick)} y1={PAD.top} y2={height - PAD.bottom} /><text className="bt-axis" x={x(tick)} y={height - 22} textAnchor="middle">{isTime ? beijingTick(tick, withTime) : formatNumber(tick, 2)}</text></g>)}
        {section.xLabel && <text className="bt-axis-label" x={PAD.left + plotW / 2} y={height - 4} textAnchor="middle">{section.xLabel}{isTime ? "（北京时间）" : ""}</text>}
        {section.yLabel && <text className="bt-axis-label" transform={`translate(14 ${PAD.top + plotH / 2}) rotate(-90)`} textAnchor="middle">{section.yLabel}</text>}
        {section.references.map((ref, i) => ref.axis === "diagonal"
          ? <line key={i} className="bt-ref" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} />
          : ref.axis === "y" && ref.value !== undefined ? <g key={i}><line className="bt-ref" x1={PAD.left} x2={W - PAD.right} y1={y(ref.value)} y2={y(ref.value)} />{ref.label && <text className="bt-axis" x={W - PAD.right} y={y(ref.value) - 4} textAnchor="end">{ref.label}</text>}</g>
            : ref.axis === "x" && ref.value !== undefined ? <line key={i} className="bt-ref" x1={x(ref.value)} x2={x(ref.value)} y1={PAD.top} y2={height - PAD.bottom} /> : null)}
        {visible.map((line) => {
          const index = lines.indexOf(line);
          const color = colorFor(line, groups.get(line.group ?? line.name) ?? index);
          const drawn = line.points.filter((p) => p.y !== null);
          const path = drawn.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x).toFixed(1)} ${y(p.y as number).toFixed(1)}`).join(" ");
          return <g key={`${index}-${line.name}`}>
            {drawn.length > 1 && <path className="bt-line" d={path} stroke={color} strokeDasharray={line.dashed ? "6 4" : undefined} opacity={section.mode === "scatter" ? 0.45 : 1} />}
            {(section.mode === "scatter" || drawn.length <= 40) && drawn.map((p, i) => <g key={i}>
              {p.lower !== undefined && p.upper !== undefined && <line className="bt-ci" stroke={p.lowSample ? "#9aa59f" : color} x1={x(p.x)} x2={x(p.x)} y1={y(p.lower)} y2={y(p.upper)} />}
              <circle cx={x(p.x)} cy={y(p.y as number)} r={radius(p)} fill={p.lowSample ? "#fff" : color} stroke={p.lowSample ? "#9aa59f" : "#fff"} strokeWidth={p.lowSample ? 1.4 : 1} strokeDasharray={p.lowSample ? "2 2" : undefined} fillOpacity={p.lowSample ? 1 : 0.9} />
            </g>)}
          </g>;
        })}
        {hoverX !== undefined && <line className="bt-hover-guide" x1={x(hoverX)} x2={x(hoverX)} y1={PAD.top} y2={height - PAD.bottom} />}
        <rect className="bt-hit" x={PAD.left} y={PAD.top} width={plotW} height={plotH} onPointerMove={trackPointer} onPointerLeave={() => setHover(undefined)} />
      </svg>
      {hoverX !== undefined && hoverRows.length > 0 && <div className={`bt-tooltip ${x(hoverX) > W * 0.6 ? "align-right" : ""}`} style={{ left: `${x(hoverX) / W * 100}%` }} aria-hidden="true">
        <strong>{xLabel(hoverX)}</strong>
        {hoverRows.slice(0, 12).map(({ line, point, index }) => <div key={`${index}-${line.name}`}><i style={{ background: colorFor(line, groups.get(line.group ?? line.name) ?? index) }} /><span>{line.name}</span><b>{formatAxis((point as SeriesPoint).y as number, section.yFormat, 0.01)}</b>{(point as SeriesPoint).lower !== undefined && <em>[{formatNumber((point as SeriesPoint).lower as number, 3)}, {formatNumber((point as SeriesPoint).upper as number, 3)}]</em>}{(point as SeriesPoint).size !== undefined && <em>n={formatNumber((point as SeriesPoint).size as number, 0)}</em>}{(point as SeriesPoint).lowSample && <em>样本不足</em>}</div>)}
      </div>}
    </div>
  </div>;
}

const HIGHLIGHT_COLORS: Record<string, string> = { market: MARKET_COLOR, best: "#1d8d75", warn: "#d98a1f", muted: "#b6c0ba" };

function barColor(highlight: string | boolean | undefined): string {
  if (highlight === true) return MARKET_COLOR;
  if (typeof highlight === "string") return HIGHLIGHT_COLORS[highlight] ?? highlight;
  return "#4a78d4";
}

/** 条形图：横向（排名 + 误差棒 + 参考线）或纵向（直方图，带 x0/x1 时按数值轴摆放）。 */
export function BarsChart({ section, title, heading }: { section: BarsSection; title?: string; heading?: string }) {
  const bars = section.bars;
  const refs = section.referenceLines;
  const values = bars.flatMap((b) => [b.value, b.lower, b.upper].filter((v): v is number => v !== null && v !== undefined));
  if (bars.length === 0 || values.length === 0) return <div className="bt-chart-empty" role="status">没有可绘制的数据。</div>;
  const vertical = section.orientation === "vertical";
  const lo = Math.min(0, ...values, ...(vertical ? [] : refs.map((r) => r.value)));
  const hi = Math.max(0, ...values, ...(vertical ? [] : refs.map((r) => r.value)));
  const ticks = niceTicks(lo, hi, 5);
  const vMin = Math.min(lo, ticks[0]); const vMax = Math.max(hi, ticks[ticks.length - 1]);
  const fmt = (v: number) => formatNumber(v, section.digits);

  if (!vertical) {
    const rowH = 30; const labelW = 190; const padR = 90; const padT = 14; const padB = 30;
    const height = padT + bars.length * rowH + padB;
    const plotW = W - labelW - padR;
    const x = (v: number) => labelW + (v - vMin) / (vMax - vMin) * plotW;
    return <div className="bt-chart">
      {heading && <strong className="bt-chart-title">{heading}</strong>}
      <svg className="bt-svg" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title ?? section.title ?? "条形图"}>
        {ticks.map((t) => <g key={t}><line className={t === 0 ? "bt-zero" : "bt-grid-x"} x1={x(t)} x2={x(t)} y1={padT} y2={height - padB} /><text className="bt-axis" x={x(t)} y={height - 10} textAnchor="middle">{fmt(t)}</text></g>)}
        {bars.map((bar, i) => {
          const cy = padT + i * rowH + rowH / 2;
          const color = barColor(bar.highlight);
          const end = bar.value ?? 0;
          const tail = Math.max(end, bar.upper ?? end);
          return <g key={`${bar.label}-${i}`}>
            <text className="bt-bar-label" x={labelW - 10} y={cy + 4} textAnchor="end">{bar.label.length > 26 ? `${bar.label.slice(0, 25)}…` : bar.label}<title>{bar.label}</title></text>
            {bar.value !== null && <rect x={Math.min(x(0), x(end))} y={cy - 9} width={Math.max(1, Math.abs(x(end) - x(0)))} height={18} rx={2} fill={color} fillOpacity={0.88} />}
            {bar.lower !== undefined && bar.lower !== null && bar.upper !== undefined && bar.upper !== null && <g className="bt-errbar"><line x1={x(bar.lower)} x2={x(bar.upper)} y1={cy} y2={cy} /><line x1={x(bar.lower)} x2={x(bar.lower)} y1={cy - 5} y2={cy + 5} /><line x1={x(bar.upper)} x2={x(bar.upper)} y1={cy - 5} y2={cy + 5} /></g>}
            <text className="bt-bar-value" x={Math.min(x(Math.max(tail, 0)) + 8, W - padR + 4)} y={cy + 4}>{bar.value === null ? "—" : fmt(bar.value)}</text>
            {bar.note && <title>{bar.note}</title>}
          </g>;
        })}
        {refs.map((ref, i) => <g key={i}><line className="bt-ref" x1={x(ref.value)} x2={x(ref.value)} y1={padT} y2={height - padB} />{ref.label && <text className="bt-axis" x={x(ref.value) + 4} y={padT + 10}>{ref.label}</text>}</g>)}
      </svg>
    </div>;
  }

  const height = 300; const padL = 56; const padR = 20; const padT = 18; const padB = 52;
  const plotW = W - padL - padR; const plotH = height - padT - padB;
  const y = (v: number) => padT + (vMax - v) / (vMax - vMin) * plotH;
  const edged = bars.every((b) => b.x0 !== undefined && b.x1 !== undefined);
  const xMin = edged ? Math.min(...bars.map((b) => b.x0 as number)) : 0;
  const xMax = edged ? Math.max(...bars.map((b) => b.x1 as number)) : bars.length;
  const xPos = (v: number) => padL + (v - xMin) / (xMax - xMin || 1) * plotW;
  return <div className="bt-chart">
    {heading && <strong className="bt-chart-title">{heading}</strong>}
    <svg className="bt-svg" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title ?? section.title ?? "直方图"}>
      {ticks.map((t) => <g key={t}><line className={t === 0 ? "bt-zero" : "bt-grid"} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} /><text className="bt-axis" x={padL - 8} y={y(t) + 4} textAnchor="end">{fmt(t)}</text></g>)}
      {bars.map((bar, i) => {
        const left = edged ? xPos(bar.x0 as number) : padL + i * plotW / bars.length;
        const right = edged ? xPos(bar.x1 as number) : padL + (i + 1) * plotW / bars.length;
        const top = bar.value === null ? y(0) : y(Math.max(bar.value, 0)); const bottom = bar.value === null ? y(0) : y(Math.min(bar.value, 0));
        const show = bars.length <= 12 || i % Math.ceil(bars.length / 10) === 0;
        return <g key={`${bar.label}-${i}`}>
          <rect x={left + 1} y={top} width={Math.max(1, right - left - 2)} height={Math.max(1, bottom - top)} fill={barColor(bar.highlight)} fillOpacity={0.88}><title>{`${bar.label}：${bar.value === null ? "—" : fmt(bar.value)}`}</title></rect>
          {bar.lower !== undefined && bar.lower !== null && bar.upper !== undefined && bar.upper !== null && <g className="bt-errbar"><line x1={(left + right) / 2} x2={(left + right) / 2} y1={y(bar.lower)} y2={y(bar.upper)} /></g>}
          {show && <text className="bt-axis" x={(left + right) / 2} y={height - 30} textAnchor="middle">{bar.label.length > 10 ? `${bar.label.slice(0, 9)}…` : bar.label}</text>}
        </g>;
      })}
      {[...refs].sort((a, b) => a.value - b.value).map((ref, i, sorted) => edged
        ? <g key={i}><line className="bt-ref" x1={xPos(ref.value)} x2={xPos(ref.value)} y1={padT} y2={height - padB} />{ref.label && <text className="bt-axis" x={xPos(ref.value) + (i === 0 && sorted.length > 1 ? -4 : 4)} textAnchor={i === 0 && sorted.length > 1 ? "end" : "start"} y={padT + 10}>{ref.label} {formatNumber(ref.value, 3)}</text>}</g>
        : <g key={i}><line className="bt-ref" x1={padL} x2={W - padR} y1={y(ref.value)} y2={y(ref.value)} />{ref.label && <text className="bt-axis" x={W - padR} y={y(ref.value) - 4} textAnchor="end">{ref.label}</text>}</g>)}
    </svg>
  </div>;
}

function heatColor(value: number, lo: number, hi: number): { background: string; color: string } {
  const mid = (lo + hi) / 2;
  const t = Math.max(-1, Math.min(1, (value - mid) / ((hi - lo) / 2 || 1)));
  const mix = (a: number[], b: number[], k: number) => a.map((c, i) => Math.round(c + (b[i] - c) * k));
  const white = [255, 255, 255]; const pos = [29, 141, 117]; const neg = [184, 68, 57];
  const rgb = t >= 0 ? mix(white, pos, t) : mix(white, neg, -t);
  return { background: `rgb(${rgb.join(",")})`, color: Math.abs(t) > 0.6 ? "#fff" : "var(--ink)" };
}

/** 热力图（相关性 / 秩相关）：固定色域，|ρ|>0.6 白字；样本数少的格子标注 n。 */
export function Heatmap({ section, title }: { section: MatrixSection; title?: string }) {
  const [lo, hi] = section.domain;
  return <div className="bt-heatmap table-scroll">
    <table className="bt-heat-table" aria-label={title ?? section.title ?? "热力图"}>
      <thead><tr><th scope="col" />{section.cols.map((col) => <th scope="col" key={col} title={col}><span>{col}</span></th>)}</tr></thead>
      <tbody>{section.rows.map((row, r) => <tr key={row}><th scope="row" title={row}>{row}</th>{section.cols.map((col, c) => {
        const value = section.values[r][c];
        const n = section.counts?.[r]?.[c];
        if (value === null) return <td key={col} className="bt-heat-null" title={`${row} × ${col}：样本不足，未计算`}>—</td>;
        const color = heatColor(value, lo, hi);
        return <td key={col} style={color} title={`${row} × ${col}：${formatNumber(value, section.digits)}${n !== null && n !== undefined ? `（n=${n}）` : ""}`}>{formatNumber(value, section.digits)}{n !== null && n !== undefined && n < 5 && <small>n={n}</small>}</td>;
      })}</tr>)}</tbody>
    </table>
    <div className="bt-heat-scale" aria-hidden="true"><span>{formatNumber(lo, 1)}</span><i style={{ background: `linear-gradient(90deg, ${heatColor(lo, lo, hi).background}, #fff, ${heatColor(hi, lo, hi).background})` }} /><span>{formatNumber(hi, 1)}</span></div>
  </div>;
}
