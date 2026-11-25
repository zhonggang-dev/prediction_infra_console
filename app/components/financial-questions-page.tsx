"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useSearchParams } from "next/navigation";
import type { ConsoleV2Page } from "../lib/console-v2";
import {
  BATCH_LABELS, BUILD_STATUS_LABELS, BUILD_STATUS_TONES, elapsedText, financialAssetOptions, financialBatchDownloadFields, financialQuestionApi,
  financialQuestionNeedsPolling, financialSingleDownloadHref, FREQUENCIES, FREQUENCY_LABELS, QUESTION_STATUS_LABELS, QUESTION_STATUS_TONES, QUESTION_STATUSES,
  runStatusLabel, thresholdText,
  type FinancialBuild, type FinancialFrequency, type FinancialLabel, type FinancialQuestion, type FinancialQuestionDetail, type FinancialQuestionStatus,
  type FinancialResolutionState, type FinancialRun, type FinancialSandboxItem,
} from "../lib/financial-questions";
import { ConsoleShell } from "./console-shell";
import { formatV2Bytes, formatV2Time, v2ErrorText } from "./console-v2-resource";
import { DetailSection, Fact, normalizeLimit, pageFromOffset, Pager, submitBatchDownload, useDetailDrawer } from "./question-workspace-parts";

/** 有题在排队或构建时每 30 秒刷新一次。 */
const POLL_INTERVAL_MS = 30_000;
const RUNS_PAGE_SIZE = 10;
const SANDBOXES_PAGE_SIZE = 100;

type Filters = { assetKey: string; frequency: FinancialFrequency | ""; status: FinancialQuestionStatus | ""; q: string };
type PageState = { filters: Filters; limit: number; page: number };
type Loaded<T> = { key: string; page: ConsoleV2Page<T> };
const EMPTY_FILTERS: Filters = { assetKey: "", frequency: "", status: "", q: "" };

