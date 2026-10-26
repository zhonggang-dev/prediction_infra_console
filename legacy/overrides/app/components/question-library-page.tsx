"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { consoleApi } from "../lib/console-api";
import { formatResolutionRules } from "../lib/resolution-rules";
import { formatTopicPath } from "../lib/topic-paths";
import type { ConsoleGeneratedQA, GeneratedQAList } from "../lib/types";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";
import { Status } from "./status";

const statusOptions = [["", "全部状态"], ["PENDING", "等待中"]];
const answerTypeLabels: Record<string, string> = {
  action_plan: "Action Plan",
  allocation_plan: "Allocation Plan",
  boolean: "Boolean",
  categorical: "Categorical",
  datetime_duration: "Date or Duration",
  experiment_plan: "Experiment Plan",
  monitoring_policy: "Monitoring Policy",
  numeric_bucket: "Numeric Bucket",
  numeric_open: "Open Numeric",
  ranking_entity: "Entity Ranking",
  risk_register: "Risk Register",
  scenario_matrix: "Scenario Matrix",
  threshold: "Threshold",
  trajectory: "Trajectory",
};

type QuestionFilters = {
  q: string;
  status: string;
  questionType: string;
  domainL1: string;
  domainPath: string;
  endFrom: string;
  endTo: string;
};

const emptyFilters: QuestionFilters = {
  q: "", status: "", questionType: "", domainL1: "", domainPath: "", endFrom: "", endTo: "",
};

export function QuestionLibraryPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [draft, setDraft] = useState(emptyFilters);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<GeneratedQAList>();
  const [selected, setSelected] = useState<ConsoleGeneratedQA>();
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void consoleApi.generatedQAs({
      q: filters.q,
      status: filters.status,
      questionType: filters.questionType,
      domain: filters.domainPath || filters.domainL1,
      endFrom: filters.endFrom,
      endTo: filters.endTo,
      offset: page * 20,
      limit: 20,
    }).then((response) => {
      if (!cancelled) { setResult(response.data); setError(undefined); }
    }).catch((requestError) => {
      if (!cancelled) setError(requestError instanceof Error ? requestError.message : "题目查询失败");
    });
    return () => { cancelled = true; };
  }, [filters, page, refreshKey]);

  const domainOptions = result?.domainOptions;
  const primaryDomains = useMemo(() => [...new Set((domainOptions ?? []).map(primaryDomain))], [domainOptions]);
  const secondaryDomains = draft.domainL1
    ? (domainOptions ?? []).filter((path) => primaryDomain(path) === draft.domainL1)
    : [];
  const search = () => { setPage(0); setSelected(undefined); setFilters(draft); };

  return <ConsoleShell>
    <header className="page-head">
      <div><p className="eyebrow">Generated Questions</p><h1>题目库</h1><p className="description">检索生成题目，查看题目背景、答案空间、结算规则和来源依据。</p></div>
      <button className="button" onClick={() => setRefreshKey((value) => value + 1)}><Icon name="refresh" /> 刷新数据</button>
    </header>
    <section className="question-summary">
      <span>共 <strong>{result?.total ?? "—"}</strong> 道题</span><span>当前页 <strong>{result?.items.length ?? "—"}</strong> 道</span><span>排序 <strong>最新创建优先</strong></span><span>数据源 <strong>QA Producer</strong></span>
    </section>
    {result && <QuestionOverview result={result} />}
    <section className="panel question-panel">
      <div className="question-filters">
        <label className="question-search"><span>关键词</span><input className="input" placeholder="题目、QA ID、语义键或事件键" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} onKeyDown={(event) => event.key === "Enter" && search()} /></label>
        <label className="question-status-filter"><span>状态</span><select className="select" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="question-type-filter"><span>题型</span><select className="select" value={draft.questionType} onChange={(event) => setDraft({ ...draft, questionType: event.target.value })}><option value="">全部题型</option>{(result?.questionTypeOptions ?? []).map((type) => <option key={type} value={type}>{answerTypeLabel(type)}</option>)}</select></label>
        <label className="question-domain-l1-filter"><span>一级领域</span><select className="select" value={draft.domainL1} onChange={(event) => setDraft({ ...draft, domainL1: event.target.value, domainPath: "" })}><option value="">全部一级领域</option>{primaryDomains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}</select></label>
        <label className="question-domain-l2-filter"><span>二级领域</span><select className="select" value={draft.domainPath} disabled={!draft.domainL1} onChange={(event) => setDraft({ ...draft, domainPath: event.target.value })}><option value="">{draft.domainL1 ? "全部二级领域" : "请先选择一级领域"}</option>{secondaryDomains.map((path) => <option key={path} value={path}>{secondaryDomain(path)}</option>)}</select></label>
        <label className="question-date-filter"><span>observation_end 起始</span><input className="input" type="date" value={draft.endFrom} onChange={(event) => setDraft({ ...draft, endFrom: event.target.value })} /></label>
        <label className="question-date-filter"><span>observation_end 结束</span><input className="input" type="date" value={draft.endTo} onChange={(event) => setDraft({ ...draft, endTo: event.target.value })} /></label>
        <div className="question-filter-actions"><button className="button" onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); setPage(0); }}>重置</button><button className="button primary question-search-action" onClick={search}><Icon name="search" /> 检索</button></div>
      </div>
      {error && <div className="notice error"><div><strong>题目查询失败</strong><p>{error}</p></div></div>}
      {selected && <><button className="question-drawer-backdrop" aria-label="关闭题目详情" onClick={() => setSelected(undefined)} /><aside className="question-drawer"><QuestionDetail item={selected} onClose={() => setSelected(undefined)} /></aside></>}
      {!result ? <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : result.items.length ? <QuestionTable items={result.items} onSelect={setSelected} /> : <div className="empty"><strong>没有匹配的题目</strong><p>调整关键词或筛选条件后再试。</p></div>}
      {result && <div className="question-pagination"><span>第 {result.total ? result.offset + 1 : 0}–{Math.min(result.offset + result.items.length, result.total)} 条，共 {result.total} 条</span><div><button className="button" disabled={result.offset === 0} onClick={() => setPage(Math.max(0, page - 1))}>上一页</button><button className="button" disabled={result.offset + result.limit >= result.total} onClick={() => setPage(page + 1)}>下一页</button></div></div>}
    </section>
  </ConsoleShell>;
}

