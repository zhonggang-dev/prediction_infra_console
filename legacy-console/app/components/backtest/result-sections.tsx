"use client";

/** result.json 的七种区块渲染器与筛选条。前端只做排序 / 筛选 / 格式化，不含任何指标口径。 */

import { useMemo, useState } from "react";
import {
  backtestApi, type BarsSection, type MetricsSection, type ResultFilter, type ResultSection, type SeriesSection, type TableSection, type TextSection,
} from "../../lib/backtest-platform";
import {
  EMPTY, badgeTone, cellValue, downloadCsv, formatCell, formatNumber, matchesFilters, matchesWhen, nextSort, normalizeDropReasons, pinColumns, pushClicked, rankNumbers, searchRows, sortRows, toCsv,
  type FilterSelection,
} from "../../lib/backtest-table";
import { TITLE_REWRITES } from "../../lib/backtest-labels";
import { BarsChart, Heatmap, SeriesChart } from "./charts";

// ───────────────────────── 筛选条 ─────────────────────────

export function FilterBar({ filters, selection, onSelect, ariaLabel = "显示档位" }: { filters: ResultFilter[]; selection: FilterSelection; onSelect: (key: string, value: string) => void; ariaLabel?: string }) {
  if (filters.length === 0) return null;
  return <div className="bt-filterbar" role="group" aria-label={ariaLabel}>
    {filters.map((filter) => <div className="bt-filter" key={filter.key}>
      <span className="bt-filter-label">{filter.label}</span>
      {filter.options.length > 8
        ? <select className="select" aria-label={filter.label} value={selection[filter.key] ?? filter.defaultValue} onChange={(event) => onSelect(filter.key, event.target.value)}>{filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <div className="v2-local-tabs" role="radiogroup" aria-label={filter.label}>{filter.options.map((option) => <button type="button" role="radio" aria-checked={(selection[filter.key] ?? filter.defaultValue) === option.value} key={option.value} className={(selection[filter.key] ?? filter.defaultValue) === option.value ? "active" : ""} onClick={() => onSelect(filter.key, option.value)}>{option.label}</button>)}</div>}
    </div>)}
  </div>;
}

// ───────────────────────── 指标卡片 ─────────────────────────

function formatMetric(item: MetricsSection["items"][number]): string {
  const { value, kind, digits } = item;
  if (value === null || value === undefined || value === "") return EMPTY;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return EMPTY;
    if (kind === "percent") return `${formatNumber(value, digits ?? 1)}%`;
    if (kind === "money") return `${value < 0 ? "-" : value > 0 ? "+" : ""}$${formatNumber(Math.abs(value), digits ?? 2)}`;
    return formatNumber(value, digits);
  }
  return String(value);
}

export function MetricsView({ section }: { section: MetricsSection }) {
  if (section.items.length === 0) return <p className="bt-muted">没有指标。</p>;
  return <div className="bt-kpis">{section.items.map((item) => <div className="bt-kpi" key={item.label} title={item.help}><span>{item.label}</span><strong className={typeof item.value === "number" && item.kind === "money" ? (item.value < 0 ? "negative" : item.value > 0 ? "positive" : "") : ""}>{formatMetric(item)}</strong>{item.help && <small>{item.help}</small>}</div>)}</div>;
}

// ───────────────────────── 表格 ─────────────────────────

const ROW_PAGE = 300;

