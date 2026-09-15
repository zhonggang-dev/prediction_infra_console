"use client";

import { useEffect, useState } from "react";
import { consoleApi } from "../lib/console-api";
import type { ConsoleGeneratedMarket, GeneratedMarketList } from "../lib/types";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";
import { Status } from "./status";

const statusOptions = [["", "全部状态"], ["PENDING", "等待中"], ["RUNNING", "运行中"], ["RESOLVED", "已解决"], ["DEFERRED", "已延期"], ["UNRESOLVED", "未解决"], ["FINAL_UNRESOLVED", "最终未解决"]];
const typeOptions = [["", "全部题型"], ["event_choice", "事件型"], ["numeric_bucket", "数值型"]];
const domainOptions = ["", "Crypto", "Culture", "Esports", "Finance", "Other", "Politics", "Science/Tech", "Sports", "Weather", "World/Geopolitics"];
const statusLabels: Record<string, string> = { PENDING: "等待中", RUNNING: "运行中", RESOLVED: "已解决", DEFERRED: "已延期", UNRESOLVED: "未解决", FINAL_UNRESOLVED: "最终未解决", ANNUL: "已作废", MECE_FAIL: "结构失败" };
const statusColors: Record<string, string> = { PENDING: "#a85f08", RUNNING: "#d8902f", RESOLVED: "#1d8d75", DEFERRED: "#56a98d", UNRESOLVED: "#b84439", FINAL_UNRESOLVED: "#8e3028", ANNUL: "#7c6f65", MECE_FAIL: "#594d46" };

export function QuestionLibraryPage() {
  const [filters, setFilters] = useState({ q: "", status: "", questionType: "", domain: "", endFrom: "", endTo: "" });
  const [draft, setDraft] = useState(filters);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<GeneratedMarketList>();
  const [selected, setSelected] = useState<ConsoleGeneratedMarket>();
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void consoleApi.generatedMarkets({ ...filters, offset: page * 20, limit: 20 }).then((response) => {
      if (!cancelled) { setResult(response.data); setError(undefined); }
    }).catch((requestError) => {
      if (!cancelled) setError(requestError instanceof Error ? requestError.message : "题目查询失败");
    });
    return () => { cancelled = true; };
  }, [filters, page, refreshKey]);

  const search = () => { setPage(0); setSelected(undefined); setFilters(draft); };
  return <ConsoleShell>
    <header className="page-head">
      <div><p className="eyebrow">Generated Markets</p><h1>题目库</h1><p className="description">从数据中台检索题目、答案发现状态和下次调度时间。</p></div>
      <button className="button" onClick={() => setRefreshKey((value) => value + 1)}><Icon name="refresh" /> 刷新数据</button>
    </header>
    <section className="question-summary">
      <span>共 <strong>{result?.total ?? "—"}</strong> 道题</span><span>当前页 <strong>{result?.items.length ?? "—"}</strong> 道</span><span>排序 <strong>最新创建优先</strong></span><span>查询来自 <strong>Prediction Infra</strong></span>
    </section>
    {result && <StatusDistribution counts={result.statusCounts} />}
    <section className="panel question-panel">
      <div className="question-filters">
        <label className="question-search"><span>关键词</span><input className="input" placeholder="题目、ID、事件或原因码" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} onKeyDown={(event) => event.key === "Enter" && search()} /></label>
        <label><span>状态</span><select className="select" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>题型</span><select className="select" value={draft.questionType} onChange={(event) => setDraft({ ...draft, questionType: event.target.value })}>{typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>领域</span><select className="select" value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })}>{domainOptions.map((domain) => <option key={domain} value={domain}>{domain || "全部领域"}</option>)}</select></label>
        <label><span>end_at 起始</span><input className="input" type="date" value={draft.endFrom} onChange={(event) => setDraft({ ...draft, endFrom: event.target.value })} /></label>
        <label><span>end_at 结束</span><input className="input" type="date" value={draft.endTo} onChange={(event) => setDraft({ ...draft, endTo: event.target.value })} /></label>
        <button className="button primary question-search-action" onClick={search}><Icon name="search" /> 检索</button>
      </div>
      {error && <div className="notice error"><div><strong>题目查询失败</strong><p>{error}</p></div></div>}
      {selected && <><button className="question-drawer-backdrop" aria-label="关闭题目详情" onClick={() => setSelected(undefined)} /><aside className="question-drawer"><QuestionDetail market={selected} onClose={() => setSelected(undefined)} /></aside></>}
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