export function FinancialQuestionsPage() {
  const searchParams = useSearchParams();
  const [initial] = useState(() => stateFromUrl(searchParams));
  const [filters, setFilters] = useState(initial.filters);
  const [draftQ, setDraftQ] = useState(initial.filters.q);
  const [limit, setLimit] = useState(initial.limit);
  const [page, setPage] = useState(initial.page);
  const [tick, setTick] = useState(0);
  const [questions, setQuestions] = useState<Loaded<FinancialQuestion>>();
  const [questionsError, setQuestionsError] = useState<string>();
  // 勾选：questionId → 该题最新一份 Sandbox ID，翻页和换筛选条件都保留
  const [picked, setPicked] = useState<Map<number, string>>(() => new Map());
  const [downloadError, setDownloadError] = useState<string>();
  const [detail, setDetail] = useState<FinancialQuestion>();
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);

  const questionsKey = [filters.assetKey, filters.frequency, filters.status, filters.q, limit, page].join("|");

  // 浏览器前进 / 后退：从地址恢复已应用的条件
  useEffect(() => {
    const onPopState = () => {
      const next = stateFromUrl(new URL(window.location.href).searchParams);
      setFilters(next.filters);
      setDraftQ(next.filters.q);
      setLimit(next.limit);
      setPage(next.page);
      setDetail(undefined);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => { syncUrl({ filters, limit, page }); }, [filters, limit, page]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void financialQuestionApi.questions({ ...filters, limit, offset: page * limit }, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setQuestions({ key: questionsKey, page: result });
        setQuestionsError(undefined);
        // 地址里的页码越界时纠正到最后一页
        if (!result.items.length && page > 0) setPage(Math.max(0, Math.ceil(result.total / limit) - 1));
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setQuestionsError(v2ErrorText(error));
      });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [filters, limit, page, questionsKey, tick]);

  const items = questions?.page.items ?? [];
  const polling = items.some(financialQuestionNeedsPolling);
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { if (!document.hidden) setTick((value) => value + 1); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [polling]);

  const closeDetail = () => {
    setDetail(undefined);
    const trigger = detailTriggerRef.current;
    detailTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
  };
  useDetailDrawer(detail, drawerCloseRef, closeDetail);

  const applyFilters = (patch: Partial<Filters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(0); };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setDraftQ(""); setPage(0); };
  const filtered = Boolean(filters.assetKey || filters.frequency || filters.status || filters.q);

  const pick = (targets: FinancialQuestion[], on: boolean) => setPicked((current) => {
    const next = new Map(current);
    for (const item of targets) {
      if (!item.latestSandbox) continue;
      if (on) next.set(item.questionId, item.latestSandbox.sandboxId); else next.delete(item.questionId);
    }
    return next;
  });
  const downloadPicked = () => {
    // 勾选后刷新可能已产出更新的一份：本页可见的题按当前最新一份下载，其余按勾选时记录的 ID
    const latest = new Map(items.flatMap((item) => item.latestSandbox ? [[item.questionId, item.latestSandbox.sandboxId] as const] : []));
    try {
      submitBatchDownload(financialBatchDownloadFields([...picked].map(([questionId, sandbox]) => latest.get(questionId) ?? sandbox)));
      setDownloadError(undefined);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "无法发起下载");
    }
  };

  const options = financialAssetOptions(items, filters.assetKey);
  return <ConsoleShell>
    <header className="page-head">
      <div><p className="eyebrow">Financial Questions</p><h1>金融题</h1><p className="description">按规则自动生成的价格预测题，到期前每轮为每道题构建一份原始版 Sandbox。</p></div>
    </header>

    <section className="panel uq-panel" aria-labelledby="fq-questions-title">
      <div className="uq-panel-head">
        <h2 id="fq-questions-title" className="section-title">题目</h2>
        {picked.size > 0 && <div className="uq-head-actions">
          <button type="button" className="uq-text-button" onClick={() => { setPicked(new Map()); setDownloadError(undefined); }}>清除勾选</button>
          <button type="button" className="button primary" title="每道题最新一份 Sandbox（原始版），外层 tar 内每份一个 .tar" onClick={downloadPicked}>下载所选（{picked.size}）</button>
        </div>}
      </div>
      {downloadError && <p className="uq-inline-error" role="alert">{downloadError}</p>}
      <div className="uq-filters">
        <select className="select" aria-label="按标的筛选" value={filters.assetKey} onChange={(event) => applyFilters({ assetKey: event.target.value })}>
          <option value="">全部标的</option>
          {(["OVERSEAS", "CN"] as const).map((batch) => <optgroup key={batch} label={BATCH_LABELS[batch]}>{options.filter((option) => option.batch === batch).map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</optgroup>)}
        </select>
        <select className="select" aria-label="按频率筛选" value={filters.frequency} onChange={(event) => applyFilters({ frequency: event.target.value as Filters["frequency"] })}><option value="">全部频率</option>{FREQUENCIES.map((value) => <option key={value} value={value}>{FREQUENCY_LABELS[value]}</option>)}</select>
        <select className="select" aria-label="按状态筛选" value={filters.status} onChange={(event) => applyFilters({ status: event.target.value as Filters["status"] })}><option value="">全部状态</option>{QUESTION_STATUSES.map((value) => <option key={value} value={value}>{QUESTION_STATUS_LABELS[value]}</option>)}</select>
        <input className="input uq-filter-q" aria-label="搜索题面" placeholder="搜索题面，回车确认" value={draftQ} onChange={(event) => setDraftQ(event.target.value)} onKeyDown={(event) => event.key === "Enter" && applyFilters({ q: draftQ.trim() })} />
        {filtered && <button type="button" className="uq-text-button" onClick={clearFilters}>清除筛选</button>}
      </div>
      {questionsError && <div className="notice error uq-notice"><div><strong>题目列表加载失败</strong><p>{questionsError}{questions ? `（下方为 ${formatV2Time(questions.page.observedAt)} 的旧数据）` : ""}</p></div><button type="button" className="button" onClick={() => setTick((value) => value + 1)}>重试</button></div>}
      {!questions ? (questionsError ? null : <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>)
        : items.length ? <QuestionTable items={items} busy={questions.key !== questionsKey} picked={picked} onPick={pick} onOpen={(item, trigger) => { detailTriggerRef.current = trigger; setDetail(item); }} />
          : !questionsError && <div className="empty"><strong>{filtered ? "没有匹配的题目" : "还没有金融题"}</strong><p>{filtered ? "调整筛选条件后再试。" : "首轮建题后会显示在这里。"}</p></div>}
      {questions && items.length > 0 && <Pager label="题目" result={questions.page} limit={limit} onLimit={(next) => { setLimit(next); setPage(0); }} onPage={setPage} />}
    </section>

    <RunsPanel tick={tick} />

    {detail && <><button className="question-drawer-backdrop" aria-label="关闭题目详情" onClick={closeDetail} /><aside className="question-drawer" role="dialog" aria-modal="true" aria-labelledby="fq-detail-title"><QuestionDetail key={detail.questionId} item={items.find((item) => item.questionId === detail.questionId) ?? detail} tick={tick} onClose={closeDetail} closeRef={drawerCloseRef} /></aside></>}
  </ConsoleShell>;
}