export function SortableTable({ section, selection, csvName, onSortChange, label }: { section: TableSection; selection: FilterSelection; csvName: string; onSortChange?: (key: string) => void; label?: string }) {
  const [sort, setSort] = useState(section.defaultSort);
  const [clicked, setClicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(ROW_PAGE);
  const columns = useMemo(() => section.pinSortedColumns ? pinColumns(section.columns, clicked) : section.columns, [section.columns, section.pinSortedColumns, clicked]);
  const rows = useMemo(() => {
    const scoped = section.rows.filter((row) => matchesFilters(row, selection));
    return sortRows(section.columns, searchRows(section.columns, scoped, query), sort);
  }, [section.rows, section.columns, selection, query, sort]);
  const ranks = useMemo(() => section.rankColumn ? rankNumbers(section.columns, rows, sort) : [], [section.rankColumn, section.columns, rows, sort]);
  const showSearch = section.searchable ?? section.rows.length > 12;
  const clickHeader = (key: string) => {
    setSort(nextSort(section.columns, sort, key));
    if (section.pinSortedColumns) setClicked((current) => pushClicked(current, key));
    onSortChange?.(key);
  };
  const shown = rows.slice(0, limit);
  return <div className="bt-table">
    <div className="bt-table-tools">
      {showSearch && <input className="input" aria-label="搜索表格" placeholder="搜索表格内容" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(ROW_PAGE); }} />}
      <span className="bt-muted">{rows.length === section.rows.length ? `${rows.length} 行` : `${rows.length} / ${section.rows.length} 行`}{section.pinSortedColumns ? " · 点表头排序，再点反向；点过的列固定在左侧" : section.columns.some((c) => c.sortable) ? " · 点表头排序" : ""}</span>
      <button type="button" className="button" disabled={rows.length === 0} onClick={() => downloadCsv(`${csvName}.csv`, toCsv(columns, rows))}>导出 CSV</button>
    </div>
    {rows.length === 0 ? <div className="empty"><strong>没有符合条件的行</strong><p>调整筛选或搜索后再试。</p></div> : <div className="table-scroll"><table className="v2-table bt-data-table" aria-label={label}>
      <thead><tr>
        {section.rankColumn && <th scope="col" className="bt-num">#</th>}
        {columns.map((column) => {
          const active = sort?.key === column.key;
          const label = <>{column.label}{active && <span aria-hidden="true">{sort?.direction === "asc" ? " ↑" : " ↓"}</span>}</>;
          return <th key={column.key} scope="col" className={column.kind === "text" || column.kind === "badge" ? "" : "bt-num"} aria-sort={active ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined} title={column.help}>
            {column.sortable ? <button type="button" className="bt-th-button" onClick={() => clickHeader(column.key)}>{label}</button> : label}
          </th>;
        })}
      </tr></thead>
      <tbody>{shown.map((row, index) => <tr key={index}>
        {section.rankColumn && <td className="bt-num">{ranks[index] ?? ""}</td>}
        {columns.map((column) => {
          const cell = cellValue(row, column);
          const display = formatCell(column, cell);
          if (column.kind === "badge") return <td key={column.key}>{display === EMPTY ? EMPTY : <span className={`bt-badge ${badgeTone(cell)}`}>{display}</span>}</td>;
          if (column.kind === "text") return <td key={column.key} className="wrap bt-text-cell">{display}</td>;
          return <td key={column.key} className="bt-num">{display}</td>;
        })}
      </tr>)}</tbody>
    </table></div>}
    {rows.length > limit && <div className="v2-pagination"><span>显示前 {limit} 行，共 {rows.length} 行</span><div><button type="button" className="button" onClick={() => setLimit(limit + ROW_PAGE)}>再显示 {ROW_PAGE} 行</button><button type="button" className="button" onClick={() => setLimit(rows.length)}>全部显示</button></div></div>}
    {section.notes.map((note) => <p className="bt-note" key={note}>{inline(note)}</p>)}
  </div>;
}

// ───────────────────────── 文本（最小 markdown） ─────────────────────────

export function inline(source: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0; let match: RegExpExecArray | null; let key = 0;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > last) parts.push(source.slice(last, match.index));
    const token = match[0];
    parts.push(token.startsWith("**") ? <strong key={key++}>{token.slice(2, -2)}</strong> : <code key={key++}>{token.slice(1, -1)}</code>);
    last = match.index + token.length;
  }
  if (last < source.length) parts.push(source.slice(last));
  return parts;
}