function QuestionTable({ items, onSelect }: { items: ConsoleGeneratedMarket[]; onSelect: (item: ConsoleGeneratedMarket) => void }) {
  return <div className="table-scroll"><table className="question-table"><thead><tr><th>题目</th><th>状态</th><th>最终答案</th><th>题型</th><th>阶段</th><th>end_at</th><th>下次调度</th><th>尝试</th></tr></thead><tbody>{items.map((item) => <tr key={item.generatedMarketId} onClick={() => onSelect(item)}><td className="question-primary"><strong>{item.question}</strong><small>{item.generatedMarketId} · {item.conditionId}</small></td><td><Status value={item.status} /></td><td className="question-answer-cell">{item.resolvedOutcomeId ? <><strong>{item.resolvedOutcomeId}</strong><span>{item.resolvedOutcomeName}</span></> : "—"}</td><td>{item.questionType === "numeric_bucket" ? "数值型" : "事件型"}</td><td className="mono muted">{item.phase}</td><td className="mono muted">{formatTime(item.endAt)}</td><td className="mono muted">{formatTime(item.nextRunAt)}</td><td className="mono">{item.attemptCount}</td></tr>)}</tbody></table></div>;
}

function QuestionDetail({ market, onClose }: { market: ConsoleGeneratedMarket; onClose: () => void }) {
  return <div className="question-detail"><div className="section-head"><div><p className="eyebrow">Question Detail</p><h2 className="section-title">题目详情</h2></div><button className="button" onClick={onClose}>关闭</button></div><div className="question-detail-meta"><Status value={market.status} /><span>{market.phase}</span><span>{market.questionType === "numeric_bucket" ? "数值型" : "事件型"}</span><span>{market.primaryDomain}</span></div><div className="question-detail-copy"><h3>{market.question}</h3><p>{market.description}</p>{market.resolvedOutcomeId && <div className="question-final-answer"><span>最终答案</span><strong>{market.resolvedOutcomeId} · {market.resolvedOutcomeName}</strong>{market.resolutionQuote && <q>{market.resolutionQuote}</q>}</div>}<h4>结算规则</h4><p>{market.resolutionRules}</p></div><div className="detail-grid"><DetailValue label="题目 ID" value={market.generatedMarketId} /><DetailValue label="Condition ID" value={market.conditionId} /><DetailValue label="end_at" value={formatTime(market.endAt)} /><DetailValue label="下次调度" value={formatTime(market.nextRunAt)} /><DetailValue label="最近原因" value={market.lastReasonCode} /><DetailValue label="尝试次数" value={String(market.attemptCount)} /><DetailValue label="生成请求" value={market.generationRequestId || "—"} /><DetailValue label="事件去重标识" value={market.eventInstanceId} /></div><p className="question-identity-help">事件去重标识用于判断两道题是否描述同一个现实事件，避免重复生成和重复入库；它不是用户可编辑的业务字段。</p><div className="question-outcomes"><h4>选项</h4>{market.outcomes.map((outcome, index) => { const option = outcomeObject(outcome); const selected = option.id === market.resolvedOutcomeId; return <span className={selected ? "selected" : ""} key={index}>{option.id ? `${option.id} · ` : ""}{option.name}{selected && <b>最终答案</b>}</span>; })}</div></div>;
}

function DetailValue({ label, value }: { label: string; value: string }) { return <div><div className="detail-key">{label}</div><div className="detail-value">{value}</div></div>; }
function formatTime(value?: string) { return value ? `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC` : "—"; }
function outcomeObject(value: unknown) { if (typeof value !== "object" || value === null) return { id: "", name: String(value) }; const outcome = value as { outcome_id?: unknown; option_id?: unknown; name?: unknown; label?: unknown }; return { id: String(outcome.outcome_id ?? outcome.option_id ?? ""), name: String(outcome.name ?? outcome.label ?? "") }; }