function QuestionTable({ items, busy, picked, onPick, onOpen }: { items: FinancialQuestion[]; busy: boolean; picked: Map<number, string>; onPick: (items: FinancialQuestion[], on: boolean) => void; onOpen: (item: FinancialQuestion, trigger: HTMLElement) => void }) {
  const pickable = items.filter((item) => item.latestSandbox);
  const allPicked = pickable.length > 0 && pickable.every((item) => picked.has(item.questionId));
  return <div className="table-scroll" aria-busy={busy}><table className="uq-table fq-questions-table">
    <thead><tr>
      <th className="uq-check"><input type="checkbox" aria-label="勾选本页全部已有 Sandbox 的题目" checked={allPicked} disabled={!pickable.length} onChange={(event) => onPick(items, event.target.checked)} /></th>
      <th>标的</th><th>题面</th><th>门槛</th><th>目标日</th><th>状态</th><th>结果</th><th>最新 Sandbox</th>
    </tr></thead>
    <tbody>{items.map((item) => <tr key={item.questionId}>
      <td className="uq-check"><input type="checkbox" aria-label={`勾选题目 ${item.questionId}`} checked={picked.has(item.questionId)} disabled={!item.latestSandbox} onChange={(event) => onPick([item], event.target.checked)} /></td>
      <td className="uq-primary">{item.assetName}<small>{FREQUENCY_LABELS[item.frequency]}{item.contractCode ? ` · ${item.contractCode}` : ""}</small></td>
      <td className="uq-primary"><button type="button" className="uq-link uq-question-text" title={item.questionText} onClick={(event) => onOpen(item, event.currentTarget)}>{item.questionText}</button></td>
      <td className="mono">{thresholdText(item)}<small className="uq-sub">{item.unit}</small></td>
      <td className="mono">{item.targetDate}</td>
      <td><QuestionStatusBadge item={item} /></td>
      <td>{item.resolution ? <><ResultLabel label={item.resolution.label} state={item.resolution.state} /><small className="uq-sub mono">{item.resolution.value}</small></> : <span className="muted">—</span>}</td>
      <td>{item.latestSandbox ? <span className="mono">{formatV2Time(item.latestSandbox.committedAt)}</span> : <span className="muted">暂无</span>}<small className="uq-sub">共 {item.sandboxCount} 份<BuildHint build={item.currentBuild} /></small></td>
    </tr>)}</tbody>
  </table></div>;
}

/** 本轮构建没有成功时才提示，失败原因放悬浮提示。 */
function BuildHint({ build }: { build?: FinancialBuild }) {
  if (!build || build.status === "SUCCEEDED") return null;
  return <span title={buildErrorText(build)} className={build.status === "FAILED" ? "fq-build-failed" : undefined}> · 本轮{BUILD_STATUS_LABELS[build.status]}</span>;
}