type Block = { kind: "h"; level: number; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "code"; text: string } | { kind: "table"; header: string[]; rows: string[][] };

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i += 1; continue; }
    if (line.startsWith("```")) {
      const body: string[] = []; i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) { body.push(lines[i]); i += 1; }
      i += 1; blocks.push({ kind: "code", text: body.join("\n") }); continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { blocks.push({ kind: "h", level: heading[1].length, text: heading[2] }); i += 1; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i += 1; }
      blocks.push({ kind: "ul", items }); continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = cells(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(cells(lines[i])); i += 1; }
      blocks.push({ kind: "table", header, rows }); continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s|```|\s*[-*]\s+)/.test(lines[i])) { para.push(lines[i]); i += 1; }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

export function TextView({ section }: { section: TextSection }) {
  if (section.format === "json" || section.format === "plain") {
    let body = section.text;
    if (section.format === "json") { try { body = JSON.stringify(JSON.parse(section.text), null, 2); } catch { /* 保持原文 */ } }
    return <pre className="bt-pre">{body}</pre>;
  }
  return <div className="bt-markdown">{parseMarkdown(section.text).map((block, index) => {
    if (block.kind === "h") return block.level <= 2 ? <h4 key={index}>{inline(block.text)}</h4> : <h5 key={index}>{inline(block.text)}</h5>;
    if (block.kind === "ul") return <ul key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
    if (block.kind === "code") return <pre className="bt-pre" key={index}>{block.text}</pre>;
    if (block.kind === "table") return <div className="table-scroll" key={index}><table className="v2-table"><thead><tr>{block.header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((c, i) => <td key={i} className="wrap">{inline(c)}</td>)}</tr>)}</tbody></table></div>;
    return <p key={index}>{inline(block.text)}</p>;
  })}</div>;
}

// ───────────────────────── 区块外壳 ─────────────────────────

/** 已知区块 id 的默认标题 / 默认折叠（区块自带的 title / collapsed 优先）。来源：执行器任务 design.md 第 5 节。 */
export const SECTION_TITLES: Record<string, string> = {
  pnl_curves: "PnL 对比图", final_pnl: "期末 PnL 排名", metrics_main: "指标明细", metrics_detail: "辅表 · 口径、样本量和异常计数", drop_reasons: "未成交候选的原因明细",
  entry_prices: "Entry price 分布", manifests: "运行清单（原始 JSON）", manifest: "运行清单（原始 JSON）", ranking: "排名图", metrics: "指标明细", brier_bars: "市场等权 Brier",
  verdicts: "与 Market 比较的结论", metrics_raw: "原始指标列", scope_ranks: "两个口径的排名对比 · 全样本 vs 赔率 20%–80%", accuracy_bars: "方向正确率", pairwise: "两两模型比较（逐市场 Brier 差）",
  coverage_funnel: "样本漏斗", original_brier: "对拍：原有三小时网格口径", report: "引擎报告", curve: "校准曲线", summary: "汇总", buckets: "逐桶明细", bucket_markets: "桶内市场明细", vs_brier: "与 Brier 并排",
  not_leaderboard: "这不是排行榜", ratio_bars: "头条比值：market brier ÷ 模型 brier", headline: "头条", terrain: "地形指纹（横向比之前必读）", by_stratum: "按中价分层 / 按偏离方向", common_terrain: "统一地形对照",
  overview: "概览", samples: "样本说明", leaderboard: "排行表", definitions: "指标口径", completion: "完成度", main: "默认 Benchmark 总表", metric_correlation: "指标之间的秩相关", metric_bars: "单指标条形图", detail: "每一列自己的样本量与完整指标",
  screen: "初筛", horizons: "六周期汇总", deciles: "六周期分桶 · 平均 Δmid ($/share)", ic_series: "IC 时序", price_strata: "价格分层", by_domain: "分 Domain", by_period: "分期对照", files: "文件",
  status_counts: "状态计数", spearman: "截面 Rank Correlation", pearson: "Raw-score Pearson", pair_samples: "Pairwise complete rows", pairs: "因子对明细", validation: "校验结果", coverage: "各数据集覆盖",
};
const DEFAULT_COLLAPSED = new Set(["metrics_detail", "manifests", "manifest", "metrics_raw", "report", "definitions", "metric_correlation", "pearson", "pair_samples", "coverage_funnel", "pairwise", "by_stratum", "bucket_markets"]);

export function sectionTitle(section: ResultSection): string | undefined {
  const title = section.title ?? SECTION_TITLES[section.id];
  return title === undefined ? undefined : TITLE_REWRITES[title] ?? title;
}
export function isCollapsed(section: ResultSection): boolean { return section.collapsed ?? DEFAULT_COLLAPSED.has(section.id); }

export function SectionFrame({ section, children }: { section: ResultSection; children: React.ReactNode }) {
  const title = sectionTitle(section);
  const collapsed = isCollapsed(section);
  const body = <>{section.caption && <p className="bt-caption">{inline(section.caption)}</p>}{children}</>;
  if (collapsed && title) return <details className="bt-section bt-details" id={`bt-section-${section.id}`}><summary>{title}</summary>{body}</details>;
  return <section className="bt-section" id={`bt-section-${section.id}`} aria-labelledby={title ? `bt-title-${section.id}` : undefined}>
    {title && <h3 className="bt-section-title" id={`bt-title-${section.id}`}>{title}</h3>}
    {body}
  </section>;
}

export function SectionBody({ section, runId, selection, csvName, onSortChange }: { section: ResultSection; runId: string; selection: FilterSelection; csvName: string; onSortChange?: (key: string) => void }) {
  switch (section.type) {
    case "metrics": return <MetricsView section={section} />;
    case "table": return <SortableTable section={normalizeDropReasons(section)} selection={selection} csvName={csvName} onSortChange={onSortChange} label={sectionTitle(section) ?? section.id} />;
    case "series": {
      const filtered: SeriesSection = { ...section, series: section.series.filter((line) => matchesFilters(line, selection)) };
      return <SeriesChart section={filtered} title={sectionTitle(section)} />;
    }
    case "bars": {
      const filtered: BarsSection = { ...section, bars: section.bars.filter((bar) => matchesFilters(bar, selection)) };
      return <BarsChart section={filtered} title={sectionTitle(section)} />;
    }
    case "matrix": return <Heatmap section={section} title={sectionTitle(section)} />;
    case "text": return <TextView section={section} />;
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <figure className="bt-figure"><img src={backtestApi.artifactUrl(runId, section.artifact)} alt={section.alt} loading="lazy" /><figcaption><a href={backtestApi.artifactUrl(runId, section.artifact)} target="_blank" rel="noreferrer">在新窗口打开原图</a></figcaption></figure>;
    default: return <p className="bt-muted">暂不支持的区块类型：{section.originalType}（id={section.id}）。完整内容在产物包里。</p>;
  }
}

/** 区块在筛选下是否可见：结果级筛选决定 `when`。 */
export function sectionVisible(section: ResultSection, globalSelection: FilterSelection): boolean {
  return matchesWhen(section.when, globalSelection);
}

