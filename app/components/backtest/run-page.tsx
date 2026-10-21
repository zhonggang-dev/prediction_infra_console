"use client";

/* 内部页面跳转沿用 ConsoleShell 的原生链接写法，绕开当前 vinext 客户端路由导出缺陷。 */
/* eslint-disable @next/next/no-html-link-for-pages */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { backtestApi, isActiveRun, type BacktestRun } from "../../lib/backtest-platform";
import { prettyHeadline, requesterLabel, runTitle, STATUS_CLASS, STATUS_LABELS } from "../../lib/backtest-labels";
import { ConsoleV2ApiError } from "../../lib/console-v2";
import { V2Frame, V2Loading, V2Notice, formatV2Time, v2ErrorText } from "../console-v2-resource";
import { ResultView, ScopeCardView } from "./result-view";

const POLL_MS = 3000;

/** 运行中每 3 秒轮询一次，终态即停；刷新失败保留上次快照并明确标注陈旧。 */
export function useRun(runId: string) {
  const [run, setRun] = useState<BacktestRun>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const runRef = useRef<BacktestRun>(undefined);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = () => {
      void backtestApi.run(runId).then((next) => {
        if (cancelled) return;
        runRef.current = next;
        setRun(next); setError(undefined); setLoading(false);
        if (isActiveRun(next)) timer = window.setTimeout(load, POLL_MS);
      }).catch((requestError: unknown) => {
        if (cancelled) return;
        setError(v2ErrorText(requestError)); setLoading(false);
        // 网络中断 / 5xx 且运行还没结束时稍后重试；404 等客户端错误和终态不再轮询，等用户手动刷新
        const transient = !(requestError instanceof ConsoleV2ApiError) || requestError.status === 0 || requestError.status >= 500;
        if (transient && (!runRef.current || isActiveRun(runRef.current))) timer = window.setTimeout(load, POLL_MS * 2);
      });
    };
    timer = window.setTimeout(load, 0);
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [runId, tick]);

  return { run, error, loading, reload, setRun };
}

export async function copyText(value: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(value); return true; } catch { /* 回退到选中复制 */ }
  const area = document.createElement("textarea");
  area.value = value; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
  document.body.appendChild(area); area.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { document.body.removeChild(area); }
}

export function ReproduceBlock({ run }: { run: BacktestRun }) {
  const [copied, setCopied] = useState<"ok" | "fail">();
  if (!run.reproduce) return <section className="bt-section bt-reproduce"><h3 className="bt-section-title">复现信息</h3><p className="bt-muted">这次运行没有复现信息（运行未完成，或旧平台导入的历史结果）。</p></section>;
  const copy = async () => { setCopied((await copyText((run.reproduce as { text: string }).text)) ? "ok" : "fail"); window.setTimeout(() => setCopied(undefined), 2500); };
  const files = Object.entries(run.inputFingerprints?.files ?? {});
  return <section className="bt-section bt-reproduce" aria-labelledby="bt-reproduce-title">
    <div className="section-head"><h3 className="bt-section-title" id="bt-reproduce-title">复现信息</h3><button type="button" className="button primary" onClick={copy}>{copied === "ok" ? "已复制" : copied === "fail" ? "复制失败，请手动选中" : "一键复制"}</button></div>
    <p className="bt-caption">把整段文本交给 agent 即可定位服务器、配置、输入、代码版本和重跑入口。</p>
    <pre className="bt-pre bt-reproduce-text">{run.reproduce.text}</pre>
    {(files.length > 0 || run.inputFingerprints?.dataGeneration) && <details className="bt-details-inline"><summary>输入指纹（{files.length} 个文件{run.inputFingerprints?.dataGeneration ? ` · ${run.inputFingerprints.dataGeneration}` : ""}）</summary>
      <div className="table-scroll"><table className="v2-table"><thead><tr><th>路径</th><th>SHA-256</th></tr></thead><tbody>{files.map(([path, sha]) => <tr key={path}><td className="mono wrap">{path}</td><td className="mono wrap">{sha}</td></tr>)}</tbody></table></div>
    </details>}
    {run.restoredInputs.length > 0 && <V2Notice title="历史重跑：这些输入从存档还原" description={run.restoredInputs.join("；")} />}
  </section>;
}

export function RunStatusBadge({ run }: { run: Pick<BacktestRun, "status" | "lost"> }) {
  return <span className="bt-status-line"><span className={`status ${STATUS_CLASS[run.status]}`}>{STATUS_LABELS[run.status]}</span>{run.lost && <span className="bt-lost" title={run.status === "queued" ? "排队较长时间仍未被执行器认领；执行器恢复后仍会处理" : "超过 5 分钟没有心跳；执行器后续回传仍然有效"}>失联</span>}</span>;
}

function ProgressPanel({ run, onCancel, cancelling }: { run: BacktestRun; onCancel: () => void; cancelling: boolean }) {
  const progress = run.progress && run.progress.total > 0 ? run.progress.done / run.progress.total : undefined;
  return <section className="bt-progress panel panel-pad" aria-live="polite">
    <div className="section-head"><div><strong>{run.status === "queued" ? "排队中，等待执行器认领" : run.stageLabel ?? run.stage ?? "运行中"}</strong>{run.progress && run.progress.total > 0 && <span className="bt-muted"> · {run.progress.done}/{run.progress.total}</span>}</div>
      <button type="button" className="button" onClick={onCancel} disabled={cancelling || run.cancelRequested}>{run.cancelRequested ? "已请求停止，等待执行器终止" : cancelling ? "正在请求…" : "停止运行"}</button></div>
    <div className="bt-bar" role="progressbar" aria-label="运行进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === undefined ? undefined : Math.round(progress * 100)}>
      <i className={progress === undefined ? "indeterminate" : ""} style={progress === undefined ? undefined : { width: `${Math.round(progress * 100)}%` }} />
    </div>
    {run.lost && <p className="bt-warn" role="alert">{run.status === "queued" ? "已排队较长时间仍未被执行器认领，执行器可能没有运行；执行器恢复后会继续处理。" : "超过 5 分钟没有收到执行器心跳，可能失联；执行器恢复后会继续回传。"}</p>}
    <p className="bt-caption">最近心跳：{formatV2Time(run.heartbeatAt)} · 每 3 秒自动刷新。日志末尾：</p>
    <pre className="bt-pre bt-log">{run.logTail?.trim() || "（暂无日志）"}</pre>
  </section>;
}