function QuestionDetail({ item, tick, onClose, closeRef }: { item: FinancialQuestion; tick: number; onClose: () => void; closeRef: RefObject<HTMLButtonElement | null> }) {
  const [detail, setDetail] = useState<FinancialQuestionDetail>();
  const [detailError, setDetailError] = useState<string>();
  const [offset, setOffset] = useState(0);
  const [sandboxes, setSandboxes] = useState<ConsoleV2Page<FinancialSandboxItem>>();
  const [sandboxesError, setSandboxesError] = useState<string>();
  const [downloadError, setDownloadError] = useState<string>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void financialQuestionApi.detail(item.questionId, controller.signal).then((result) => {
        if (!controller.signal.aborted) { setDetail(result); setDetailError(undefined); }
      }).catch((error: unknown) => { if (!controller.signal.aborted) setDetailError(v2ErrorText(error)); });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [item.questionId, tick, retry]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void financialQuestionApi.sandboxes(item.questionId, { limit: SANDBOXES_PAGE_SIZE, offset }, controller.signal).then((result) => {
        if (!controller.signal.aborted) { setSandboxes(result); setSandboxesError(undefined); }
      }).catch((error: unknown) => { if (!controller.signal.aborted) setSandboxesError(v2ErrorText(error)); });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [item.questionId, offset, tick, retry]);

  const current = detail ?? item;
  const reload = () => setRetry((value) => value + 1);
  const downloadable = (sandboxes?.items ?? []).flatMap((row) => row.sandbox ? [row.sandbox.sandboxId] : []);
  const downloadPage = () => {
    try {
      submitBatchDownload(financialBatchDownloadFields(downloadable));
      setDownloadError(undefined);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "无法发起下载");
    }
  };

  return <div className="question-detail">
    <div className="question-detail-head"><div><p className="eyebrow">Financial Question</p><h2 id="fq-detail-title" className="section-title">题目详情</h2></div><button ref={closeRef} type="button" className="button" onClick={onClose}>关闭</button></div>
    <div className="question-detail-meta"><QuestionStatusBadge item={current} /><span>{current.assetName} · {FREQUENCY_LABELS[current.frequency]} · {BATCH_LABELS[current.batch]}</span><span>共 {current.sandboxCount} 份 Sandbox</span></div>
    <section className="question-detail-copy"><h3 className="uq-detail-question">{current.questionText}</h3></section>
    {detailError && <div className="notice error uq-notice"><div><strong>题目详情加载失败</strong><p>{detailError}</p></div><button type="button" className="button" onClick={reload}>重试</button></div>}
    <DetailSection title="门槛与参考价">
      <div className="fact-grid">
        <Fact label="门槛" value={`${thresholdText(current)} ${current.unit}`} />
        <Fact label="参考价" value={detail ? `${detail.reference.value} ${detail.reference.unit}` : "—"} />
        <Fact label="目标日" value={current.targetDate} />
        <Fact label="停止构建" value={formatV2Time(current.stopAt)} />
        {current.contractCode && <Fact label="期货合约" value={current.contractCode} />}
        {detail && <Fact label="参考价行情时刻" value={formatV2Time(detail.reference.observedAt)} />}
      </div>
    </DetailSection>
    <DetailSection title="结果">
      {detail && <p className="uq-sub fq-rule">{detail.resolutionRule.resultRule}</p>}
      {!detail ? (detailError ? null : <div className="skeleton" />)
        : detail.resolutions.length ? <div className="table-scroll"><table className="uq-table fq-resolutions-table">
          <thead><tr><th>结果</th><th>结果价</th><th>行情时刻</th><th>判定时间</th></tr></thead>
          <tbody>{detail.resolutions.map((row, index) => <tr key={`${row.createdAt}-${index}`} title={`来源 ${row.source}，采集于 ${formatV2Time(row.collectedAt)}`}>
            <td><ResultLabel label={row.label} state={row.state} />{index > 0 && <small className="uq-sub">历史记录</small>}</td>
            <td className="mono">{row.value}</td>
            <td className="mono muted">{formatV2Time(row.observedAt)}</td>
            <td className="mono muted">{formatV2Time(row.createdAt)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="question-empty-value">还没有结果。</p>}
    </DetailSection>
    <DetailSection title={`各轮 Sandbox${sandboxes ? `（共 ${sandboxes.total} 轮）` : ""}`}>
      {sandboxesError && <div className="notice error uq-notice"><div><strong>各轮 Sandbox 加载失败</strong><p>{sandboxesError}</p></div><button type="button" className="button" onClick={reload}>重试</button></div>}
      {downloadError && <p className="uq-inline-error" role="alert">{downloadError}</p>}
      {downloadable.length > 1 && <div><button type="button" className="button" title="原始版，外层 tar 内每份一个 .tar" onClick={downloadPage}>{sandboxes && sandboxes.total > sandboxes.limit ? "下载本页" : "下载全部"}（{downloadable.length} 份）</button></div>}
      {!sandboxes ? (sandboxesError ? null : <div><div className="skeleton" /><div className="skeleton" /></div>)
        : sandboxes.items.length ? <div className="table-scroll"><table className="uq-table uq-history-table">
          <thead><tr><th>轮次</th><th>状态</th><th>页数</th><th>大小</th><th>完成时间</th><th>下载</th></tr></thead>
          <tbody>{sandboxes.items.map((row) => <tr key={row.buildId}>
            <td className="mono">{formatV2Time(row.roundPlannedAt)}</td>
            <td title={buildErrorText(row)}><span className={`status ${BUILD_STATUS_TONES[row.status]}`}>{BUILD_STATUS_LABELS[row.status]}</span>{row.attemptCount > 1 && <small className="uq-sub">第 {row.attemptCount} 次尝试</small>}</td>
            <td className="mono">{row.sandbox?.pageCount ?? "—"}</td>
            <td className="mono">{row.sandbox ? formatV2Bytes(row.sandbox.archiveSizeBytes) : "—"}</td>
            <td className="mono muted">{row.sandbox ? formatV2Time(row.sandbox.committedAt) : "—"}</td>
            <td>{row.sandbox ? <a className="button uq-download-link" href={financialSingleDownloadHref(row.sandbox.sandboxId)} target="_blank" rel="noreferrer" aria-label={`下载 ${formatV2Time(row.roundPlannedAt)} 轮的 Sandbox`}>下载</a> : <span className="muted">—</span>}</td>
          </tr>)}</tbody>
        </table></div> : <p className="question-empty-value">还没有构建记录。</p>}
      {sandboxes && sandboxes.total > sandboxes.limit && <div className="uq-history-pager"><span>第 {sandboxes.offset + 1}–{sandboxes.offset + sandboxes.items.length} 条，共 {sandboxes.total} 条</span><button type="button" className="button" disabled={sandboxes.offset === 0} onClick={() => setOffset(Math.max(0, sandboxes.offset - sandboxes.limit))}>上一页</button><button type="button" className="button" disabled={sandboxes.offset + sandboxes.limit >= sandboxes.total} onClick={() => setOffset(sandboxes.offset + sandboxes.limit)}>下一页</button></div>}
    </DetailSection>
    <details className="question-audit"><summary>标识与来源</summary><div className="fact-grid">
      <Fact label="题目 ID" value={String(current.questionId)} />
      <Fact label="标的标识" value={current.assetKey} />
      <Fact label="周期" value={current.periodKey} />
      <Fact label="题型" value={current.typeCode} />
      <Fact label="建题时间" value={formatV2Time(current.createdAt)} />
      {current.statusReason && <Fact label="状态原因" value={current.statusReason} />}
      {detail && <>
        <Fact label="系数 / 原始乘积" value={`${detail.coefficient} / ${detail.rawProduct}`} />
        <Fact label="参考价来源" value={[detail.reference.source, detail.reference.sourceSymbol, detail.reference.contractCode].filter(Boolean).join(" · ")} />
        <Fact label="参考价采集时刻" value={formatV2Time(detail.reference.collectedAt)} />
        <Fact label="结果来源" value={detail.resolutionRule.resultSource} />
        <Fact label="观测时段" value={`${formatV2Time(detail.resolutionRule.observeStartAt)} → ${formatV2Time(detail.resolutionRule.observeEndAt)}`} />
        <Fact label="业务时区" value={detail.resolutionRule.timezone} />
      </>}
      {current.latestSandbox && <Fact label="最新 Sandbox ID" value={current.latestSandbox.sandboxId} />}
    </div></details>
  </div>;
}

/** 轮次摘要是次要信息：默认收起，展开后才加载。 */
function RunsPanel({ tick }: { tick: number }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [runs, setRuns] = useState<ConsoleV2Page<FinancialRun>>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void financialQuestionApi.runs({ limit: RUNS_PAGE_SIZE, offset: page * RUNS_PAGE_SIZE }, controller.signal).then((result) => {
        if (!controller.signal.aborted) { setRuns(result); setError(undefined); }
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(v2ErrorText(cause)); });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, page, tick, retry]);
  return <details className="panel uq-panel fq-runs" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>轮次摘要</summary>
    {error && <div className="notice error uq-notice"><div><strong>轮次摘要加载失败</strong><p>{error}</p></div><button type="button" className="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
    {!runs ? (error ? null : <div className="panel-pad"><div className="skeleton" /></div>)
      : runs.items.length ? <div className="table-scroll"><table className="uq-table fq-runs-table">
        <thead><tr><th>轮次</th><th>状态</th><th title="按交易日历本轮应参与的标的数">标的</th><th>新建题</th><th>复用题</th><th title="入选构建的题数">入选</th><th>成功</th><th>失败</th><th title="因休市跳过的标的数">休市</th><th title="本轮到期、不再构建的题数">到期</th><th title="到期后等待结果的题数">待结果</th><th>耗时</th></tr></thead>
        <tbody>{runs.items.map((run) => <tr key={run.runId}>
          <td className="uq-primary" title={`计划时刻 ${formatV2Time(run.plannedAt)}${run.frozenAt ? `，冻结于 ${formatV2Time(run.frozenAt)}` : ""}`}>{run.businessDate} {BATCH_LABELS[run.batch]}</td>
          <td title={run.summary.reason ? `${run.status}：${run.summary.reason}` : run.status}>{runStatusLabel(run.status)}</td>
          {[run.summary.expectedAssets, run.summary.createdQuestions, run.summary.reusedQuestions, run.summary.selectedBuilds, run.summary.succeededBuilds, run.summary.failedBuilds, run.summary.closedSkipped, run.summary.expiredQuestions, run.summary.pendingResults].map((value, index) => <td key={index} className="mono">{value ?? "—"}</td>)}
          <td className="mono">{elapsedText(run.summary.elapsedSeconds)}</td>
        </tr>)}</tbody>
      </table></div> : <div className="empty"><strong>还没有轮次</strong></div>}
    {runs && runs.total > RUNS_PAGE_SIZE && <Pager label="轮次" result={runs} onPage={setPage} />}
  </details>;
}

function QuestionStatusBadge({ item }: { item: Pick<FinancialQuestion, "status" | "statusReason"> }) {
  return <span className={`status ${QUESTION_STATUS_TONES[item.status]}`} title={item.statusReason}>{QUESTION_STATUS_LABELS[item.status]}</span>;
}

function ResultLabel({ label, state }: { label: FinancialLabel; state: FinancialResolutionState }) {
  return <span className="fq-result"><strong className={label === "YES" ? "yes" : "no"}>{label}</strong>{state === "PROVISIONAL" && <em title="结果价尚未最终确认，后续可能修订">临时</em>}</span>;
}

function buildErrorText(build: Pick<FinancialBuild, "errorCode" | "errorMessage">): string | undefined {
  return [build.errorCode, build.errorMessage].filter(Boolean).join("：") || undefined;
}

function stateFromUrl(params: URLSearchParams): PageState {
  const limit = normalizeLimit(params.get("limit"));
  const assetKey = params.get("asset_key") ?? "";
  const frequency = params.get("frequency") ?? "";
  const status = params.get("status") ?? "";
  return {
    filters: {
      // 与中台 asset_key 校验一致：大写字母开头，其余为大写字母、数字、下划线，最长 64
      assetKey: /^[A-Z][A-Z0-9_]{0,63}$/.test(assetKey) ? assetKey : "",
      frequency: (FREQUENCIES as readonly string[]).includes(frequency) ? frequency as FinancialFrequency : "",
      status: (QUESTION_STATUSES as readonly string[]).includes(status) ? status as FinancialQuestionStatus : "",
      q: params.get("q") ?? "",
    },
    limit,
    page: pageFromOffset(params.get("offset"), limit),
  };
}

/** 地址只反映已应用的条件（搜索草稿不写入），用 replaceState 不产生历史记录。 */
function syncUrl({ filters, limit, page }: PageState) {
  const url = new URL(window.location.href);
  const values: Record<string, string> = {
    asset_key: filters.assetKey,
    frequency: filters.frequency,
    status: filters.status,
    q: filters.q,
    limit: limit === 20 ? "" : String(limit),
    offset: page > 0 ? String(page * limit) : "",
  };
  for (const [key, value] of Object.entries(values)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
}