function QuestionOverview({ result }: { result: GeneratedQAList }) {
  const pending = result.statusCounts.PENDING ?? 0;
  const market = result.marketCompatibleCounts.market ?? 0;
  const decision = result.marketCompatibleCounts.decision ?? 0;
  return <section className="question-overview panel">
    <div className="question-overview-total"><strong>{result.total}</strong><span>题目总数</span></div>
    <OverviewMetric label="等待结算" value={pending} tone="amber" />
    <OverviewMetric label="预测市场题" value={market} tone="mint" />
    <OverviewMetric label="决策分析题" value={decision} tone="ink" />
    <OverviewMetric label="答案类型" value={result.questionTypeOptions.length} tone="neutral" />
  </section>;
}

function OverviewMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`question-overview-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function QuestionTable({ items, onSelect }: { items: ConsoleGeneratedQA[]; onSelect: (item: ConsoleGeneratedQA) => void }) {
  return <div className="table-scroll"><table className="question-table"><colgroup><col className="question-col" /><col className="status-col" /><col className="domain-col" /><col className="type-col" /><col className="time-col" /></colgroup><thead><tr><th>题目</th><th>状态</th><th>领域</th><th>题型</th><th>observation_end</th></tr></thead><tbody>{items.map((item) => <tr key={item.generatedQaId} onClick={() => onSelect(item)}><td className="question-primary"><strong>{item.question}</strong><small>{item.sourceQaId}</small></td><td><Status value={item.status} /></td><td><div className="domain-path"><strong>{item.domainL1}</strong><span>{item.industryL2}</span></div></td><td><span className="question-type-badge">{answerTypeLabel(item.answerType)}</span></td><td className="mono muted">{formatTime(item.endAt)}</td></tr>)}</tbody></table></div>;
}

function QuestionDetail({ item, onClose }: { item: ConsoleGeneratedQA; onClose: () => void }) {
  const answerSpec = asRecord(item.answerSpec);
  const decisionSpec = asRecord(item.decisionSpec);
  const temporal = asRecord(item.temporalContract);
  const grounding = asRecord(item.grounding);
  const forecastability = asRecord(item.forecastability);
  const ruleSections = formatResolutionRules(item.resolutionCriteria);
  return <div className="question-detail">
    <div className="question-detail-head"><div><p className="eyebrow">Question Detail</p><h2 className="section-title">题目详情</h2></div><button className="button" onClick={onClose}>关闭</button></div>
    <div className="question-detail-meta"><Status value={item.status} /><span>{answerTypeLabel(item.answerType)}</span><span>{phaseLabel(item.phase)}</span><span>{item.marketCompatible ? "预测市场题" : "决策分析题"}</span><span>{formatTopicPath(item.topicPath)}</span></div>
    <section className="question-detail-copy"><h3>{item.question}</h3><p>{item.context}</p></section>
    <DetailSection title="结算或评价规则"><div className="resolution-rule-sections">{ruleSections.map((section) => <section key={section.key}>{section.title && <h5>{section.title}</h5>}<p>{section.content}</p></section>)}</div></DetailSection>
    <DetailSection title="选项与答案空间"><OptionsList options={item.options} /><FactGrid values={[
      ["答案类型", answerTypeLabel(text(answerSpec.type) || item.answerType)],
      ["单位", text(answerSpec.unit)], ["精度", text(answerSpec.precision)],
      ["答案数量", text(answerSpec.cardinality)], ["有效范围", display(answerSpec.valid_range)],
      ["记录系统", text(answerSpec.record_system)],
    ]} /><TextList title="约束" values={stringList(answerSpec.constraints)} /></DetailSection>
    {Object.keys(decisionSpec).length > 0 && <DetailSection title="决策约束"><FactGrid values={[["决策负责人", text(decisionSpec.decision_owner)]]} /><TextList title="目标" values={stringList(decisionSpec.objectives)} /><TextList title="约束" values={stringList(decisionSpec.constraints)} /><TextList title="输出章节" values={stringList(decisionSpec.required_sections)} /><TextList title="情景" values={stringList(decisionSpec.scenarios)} /><TextList title="评价指标" values={stringList(decisionSpec.evaluation_metrics)} /></DetailSection>}
    <DetailSection title="时间合同"><div className="timeline-list"><TimeRow label="信息截止" value={temporal.as_of_at} /><TimeRow label="观察开始" value={temporal.observation_start} /><TimeRow label="observation_end" value={temporal.observation_end} /><TimeRow label="answer_available_after" value={temporal.answer_available_after} /><TimeRow label="evaluation_available_after" value={temporal.evaluation_available_after} /></div></DetailSection>
    <DetailSection title="证据依据"><SourceLinks values={stringList(grounding.source_urls)} /><TextList title="已验证事实" values={stringList(grounding.verified_facts)} /><TextList title="情景假设" values={stringList(grounding.scenario_assumptions)} />{text(grounding.evidence_excerpt) && <div className="evidence-excerpt"><span>证据摘录</span><p>{text(grounding.evidence_excerpt)}</p></div>}</DetailSection>
    <DetailSection title="可预测性"><FactGrid values={[["当前未知原因", text(forecastability.why_not_known_now)], ["预测依据", text(forecastability.basis)], ["信息价值", text(forecastability.information_value)]]} /><TextList title="不确定因素" values={stringList(forecastability.uncertainty_drivers)} /></DetailSection>
    <details className="question-audit"><summary>审计标识</summary><div className="detail-grid"><DetailValue label="内部 ID" value={item.generatedQaId} /><DetailValue label="QA ID" value={item.sourceQaId} /><DetailValue label="生成请求" value={item.generationRequestId || "—"} /><DetailValue label="语义键" value={item.semanticKey} /><DetailValue label="事件键" value={item.eventClusterKey || "—"} /><DetailValue label="Ground Truth" value={item.groundTruthKind} /></div></details>
  </div>;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="question-detail-section"><h4>{title}</h4>{children}</section>;
}

function OptionsList({ options }: { options: unknown[] }) {
  if (!options.length) return <p className="question-empty-value">开放答案空间，无固定选项</p>;
  return <div className="option-list">{options.map((option, index) => { const value = optionObject(option); return <div key={`${value.id}-${index}`}><strong>{value.id || index + 1}</strong><span>{value.name}</span>{value.canonical && <small>{value.canonical}</small>}</div>; })}</div>;
}

function FactGrid({ values }: { values: Array<[string, string]> }) {
  const visible = values.filter(([, value]) => value && value !== "—");
  if (!visible.length) return null;
  return <div className="fact-grid">{visible.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function TextList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return <div className="structured-list"><h5>{title}</h5><ul>{values.map((value) => <li key={value}>{value}</li>)}</ul></div>;
}

function SourceLinks({ values }: { values: string[] }) {
  const links = values.filter(safeSourceUrl);
  if (!links.length) return null;
  return <div className="source-links"><h5>来源</h5>{links.map((value) => <a href={value} target="_blank" rel="noreferrer" key={value}>{value}</a>)}</div>;
}

function TimeRow({ label, value }: { label: string; value: unknown }) {
  if (!value) return null;
  return <div><span>{label}</span><strong>{formatTime(String(value))}</strong></div>;
}

function DetailValue({ label, value }: { label: string; value: string }) { return <div><div className="detail-key">{label}</div><div className="detail-value">{value}</div></div>; }
function answerTypeLabel(value: string) { return answerTypeLabels[value] ?? value.replaceAll("_", " "); }
function phaseLabel(value: string) { return value === "POST_END" ? "结束后" : value === "PRE_END" ? "结束前" : value; }
function primaryDomain(value: string) { const index = value.indexOf("."); return index < 0 ? value : value.slice(0, index); }
function secondaryDomain(value: string) { const index = value.indexOf("."); return index < 0 ? value : value.slice(index + 1); }
function formatTime(value?: string) { return value ? `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC` : "—"; }
function asRecord(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return value === undefined || value === null || value === "" ? "—" : String(value); }
function display(value: unknown) { return Array.isArray(value) ? value.map(String).join(" – ") : text(value); }
function stringList(value: unknown) { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function safeSourceUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }
function optionObject(value: unknown) { if (typeof value !== "object" || value === null) return { id: "", name: String(value), canonical: "" }; const option = value as { option_id?: unknown; label?: unknown; canonical_value?: unknown }; return { id: String(option.option_id ?? ""), name: String(option.label ?? ""), canonical: typeof option.canonical_value === "string" || typeof option.canonical_value === "number" ? String(option.canonical_value) : "" }; }
