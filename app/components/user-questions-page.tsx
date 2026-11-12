"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useSearchParams } from "next/navigation";
import type { ConsoleV2Page } from "../lib/console-v2";
import {
  BATCH_DOWNLOAD_ACTION, batchDownloadFields, DISPLAY_STATUS_LABELS, DISPLAY_STATUS_TONES, DISPLAY_STATUSES, questionNeedsPolling, singleDownloadHref,
  uploadContentType, uploadHasActiveBuilds, userQuestionApi, USER_QUESTION_MAX_QUESTIONS, USER_QUESTION_UPLOAD_LIMIT_BYTES,
  type UserQuestion, type UserQuestionBuildStatus, type UserQuestionDisplayStatus, type UserQuestionHistoryItem, type UserQuestionLatestSandboxIds,
  type UserQuestionUpload, type UserQuestionUploadCreated,
} from "../lib/user-questions";
import { ConsoleShell } from "./console-shell";
import { formatV2Bytes, formatV2Time, v2ErrorText } from "./console-v2-resource";
import { Icon } from "./icons";

/** 有等待构建 / 构建中的题时，每 30 秒刷新一次；全部到终态后停止。 */
const POLL_INTERVAL_MS = 30_000;
const FILES_PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 100;
const DOWNLOAD_HINT = "每道题最新一份 Sandbox（原始版），外层 tar 内每份一个 .tar；没有成功构建过的题不在里面";

type QuestionFilters = { status: UserQuestionDisplayStatus | ""; q: string };
type PageState = { uploadId?: number; filters: QuestionFilters; limit: number; page: number; filesQ: string; filesPage: number };
type Loaded<T> = { key: string; page: ConsoleV2Page<T> };

