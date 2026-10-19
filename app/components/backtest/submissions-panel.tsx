"use client";

import { useEffect, useRef, useState } from "react";
import { backtestApi, UPLOAD_CONTENT_TYPES, UPLOAD_LIMIT_BYTES, type Submission, type SubmissionKind } from "../../lib/backtest-platform";
import { IDENTITY_FIELDS, validateIdentity } from "../../lib/backtest-submit";
import { V2Notice, formatV2Bytes, formatV2Time, v2ErrorText } from "../console-v2-resource";

const KINDS: Array<{ id: SubmissionKind; label: string; hint: string }> = [
  { id: "prediction", label: "预测表", hint: "列：condition_id、available_at（带时区）、probability（0–1）、side（YES/NO）。路径带模型标识、训练版本、预测版本。" },
  { id: "factor_table", label: "因子表", hint: "五列 Parquet：factor_id、condition_id、side、ts（带时区）、value。逐因子校验，坏因子不影响其他因子。" },
  { id: "strategy", label: "策略", hint: "tar / tar.gz 包：strategy.yaml（标识、版本、参数、所需因子与预测、仓位模式、Domain、决策频率）+ 代码 + 输入输出示例。" },
];

const STATUS_TEXT: Record<Submission["status"], string> = { validating: "校验中", accepted: "已通过", rejected: "被拒绝" };
const STATUS_CLASS: Record<Submission["status"], string> = { validating: "pending", accepted: "ready", rejected: "failed" };

/** 提交：页面内上传 + 状态与逐项错误。同标识同版本内容相同返回原提交，内容不同返回 409，绝不覆盖。 */
export function SubmissionsPanel() {
  const [kind, setKind] = useState<SubmissionKind>("prediction");
  const [parts, setParts] = useState<Record<SubmissionKind, string[]>>({ prediction: ["", "", ""], factor_table: ["", ""], strategy: ["", ""] });
  const [file, setFile] = useState<File>();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [lookup, setLookup] = useState("");
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
      {submissions.length === 0 ? <p className="bt-muted">本次会话还没有提交。通过接口提交的，用提交 ID 查询即可看到状态与逐项错误。</p> : <div className="bt-submissions">{submissions.map((submission) => <article className="panel panel-pad bt-submission" key={submission.id}>
        <div className="section-head"><div><strong>{KINDS.find((k) => k.id === submission.kind)?.label}</strong> <span className="mono">{Object.values(submission.identity).map(String).join(" / ")}</span><br /><small className="mono bt-muted">{submission.id}</small></div><span className={`status ${STATUS_CLASS[submission.status]}`}>{STATUS_TEXT[submission.status]}</span></div>
        <div className="v2-facts"><div className="v2-fact"><span>提交人</span><strong>{submission.submittedBy ?? "未知"}</strong></div><div className="v2-fact"><span>提交时间</span><strong>{formatV2Time(submission.createdAt)}</strong></div><div className="v2-fact"><span>大小</span><strong>{formatV2Bytes(submission.bytes)}</strong></div><div className="v2-fact"><span>SHA-256</span><strong className="mono">{submission.sha256 ? `${submission.sha256.slice(0, 16)}…` : "未知"}</strong></div></div>
        {submission.errors.length > 0 && <div className="table-scroll"><table className="v2-table"><thead><tr><th>位置</th><th>代码</th><th>说明</th></tr></thead><tbody>{submission.errors.map((item, index) => <tr key={index}><td className="mono wrap">{item.path ?? "—"}</td><td className="mono">{item.code ?? "—"}</td><td className="wrap">{item.message}</td></tr>)}</tbody></table></div>}
        {submission.status === "accepted" && submission.errors.length === 0 && <p className="bt-note bt-ok">校验通过，已登记进可选对象目录。</p>}
        {submission.alreadySubmitted && <p className="bt-note">这份内容此前已经提交过（相同标识、相同内容），本次按幂等成功处理，没有重复校验。</p>}
        {submission.intakeRunId && <p className="bt-note">校验运行：<a href={`/backtest-platform/runs/${encodeURIComponent(submission.intakeRunId)}`}>{submission.intakeRunId}</a></p>}
      </article>)}</div>}
    </section>
  </section>;
}
