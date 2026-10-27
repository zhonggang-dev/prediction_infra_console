"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { backtestApi, UPLOAD_CONTENT_TYPES, UPLOAD_LIMIT_BYTES, type BacktestRun, type Submission, type SubmissionKind } from "../../lib/backtest-platform";
import { SUBMISSION_KIND_LABELS, requesterLabel } from "../../lib/backtest-labels";
import { submissionHistory } from "../../lib/backtest-runs";
import { IDENTITY_FIELDS, validateIdentity } from "../../lib/backtest-submit";
import { V2Loading, V2Notice, formatV2Bytes, formatV2Time, v2ErrorText } from "../console-v2-resource";
import { RunStatusBadge } from "./run-page";

const KINDS: Array<{ id: SubmissionKind; label: string; hint: string }> = [
  { id: "prediction", label: "预测表", hint: "列：condition_id、available_at（带时区）、probability（0–1）、side（YES/NO）。路径带模型标识、训练版本、预测版本。" },
  { id: "factor_table", label: "因子表", hint: "五列 Parquet：factor_id、condition_id、side、ts（带时区）、value。逐因子校验，坏因子不影响其他因子。" },
  { id: "strategy", label: "策略", hint: "tar / tar.gz 包：strategy.yaml（标识、版本、参数、所需因子与预测、仓位模式、Domain、决策频率）+ 代码 + 输入输出示例。" },
];

const STATUS_TEXT: Record<Submission["status"], string> = { validating: "校验中", accepted: "已通过", rejected: "被拒绝" };
const STATUS_CLASS: Record<Submission["status"], string> = { validating: "pending", accepted: "ready", rejected: "failed" };


function SubmissionCard({ submission }: { submission: Submission }) {
  return <article className="panel panel-pad bt-submission">
    <div className="section-head"><div><strong>{KINDS.find((k) => k.id === submission.kind)?.label}</strong> <span className="mono">{Object.values(submission.identity).map(String).join(" / ")}</span><br /><small className="mono bt-muted">{submission.id}</small></div><span className={`status ${STATUS_CLASS[submission.status]}`}>{STATUS_TEXT[submission.status]}</span></div>
    <div className="v2-facts"><div className="v2-fact"><span>提交人</span><strong>{submission.submittedBy ?? "未知"}</strong></div><div className="v2-fact"><span>提交时间</span><strong>{formatV2Time(submission.createdAt)}</strong></div><div className="v2-fact"><span>大小</span><strong>{formatV2Bytes(submission.bytes)}</strong></div><div className="v2-fact"><span>SHA-256</span><strong className="mono">{submission.sha256 ? `${submission.sha256.slice(0, 16)}…` : "未知"}</strong></div></div>
    {submission.errors.length > 0 && <div className="table-scroll"><table className="v2-table"><thead><tr><th>位置</th><th>代码</th><th>说明</th></tr></thead><tbody>{submission.errors.map((item, index) => <tr key={index}><td className="mono wrap">{item.path ?? "—"}</td><td className="mono">{item.code ?? "—"}</td><td className="wrap">{item.message}</td></tr>)}</tbody></table></div>}
    {submission.status === "accepted" && submission.errors.length === 0 && <p className="bt-note bt-ok">校验通过，已登记进可选对象目录。</p>}
    {submission.alreadySubmitted && <p className="bt-note">这份内容此前已经提交过（相同标识、相同内容），本次按幂等成功处理，没有重复校验。</p>}
    {submission.intakeRunId && <p className="bt-note">校验运行：<a href={`/backtest-platform/runs/${encodeURIComponent(submission.intakeRunId)}`}>{submission.intakeRunId}</a></p>}
  </article>;
}