export function UserQuestionsPage() {
  const searchParams = useSearchParams();
  const [initial] = useState(() => stateFromUrl(searchParams));
  const [uploadId, setUploadId] = useState(initial.uploadId);
  const [filters, setFilters] = useState(initial.filters);
  const [draft, setDraft] = useState(initial.filters);
  const [limit, setLimit] = useState(initial.limit);
  const [page, setPage] = useState(initial.page);
  const [filesQ, setFilesQ] = useState(initial.filesQ);
  const [filesDraft, setFilesDraft] = useState(initial.filesQ);
  const [filesPage, setFilesPage] = useState(initial.filesPage);
  const [tick, setTick] = useState(0);
  const [formatOpen, setFormatOpen] = useState(false);

  const [uploads, setUploads] = useState<Loaded<UserQuestionUpload>>();
  const [uploadsError, setUploadsError] = useState<string>();
  const [questions, setQuestions] = useState<Loaded<UserQuestion>>();
  const [questionsError, setQuestionsError] = useState<string>();
  const [latestIds, setLatestIds] = useState<UserQuestionLatestSandboxIds>();
  const [latestIdsError, setLatestIdsError] = useState<string>();
  // 勾选：questionId → 该题最新一份 Sandbox ID；换文件时清空
  const [picked, setPicked] = useState<{ uploadId?: number; ids: Map<number, string> }>({ ids: new Map() });
  const [downloadError, setDownloadError] = useState<string>();

  const [detail, setDetail] = useState<UserQuestion>();
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);

  const uploadsKey = `${filesQ}|${filesPage}`;
  const questionsKey = `${uploadId ?? ""}|${filters.status}|${filters.q}|${limit}|${page}`;

  // 浏览器前进 / 后退：从地址恢复已应用的条件
  useEffect(() => {
    const onPopState = () => {
      const next = stateFromUrl(new URL(window.location.href).searchParams);
      setUploadId(next.uploadId);
      setFilters(next.filters);
      setDraft(next.filters);
      setLimit(next.limit);
      setPage(next.page);
      setFilesQ(next.filesQ);
      setFilesDraft(next.filesQ);
      setFilesPage(next.filesPage);
      setDetail(undefined);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => { syncUrl({ uploadId, filters, limit, page, filesQ, filesPage }); }, [uploadId, filters, limit, page, filesQ, filesPage]);

  // 文件列表
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void userQuestionApi.uploads({ q: filesQ || undefined, limit: FILES_PAGE_SIZE, offset: filesPage * FILES_PAGE_SIZE }, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setUploads({ key: uploadsKey, page: result });
        setUploadsError(undefined);
        // 地址里的页码越界（例如文件被筛掉）时纠正到最后一页，只纠正一次
        if (!result.items.length && filesPage > 0) setFilesPage(Math.max(0, Math.ceil(result.total / FILES_PAGE_SIZE) - 1));
        // 没有选中文件时默认选中最新上传的文件
        setUploadId((current) => current ?? result.items[0]?.uploadId);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setUploadsError(v2ErrorText(error));
      });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [filesQ, filesPage, uploadsKey, tick]);

  // 选中文件的问题列表
  useEffect(() => {
    if (uploadId === undefined) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void userQuestionApi.questions({ uploadId, status: filters.status, q: filters.q || undefined, limit, offset: page * limit }, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setQuestions({ key: questionsKey, page: result });
        setQuestionsError(undefined);
        if (!result.items.length && page > 0) setPage(Math.max(0, Math.ceil(result.total / limit) - 1));
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setQuestionsError(v2ErrorText(error));
      });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [uploadId, filters, limit, page, questionsKey, tick]);

  // 「下载整个文件」要用的每题最新一份 Sandbox ID：提前取好，点击时同步提交表单（避免异步后被拦截弹窗）
  useEffect(() => {
    if (uploadId === undefined) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void userQuestionApi.latestSandboxIds(uploadId, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setLatestIds(result);
        setLatestIdsError(undefined);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) { setLatestIds(undefined); setLatestIdsError(v2ErrorText(error)); }
      });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [uploadId, tick]);

  const visibleUploads = uploads?.page.items ?? [];
  const visibleQuestions = questions && questions.key.split("|")[0] === String(uploadId ?? "") ? questions.page.items : [];
  const selectedUpload = visibleUploads.find((item) => item.uploadId === uploadId);
  const wholeFileIds = latestIds && latestIds.uploadId === uploadId ? latestIds.sandboxIds : undefined;
  const polling = visibleUploads.some(uploadHasActiveBuilds) || visibleQuestions.some(questionNeedsPolling);

  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { if (!document.hidden) setTick((value) => value + 1); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [polling]);

  // 详情抽屉：焦点、Escape、Tab 循环
  useEffect(() => {
    if (!detail) return;
    const timer = window.setTimeout(() => drawerCloseRef.current?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDetail(undefined);
        const trigger = detailTriggerRef.current;
        detailTriggerRef.current = null;
        window.requestAnimationFrame(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = drawerCloseRef.current?.closest<HTMLElement>(".question-drawer");
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKeyDown); };
  }, [detail]);

  const closeDetail = () => {
    setDetail(undefined);
    const trigger = detailTriggerRef.current;
    detailTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
  };

  const selectUpload = (next: number) => {
    if (next === uploadId) return;
    setUploadId(next);
    setFilters({ status: "", q: "" });
    setDraft({ status: "", q: "" });
    setPage(0);
    setDetail(undefined);
    setDownloadError(undefined);
    setLatestIds(undefined);
    setPicked({ ids: new Map() });
  };

  const onUploaded = (created: UserQuestionUploadCreated) => {
    setFilesQ("");
    setFilesDraft("");
    setFilesPage(0);
    setUploadId(created.uploadId);
    setFilters({ status: "", q: "" });
    setDraft({ status: "", q: "" });
    setPage(0);
    setDetail(undefined);
    setDownloadError(undefined);
    setLatestIds(undefined);
    setPicked({ ids: new Map() });
    setTick((value) => value + 1);
  };
  const uploadInput = useRef<HTMLInputElement>(null);
  const upload = useQuestionUpload(uploadInput, onUploaded);

  const pickedIds = picked.uploadId === uploadId ? picked.ids : new Map<number, string>();
  const togglePick = (item: UserQuestion, on: boolean) => {
    const sandbox = item.latestSandbox?.sandboxId;
    if (!sandbox) return;
    setPicked((current) => {
      const ids = new Map(current.uploadId === uploadId ? current.ids : []);
      if (on) ids.set(item.questionId, sandbox); else ids.delete(item.questionId);
      return { uploadId, ids };
    });
  };
  const pickPage = (on: boolean) => {
    setPicked((current) => {
      const ids = new Map(current.uploadId === uploadId ? current.ids : []);
      for (const item of visibleQuestions) {
        if (!item.latestSandbox) continue;
        if (on) ids.set(item.questionId, item.latestSandbox.sandboxId); else ids.delete(item.questionId);
      }
      return { uploadId, ids };
    });
  };
  /** 勾选后轮询可能已产出更新的一份：本页可见的题按当前最新一份下载，其余按勾选时记录的 ID。 */
  const pickedDownloadIds = () => {
    const latest = new Map(visibleQuestions.flatMap((item) => item.latestSandbox ? [[item.questionId, item.latestSandbox.sandboxId] as const] : []));
    return [...new Set([...pickedIds].map(([questionId, sandbox]) => latest.get(questionId) ?? sandbox))];
  };
  const download = (ids: string[]) => {
    try {
      submitBatchDownload(ids);
      setDownloadError(undefined);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "无法发起下载");
    }
  };

  const searchQuestions = () => { setFilters(draft); setPage(0); };
  const searchFiles = () => { setFilesQ(filesDraft.trim()); setFilesPage(0); };
  const questionsBusy = Boolean(questions && questions.key !== questionsKey);
  const showQuestionSkeleton = uploadId !== undefined && !questionsError && (!questions || questions.key.split("|")[0] !== String(uploadId));

  return <ConsoleShell>
    <header className="page-head">
      <div><p className="eyebrow">Custom Questions</p><h1>自定义问题</h1><p className="description">上传问题文件，每天 17:00（北京时间）为每道题构建一份原始版 Sandbox。</p></div>
    </header>

    <section className="panel uq-panel" aria-labelledby="uq-files-title">
      <div className="uq-panel-head">
        <h2 id="uq-files-title" className="section-title">问题文件</h2>
        <div className="uq-head-actions">
          <input className="input uq-search" aria-label="按文件名搜索" placeholder="按文件名搜索，回车确认" value={filesDraft} onChange={(event) => setFilesDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchFiles()} />
          <button type="button" className="uq-text-button" aria-expanded={formatOpen} aria-controls="uq-format-help" onClick={() => setFormatOpen((open) => !open)}>格式说明</button>
          <input ref={uploadInput} className="uq-file-input" type="file" accept=".json,.csv" aria-label="选择问题文件" tabIndex={-1} onChange={upload.onChange} />
          <button type="button" className="button primary" disabled={upload.uploading} onClick={upload.choose}><Icon name="upload" /> {upload.uploading ? `上传中 ${Math.round((upload.progress ?? 0) * 100)}%` : "上传文件"}</button>
        </div>
      </div>
      {formatOpen && <p id="uq-format-help" className="uq-format-help">JSON：字符串数组 <code>[&quot;…&quot;]</code> 或对象数组 <code>[{"{"}&quot;question&quot;: &quot;…&quot;{"}"}]</code>；CSV：第一行表头须含 <code>question</code> 列，其余列忽略。每个文件最多 {USER_QUESTION_MAX_QUESTIONS} 道题、不超过 {formatV2Bytes(USER_QUESTION_UPLOAD_LIMIT_BYTES)}，空行跳过。</p>}
      {upload.uploading && <div className="bt-bar uq-upload-bar" role="progressbar" aria-label="上传进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((upload.progress ?? 0) * 100)}><i style={{ width: `${Math.round((upload.progress ?? 0) * 100)}%` }} /></div>}
      {upload.error && <div className="notice error uq-notice" role="alert"><div><strong>上传失败</strong><p>{upload.error}</p></div></div>}
      {upload.created && <div className="notice uq-notice uq-success" role="status"><div><strong>已上传 {upload.created.originalFilename}</strong><p>{upload.created.questionCount} 道题{upload.created.blankRowsSkipped ? `，跳过空行 ${upload.created.blankRowsSkipped} 行` : ""}，等待下一个 17:00 构建。</p></div></div>}
      {uploadsError && <div className="notice error uq-notice"><div><strong>文件列表加载失败</strong><p>{uploadsError}{uploads ? `（下方为 ${formatV2Time(uploads.page.observedAt)} 的旧数据）` : ""}</p></div><button type="button" className="button" onClick={() => setTick((value) => value + 1)}>重试</button></div>}
      {!uploads ? (uploadsError ? null : <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /></div>)
        : uploads.page.items.length ? <UploadTable items={uploads.page.items} selectedId={uploadId} onSelect={selectUpload} busy={uploads.key !== uploadsKey} />
          : <div className="empty"><strong>{filesQ ? "没有匹配的文件" : "还没有上传过问题文件"}</strong><p>{filesQ ? "换个文件名再试。" : "点右上角「上传文件」，选择 JSON 或 CSV 文件。"}</p></div>}
      {uploads && uploads.page.total > FILES_PAGE_SIZE && <Pager label="文件" result={uploads.page} onPage={(next) => setFilesPage(next)} />}
    </section>

    {uploadId !== undefined && <section className="panel uq-panel" aria-labelledby="uq-questions-title">
      <div className="uq-panel-head">
        <h2 id="uq-questions-title" className="section-title">{selectedUpload ? selectedUpload.originalFilename : `文件 #${uploadId}`} 的问题</h2>
        <div className="uq-head-actions">
          {pickedIds.size > 0 && <>
            <button type="button" className="uq-text-button" onClick={() => setPicked({ uploadId, ids: new Map() })}>清除勾选</button>
            <button type="button" className="button" title={DOWNLOAD_HINT} onClick={() => download(pickedDownloadIds())}>下载所选（{pickedIds.size}）</button>
          </>}
          <button type="button" className="button primary" disabled={!wholeFileIds?.length} title={wholeFileIds && !wholeFileIds.length ? "这个文件还没有构建成功的 Sandbox" : DOWNLOAD_HINT} onClick={() => wholeFileIds && download(wholeFileIds)}>下载整个文件（{wholeFileIds ? `${wholeFileIds.length} 份` : "…"}）</button>
        </div>
      </div>
      {(downloadError || latestIdsError) && <p className="uq-inline-error" role="alert">{downloadError ?? `暂时无法获取整个文件的下载清单：${latestIdsError}`}</p>}
      <div className="uq-filters">
        <select className="select" aria-label="按状态筛选" value={draft.status} onChange={(event) => { const next = { ...draft, status: event.target.value as QuestionFilters["status"] }; setDraft(next); setFilters(next); setPage(0); }}><option value="">全部状态</option>{DISPLAY_STATUSES.map((status) => <option key={status} value={status}>{DISPLAY_STATUS_LABELS[status]}</option>)}</select>
        <input className="input uq-filter-q" aria-label="搜索问题文本" placeholder="搜索问题文本，回车确认" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} onKeyDown={(event) => event.key === "Enter" && searchQuestions()} />
      </div>
      {questionsError && <div className="notice error uq-notice"><div><strong>问题列表加载失败</strong><p>{questionsError}{visibleQuestions.length && questions ? `（下方为 ${formatV2Time(questions.page.observedAt)} 的旧数据）` : ""}</p></div><button type="button" className="button" onClick={() => setTick((value) => value + 1)}>重试</button></div>}
      {showQuestionSkeleton ? <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        : questions && visibleQuestions.length ? <QuestionTable items={visibleQuestions} busy={questionsBusy} picked={pickedIds} onPick={togglePick} onPickPage={pickPage} onOpen={(item, trigger) => { detailTriggerRef.current = trigger; setDetail(item); }} />
          : questions && !questionsError ? <div className="empty"><strong>没有匹配的问题</strong><p>调整状态或搜索条件后再试。</p></div> : null}
      {questions && visibleQuestions.length > 0 && <Pager label="问题" result={questions.page} limit={limit} onLimit={(next) => { setLimit(next); setPage(0); }} onPage={setPage} />}
    </section>}

    {detail && <><button className="question-drawer-backdrop" aria-label="关闭问题详情" onClick={closeDetail} /><aside className="question-drawer" role="dialog" aria-modal="true" aria-labelledby="uq-detail-title"><QuestionDetail key={detail.questionId} item={visibleQuestions.find((item) => item.questionId === detail.questionId) ?? detail} upload={selectedUpload} tick={tick} onClose={closeDetail} closeRef={drawerCloseRef} /></aside></>}
  </ConsoleShell>;
}

