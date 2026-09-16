"use client";

import { useEffect, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { formatResolutionRules } from "../lib/resolution-rules";
import { formatTopicPath } from "../lib/topic-paths";
import type { ConsoleGeneratedQA, GeneratedQAList } from "../lib/types";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";
import { Status } from "./status";

const statusOptions = [["", "全部状态"], ["PENDING", "等待中"]];
const statusLabels: Record<string, string> = { PENDING: "等待中" };
const statusColors: Record<string, string> = { PENDING: "#a85f08" };

export function QuestionLibraryPage() {
  const [filters, setFilters] = useState({ q: "", status: "", questionType: "", domain: "", endFrom: "", endTo: "" });
  const [draft, setDraft] = useState(filters);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<GeneratedQAList>();
  const [selected, setSelected] = useState<ConsoleGeneratedQA>();
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void consoleApi.generatedQAs({ ...filters, offset: page * 20, limit: 20 }).then((response) => {
      if (!cancelled) { setResult(response.data); setError(undefined); }
    }).catch((requestError) => {
      if (!cancelled) setError(requestError instanceof Error ? requestError.message : "题目查询失败");
    });
    return () => { cancelled = true; };
  }, [filters, page, refreshKey]);

  const search = () => { setPage(0); setSelected(undefined); setFilters(draft); };
  return <ConsoleShell>
    <header className="page-head">
      <div><p className="eyebrow">Generated QA</p><h1>题目库</h1><p className="description">检索新版 ForecastQuestion，并查看原生答案空间、时间合同和证据约束。</p></div>
      <button className="button" onClick={() => setRefreshKey((value) => value + 1)}><Icon name="refresh" /> 刷新数据</button>
    </header>
    <section className="question-summary">
      <span>共 <strong>{result?.total ?? "—"}</strong> 道题</span><span>当前页 <strong>{result?.items.length ?? "—"}</strong> 道</span><span>排序 <strong>最新创建优先</strong></span><span>查询来自 <strong>Prediction Infra</strong></span>
    </section>
    {result && <StatusDistribution counts={result.statusCounts} />}
    <section className="panel question-panel">
      <div className="question-filters">
        <label className="question-search"><span>关键词</span><input className="input" placeholder="题目、ID、语义键或事件键" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} onKeyDown={(event) => event.key === "Enter" && search()} /></label>
        <label><span>状态</span><select className="select" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>题型</span><select className="select" value={draft.questionType} onChange={(event) => setDraft({ ...draft, questionType: event.target.value })}><option value="">全部题型</option>{(result?.questionTypeOptions ?? []).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label><span>领域</span><select className="select" value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })}><option value="">全部领域</option>{(result?.domainOptions ?? []).map((domain) => <option key={domain} value={domain}>{formatTopicPath(domain)}</option>)}</select></label>
        <label><span>可得时间起始</span><input className="input" type="date" value={draft.endFrom} onChange={(event) => setDraft({ ...draft, endFrom: event.target.value })} /></label>
        <label><span>可得时间结束</span><input className="input" type="date" value={draft.endTo} onChange={(event) => setDraft({ ...draft, endTo: event.target.value })} /></label>
        <button className="button primary question-search-action" onClick={search}><Icon name="search" /> 检索</button>
      </div>
      {error && <div className="notice error"><div><strong>题目查询失败</strong><p>{error}</p></div></div>}
      {selected && <><button className="question-drawer-backdrop" aria-label="关闭题目详情" onClick={() => setSelected(undefined)} /><aside className="question-drawer"><QuestionDetail item={selected} onClose={() => setSelected(undefined)} /></aside></>}
      {!result ? <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : result.items.length ? <QuestionTable items={result.items} onSelect={setSelected} /> : <div className="empty"><strong>没有匹配的题目</strong><p>调整关键词或筛选条件后再试。</p></div>}
      {result && <div className="question-pagination"><span>第 {result.total ? result.offset + 1 : 0}–{Math.min(result.offset + result.items.length, result.total)} 条，共 {result.total} 条</span><div><button className="button" disabled={result.offset === 0} onClick={() => setPage(Math.max(0, page - 1))}>上一页</button><button className="button" disabled={result.offset + result.limit >= result.total} onClick={() => setPage(page + 1)}>下一页</button></div></div>}
    </section>
  </ConsoleShell>;
}