/** 提交历史：infra 没有提交列表，用 board=intake 的校验运行还原（见 submissionHistory）；点开查看提交状态与逐项错误。 */
function SubmissionHistory({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [next, setNext] = useState<number | undefined>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [opened, setOpened] = useState<Record<string, { submission?: Submission; error?: string }>>({});
  const entries = useMemo(() => submissionHistory(runs), [runs]);

  const load = (offset: number, replace: boolean) => {
    setLoading(true); setError(undefined);
    void backtestApi.runs({ board: "intake", limit: 50, offset })
      .then((page) => { setRuns((current) => replace ? page.items : [...current, ...page.items]); setNext(page.hasMore ? page.offset + page.items.length : undefined); })
      .catch((cause: unknown) => setError(v2ErrorText(cause)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const timer = window.setTimeout(() => load(0, true), 0);
    return () => window.clearTimeout(timer);
  }, [refreshKey]);

  const open = (id: string) => {
    if (opened[id]) { setOpened((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))); return; }
    setOpened((current) => ({ ...current, [id]: {} }));
    backtestApi.submission(id)
      .then((submission) => setOpened((current) => id in current ? { ...current, [id]: { submission } } : current))
      .catch((cause: unknown) => setOpened((current) => id in current ? { ...current, [id]: { error: v2ErrorText(cause) } } : current));
  };

  return <section className="bt-section">
    <div className="section-head"><h3 className="bt-section-title">提交历史</h3><button type="button" className="button" disabled={loading} onClick={() => load(0, true)}>刷新</button></div>
    <p className="bt-caption">按提交校验运行还原，同一份提交只列一次。点「查看」读取提交状态与逐项错误。</p>
    {error && <V2Notice error title="提交历史不可用" description={error} />}
    {loading && entries.length === 0 && !error && <V2Loading />}
    {!loading && !error && entries.length === 0 && <div className="empty"><strong>还没有提交记录</strong><p>通过上方表单或接口提交后，校验运行会出现在这里。</p></div>}
    {entries.length > 0 && <div className="table-scroll"><table className="v2-table">
      <thead><tr><th>类型</th><th>标识</th><th>提交人</th><th>提交时间</th><th>校验运行</th><th className="v2-action-column">操作</th></tr></thead>
      <tbody>{entries.map((entry) => {
        const detail = opened[entry.submissionId];
        return [
          <tr key={entry.submissionId}>
            <td>{SUBMISSION_KIND_LABELS[entry.kind] ?? entry.kind}</td>
            <td className="primary"><div className="v2-cell-copy"><strong className="mono wrap">{entry.identity || "—"}</strong><small className="mono">{entry.submissionId}</small></div></td>
            <td>{requesterLabel(entry.run.requestedBy)}</td>
            <td>{formatV2Time(entry.run.createdAt)}</td>
            <td><div className="v2-cell-copy"><RunStatusBadge run={entry.run} /><small><a href={`/backtest-platform/runs/${encodeURIComponent(entry.runId)}`}>{entry.runId}</a></small></div></td>
            <td className="v2-action-cell"><button type="button" className="button" aria-expanded={detail !== undefined} onClick={() => open(entry.submissionId)}>{detail ? "收起" : "查看"}</button></td>
          </tr>,
          detail && <tr key={`${entry.submissionId}-detail`}><td colSpan={6}>{detail.submission ? <SubmissionCard submission={detail.submission} /> : detail.error ? <V2Notice error title="无法读取提交" description={detail.error} /> : <V2Loading />}</td></tr>,
        ];
      })}</tbody>
    </table></div>}
    {next !== undefined && <div className="v2-pagination"><span>已加载 {entries.length} 份提交</span><div><button type="button" className="button" disabled={loading} onClick={() => load(next, false)}>加载更早的</button></div></div>}
  </section>;
}

/** 提交：页面内上传 + 状态与逐项错误。同标识同版本内容相同返回原提交，内容不同返回 409，绝不覆盖。 */
export function SubmissionsPanel() {
  const [kind, setKind] = useState<SubmissionKind>("prediction");
  const [parts, setParts] = useState<Record<SubmissionKind, string[]>>({ prediction: ["", "", ""], factor_table: ["", ""], strategy: ["", ""] });
  const [file, setFile] = useState<File>();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [lookup, setLookup] = useState("");
  const [historyKey, setHistoryKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const identityErrors = validateIdentity(kind, parts[kind]);
  const spec = UPLOAD_CONTENT_TYPES[kind];
  const tooLarge = file !== undefined && file.size > UPLOAD_LIMIT_BYTES;
  const uploading = progress !== undefined;

  const upsert = (next: Submission) => setSubmissions((current) => [next, ...current.filter((s) => s.id !== next.id)]);

  // 校验中的提交每 3 秒刷新一次，直到通过或被拒绝
  const validatingIds = submissions.filter((s) => s.status === "validating").map((s) => s.id).join(",");
  useEffect(() => {
    if (!validatingIds) return;
    const timer = window.setInterval(() => {
      for (const id of validatingIds.split(",")) void backtestApi.submission(id).then((next) => setSubmissions((current) => [next, ...current.filter((s) => s.id !== next.id)].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")))).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [validatingIds]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || identityErrors.length || tooLarge) return;
    setError(undefined); setProgress(0);
    try {
      upsert(await backtestApi.upload(kind, parts[kind].map((p) => p.trim()), file, setProgress));
      setHistoryKey((value) => value + 1);
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = "";
    } catch (cause) { setError(v2ErrorText(cause)); } finally { setProgress(undefined); }
  };
  const find = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lookup.trim()) return;
    setError(undefined);
    try { upsert(await backtestApi.submission(lookup.trim())); setLookup(""); } catch (cause) { setError(v2ErrorText(cause)); }
  };

  return <section className="section v2-list-section">
    <p className="section-caption">研究侧提交策略和因子表，模型训练侧提交预测。提交后同步做格式快检，完整校验由执行器异步完成；输入只增不改。</p>
    <section className="panel panel-pad">
      <form className="bt-form" onSubmit={submit}>
        <div className="v2-local-tabs" role="radiogroup" aria-label="提交类型">{KINDS.map((k) => <button type="button" role="radio" aria-checked={kind === k.id} key={k.id} className={kind === k.id ? "active" : ""} onClick={() => { setKind(k.id); setError(undefined); }}>{k.label}</button>)}</div>
        <p className="bt-note">{KINDS.find((k) => k.id === kind)?.hint}</p>
        <div className="bt-form-row">{IDENTITY_FIELDS[kind].map((label, index) => <label key={label}><span>{label}</span><input className="input" value={parts[kind][index]} onChange={(event) => setParts((current) => ({ ...current, [kind]: current[kind].map((p, i) => i === index ? event.target.value : p) }))} autoComplete="off" spellCheck={false} /></label>)}</div>
        {parts[kind].some(Boolean) && identityErrors.map((message) => <p className="bt-warn" key={message}>{message}</p>)}
        <label><span>文件（{spec.accept}，页面内上限 {formatV2Bytes(UPLOAD_LIMIT_BYTES)}）</span><input ref={fileInput} className="input" type="file" accept={spec.accept} onChange={(event) => setFile(event.target.files?.[0])} /></label>
        {tooLarge && <p className="bt-warn" role="alert">文件 {formatV2Bytes(file?.size)} 超过页面内上限，请使用下方的接口方式提交。</p>}
        {uploading && <div className="bt-bar" role="progressbar" aria-label="上传进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)}><i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>}
        {error && <V2Notice error title="提交失败" description={error} />}
        <div className="bt-form-row"><button className="button primary" type="submit" disabled={!file || identityErrors.length > 0 || tooLarge || uploading}>{uploading ? `上传中 ${Math.round((progress ?? 0) * 100)}%` : `提交${KINDS.find((k) => k.id === kind)?.label}`}</button></div>
      </form>
      <details className="bt-details-inline"><summary>通过接口提交（超过页面上限，或由脚本调用）</summary>
        <pre className="bt-pre">{`# 研究侧（策略、因子表）用 BACKTEST_PLATFORM_RESEARCH_TOKEN；训练侧（预测）用 BACKTEST_PLATFORM_TRAINER_TOKEN
curl -X POST "$INFRA/api/v1/backtest/predictions/<model_id>/versions/<训练版本>/<预测版本>" \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/vnd.apache.parquet" --data-binary @pred.parquet
curl -X POST "$INFRA/api/v1/backtest/factor-tables/<表名>/versions/<数据版本>" \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/vnd.apache.parquet" --data-binary @factors.parquet
curl -X POST "$INFRA/api/v1/backtest/strategies/<策略标识>/versions/<版本>" \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/gzip" --data-binary @strategy.tar.gz
# 返回提交 ID（bts-…）后查询：GET $INFRA/api/v1/backtest/submissions/<id>`}</pre>
      </details>
    </section>

    <section className="bt-section">
      <div className="section-head"><h3 className="bt-section-title">提交状态</h3>
        <form className="bt-form-row" onSubmit={find}><input className="input" aria-label="按提交 ID 查询" placeholder="按提交 ID 查询（bts-…）" value={lookup} onChange={(event) => setLookup(event.target.value)} /><button className="button" type="submit" disabled={!lookup.trim()}>查询</button></form></div>
      {submissions.length === 0 ? <p className="bt-muted">本次会话还没有提交。历史提交见下方「提交历史」，也可以用提交 ID 查询。</p> : <div className="bt-submissions">{submissions.map((submission) => <SubmissionCard key={submission.id} submission={submission} />)}</div>}
    </section>

    <SubmissionHistory refreshKey={historyKey} />
  </section>;
}
