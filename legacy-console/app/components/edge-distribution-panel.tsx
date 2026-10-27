"use client";

import { useState } from "react";
import type { EdgeDistribution, EdgeDistributionBin, EdgeDistributionSeries } from "../lib/types";

const WIDTH = 920;
const HEIGHT = 300;
const PAD = { top: 25, right: 22, bottom: 46, left: 50 };

/** 展示最新决策周期内各模型的 Edge 分布。 */
export function EdgeDistributionPanel({ distribution, loading, error, onRetry }: {
  distribution?: EdgeDistribution;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const selected = distribution?.series.find((series) => series.modelId === selectedModelId) ?? distribution?.series[0];

  return <section className="section edge-section" aria-labelledby="edge-distribution-title">
    <div className="section-head edge-section-head">
      <div><h2 className="section-title" id="edge-distribution-title">模型 Edge 分布</h2><p className="section-caption">最新十分钟决策快照 · outcome 0 · Edge = 模型概率 − 盘口中间价</p></div>
      {distribution && <div className="edge-snapshot-time"><span>决策时间</span><strong>{formatDecisionTime(distribution.decisionAt)}</strong></div>}
    </div>
    <div className="panel edge-panel">
      {loading && !distribution ? <EdgeSkeleton /> : !distribution || !selected ? <div className="edge-empty"><strong>暂无可用 Edge 分布</strong><p>{error ?? "Trading 尚未产生完整的十分钟决策快照。"}</p><button className="button" onClick={onRetry}>重新读取</button></div> : <>
        <div className="edge-toolbar">
          <div className="edge-model-tabs" role="tablist" aria-label="预测模型">
            {distribution.series.map((series) => <button key={series.modelId} role="tab" aria-selected={series.modelId === selected.modelId} className={series.modelId === selected.modelId ? "active" : ""} onClick={() => setSelectedModelId(series.modelId)}>{series.modelId}<span>{series.sampleCount}</span></button>)}
          </div>
          <span className="edge-basis">MIDPOINT · 5pp bins</span>
        </div>
        <EdgeStats series={selected} />
        <DistributionChart series={selected} rangeMin={distribution.rangeMin} rangeMax={distribution.rangeMax} />
        <footer className="edge-footer"><span><i />正值表示模型概率高于市场隐含概率</span><span>有效样本 {selected.sampleCount}{selected.excludedCount ? ` · 排除缺失/异常盘口 ${selected.excludedCount}` : ""}</span></footer>
      </>}
    </div>
  </section>;
}

/** 展示当前模型的核心 Edge 统计指标。 */
function EdgeStats({ series }: { series: EdgeDistributionSeries }) {
  const stats = [
    ["平均 Edge", signedPP(series.mean)], ["中位数", signedPP(series.median)],
    ["标准差", pp(series.standardDeviation)], ["正 Edge 占比", percent(series.positiveRatio)],
  ];
  return <div className="edge-stats">{stats.map(([label, value], index) => <div key={label}><span>{label}</span><strong className={index < 2 ? tone(index === 0 ? series.mean : series.median) : ""}>{value}</strong></div>)}</div>;
}

/** 将 Edge 分箱绘制成直方图和轻度平滑趋势线。 */
function DistributionChart({ series, rangeMin, rangeMax }: { series: EdgeDistributionSeries; rangeMin: number; rangeMax: number }) {
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const density = smooth(series.bins);
  const maximum = Math.max(0.01, ...series.bins.map((bin) => bin.ratio), ...density);
  const barSlot = plotWidth / Math.max(1, series.bins.length);
  const x = (value: number) => PAD.left + (value - rangeMin) / (rangeMax - rangeMin) * plotWidth;
  const y = (value: number) => PAD.top + plotHeight - value / maximum * plotHeight;
  const line = density.map((value, index) => `${index ? "L" : "M"} ${PAD.left + (index + 0.5) * barSlot} ${y(value)}`).join(" ");
  const ticks = [rangeMin, rangeMin / 2, 0, rangeMax / 2, rangeMax];
  const yTicks = [0, maximum / 2, maximum];
  return <div className="edge-chart-scroll"><svg className="edge-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${series.modelId} 最新决策周期的 Edge 直方图`}>
    {yTicks.map((value) => <g key={value}><line className="edge-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} /><text className="edge-y-label" x={PAD.left - 9} y={y(value) + 3} textAnchor="end">{percent(value)}</text></g>)}
    {series.bins.map((bin, index) => {
      const barHeight = Math.max(0, plotHeight - (y(bin.ratio) - PAD.top));
      return <rect key={`${bin.lower}:${bin.upper}`} className={`edge-bar ${bin.upper <= 0 ? "negative" : "positive"}`} x={PAD.left + index * barSlot + 1.5} y={PAD.top + plotHeight - barHeight} width={Math.max(1, barSlot - 3)} height={barHeight}><title>{binLabel(bin)} · {bin.count} 个市场（{percent(bin.ratio)}）</title></rect>;
    })}
    <line className="edge-zero" x1={x(0)} x2={x(0)} y1={PAD.top - 5} y2={PAD.top + plotHeight} />
    <path className="edge-density" d={line} />
    {ticks.map((value) => <g key={value}><line className="edge-x-tick" x1={x(value)} x2={x(value)} y1={PAD.top + plotHeight} y2={PAD.top + plotHeight + 5} /><text className={value === 0 ? "edge-x-label zero" : "edge-x-label"} x={x(value)} y={HEIGHT - 18} textAnchor="middle">{signedPP(value)}</text></g>)}
    <text className="edge-axis-title" x={WIDTH / 2} y={HEIGHT - 2} textAnchor="middle">EDGE（百分点）</text>
  </svg></div>;
}

/** 展示 Edge 数据读取中的骨架占位。 */
function EdgeSkeleton() {
  return <div className="edge-loading" aria-label="正在读取 Edge 分布"><div className="skeleton edge-loading-tabs" /><div className="edge-loading-stats">{[0, 1, 2, 3].map((item) => <div className="skeleton" key={item} />)}</div><div className="skeleton edge-loading-chart" /></div>;
}

/** 使用固定卷积权重平滑分箱比例，仅用于辅助观察趋势。 */
function smooth(bins: EdgeDistributionBin[]): number[] {
  const weights = [0.06, 0.24, 0.4, 0.24, 0.06];
  return bins.map((_, index) => weights.reduce((total, weight, offset) => total + (bins[index + offset - 2]?.ratio ?? 0) * weight, 0));
}

/** 将分箱上下界格式化为可读区间。 */
function binLabel(bin: EdgeDistributionBin) {
  return `${signedPP(bin.lower)} 至 ${signedPP(bin.upper)}`;
}

/** 将概率差格式化为带正负号的百分点。 */
function signedPP(value: number) {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}pp`;
}

/** 将概率差格式化为百分点。 */
function pp(value: number) {
  return `${(value * 100).toFixed(1)}pp`;
}

/** 将零到一比例格式化为百分比。 */
function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

/** 根据 Edge 正负返回对应的视觉语义。 */
function tone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
}

/** 将决策时间统一格式化为 UTC 展示文本。 */
function formatDecisionTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
