"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { backtestApi, type BacktestRun } from "../../lib/backtest-platform";
import { BOARD_LABELS, requesterLabel, runSummary, runTitle, STATUS_LABELS } from "../../lib/backtest-labels";
import { compareResults, diffRuns } from "../../lib/backtest-compare";
import { collectRuns, type VisibleRunsPage } from "../../lib/backtest-runs";
import { formatNumber } from "../../lib/backtest-table";
import { V2Loading, V2Notice, formatV2Time, v2ErrorText } from "../console-v2-resource";
import { RunStatusBadge } from "./run-page";

type View = "runs" | "intake";
type Filters = { board: string; status: string; batchId: string; requestedBy: string };
const PAGE_SIZE = 20;
const VIEWS: Array<[View, string]> = [["runs", "运行"], ["intake", "提交校验"]];

/** 运行记录：「运行 / 提交校验」两个视图；分页（不编造总数）、按板块 / 状态 / 批次筛选、失联高亮、勾选两次运行对比。 */
export function RunsPanel() {
  const search = useSearchParams();
  const initialBatch = search.get("batch_id") ?? "";
  const compareSeed = search.get("compare") ?? "";
  const [view, setView] = useState<View>("runs");
  const [filters, setFilters] = useState<Filters>({ board: "", status: "", batchId: initialBatch, requestedBy: "" });
  const [draftBatch, setDraftBatch] = useState(initialBatch);
  // 每一页在服务端列表里的起点：翻页只需要记住它们（「运行」视图要排除提交校验，页内条数靠连续取页凑满）
  const [cursors, setCursors] = useState<number[]>([0]);
  const [page, setPage] = useState<VisibleRunsPage>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<string[]>(compareSeed ? [compareSeed] : []);

  const cursor = cursors[cursors.length - 1];
  const query = useMemo(() => ({ board: view === "intake" ? "intake" : filters.board || undefined, status: filters.status || undefined, batch_id: filters.batchId || undefined, requested_by: filters.requestedBy || undefined }), [view, filters]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true); setError(undefined);
      const excludeIntake = view === "runs" && !query.board;
      void collectRuns((offset, limit) => backtestApi.runs({ ...query, limit, offset }), cursor, PAGE_SIZE, excludeIntake ? (run) => run.board === "intake" : undefined)
        .then((next) => { if (!cancelled) setPage(next); })
        .catch((cause: unknown) => { if (!cancelled) { setPage(undefined); setError(v2ErrorText(cause)); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, cursor, view, tick]);

  const resetPaging = () => setCursors([0]);
  const update = (patch: Partial<Filters>) => { resetPaging(); setFilters((current) => ({ ...current, ...patch })); };
  const switchView = (next: View) => { if (next === view) return; resetPaging(); setPage(undefined); setView(next); update({ board: "" }); };
  const toggle = (runId: string) => setPicked((current) => current.includes(runId) ? current.filter((id) => id !== runId) : current.length >= 2 ? [current[1], runId] : [...current, runId]);
  const boards = Object.entries(BOARD_LABELS).filter(([key]) => key !== "intake");

  return <section className="section v2-list-section">
    <p className="section-caption">点运行 ID 查看结果；勾选两次运行可对比配置、输入指纹和同一对象的指标。提交的预测表、因子表和策略的校验运行放在「提交校验」。</p>
    <section className="panel v2-list-panel">
      <form className="filters v2-filterbar" onSubmit={(event) => { event.preventDefault(); update({ batchId: draftBatch.trim() }); }}>
        <div className="v2-local-tabs" role="radiogroup" aria-label="运行记录视图">{VIEWS.map(([key, label]) => <button type="button" role="radio" aria-checked={view === key} key={key} className={view === key ? "active" : ""} onClick={() => switchView(key)}>{label}</button>)}</div>
        {view === "runs" && <select className="select" aria-label="板块" value={filters.board} onChange={(event) => update({ board: event.target.value })}><option value="">全部板块</option>{boards.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
        <select className="select" aria-label="状态" value={filters.status} onChange={(event) => update({ status: event.target.value })}><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <input className="input" aria-label="批次" placeholder="批次 ID（btb-…）" value={draftBatch} onChange={(event) => setDraftBatch(event.target.value)} />
        <button className="button primary" type="submit">筛选</button>
        {filters.batchId && <button className="button" type="button" onClick={() => { setDraftBatch(""); update({ batchId: "" }); }}>清除批次</button>}
        <button className="button" type="button" onClick={() => setTick((v) => v + 1)}>刷新</button>
      </form>
      {error && <V2Notice error title="运行记录不可用" description={error} />}
      {loading && !page && <V2Loading />}
      {!error && page && page.items.length === 0 && <div className="empty"><strong>{view === "intake" ? "没有提交校验记录" : "没有匹配的运行"}</strong><p>{view === "intake" ? "到「提交」页上传预测表、因子表或策略后，校验运行会出现在这里。" : "调整筛选，或到其它 Tab 发起一次运行。"}</p></div>}
      {!error && page && page.items.length > 0 && <div className={loading ? "table-scroll is-loading" : "table-scroll"}><table className="v2-table">
        <thead><tr><th aria-label="选择对比" /><th>运行</th><th>状态 / 进度</th><th>发起人</th><th>创建</th><th>批次 / 关联</th></tr></thead>
        <tbody>{page.items.map((run) => {
          const active = run.status === "running" || run.status === "queued";
          const summary = runSummary(run);
          return <tr key={run.runId} className={run.lost ? "bt-row-lost" : undefined}>
            <td><input type="checkbox" aria-label={`选择 ${run.runId} 用于对比`} checked={picked.includes(run.runId)} onChange={() => toggle(run.runId)} /></td>
            <td className="primary"><div className="v2-cell-copy"><a href={`/backtest-platform/runs/${encodeURIComponent(run.runId)}`}><strong>{runTitle(run.board, run.item)}</strong></a>{summary && <small className="bt-run-summary">{summary}</small>}<small className="mono">{run.runId}{run.origin === "legacy" ? " · 旧平台导入" : ""}</small></div></td>
            <td><div className="v2-cell-copy"><RunStatusBadge run={run} /><small>{active ? run.stageLabel ?? run.stage ?? "" : run.error?.message ?? ""}{active && run.progress ? ` ${run.progress.done}/${run.progress.total}` : ""}</small></div></td>
            <td>{requesterLabel(run.requestedBy)}</td>
            <td>{formatV2Time(run.createdAt)}</td>
            <td><div className="v2-cell-copy"><span className="mono">{run.batchId ?? "—"}</span>{run.parentRunId && <small>重跑自 <a href={`/backtest-platform/runs/${encodeURIComponent(run.parentRunId)}`}>{run.parentRunId}</a></small>}</div></td>
          </tr>;
        })}</tbody>
      </table></div>}
      {page && <div className="v2-pagination"><span>第 {cursors.length} 页 · 本页 {page.items.length} 条 · 按页展示，未统计总数</span><div><button type="button" className="button" disabled={cursors.length <= 1} onClick={() => setCursors((current) => current.slice(0, -1))}>上一页</button><button type="button" className="button" disabled={!page.hasMore} onClick={() => setCursors((current) => [...current, page.nextOffset])}>下一页</button></div></div>}
    </section>
    {picked.length > 0 && <section className="bt-section" aria-label="运行对比">
      <div className="section-head"><h3 className="bt-section-title">两次运行对比</h3><button type="button" className="button" onClick={() => setPicked([])}>清空选择</button></div>
      {picked.length < 2 ? <p className="bt-muted">已选 {picked[0]}；再勾选另一次运行即可对比。</p> : <RunCompare aId={picked[0]} bId={picked[1]} />}
    </section>}
  </section>;
}

function RunCompare({ aId, bId }: { aId: string; bId: string }) {
  const [state, setState] = useState<{ key: string; a?: BacktestRun; b?: BacktestRun; error?: string }>();
  const key = `${aId}|${bId}`;
  const load = useCallback(() => Promise.all([backtestApi.run(aId), backtestApi.run(bId)]), [aId, bId]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void load().then(([a, b]) => { if (!cancelled) setState({ key, a, b }); }).catch((cause: unknown) => { if (!cancelled) setState({ key, error: v2ErrorText(cause) }); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [load, key]);
  if (!state || state.key !== key) return <V2Loading />;
  if (state.error || !state.a || !state.b) return <V2Notice error title="无法加载对比" description={state.error ?? "运行缺失"} />;
  return <CompareView a={state.a} b={state.b} />;
}

export function CompareView({ a, b }: { a: BacktestRun; b: BacktestRun }) {
  const diff = useMemo(() => diffRuns(a, b), [a, b]);
  const pairs = useMemo(() => compareResults(a, b), [a, b]);
  const [showAll, setShowAll] = useState(false);
  const missingResult = !a.result || !b.result;
  const shown = showAll ? pairs : pairs.slice(0, 120);
  return <div className="bt-compare">
    <div className="v2-facts"><div className="v2-fact"><span>A</span><strong className="mono"><a href={`/backtest-platform/runs/${encodeURIComponent(a.runId)}`}>{a.runId}</a></strong></div><div className="v2-fact"><span>B</span><strong className="mono"><a href={`/backtest-platform/runs/${encodeURIComponent(b.runId)}`}>{b.runId}</a></strong></div><div className="v2-fact"><span>A 项目</span><strong>{runTitle(a.board, a.item)}</strong></div><div className="v2-fact"><span>B 项目</span><strong>{runTitle(b.board, b.item)}</strong></div></div>
    {diff.sameConfigSha === true && <p className="bt-note">两次运行的配置摘要相同（相同配置与相同数据版本）。</p>}
    <h4>配置差异（{diff.config.length} 项）</h4>
    {diff.config.length === 0 ? <p className="bt-muted">配置没有差异（已忽略 run_id、批次、发起人、创建时间）。</p> : <div className="table-scroll"><table className="v2-table"><thead><tr><th>字段</th><th>A</th><th>B</th></tr></thead><tbody>{diff.config.map((row) => <tr key={row.path}><td className="mono wrap">{row.path}</td><td className="wrap">{row.a}</td><td className="wrap">{row.b}</td></tr>)}</tbody></table></div>}
    <h4>输入指纹差异（{diff.fingerprints.length} 项）</h4>
    {diff.fingerprints.length === 0 ? <p className="bt-muted">输入指纹没有差异。</p> : <div className="table-scroll"><table className="v2-table"><thead><tr><th>输入</th><th>A</th><th>B</th></tr></thead><tbody>{diff.fingerprints.map((row) => <tr key={row.path}><td className="mono wrap">{row.path}</td><td className="mono wrap">{row.a}</td><td className="mono wrap">{row.b}</td></tr>)}</tbody></table></div>}
    <h4>同一对象同一指标并排</h4>
    {missingResult ? <p className="bt-muted">至少一次运行没有结果（未完成或失败），无法并排数值。</p> : pairs.length === 0 ? <p className="bt-muted">两份结果没有可并排的同名表格行（只比较表格里同一对象的数值列）。</p> : <div className="table-scroll"><table className="v2-table"><thead><tr><th>区块</th><th>对象</th><th>指标</th><th className="bt-num">A</th><th className="bt-num">B</th><th className="bt-num">B − A</th></tr></thead><tbody>{shown.map((pair, index) => <tr key={index}><td>{pair.sectionTitle}</td><td className="wrap">{pair.object}</td><td>{pair.metric}</td><td className="bt-num">{pair.displayA}</td><td className="bt-num">{pair.displayB}</td><td className="bt-num">{pair.delta === null ? "—" : `${pair.delta > 0 ? "+" : ""}${formatNumber(pair.delta, 4)}`}</td></tr>)}</tbody></table>{pairs.length > shown.length && <div className="v2-pagination"><span>显示前 {shown.length} 行，共 {pairs.length} 行</span><button type="button" className="button" onClick={() => setShowAll(true)}>全部显示</button></div>}</div>}
  </div>;
}
