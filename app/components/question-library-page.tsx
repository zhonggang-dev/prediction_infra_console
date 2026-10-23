"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { consoleApi } from "../lib/console-api";
import { readAnswerAudit } from "../lib/answer-audit";
import { formatResolutionRules } from "../lib/resolution-rules";
import { formatTopicPath } from "../lib/topic-paths";
import type { ConsoleGeneratedQA, GeneratedQAList } from "../lib/types";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";
import { Status } from "./status";

const statusOptions = [
  ["", "全部状态"], ["PENDING", "等待中"], ["RUNNING", "运行中"], ["RESOLVED", "已解决"],
  ["DEFERRED", "已延期"], ["UNRESOLVED", "未解决"], ["FINAL_UNRESOLVED", "最终未解决"],
  ["ANNUL", "已作废"], ["MECE_FAIL", "结构失败"],
];
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
  const searchParams = useSearchParams();
  const initialLimit = normalizeQuestionLimit(searchParams.get("limit"));
  const initialPage = normalizeQuestionPage(searchParams.get("offset"), initialLimit);
  const initialFilters = questionFiltersFromUrl(searchParams);
  const [filters, setFilters] = useState(initialFilters);
  const [draft, setDraft] = useState(initialFilters);
  const [page, setPage] = useState(initialPage);
  const [limit, setLimit] = useState(initialLimit);
  const [result, setResult] = useState<GeneratedQAList>();
  const [selected, setSelected] = useState<ConsoleGeneratedQA>();
  const selectedTriggerRef = useRef<HTMLElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const syncPaginationFromUrl = () => {
      const urlParams = new URL(window.location.href).searchParams;
      const nextLimit = normalizeQuestionLimit(urlParams.get("limit"));
      const nextPage = normalizeQuestionPage(urlParams.get("offset"), nextLimit);
      const nextFilters = questionFiltersFromUrl(urlParams);
      setLimit(nextLimit);
      setPage(nextPage);
      setFilters(nextFilters);
      setDraft(nextFilters);
    };
    window.addEventListener("popstate", syncPaginationFromUrl);
    return () => window.removeEventListener("popstate", syncPaginationFromUrl);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setResult(undefined);
      setSelected(undefined);
      setError(undefined);
      void consoleApi.generatedQAs({
        q: filters.q,
        status: filters.status,
        questionType: filters.questionType,
        domain: filters.domainPath || filters.domainL1,
        endFrom: filters.endFrom,
        endTo: filters.endTo,
        offset: page * limit,
        limit,
      }).then((response) => {
        if (!cancelled) { setResult(response.data); setError(undefined); }
      }).catch((requestError) => {
        if (!cancelled) { setResult(undefined); setSelected(undefined); setError(requestError instanceof Error ? requestError.message : "题目查询失败"); }
      });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [filters, page, limit, refreshKey]);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => drawerCloseRef.current?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setSelected(undefined); return; }
      if (event.key !== "Tab") return;
      const drawer = drawerCloseRef.current?.closest<HTMLElement>(".question-drawer");
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]:not([tabindex=\"-1\"])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKeyDown); };
  }, [selected]);

  const closeQuestion = () => {
    setSelected(undefined);
    const trigger = selectedTriggerRef.current;
    selectedTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
  };

  const domainOptions = result?.domainOptions;
  const primaryDomains = useMemo(() => [...new Set((domainOptions ?? []).map(primaryDomain))], [domainOptions]);
  const secondaryDomains = draft.domainL1
    ? (domainOptions ?? []).filter((path) => primaryDomain(path) === draft.domainL1)
    : [];
  const search = () => {
    if (draft.endFrom && draft.endTo && draft.endTo < draft.endFrom) {
      setResult(undefined);
      setSelected(undefined);
      setError("observation_end 结束日期必须不早于起始日期；结束日期按 UTC 当天结束后的独占边界查询。");
      return;
    }
    setPage(0);
    setSelected(undefined);
    setFilters(draft);
    syncQuestionFiltersUrl(draft);
    syncQuestionPaginationUrl(limit, 0);
  };

  return <ConsoleShell>
    <header className="page-head">
      <div><p className="eyebrow">Generated Questions</p><h1>题目库</h1><p className="description">检索生成题目，查看题目背景、答案空间、结算规则和来源依据。</p></div>
      <button className="button" onClick={() => setRefreshKey((value) => value + 1)}><Icon name="refresh" /> 刷新数据</button>
    </header>
    <section className="question-summary">
      <span>共 <strong>{result?.total ?? "—"}</strong> 道题</span><span>当前页 <strong>{result?.items.length ?? "—"}</strong> 道</span><span>排序 <strong>最新创建优先</strong></span><span>数据源 <strong>QA Producer</strong></span>{result && <span>题型 <strong>{result.marketCompatibleCounts.market ?? 0} 预测 / {result.marketCompatibleCounts.decision ?? 0} 决策</strong></span>}
    </section>
    {result && <QuestionOverview result={result} />}
    <section className="panel question-panel">
      <div className="question-filters">
        <label className="question-search"><span>关键词</span><input className="input" placeholder="题目、QA ID、语义键或事件键" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} onKeyDown={(event) => event.key === "Enter" && search()} /></label>
        <label className="question-status-filter"><span>状态</span><select className="select" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="question-type-filter"><span>题型</span><select className="select" value={draft.questionType} onChange={(event) => setDraft({ ...draft, questionType: event.target.value })}><option value="">全部题型</option>{(result?.questionTypeOptions ?? []).map((type) => <option key={type} value={type}>{answerTypeLabel(type)}</option>)}</select></label>
        <label className="question-domain-l1-filter"><span>一级领域</span><select className="select" value={draft.domainL1} onChange={(event) => setDraft({ ...draft, domainL1: event.target.value, domainPath: "" })}><option value="">全部一级领域</option>{primaryDomains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}</select></label>
        <label className="question-domain-l2-filter"><span>二级领域</span><select className="select" value={draft.domainPath} disabled={!draft.domainL1} onChange={(event) => setDraft({ ...draft, domainPath: event.target.value })}><option value="">{draft.domainL1 ? "全部二级领域" : "请先选择一级领域"}</option>{secondaryDomains.map((path) => <option key={path} value={path}>{secondaryDomain(path)}</option>)}</select></label>
        <label className="question-date-filter"><span>observation_end 起始（UTC）</span><input className="input" type="date" value={draft.endFrom} onChange={(event) => setDraft({ ...draft, endFrom: event.target.value })} /></label>
        <label className="question-date-filter"><span>observation_end 结束（含当天，UTC）</span><input className="input" type="date" min={draft.endFrom || undefined} value={draft.endTo} onChange={(event) => setDraft({ ...draft, endTo: event.target.value })} /></label>
      <div className="question-filter-actions"><button className="button" onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); setPage(0); syncQuestionFiltersUrl(emptyFilters); syncQuestionPaginationUrl(limit, 0); }}>重置</button><button className="button primary question-search-action" onClick={search}><Icon name="search" /> 检索</button></div>
      </div>
      {error && <div className="notice error"><div><strong>题目查询失败</strong><p>{error}</p></div></div>}
      {selected && <><button className="question-drawer-backdrop" aria-label="关闭题目详情" onClick={closeQuestion} /><aside className="question-drawer" role="dialog" aria-modal="true" aria-labelledby="question-detail-title"><QuestionDetail item={selected} onClose={closeQuestion} closeRef={drawerCloseRef} /></aside></>}
      {!result ? <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : result.items.length ? <QuestionTable items={result.items} onSelect={(item, trigger) => { selectedTriggerRef.current = trigger; setSelected(item); }} /> : <div className="empty"><strong>没有匹配的题目</strong><p>调整关键词或筛选条件后再试。</p></div>}
      {result && <div className="question-pagination"><span>第 {result.total ? result.offset + 1 : 0}–{Math.min(result.offset + result.items.length, result.total)} 条，共 {result.total} 条 · 第 {result.total ? page + 1 : 0} / {result.total ? Math.ceil(result.total / result.limit) : 0} 页</span><div className="question-pagination-controls"><label className="v2-page-size"><span>每页</span><select className="select" aria-label="题目每页条数" value={limit} onChange={(event) => { const next = normalizeQuestionLimit(event.target.value); setLimit(next); setPage(0); syncQuestionPaginationUrl(next, 0); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><label className="v2-page-jump"><span>跳至</span><input className="input" aria-label="题目跳转页码" inputMode="numeric" placeholder="页码" onKeyDown={(event) => { if (event.key !== "Enter") return; const totalPages = Math.ceil(result.total / result.limit); const next = Number(event.currentTarget.value); if (Number.isSafeInteger(next) && next >= 1 && next <= totalPages) { setPage(next - 1); syncQuestionPaginationUrl(limit, (next - 1) * limit); event.currentTarget.value = ""; } }} /><span>页</span></label><button className="button" disabled={result.offset === 0} onClick={() => { const next = Math.max(0, page - 1); setPage(next); syncQuestionPaginationUrl(limit, next * limit); }}>上一页</button><button className="button" disabled={result.offset + result.limit >= result.total} onClick={() => { const next = page + 1; setPage(next); syncQuestionPaginationUrl(limit, next * limit); }}>下一页</button></div></div>}
    </section>
  </ConsoleShell>;
}

function QuestionOverview({ result }: { result: GeneratedQAList }) {
  return <section className="question-overview panel">
    <div className="question-overview-total"><strong>{result.total}</strong><span>题目总数</span></div>
    <OverviewMetric label="等待中" value={result.statusCounts.PENDING ?? 0} tone="amber" />
    <OverviewMetric label="运行中" value={result.statusCounts.RUNNING ?? 0} tone="ink" />
    <OverviewMetric label="已解决" value={result.statusCounts.RESOLVED ?? 0} tone="mint" />
    <OverviewMetric label="已延期" value={result.statusCounts.DEFERRED ?? 0} tone="neutral" />
    <OverviewMetric label="未解决" value={result.statusCounts.UNRESOLVED ?? 0} tone="neutral" />
  </section>;
}

function OverviewMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`question-overview-metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function normalizeQuestionLimit(value: string | number | null | undefined) {
  const numeric = Number(value);
  return numeric === 50 || numeric === 100 ? numeric : 20;
}

function questionFiltersFromUrl(params: URLSearchParams): QuestionFilters {
  return { q: params.get("q") ?? "", status: params.get("status") ?? "", questionType: params.get("question_type") ?? "", domainL1: params.get("domain") ?? "", domainPath: params.get("domain_path") ?? "", endFrom: params.get("end_from")?.slice(0, 10) ?? "", endTo: params.get("end_to")?.slice(0, 10) ?? "" };
}

function syncQuestionFiltersUrl(filters: QuestionFilters) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const values: Record<string, string> = { q: filters.q, status: filters.status, question_type: filters.questionType, domain: filters.domainPath || filters.domainL1, domain_path: filters.domainPath, end_from: filters.endFrom, end_to: filters.endTo };
  for (const [key, value] of Object.entries(values)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function normalizeQuestionPage(value: string | number | null | undefined, limit: number) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) return 0;
  return Math.floor(numeric / limit);
}

function syncQuestionPaginationUrl(limit: number, offset = 0) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (limit === 20) url.searchParams.delete("limit");
  else url.searchParams.set("limit", String(limit));
  if (offset > 0) url.searchParams.set("offset", String(offset));
  else url.searchParams.delete("offset");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function QuestionTable({ items, onSelect }: { items: ConsoleGeneratedQA[]; onSelect: (item: ConsoleGeneratedQA, trigger: HTMLElement) => void }) {
  return <div className="table-scroll"><table className="question-table"><colgroup><col className="question-col" /><col className="status-col" /><col className="domain-col" /><col className="type-col" /><col className="time-col" /><col className="time-col" /></colgroup><thead><tr><th>题目</th><th>状态</th><th>领域</th><th>预测 / 决策</th><th>observation_end</th><th>下次调度 / 原因</th></tr></thead><tbody>{items.map((item) => <tr key={item.generatedQaId} tabIndex={0} role="button" onClick={(event) => onSelect(item, event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(item, event.currentTarget); } }}><td className="question-primary"><strong>{item.question}</strong><small>{item.sourceQaId}</small></td><td><Status value={item.status} label={statusDisplayLabel(item)} /></td><td><div className="domain-path"><strong>{item.domainL1}</strong><span>{item.industryL2}</span></div></td><td><span className="question-type-badge">{item.marketCompatible ? "预测市场" : "决策分析"}</span><small className="question-phase">{answerTypeLabel(item.answerType)}</small></td><td className="mono muted">{formatTime(item.observationEnd)}</td><td><div className="v2-cell-copy"><span>{formatTime(item.nextRunAt)}</span><small>{item.lastReasonCode || "—"}</small></div></td></tr>)}</tbody></table></div>;
}

function QuestionDetail({ item, onClose, closeRef }: { item: ConsoleGeneratedQA; onClose: () => void; closeRef: React.RefObject<HTMLButtonElement | null> }) {
  const [activeTab, setActiveTab] = useState<"definition" | "timing" | "result">("definition");
  const answerSpec = asRecord(item.answerSpec);
  const decisionSpec = asRecord(item.decisionSpec);
  const temporal = asRecord(item.temporalContract);
  const grounding = asRecord(item.grounding);
  const forecastability = asRecord(item.forecastability);
  const ruleSections = formatResolutionRules(item.resolutionCriteria);
  const latestRun = asRecord(item.latestRun);
  const hasFinalResult = item.status === "RESOLVED";
  const resultKind = hasFinalResult ? item.latestResultKind : undefined;
  const resultValue = hasFinalResult
    ? resultKind === "factual_answer" ? (item.latestFactualAnswer ?? item.canonicalAnswer ?? item.resolvedOptionId ?? item.latestResult)
      : resultKind === "decision_reference" ? (item.decisionReference ?? item.latestResult ?? item.canonicalAnswer)
        : item.canonicalAnswer ?? item.latestResult
    : undefined;
  return <div className="question-detail">
    <div className="question-detail-head"><div><p className="eyebrow">Question Detail</p><h2 id="question-detail-title" className="section-title">题目详情</h2></div><button ref={closeRef} className="button" onClick={onClose}>关闭</button></div>
    <div className="question-detail-meta"><Status value={item.status} label={statusDisplayLabel(item)} /><span>{answerTypeLabel(item.answerType)}</span><span>{item.marketCompatible ? "预测市场题" : "决策分析题"}</span><span>{formatTopicPath(item.topicPath)}</span></div>
    <div className="question-detail-tabs" role="tablist" aria-label="题目详情视图">
      {([["definition", "题目定义"], ["timing", "时间与依据"], ["result", "结果与审计"]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={activeTab === value} className={activeTab === value ? "active" : ""} onClick={() => setActiveTab(value)}>{label}</button>)}
    </div>
    {activeTab === "definition" && <DefinitionTab item={item} answerSpec={answerSpec} decisionSpec={decisionSpec} ruleSections={ruleSections} />}
    {activeTab === "timing" && <TimingTab item={item} temporal={temporal} grounding={grounding} forecastability={forecastability} />}
    {activeTab === "result" && <ResultAuditTab item={item} latestRun={latestRun} hasFinalResult={hasFinalResult} resultKind={resultKind} resultValue={resultValue} />}
  </div>;
}

function DefinitionTab({ item, answerSpec, decisionSpec, ruleSections }: { item: ConsoleGeneratedQA; answerSpec: Record<string, unknown>; decisionSpec: Record<string, unknown>; ruleSections: Array<{ key: string; title: string; content: string }> }) {
  return <div className="question-detail-tab-panel" role="tabpanel">
    <section className="question-detail-copy"><h3>{item.question}</h3>{item.context && <p>{item.context}</p>}</section>
    <DetailSection title="结算或评价规则"><div className="resolution-rule-sections">{ruleSections.map((section) => <section key={section.key}>{section.title && <h5>{section.title}</h5>}<p>{section.content}</p></section>)}</div></DetailSection>
    <DetailSection title="选项与答案空间"><OptionsList options={item.options} /><FactGrid values={[["答案类型", answerTypeLabel(text(answerSpec.type) || item.answerType)], ["单位", text(answerSpec.unit)], ["精度", text(answerSpec.precision)], ["答案数量", text(answerSpec.cardinality)], ["有效范围", display(answerSpec.valid_range)], ["记录系统", text(answerSpec.record_system)]]} /><TextList title="约束" values={stringList(answerSpec.constraints)} /></DetailSection>
    {Object.keys(decisionSpec).length > 0 && <details className="question-detail-disclosure"><summary>决策约束</summary><div className="question-detail-disclosure-body"><FactGrid values={[["决策负责人", text(decisionSpec.decision_owner)]]} /><TextList title="目标" values={stringList(decisionSpec.objectives)} /><TextList title="约束" values={stringList(decisionSpec.constraints)} /><TextList title="输出章节" values={stringList(decisionSpec.required_sections)} /><TextList title="情景" values={stringList(decisionSpec.scenarios)} /><TextList title="评价指标" values={stringList(decisionSpec.evaluation_metrics)} /></div></details>}
  </div>;
}

function TimingTab({ item, temporal, grounding, forecastability }: { item: ConsoleGeneratedQA; temporal: Record<string, unknown>; grounding: Record<string, unknown>; forecastability: Record<string, unknown> }) {
  return <div className="question-detail-tab-panel" role="tabpanel">
    <DetailSection title="调度与时间合同"><div className="timeline-list"><TimeRow label="信息截止" value={temporal.as_of_at} /><TimeRow label="观察开始" value={temporal.observation_start} /><TimeRow label="observation_end" value={item.observationEnd ?? temporal.observation_end} /><TimeRow label="available_after" value={item.availableAfter} /><TimeRow label="下次调度" value={item.nextRunAt} /><TimeRow label="Hard Stop" value={item.effectiveHardStopAt} /></div><FactGrid values={[["尝试次数", String(item.attemptCount)], ["最近完成", formatTime(item.lastFinishedAt)], ["原因码", item.lastReasonCode]]} /></DetailSection>
    <DetailSection title="来源与证据"><SourceLinks values={stringList(grounding.source_urls)} /><TextList title="已验证事实" values={stringList(grounding.verified_facts)} /><TextList title="情景假设" values={stringList(grounding.scenario_assumptions)} />{text(grounding.evidence_excerpt) && <div className="evidence-excerpt"><span>题目原始证据摘录</span><p>{text(grounding.evidence_excerpt)}</p></div>}{hasContent(item.latestEvidence) && <JsonBlock title="最近一次冻结证据" value={item.latestEvidence} />}</DetailSection>
    <DetailSection title="可预测性"><FactGrid values={[["当前未知原因", text(forecastability.why_not_known_now)], ["预测依据", text(forecastability.basis)], ["信息价值", text(forecastability.information_value)]]} /><TextList title="不确定因素" values={stringList(forecastability.uncertainty_drivers)} /></DetailSection>
  </div>;
}

function ResultAuditTab({ item, latestRun, hasFinalResult, resultKind, resultValue }: { item: ConsoleGeneratedQA; latestRun: Record<string, unknown>; hasFinalResult: boolean; resultKind?: string; resultValue: unknown }) {
  const audit = readAnswerAudit(item.latestResult);
  return <div className="question-detail-tab-panel" role="tabpanel">
    {hasFinalResult && <DetailSection title={item.marketCompatible ? "最终答案" : "事后参考答案"}><ResultPanel kind={resultKind} value={resultValue} /><FactGrid values={[["证据等级", audit.gradeLabel]]} /></DetailSection>}
    {(audit.gate || audit.error) && <DetailSection title="最近一次判定"><FactGrid values={[["门禁", audit.gate], ["说明", audit.error]]} />{hasContent(audit.grading) && <JsonBlock title="来源评分" value={audit.grading} />}{hasContent(audit.coverage) && <JsonBlock title="章节覆盖" value={audit.coverage} />}</DetailSection>}
    <DetailSection title="最近运行"><FactGrid values={[["运行状态", text(latestRun.execution_status)], ["触发方式", text(latestRun.trigger)], ["Worker 版本", text(latestRun.worker_version)], ["模型", text(latestRun.model)], ["提示词版本", text(latestRun.prompt_version)], ["开始时间", formatTime(optionalTime(latestRun.started_at))], ["结束时间", formatTime(optionalTime(latestRun.finished_at))], ["执行错误", text(latestRun.error)]]} />{Object.keys(latestRun).length === 0 && <p className="question-empty-value">暂无运行记录</p>}</DetailSection>
    <details className="question-audit"><summary>审计标识</summary><div className="detail-grid"><DetailValue label="内部 ID" value={item.generatedQaId} /><DetailValue label="QA ID" value={item.sourceQaId} /><DetailValue label="生成请求" value={item.generationRequestId || "—"} /><DetailValue label="语义键" value={item.semanticKey} /><DetailValue label="事件键" value={item.eventClusterKey || "—"} /><DetailValue label="Ground Truth" value={item.groundTruthKind} /><DetailValue label="最近原因码" value={item.lastReasonCode} /></div></details>
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

function ResultPanel({ kind, value }: { kind?: string; value: unknown }) {
  if (value === undefined || value === null || value === "") return <p className="question-empty-value">尚未形成最终产物</p>;
  return <div className="answer-panel"><FactGrid values={[["结果类型", resultKindLabel(kind)], ["结果", compactValue(value)]]} /><JsonBlock title="结构化结果" value={value} /></div>;
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return <div className="json-block"><span>{title}</span><pre>{formatValue(value)}</pre></div>;
}

function TimeRow({ label, value }: { label: string; value: unknown }) {
  if (!value) return null;
  return <div><span>{label}</span><strong>{formatTime(String(value))}</strong></div>;
}

function DetailValue({ label, value }: { label: string; value: string }) { return <div><div className="detail-key">{label}</div><div className="detail-value">{value}</div></div>; }
function answerTypeLabel(value: string) { return answerTypeLabels[value] ?? value.replaceAll("_", " "); }
function resultKindLabel(value?: string) { return value === "factual_answer" ? "事实答案" : value === "decision_reference" ? "事后参考答案" : value || "—"; }
function statusDisplayLabel(item: ConsoleGeneratedQA) { return item.status === "RESOLVED" && !item.marketCompatible ? "参考答案已生成" : undefined; }
function primaryDomain(value: string) { const index = value.indexOf("."); return index < 0 ? value : value.slice(0, index); }
function secondaryDomain(value: string) { const index = value.indexOf("."); return index < 0 ? value : value.slice(index + 1); }
function formatTime(value?: string) { return value ? `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC` : "—"; }
function optionalTime(value: unknown) { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined; }
function asRecord(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return value === undefined || value === null || value === "" ? "—" : String(value); }
function display(value: unknown) { return Array.isArray(value) ? value.map(String).join(" – ") : text(value); }
function stringList(value: unknown) { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function hasContent(value: unknown) { if (Array.isArray(value)) return value.length > 0; if (value !== null && typeof value === "object") return Object.keys(value).length > 0; return value !== undefined && value !== null && value !== ""; }
function compactValue(value: unknown) { return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : formatValue(value); }
function formatValue(value: unknown) { if (typeof value === "string") return value; try { return JSON.stringify(value, null, 2) ?? "—"; } catch { return String(value); } }
function safeSourceUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }
function optionObject(value: unknown) { if (typeof value !== "object" || value === null) return { id: "", name: String(value), canonical: "" }; const option = value as { option_id?: unknown; label?: unknown; canonical_value?: unknown }; return { id: String(option.option_id ?? ""), name: String(option.label ?? ""), canonical: typeof option.canonical_value === "string" || typeof option.canonical_value === "number" ? String(option.canonical_value) : "" }; }