function StatusDistribution({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0).sort((left, right) => right[1] - left[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const stops = entries.reduce<{ stops: string[]; cursor: number }>((accumulator, [status, count]) => {
    const start = accumulator.cursor;
    const end = start + (count / Math.max(total, 1)) * 360;
    return { stops: [...accumulator.stops, `${statusColors[status] ?? "#8b9992"} ${start}deg ${end}deg`], cursor: end };
  }, { stops: [], cursor: 0 }).stops;
  return <section className="status-distribution panel"><div className="status-donut" style={{ background: `conic-gradient(${stops.join(", ") || "#dfe5dd 0deg 360deg"})` }}><div><strong>{total}</strong><span>总题数</span></div></div><div className="status-legend">{entries.map(([status, count]) => <div className="status-legend-item" key={status}><i style={{ background: statusColors[status] ?? "#8b9992" }} /><span>{statusLabels[status] ?? status}</span><div className="status-legend-values"><strong>{count}</strong><small>{total ? `${Math.round((count / total) * 100)}%` : "0%"}</small></div></div>)}</div></section>;
}

function QuestionTable({ items, onSelect }: { items: ConsoleGeneratedQA[]; onSelect: (item: ConsoleGeneratedQA) => void }) {
  return <div className="table-scroll"><table className="question-table"><thead><tr><th>题目</th><th>状态</th><th>领域</th><th>题型</th><th>阶段</th><th>可得时间</th><th>生成请求</th></tr></thead><tbody>{items.map((item) => <tr key={item.generatedQaId} onClick={() => onSelect(item)}><td className="question-primary"><strong>{item.question}</strong><small>{item.generatedQaId} · {item.sourceQaId}</small></td><td><Status value={item.status} /></td><td><span className="domain-badges"><span>{formatTopicPath(item.topicPath)}</span></span></td><td className="mono muted">{item.answerType}</td><td className="mono muted">{item.phase}</td><td className="mono muted">{formatTime(item.availableAfter)}</td><td className="mono muted">{item.generationRequestId || "—"}</td></tr>)}</tbody></table></div>;
}

function QuestionDetail({ item, onClose }: { item: ConsoleGeneratedQA; onClose: () => void }) {
  const ruleSections = formatResolutionRules(item.resolutionCriteria);
  return <div className="question-detail"><div className="section-head"><div><p className="eyebrow">Question Detail</p><h2 className="section-title">题目详情</h2></div><button className="button" onClick={onClose}>关闭</button></div>
    <div className="question-detail-meta"><Status value={item.status} /><span>{item.phase}</span><span>{item.answerType}</span><span>{item.taskFamily}</span><span>{item.marketCompatible ? "Market compatible" : "Decision task"}</span><span>{formatTopicPath(item.topicPath)}</span></div>
    <div className="question-detail-copy"><h3>{item.question}</h3><p>{item.context}</p><h4>结算或评价规则</h4><div className="resolution-rule-sections">{ruleSections.map((section) => <section key={section.key}>{section.title && <h5>{section.title}</h5>}<p>{section.content}</p></section>)}</div></div>
    <div className="question-specs">
      <SpecSection title="答案空间" value={item.answerSpec} />
      {item.decisionSpec && <SpecSection title="决策约束" value={item.decisionSpec} />}
      <SpecSection title="时间合同" value={item.temporalContract} />
      <SpecSection title="证据依据" value={item.grounding} />
      <SpecSection title="可预测性" value={item.forecastability} />
    </div>
    <div className="detail-grid"><DetailValue label="题目 ID" value={item.generatedQaId} /><DetailValue label="Source QA ID" value={item.sourceQaId} /><DetailValue label="可得时间" value={formatTime(item.availableAfter)} /><DetailValue label="生成请求" value={item.generationRequestId || "—"} /><DetailValue label="语义键" value={item.semanticKey} /><DetailValue label="事件键" value={item.eventClusterKey || "—"} /><DetailValue label="Ground Truth" value={item.groundTruthKind} /><DetailValue label="领域" value={item.topicPath} /></div>
    <div className="question-outcomes"><h4>选项</h4>{item.options.length ? item.options.map((option, index) => { const value = optionObject(option); return <span key={index}>{value.id ? `${value.id} · ` : ""}{value.name}</span>; }) : <span>开放答案空间，无固定选项</span>}</div>
  </div>;
}

function SpecSection({ title, value }: { title: string; value: unknown }) {
  return <section className="question-spec"><h4>{title}</h4><pre>{JSON.stringify(value, null, 2)}</pre></section>;
}

function DetailValue({ label, value }: { label: string; value: string }) { return <div><div className="detail-key">{label}</div><div className="detail-value">{value}</div></div>; }
function formatTime(value?: string) { return value ? `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC` : "—"; }
function optionObject(value: unknown) { if (typeof value !== "object" || value === null) return { id: "", name: String(value) }; const option = value as { option_id?: unknown; label?: unknown }; return { id: String(option.option_id ?? ""), name: String(option.label ?? "") }; }
