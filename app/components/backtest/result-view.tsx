"use client";

import { useCallback, useMemo, useState } from "react";
import { factorGroupOf, type BacktestResult, type BacktestRun, type ResultSection, type SeriesSection } from "../../lib/backtest-platform";
import { alignPnlSeries, defaultSelection, matchesFilters, formatNumber, type FilterSelection } from "../../lib/backtest-table";
import { displayBeijing } from "../../lib/backtest-selection";
import { V2Notice } from "../console-v2-resource";
import { SeriesChart } from "./charts";
import { FilterBar, SectionBody, SectionFrame, sectionTitle, sectionVisible } from "./result-sections";

// ───────────────────────── 口径卡片 ─────────────────────────

export function ScopeCardView({ result, run }: { result: BacktestResult; run: BacktestRun }) {
  const card = result.scopeCard;
  const facts: Array<{ label: string; value: React.ReactNode }> = [];
  if (card.window) facts.push({ label: "窗口（北京时间，右开）", value: `${displayBeijing(card.window.start)} → ${displayBeijing(card.window.endExclusive)}${card.window.align === "strict_common" ? " · 公共时间区间" : ""}` });
  if (card.domains.length) facts.push({ label: "Domain", value: card.domains.join("、") });
  if (card.dataset) facts.push({ label: "数据集", value: card.dataset });
  if (card.engine || card.protocol) facts.push({ label: "引擎 / 协议", value: [card.engine, card.protocol].filter(Boolean).join(" · ") });
  if (card.sampleScope) facts.push({ label: "样本口径", value: card.sampleScope });
  if (card.sampleCounts.length) facts.push({ label: "样本数", value: card.sampleCounts.map((entry) => `${entry.label} ${entry.value}`).join(" · ") });
  if (card.batchMembers.length) facts.push({ label: "批次成员（影响 Holm 校正）", value: `${card.batchMembers.length} 个：${card.batchMembers.slice(0, 8).join("、")}${card.batchMembers.length > 8 ? "…" : ""}` });
  if (run.origin === "legacy") facts.push({ label: "来源", value: "旧平台历史结果（只读，不可重跑）" });
  if (facts.length === 0) return null;
  return <section className="bt-scope" aria-label="口径卡片">
    <div className="v2-facts bt-scope-facts">{facts.map((fact) => <div className="v2-fact" key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}</div>
    {card.batchMembers.length > 1 && <p className="bt-note">Holm 校正按本批 {card.batchMembers.length} 个对象计算，单独评估结果可能不同。</p>}
  </section>;
}

// ───────────────────────── Trading：PnL 曲线口径与 Gap ─────────────────────────

type Basis = "realised" | "mtm" | "both";
const BASIS_LABELS: Record<Basis, string> = { realised: "Realised", mtm: "MTM", both: "Realised + MTM" };

function PnlCurvesPanel({ section }: { section: SeriesSection }) {
  const [basis, setBasis] = useState<Basis>("mtm");
  const hasVariants = section.series.some((line) => line.variant === "realised" || line.variant === "mtm");
  const visibleSection = useMemo<SeriesSection>(() => ({
    ...section,
    series: hasVariants ? section.series.filter((line) => basis === "both" || line.variant === basis || !line.variant).map((line) => ({ ...line, dashed: basis === "both" && line.variant === "realised" ? true : line.dashed })) : section.series,
  }), [section, basis, hasVariants]);
  return <>
    {hasVariants && <div className="bt-filterbar" role="group" aria-label="PnL 曲线口径"><div className="bt-filter"><span className="bt-filter-label">PnL 曲线口径（只切换显示，不重跑）</span><div className="v2-local-tabs" role="radiogroup" aria-label="PnL 曲线口径">{(Object.keys(BASIS_LABELS) as Basis[]).map((key) => <button type="button" role="radio" aria-checked={basis === key} key={key} className={basis === key ? "active" : ""} onClick={() => setBasis(key)}>{BASIS_LABELS[key]}</button>)}</div></div></div>}
    <SeriesChart section={visibleSection} title={sectionTitle(section)} />
    {hasVariants && <PnlGapPanel section={section} defaultBasis={basis === "both" ? "mtm" : basis} />}
  </>;
}

function PnlGapPanel({ section, defaultBasis }: { section: SeriesSection; defaultBasis: "realised" | "mtm" }) {
  const groups = useMemo(() => Array.from(new Set(section.series.map((line) => line.group ?? line.name))), [section.series]);
  const [basis, setBasis] = useState<"realised" | "mtm">(defaultBasis);
  const [a, setA] = useState(groups[0] ?? "");
  const [b, setB] = useState(groups[1] ?? "");
  const pick = useCallback((group: string) => section.series.find((line) => (line.group ?? line.name) === group && line.variant === basis), [section.series, basis]);
  if (groups.length < 2) return <div className="bt-gap"><h4>PnL Gap 对比</h4><p className="bt-muted">至少需要两个 strategy × model 回测结果才能计算 Gap。</p></div>;
  const lineA = pick(a); const lineB = pick(b);
  const aligned = a !== b && lineA && lineB ? alignPnlSeries(lineA.points, lineB.points) : undefined;
  const money = (v: number) => `${v < 0 ? "-" : v > 0 ? "+" : ""}$${formatNumber(Math.abs(v), 2)}`;
  const base: Omit<SeriesSection, "id" | "series" | "yLabel"> = { type: "series", filters: [], xKind: "time", xLabel: "时间", yFormat: "money", references: [{ axis: "y", value: 0 }], mode: "line" };
  const curves: SeriesSection | undefined = aligned ? { ...base, id: "gap-curves", yLabel: "PnL ($)", series: [{ name: `A · ${a}`, points: aligned.times.map((x, i) => ({ x, y: aligned.a[i] })) }, { name: `B · ${b}`, points: aligned.times.map((x, i) => ({ x, y: aligned.b[i] })) }] } : undefined;
  const gap: SeriesSection | undefined = aligned ? { ...base, id: "gap-diff", yLabel: "Gap (A − B) ($)", series: [{ name: "Gap (A − B)", color: "#d98a1f", points: aligned.times.map((x, i) => ({ x, y: aligned.gap[i] })) }] } : undefined;
  return <div className="bt-gap">
    <h4>PnL Gap 对比</h4>
    <div className="bt-form-row">
      <label><span>Gap 口径</span><select className="select" value={basis} onChange={(event) => setBasis(event.target.value as "realised" | "mtm")}><option value="realised">Realised</option><option value="mtm">MTM</option></select></label>
      <label><span>曲线 A</span><select className="select" value={a} onChange={(event) => setA(event.target.value)}>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
      <label><span>曲线 B</span><select className="select" value={b} onChange={(event) => setB(event.target.value)}>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
    </div>
    {a === b && <p className="bt-warn" role="alert">请选择两条不同的 PnL 曲线。</p>}
    {a !== b && !aligned && <p className="bt-warn" role="alert">无法计算 PnL Gap：所选曲线在该口径下没有数据点。</p>}
    {aligned && curves && gap && <>
      <p className="bt-caption">{BASIS_LABELS[basis]} · A = {a} · B = {b}</p>
      <SeriesChart section={curves} title="原始曲线（同一时间轴）" heading="原始曲线（同一时间轴）" height={300} />
      <p className="bt-caption">Gap = A − B；正值表示 A 领先。</p>
      <SeriesChart section={gap} title="Gap 曲线" heading="Gap 曲线" height={260} />
      <div className="bt-kpis"><div className="bt-kpi"><span>最终 Gap</span><strong className={aligned.final < 0 ? "negative" : "positive"}>{money(aligned.final)}</strong></div><div className="bt-kpi"><span>最大 Gap</span><strong>{money(aligned.max)}</strong></div><div className="bt-kpi"><span>最小 Gap</span><strong>{money(aligned.min)}</strong></div></div>
      <p className="bt-note">对齐规则：两条曲线取事件时间并集，缺失处前向填充，首个事件之前记 $0；时间为北京时间。</p>
    </>}
  </div>;
}

// ───────────────────────── 结果主体 ─────────────────────────

type Selections = Record<string, FilterSelection>;
const GLOBAL = "$global";

/** 旧页面的表格交互默认值：Overview 主表点表头排序、已点列固定在左、排名号随排序。 */
function withLayoutDefaults(result: BacktestResult, section: ResultSection): ResultSection {
  if (section.type === "table" && result.board === "benchmark" && result.item === "overview" && section.id === "main") {
    return { ...section, pinSortedColumns: section.pinSortedColumns || true, rankColumn: section.rankColumn || true };
  }
  return section;
}

type Block = { kind: "section"; section: ResultSection } | { kind: "factor-picker" } | { kind: "tabs"; scope: string; sections: ResultSection[] };

/** 把可见区块排成渲染块：批量因子的「因子明细」选择器放在第一个因子区块处；同一范围里带 tab 的区块合成一组标签页。 */
function layoutBlocks(sections: ResultSection[], factor: string | undefined): Block[] {
  const blocks: Block[] = [];
  const emittedTabs = new Set<string>();
  let pickerEmitted = false;
  for (const section of sections) {
    const group = factorGroupOf(section.id);
    if (group !== undefined) {
      if (!pickerEmitted) { blocks.push({ kind: "factor-picker" }); pickerEmitted = true; }
      if (group !== factor) continue;
    }
    if (section.tab) {
      const scope = group ?? "$";
      if (emittedTabs.has(scope)) continue;
      emittedTabs.add(scope);
      blocks.push({ kind: "tabs", scope, sections: sections.filter((s) => s.tab && (factorGroupOf(s.id) ?? "$") === scope) });
    } else blocks.push({ kind: "section", section });
  }
  return blocks;
}

export function ResultView({ run }: { run: BacktestRun }) {
  const result = run.result as BacktestResult;
  const [selections, setSelections] = useState<Selections>(() => ({ [GLOBAL]: defaultSelection(result.filters), ...Object.fromEntries(result.sections.filter((s) => s.filters.length).map((s) => [s.id, defaultSelection(s.filters)])) }));
  const factorGroups = useMemo(() => Array.from(new Set(result.sections.map((s) => factorGroupOf(s.id)).filter((g): g is string => g !== undefined))), [result.sections]);
  const [factor, setFactor] = useState<string | undefined>(factorGroups[0]);
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});
  const globalSelection = selections[GLOBAL] ?? {};
  const select = (scope: string, key: string, value: string) => setSelections((current) => ({ ...current, [scope]: { ...current[scope], [key]: value } }));

  // 旧 Overview：点主表某一列的表头，下面的单指标条形图跟着换成该指标（选项 value 与列 key 对应时）。
  const followSortedColumn = (key: string) => {
    const bars = result.sections.find((s) => s.id === "metric_bars");
    const filter = bars?.filters.find((f) => f.options.some((o) => o.value === key));
    if (bars && filter) select(bars.id, filter.key, key);
  };

  const renderSection = (raw: ResultSection, framed = true) => {
    const section = withLayoutDefaults(result, raw);
    const local = selections[section.id] ?? {};
    const merged = { ...globalSelection, ...local };
    const body = <>
      <FilterBar filters={section.filters} selection={local} onSelect={(key, value) => select(section.id, key, value)} ariaLabel={`${sectionTitle(section) ?? section.id} 显示档位`} />
      {run.result?.board === "trading" && section.type === "series" && section.id === "pnl_curves"
        ? <PnlCurvesPanel section={{ ...section, series: section.series.filter((line) => matchesFilters(line, merged)) }} />
        : <SectionBody section={section} runId={run.runId} selection={merged} csvName={`${run.runId}-${section.id.replaceAll(":", "_")}`} onSortChange={section.id === "main" ? followSortedColumn : undefined} />}
    </>;
    return framed ? <SectionFrame key={section.id} section={section}>{body}</SectionFrame> : <div key={section.id} className="bt-tab-section">{sectionTitle(section) && <h4 className="bt-tab-section-title">{sectionTitle(section)}</h4>}{section.caption && <p className="bt-caption">{section.caption}</p>}{body}</div>;
  };

  const visible = result.sections.filter((section) => sectionVisible(section, globalSelection));
  return <>
    {result.warnings.map((warning) => <V2Notice key={warning.text} error={warning.level === "error"} title={warning.level === "info" ? "说明" : warning.level === "error" ? "错误" : "注意"} description={warning.text} />)}
    <FilterBar filters={result.filters} selection={globalSelection} onSelect={(key, value) => select(GLOBAL, key, value)} ariaLabel="结果显示档位" />
    {layoutBlocks(visible, factor).map((block) => {
      if (block.kind === "section") return renderSection(block.section);
      if (block.kind === "factor-picker") return <div className="bt-filterbar bt-factor-picker" key="factor-picker"><label className="bt-filter"><span className="bt-filter-label">因子明细（{factorGroups.length} 个因子）</span><select className="select" aria-label="因子明细" value={factor} onChange={(event) => setFactor(event.target.value)}>{factorGroups.map((g) => <option key={g} value={g}>{g}</option>)}</select></label></div>;
      const tabs = Array.from(new Set(block.sections.map((s) => s.tab as string)));
      const current = tabs.includes(activeTab[block.scope]) ? activeTab[block.scope] : tabs[0];
      const tabId = (tab: string) => `bt-tab-${block.scope}-${tab}`;
      // 标签页键盘操作：← → Home End 切换并聚焦（与 V2Tabs 一致，未选中的标签页不在 Tab 顺序里）
      const onTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        setActiveTab((state) => ({ ...state, [block.scope]: tabs[next] }));
        document.getElementById(tabId(tabs[next]))?.focus();
      };
      return <section className="bt-section bt-tabs-block" key={`tabs-${block.scope}`}>
        <div className="v2-local-tabs" role="tablist" aria-label="明细">{tabs.map((tab, index) => <button type="button" role="tab" key={tab} id={tabId(tab)} aria-selected={tab === current} aria-controls={`bt-tabpanel-${block.scope}`} tabIndex={tab === current ? 0 : -1} className={tab === current ? "active" : ""} onClick={() => setActiveTab((state) => ({ ...state, [block.scope]: tab }))} onKeyDown={(event) => onTabKey(event, index)}>{tab}</button>)}</div>
        <div role="tabpanel" id={`bt-tabpanel-${block.scope}`} aria-labelledby={tabId(current)} className="bt-tabpanel" tabIndex={0}>{block.sections.filter((s) => s.tab === current).map((s) => renderSection(s, false))}</div>
      </section>;
    })}
    {result.artifacts.length > 0 && <section className="bt-section"><h3 className="bt-section-title">产物文件</h3><p className="bt-caption">单个文件在完整产物包里（页面顶部「下载产物包」）；只有结果里直接展示的图片可单独打开。</p><ul className="bt-artifacts">{result.artifacts.map((artifact) => <li key={artifact.path}><span>{artifact.name}</span>{artifact.bytes !== undefined && <small>{formatNumber(artifact.bytes / 1024, 1)} KB</small>}<code>{artifact.path}</code></li>)}</ul></section>}
  </>;
}