/** 点「上传文件」打开系统选择框，选中后立即校验并上传。 */
function useQuestionUpload(inputRef: RefObject<HTMLInputElement | null>, onUploaded: (created: UserQuestionUploadCreated) => void) {
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<UserQuestionUploadCreated>();
  const uploading = progress !== undefined;

  const choose = () => { if (!uploading) inputRef.current?.click(); };
  const onChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading) return;
    setError(undefined); setCreated(undefined);
    const localProblem = !uploadContentType(file.name) ? "只支持 .json 或 .csv 文件。" : file.size > USER_QUESTION_UPLOAD_LIMIT_BYTES ? `文件 ${formatV2Bytes(file.size)} 超过 ${formatV2Bytes(USER_QUESTION_UPLOAD_LIMIT_BYTES)} 上限。` : undefined;
    if (localProblem) { setError(localProblem); return; }
    setProgress(0);
    try {
      const result = await userQuestionApi.upload(file, setProgress);
      setCreated(result);
      onUploaded(result);
    } catch (cause) {
      setError(v2ErrorText(cause));
    } finally {
      setProgress(undefined);
    }
  };
  return { progress, error, created, uploading, choose, onChange };
}

function UploadTable({ items, selectedId, onSelect, busy }: { items: UserQuestionUpload[]; selectedId?: number; onSelect: (uploadId: number) => void; busy: boolean }) {
  // 当前轮是全局的（最近一次 17:00 计划写入的业务日），各行相同；17:00 前仍是前一天那轮
  const round = items.find((item) => item.currentBusinessDate)?.currentBusinessDate;
  return <div className="table-scroll" aria-busy={busy}><table className="uq-table uq-files-table">
    <thead><tr><th>文件</th><th>上传时间</th><th>构建进度{round && `（${round.slice(5)} 轮）`}</th><th>已有 Sandbox</th></tr></thead>
    <tbody>{items.map((item) => {
      const selected = item.uploadId === selectedId;
      return <tr key={item.uploadId} className={selected ? "selected" : undefined}>
        <td className="uq-primary"><button type="button" className="uq-link" aria-pressed={selected} onClick={() => onSelect(item.uploadId)}>{item.originalFilename}</button><small>#{item.uploadId} · {item.fileFormat} · {formatV2Bytes(item.sizeBytes)}{item.blankRowsSkipped ? ` · 跳过空行 ${item.blankRowsSkipped}` : ""}</small></td>
        <td className="mono muted">{formatV2Time(item.createdAt)}</td>
        <td><ProgressCell upload={item} /></td>
        {/* 只算当前轮构建成功的题（用户 11-10 确认），以前轮次的 Sandbox 在详情的历史版本里 */}
        <td className="mono">{item.progress.succeeded} / {item.questionCount}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function ProgressCell({ upload }: { upload: UserQuestionUpload }) {
  const { waiting, building, succeeded, failed } = upload.progress;
  const total = waiting + building + succeeded + failed || 1;
  const segments: Array<[string, number, string]> = [["succeeded", succeeded, "成功"], ["building", building, "构建中"], ["waiting", waiting, "等待"], ["failed", failed, "失败"]];
  return <div className="uq-progress">
    <div className="uq-progress-bar" role="img" aria-label={`成功 ${succeeded}，构建中 ${building}，等待 ${waiting}，失败 ${failed}`}>{segments.map(([tone, count]) => count > 0 && <i key={tone} className={tone} style={{ width: `${(count / total) * 100}%` }} />)}</div>
    <small>{segments.map(([, count, label]) => `${label} ${count}`).join(" · ")}</small>
  </div>;
}

function QuestionTable({ items, busy, picked, onPick, onPickPage, onOpen }: { items: UserQuestion[]; busy: boolean; picked: Map<number, string>; onPick: (item: UserQuestion, on: boolean) => void; onPickPage: (on: boolean) => void; onOpen: (item: UserQuestion, trigger: HTMLElement) => void }) {
  const pickable = items.filter((item) => item.latestSandbox);
  const allPicked = pickable.length > 0 && pickable.every((item) => picked.has(item.questionId));
  return <div className="table-scroll" aria-busy={busy}><table className="uq-table uq-questions-table">
    <thead><tr>
      <th className="uq-check"><input type="checkbox" aria-label="勾选本页全部已有 Sandbox 的问题" checked={allPicked} disabled={!pickable.length} onChange={(event) => onPickPage(event.target.checked)} /></th>
      <th>#</th><th>问题</th><th>状态</th><th>最新 Sandbox</th><th>成功次数</th>
    </tr></thead>
    <tbody>{items.map((item) => {
      const build = item.currentBuild;
      return <tr key={item.questionId}>
        <td className="uq-check"><input type="checkbox" aria-label={`勾选第 ${item.rowNumber} 题`} checked={picked.has(item.questionId)} disabled={!item.latestSandbox} onChange={(event) => onPick(item, event.target.checked)} /></td>
        <td className="mono muted">{item.rowNumber}</td>
        <td className="uq-primary"><button type="button" className="uq-link uq-question-text" onClick={(event) => onOpen(item, event.currentTarget)}>{item.questionText}</button></td>
        <td><StatusBadge status={item.displayStatus} />{item.displayStatus === "FAILED" && build ? <small className="uq-sub uq-fail" title={build.errorMessage}>{build.errorCode ?? "未知错误"}</small> : build && build.attemptCount > 1 && <small className="uq-sub">第 {build.attemptCount} 次尝试</small>}</td>
        <td>{item.latestSandbox ? <span className="mono">{item.latestSandbox.businessDate ?? formatV2Time(item.latestSandbox.committedAt)}</span> : <span className="muted">暂无</span>}</td>
        <td className="mono">{item.sandboxCount}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function QuestionDetail({ item, upload, tick, onClose, closeRef }: { item: UserQuestion; upload?: UserQuestionUpload; tick: number; onClose: () => void; closeRef: RefObject<HTMLButtonElement | null> }) {
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<Loaded<UserQuestionHistoryItem>>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const key = `${item.questionId}|${offset}`;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void userQuestionApi.history(item.questionId, { limit: HISTORY_PAGE_SIZE, offset }, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setHistory({ key, page: result });
        setError(undefined);
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(v2ErrorText(cause));
      });
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [item.questionId, offset, key, tick, retry]);
  const build = item.currentBuild;
  const rows = history && history.key.startsWith(`${item.questionId}|`) ? history.page : undefined;
  return <div className="question-detail">
    <div className="question-detail-head"><div><p className="eyebrow">User Question</p><h2 id="uq-detail-title" className="section-title">问题详情</h2></div><button ref={closeRef} type="button" className="button" onClick={onClose}>关闭</button></div>
    <div className="question-detail-meta"><StatusBadge status={item.displayStatus} /><span>{upload ? upload.originalFilename : `文件 #${item.uploadId}`} · 第 {item.rowNumber} 题</span><span>共 {item.sandboxCount} 份 Sandbox</span></div>
    <section className="question-detail-copy"><h3 className="uq-detail-question">{item.questionText}</h3></section>
    <DetailSection title="当前构建轮">
      {build ? <div className="fact-grid">
        <Fact label="业务日（北京时间）" value={build.businessDate} />
        <Fact label="状态" value={DISPLAY_STATUS_LABELS[build.status]} />
        <Fact label="尝试次数" value={String(build.attemptCount)} />
        <Fact label="开始时间" value={build.startedAt ? formatV2Time(build.startedAt) : "—"} />
        <Fact label="完成时间" value={build.finishedAt ? formatV2Time(build.finishedAt) : "—"} />
        {(build.errorCode || build.errorMessage) && <Fact label="失败原因" value={[build.errorCode, build.errorMessage].filter(Boolean).join("：")} />}
      </div> : <p className="question-empty-value">还没有进入构建轮次，等待下一个 17:00（北京时间）。</p>}
    </DetailSection>
    <DetailSection title={`全部历史版本${rows ? `（共 ${rows.total} 次构建）` : ""}`}>
      {error && <div className="notice error uq-notice"><div><strong>历史版本加载失败</strong><p>{error}</p></div><button type="button" className="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
      {!rows ? (error ? null : <div><div className="skeleton" /><div className="skeleton" /></div>)
        : rows.items.length ? <div className="table-scroll"><table className="uq-table uq-history-table">
          <thead><tr><th>业务日</th><th>状态</th><th>尝试</th><th>页数</th><th>大小</th><th>完成时间</th><th>下载</th></tr></thead>
          <tbody>{rows.items.map((row) => <tr key={row.buildId}>
            <td className="mono">{row.businessDate}</td>
            <td><StatusBadge status={row.status} />{row.status === "FAILED" && row.errorCode && <small className="uq-sub" title={row.errorMessage}>{row.errorCode}</small>}</td>
            <td className="mono">{row.attemptCount}</td>
            <td className="mono">{row.sandbox?.pageCount ?? "—"}</td>
            <td className="mono">{row.sandbox ? formatV2Bytes(row.sandbox.archiveSizeBytes) : "—"}</td>
            <td className="mono muted">{row.finishedAt ? formatV2Time(row.finishedAt) : "—"}</td>
            <td>{row.sandbox ? <a className="button uq-download-link" href={singleDownloadHref(row.sandbox.sandboxId)} target="_blank" rel="noreferrer" aria-label={`下载 ${row.businessDate} 的 Sandbox`}>下载</a> : <span className="muted">—</span>}</td>
          </tr>)}</tbody>
        </table></div> : <p className="question-empty-value">还没有构建记录。</p>}
      {rows && rows.total > rows.limit && <div className="uq-history-pager"><span>第 {rows.offset + 1}–{rows.offset + rows.items.length} 条，共 {rows.total} 条</span><button type="button" className="button" disabled={rows.offset === 0} onClick={() => setOffset(Math.max(0, rows.offset - rows.limit))}>上一页</button><button type="button" className="button" disabled={rows.offset + rows.limit >= rows.total} onClick={() => setOffset(rows.offset + rows.limit)}>下一页</button></div>}
    </DetailSection>
    <details className="question-audit"><summary>标识</summary><div className="fact-grid"><Fact label="问题 ID" value={String(item.questionId)} /><Fact label="文件 ID" value={String(item.uploadId)} /><Fact label="上传时间" value={formatV2Time(item.createdAt)} />{item.latestSandbox && <Fact label="最新 Sandbox ID" value={item.latestSandbox.sandboxId} />}</div></details>
  </div>;
}

function Pager<T>({ label, result, limit, onLimit, onPage }: { label: string; result: ConsoleV2Page<T>; limit?: number; onLimit?: (limit: number) => void; onPage: (page: number) => void }) {
  const pageSize = result.limit;
  const current = Math.floor(result.offset / pageSize);
  const totalPages = Math.ceil(result.total / pageSize);
  return <div className="question-pagination">
    <span>第 {result.total ? result.offset + 1 : 0}–{Math.min(result.offset + result.items.length, result.total)} 条，共 {result.total} 条 · 第 {result.total ? current + 1 : 0} / {totalPages} 页</span>
    <div className="question-pagination-controls">
      {onLimit && <label className="v2-page-size"><span>每页</span><select className="select" aria-label={`${label}每页条数`} value={limit} onChange={(event) => onLimit(normalizeLimit(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label>}
      <button type="button" className="button" disabled={result.offset === 0} onClick={() => onPage(Math.max(0, current - 1))}>上一页</button>
      <button type="button" className="button" disabled={result.offset + pageSize >= result.total} onClick={() => onPage(current + 1)}>下一页</button>
    </div>
  </div>;
}

function StatusBadge({ status }: { status: UserQuestionDisplayStatus | UserQuestionBuildStatus }) {
  return <span className={`status ${DISPLAY_STATUS_TONES[status]}`}>{DISPLAY_STATUS_LABELS[status]}</span>;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="question-detail-section"><h4>{title}</h4>{children}</section>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

/** 用隐藏表单 POST 到下载 BFF：浏览器原生下载、流式，不把归档读进页面内存。 */
function submitBatchDownload(ids: string[]) {
  const fields = batchDownloadFields(ids);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = BATCH_DOWNLOAD_ACTION;
  form.target = "_blank";
  form.rel = "noopener";
  form.hidden = true;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  try { form.submit(); } finally { form.remove(); }
}

function normalizeLimit(value: string | number | null | undefined) {
  const numeric = Number(value);
  return numeric === 50 || numeric === 100 ? numeric : 20;
}

function positiveId(value: string | null): number | undefined {
  if (!value || !/^[1-9][0-9]{0,15}$/.test(value)) return undefined;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : undefined;
}

function pageFromOffset(value: string | null, limit: number) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? Math.floor(numeric / limit) : 0;
}

function stateFromUrl(params: URLSearchParams): PageState {
  const limit = normalizeLimit(params.get("limit"));
  const status = params.get("status") ?? "";
  return {
    uploadId: positiveId(params.get("upload_id")),
    filters: { status: (DISPLAY_STATUSES as readonly string[]).includes(status) ? status as UserQuestionDisplayStatus : "", q: params.get("q") ?? "" },
    limit,
    page: pageFromOffset(params.get("offset"), limit),
    filesQ: params.get("file_q") ?? "",
    filesPage: pageFromOffset(params.get("file_offset"), FILES_PAGE_SIZE),
  };
}

/** 地址只反映已应用的条件（草稿不写入），用 replaceState 不产生历史记录。 */
function syncUrl(state: PageState) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const values: Record<string, string> = {
    upload_id: state.uploadId === undefined ? "" : String(state.uploadId),
    status: state.filters.status,
    q: state.filters.q,
    limit: state.limit === 20 ? "" : String(state.limit),
    offset: state.page > 0 ? String(state.page * state.limit) : "",
    file_q: state.filesQ,
    file_offset: state.filesPage > 0 ? String(state.filesPage * FILES_PAGE_SIZE) : "",
  };
  for (const [key, value] of Object.entries(values)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
}