export function RunPage({ runId }: { runId: string }) {
  const { run, error, loading, reload, setRun } = useRun(runId);
  const [action, setAction] = useState<{ busy: "cancel" | "rerun" | undefined; error?: string }>({ busy: undefined });
  const search = useSearchParams();
  const reused = search.get("reused") === "1";

  const cancel = async () => {
    setAction({ busy: "cancel" });
    try { setRun(await backtestApi.cancelRun(runId)); setAction({ busy: undefined }); reload(); } catch (cause) { setAction({ busy: undefined, error: v2ErrorText(cause) }); }
  };
  const rerun = async () => {
    setAction({ busy: "rerun" });
    try {
      const created = await backtestApi.createRuns({ runs: [], rerun_of: runId, force: true });
      window.location.href = `/backtest-platform/runs/${encodeURIComponent(created.runs[0].runId)}`;
    } catch (cause) { setAction({ busy: undefined, error: v2ErrorText(cause) }); }
  };

  const title = run ? runTitle(run.board, run.item) : "运行详情";
  return <V2Frame eyebrow="Backtest Platform / Run" title={title} description={run ? (run.result?.headline ? prettyHeadline(run.result.headline) : `运行 ${run.runId}`) : `运行 ${runId}`} observedAt={undefined} onRefresh={reload} loading={loading}>
    <nav className="v2-context-links" aria-label="相关页面"><a href="/backtest-platform/runs">← 运行记录</a>{run?.parentRunId && <a href={`/backtest-platform/runs/${encodeURIComponent(run.parentRunId)}`}>重跑自 {run.parentRunId}</a>}{run && <a href={`/backtest-platform/runs?compare=${encodeURIComponent(run.runId)}`}>与另一次运行对比</a>}</nav>
    {error && <V2Notice error title={run ? "最近一次刷新失败，下面的内容可能已陈旧" : "运行不可用"} description={error} />}
    {action.error && <V2Notice error title="操作失败" description={action.error} />}
    {loading && !run && <V2Loading />}
    {run && <>
      <section className="bt-run-head panel panel-pad">
        <div className="v2-facts">
          <div className="v2-fact"><span>运行 ID</span><strong className="mono">{run.runId}</strong></div>
          <div className="v2-fact"><span>状态</span><strong><RunStatusBadge run={run} /></strong></div>
          <div className="v2-fact"><span>发起人 / 来源</span><strong>{requesterLabel(run.requestedBy)}{run.origin === "legacy" && run.requestedBy !== "legacy-import" ? " · 旧平台导入" : ""}</strong></div>
          <div className="v2-fact"><span>批次</span><strong className="mono">{run.batchId ?? "—"}</strong></div>
          <div className="v2-fact"><span>创建</span><strong>{formatV2Time(run.createdAt)}</strong></div>
          <div className="v2-fact"><span>开始</span><strong>{formatV2Time(run.startedAt)}</strong></div>
          <div className="v2-fact"><span>结束</span><strong>{formatV2Time(run.finishedAt)}</strong></div>
          <div className="v2-fact"><span>配置摘要</span><strong className="mono">{run.configSha256 ? `${run.configSha256.slice(0, 12)}…` : "—"}</strong></div>
        </div>
        <div className="bt-actions">
          {run.hasArtifacts && <a className="button" href={backtestApi.artifactUrl(run.runId)} download>下载产物包</a>}
          {run.rerunnable && !isActiveRun(run) && <button type="button" className="button" onClick={rerun} disabled={action.busy === "rerun"}>{action.busy === "rerun" ? "正在发起…" : "重跑（新运行，关联本次）"}</button>}
          {!run.rerunnable && !isActiveRun(run) && <span className="bt-muted">{run.origin === "legacy" ? "旧平台历史结果不可重跑" : "该运行不可重跑"}</span>}
        </div>
      </section>
      {reused && <V2Notice title="命中已有结果" description="相同配置与相同数据版本已有成功运行，直接返回了它，没有重新计算。需要重新计算请在发起页勾选「强制重跑」。" />}
      {isActiveRun(run) && <ProgressPanel run={run} onCancel={cancel} cancelling={action.busy === "cancel"} />}
      {run.status === "failed" && <section className="bt-section"><V2Notice error title={`运行失败${run.error?.code ? `（${run.error.code}）` : ""}`} description={run.error?.message ?? "执行器没有给出错误信息。"} />{(run.error?.logTail || run.logTail) && <pre className="bt-pre bt-log">{run.error?.logTail ?? run.logTail}</pre>}</section>}
      {run.status === "cancelled" && <V2Notice title="运行已停止" description="这次运行被用户停止，不是策略执行错误。" />}
      {run.status === "succeeded" && !run.result && <V2Notice error title="结果缺失" description="运行已完成但没有 result.json；请检查执行器回传。" />}
      {run.result && <><ScopeCardView result={run.result} run={run} /><ResultView key={run.runId} run={run} /></>}
      {!isActiveRun(run) && <ReproduceBlock run={run} />}
    </>}
  </V2Frame>;
}
