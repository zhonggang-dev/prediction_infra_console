/**
 * 用户问题 → 每日构建 Sandbox：类型、严格解码与浏览器侧客户端。
 *
 * 浏览器只请求同源 BFF：上传走 `/api/console/user-questions/uploads`（服务端注入
 * USER_QUESTION_CONSOLE_TOKEN），列表与历史走只读 `/api/console/v2/infra/*`，
 * 下载走 `/api/console/downloads/*`。接口形状以任务目录 contract.md 第 1、2、4 节为准。
 */

import { ConsoleV2ApiError, ConsoleV2ContractError, type ConsoleV2Page } from "./console-v2.ts";

/** 页面内上传上限，需与 BFF 的 `UPLOAD_LIMIT_BYTES` 及中台 `USER_QUESTION_UPLOAD_MAX_BYTES` 默认值一致（测试断言）。 */
export const USER_QUESTION_UPLOAD_LIMIT_BYTES = 64 * 1024 * 1024;
/** 一个文件最多的题数（中台校验，前端只用于文案）。 */
export const USER_QUESTION_MAX_QUESTIONS = 1000;
/** 批量下载一次最多的 Sandbox 个数，需与下载 BFF 的 `MAX_BATCH_IDS` 一致（测试断言）。 */
export const USER_QUESTION_MAX_BATCH_IDS = 1000;
/** 写操作必带的标记头（BFF 据此挡掉跨站伪造请求；需与 BFF 里的值一致）。 */
export const USER_QUESTION_WRITE_MARKER_HEADER = "x-requested-with";
export const USER_QUESTION_WRITE_MARKER_VALUE = "user-question-console";
export const USER_QUESTION_ASSET_KIND = "USER_QUESTION";
/** 文件名请求头：百分号编码的 UTF-8，解码后不超过 255 字节。 */
export const UPLOAD_FILENAME_HEADER = "x-upload-filename";
export const UPLOAD_FILENAME_MAX_BYTES = 255;

export type UserQuestionDisplayStatus = "WAITING" | "BUILDING" | "SUCCEEDED" | "FAILED";
export type UserQuestionBuildStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
export type UserQuestionFileFormat = "JSON" | "CSV";

export const DISPLAY_STATUSES: readonly UserQuestionDisplayStatus[] = ["WAITING", "BUILDING", "SUCCEEDED", "FAILED"];
const BUILD_STATUSES: readonly UserQuestionBuildStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"];
const FILE_FORMATS: readonly UserQuestionFileFormat[] = ["JSON", "CSV"];

export interface UserQuestionProgress { waiting: number; building: number; succeeded: number; failed: number }

export interface UserQuestionUpload {
  uploadId: number;
  originalFilename: string;
  fileFormat: UserQuestionFileFormat;
  questionCount: number;
  blankRowsSkipped: number;
  sizeBytes: number;
  createdAt: string;
  /** 当前业务轮（YYYY-MM-DD，北京时间）；还没有任何构建轮时为 null。 */
  currentBusinessDate: string | null;
  progress: UserQuestionProgress;
  latestSandboxCount: number;
}

export interface UserQuestionBuild {
  buildId: number;
  businessDate: string;
  status: UserQuestionBuildStatus;
  attemptCount: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface UserQuestionSandboxRef {
  sandboxId: string;
  businessDate?: string;
  committedAt: string;
  pageCount: number | null;
  archiveSizeBytes: number | null;
}

export interface UserQuestion {
  questionId: number;
  uploadId: number;
  rowNumber: number;
  questionText: string;
  createdAt: string;
  displayStatus: UserQuestionDisplayStatus;
  currentBuild?: UserQuestionBuild;
  latestSandbox?: UserQuestionSandboxRef;
  sandboxCount: number;
}

export interface UserQuestionHistoryItem extends UserQuestionBuild {
  sandbox?: UserQuestionSandboxRef;
}

export interface UserQuestionUploadCreated {
  uploadId: number;
  originalFilename: string;
  fileFormat: UserQuestionFileFormat;
  questionCount: number;
  blankRowsSkipped: number;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
}

export interface UserQuestionLatestSandboxIds { uploadId: number; sandboxIds: string[]; observedAt: string }

type RawRecord = Record<string, unknown>;

// ───────────────────────── 解码 ─────────────────────────

export function decodeUserQuestionPage<T>(payload: unknown, decode: (value: RawRecord) => T): ConsoleV2Page<T> {
  const data = record(record(payload).data ?? payload, "data");
  const observedAt = requiredTime(data.observed_at, "observed_at");
  if (!Array.isArray(data.items)) throw new ConsoleV2ContractError("用户问题接口缺少 items");
  const items = data.items.map((item, index) => decode(record(item, `items[${index}]`)));
  const limit = positiveInteger(data.limit, "limit");
  const offset = nonNegativeInteger(data.offset, "offset");
  const total = nonNegativeInteger(data.total, "total");
  return { items, limit, offset, total, hasMore: data.has_more === true, observedAt };
}

export function decodeUserQuestionUpload(value: RawRecord): UserQuestionUpload {
  const progress = record(value.progress, "progress");
  return {
    uploadId: positiveInteger(value.upload_id, "upload_id"),
    originalFilename: requiredText(value.original_filename, "original_filename"),
    fileFormat: oneOf(value.file_format, FILE_FORMATS, "file_format"),
    questionCount: nonNegativeInteger(value.question_count, "question_count"),
    blankRowsSkipped: nonNegativeInteger(value.blank_rows_skipped, "blank_rows_skipped"),
    sizeBytes: nonNegativeInteger(value.size_bytes, "size_bytes"),
    createdAt: requiredTime(value.created_at, "created_at"),
    currentBusinessDate: value.current_business_date === null || value.current_business_date === undefined ? null : businessDate(value.current_business_date, "current_business_date"),
    progress: {
      waiting: nonNegativeInteger(progress.waiting, "progress.waiting"),
      building: nonNegativeInteger(progress.building, "progress.building"),
      succeeded: nonNegativeInteger(progress.succeeded, "progress.succeeded"),
      failed: nonNegativeInteger(progress.failed, "progress.failed"),
    },
    latestSandboxCount: nonNegativeInteger(value.latest_sandbox_count, "latest_sandbox_count"),
  };
}

export function decodeUserQuestion(value: RawRecord): UserQuestion {
  return {
    questionId: positiveInteger(value.question_id, "question_id"),
    uploadId: positiveInteger(value.upload_id, "upload_id"),
    rowNumber: positiveInteger(value.row_number, "row_number"),
    questionText: requiredString(value.question_text, "question_text"),
    createdAt: requiredTime(value.created_at, "created_at"),
    displayStatus: oneOf(value.display_status, DISPLAY_STATUSES, "display_status"),
    currentBuild: value.current_build === null || value.current_build === undefined ? undefined : decodeBuild(record(value.current_build, "current_build"), "current_build"),
    latestSandbox: value.latest_sandbox === null || value.latest_sandbox === undefined ? undefined : decodeSandboxRef(record(value.latest_sandbox, "latest_sandbox"), "latest_sandbox"),
    sandboxCount: nonNegativeInteger(value.sandbox_count, "sandbox_count"),
  };
}

export function decodeUserQuestionHistoryItem(value: RawRecord): UserQuestionHistoryItem {
  const build = decodeBuild(value, "sandboxes");
  const sandbox = value.sandbox === null || value.sandbox === undefined ? undefined : decodeSandboxRef(record(value.sandbox, "sandbox"), "sandbox");
  if (build.status === "SUCCEEDED" && !sandbox) throw new ConsoleV2ContractError("用户问题接口：成功的构建缺少 sandbox");
  if (build.status !== "SUCCEEDED" && sandbox) throw new ConsoleV2ContractError("用户问题接口：未成功的构建不应有 sandbox");
  return { ...build, sandbox: sandbox ? { ...sandbox, businessDate: sandbox.businessDate ?? build.businessDate } : undefined };
}

export function decodeUserQuestionUploadCreated(payload: unknown): UserQuestionUploadCreated {
  const data = record(record(payload).data ?? payload, "data");
  const sha256 = requiredText(data.sha256, "sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new ConsoleV2ContractError("用户问题接口缺少有效 sha256");
  return {
    uploadId: positiveInteger(data.upload_id, "upload_id"),
    originalFilename: requiredText(data.original_filename, "original_filename"),
    fileFormat: oneOf(data.file_format, FILE_FORMATS, "file_format"),
    questionCount: positiveInteger(data.question_count, "question_count"),
    blankRowsSkipped: nonNegativeInteger(data.blank_rows_skipped, "blank_rows_skipped"),
    sha256,
    sizeBytes: nonNegativeInteger(data.size_bytes, "size_bytes"),
    createdAt: requiredTime(data.created_at, "created_at"),
  };
}

export function decodeLatestSandboxIds(payload: unknown, expectedUploadId: number): UserQuestionLatestSandboxIds {
  const data = record(record(payload).data ?? payload, "data");
  const uploadId = positiveInteger(data.upload_id, "upload_id");
  if (uploadId !== expectedUploadId) throw new ConsoleV2ContractError("用户问题接口返回的文件与当前选择不一致");
  if (!Array.isArray(data.sandbox_ids)) throw new ConsoleV2ContractError("用户问题接口缺少 sandbox_ids");
  const sandboxIds = data.sandbox_ids.map((id, index) => sandboxId(id, `sandbox_ids[${index}]`));
  if (new Set(sandboxIds).size !== sandboxIds.length) throw new ConsoleV2ContractError("用户问题接口返回了重复的 Sandbox ID");
  if (sandboxIds.length > USER_QUESTION_MAX_BATCH_IDS) throw new ConsoleV2ContractError(`用户问题接口返回的 Sandbox 超过 ${USER_QUESTION_MAX_BATCH_IDS} 个`);
  return { uploadId, sandboxIds, observedAt: requiredTime(data.observed_at, "observed_at") };
}

function decodeBuild(value: RawRecord, prefix: string): UserQuestionBuild {
  return {
    buildId: positiveInteger(value.build_id, `${prefix}.build_id`),
    businessDate: businessDate(value.business_date, `${prefix}.business_date`),
    status: oneOf(value.status, BUILD_STATUSES, `${prefix}.status`),
    attemptCount: nonNegativeInteger(value.attempt_count, `${prefix}.attempt_count`),
    errorCode: optionalText(value.error_code),
    errorMessage: optionalText(value.error_message),
    startedAt: optionalTime(value.started_at, `${prefix}.started_at`),
    finishedAt: optionalTime(value.finished_at, `${prefix}.finished_at`),
  };
}

function decodeSandboxRef(value: RawRecord, prefix: string): UserQuestionSandboxRef {
  return {
    sandboxId: sandboxId(value.sandbox_id, `${prefix}.sandbox_id`),
    businessDate: value.business_date === null || value.business_date === undefined ? undefined : businessDate(value.business_date, `${prefix}.business_date`),
    committedAt: requiredTime(value.committed_at, `${prefix}.committed_at`),
    pageCount: optionalNonNegativeInteger(value.page_count, `${prefix}.page_count`),
    archiveSizeBytes: optionalNonNegativeInteger(value.archive_size_bytes, `${prefix}.archive_size_bytes`),
  };
}

// ───────────────────────── 客户端 ─────────────────────────

type Params = Record<string, string | number | undefined>;

async function getJson(path: string, params: Params = {}, signal?: AbortSignal): Promise<unknown> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  let response: Response;
  try {
    response = await fetch(`/api/console/v2/infra/${path}${query.size ? `?${query}` : ""}`, { cache: "no-store", signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ConsoleV2ApiError("控制台网络不可用，请检查服务连接。", 0, "UPSTREAM_UNAVAILABLE");
  }
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(payload, response.status);
  return payload;
}

export const userQuestionApi = {
  uploads: (params: { limit?: number; offset?: number; q?: string } = {}, signal?: AbortSignal) =>
    getJson("user-question-uploads", { limit: 20, ...params }, signal).then((payload) => decodeUserQuestionPage(payload, decodeUserQuestionUpload)),
  questions: (params: { uploadId?: number; status?: UserQuestionDisplayStatus | ""; q?: string; limit?: number; offset?: number } = {}, signal?: AbortSignal) =>
    getJson("user-questions", { upload_id: params.uploadId, status: params.status, q: params.q, limit: params.limit ?? 20, offset: params.offset }, signal).then((payload) => decodeUserQuestionPage(payload, decodeUserQuestion)),
  history: (questionId: number, params: { limit?: number; offset?: number } = {}, signal?: AbortSignal) =>
    getJson(`user-questions/${encodeURIComponent(String(questionId))}/sandboxes`, { limit: params.limit ?? 100, offset: params.offset }, signal).then((payload) => decodeUserQuestionPage(payload, decodeUserQuestionHistoryItem)),
  latestSandboxIds: (uploadId: number, signal?: AbortSignal) =>
    getJson(`user-question-uploads/${encodeURIComponent(String(uploadId))}/latest-sandbox-ids`, {}, signal).then((payload) => decodeLatestSandboxIds(payload, uploadId)),
  upload: uploadUserQuestionFile,
};

/** 按扩展名决定上传的 Content-Type；不认识的扩展名返回 undefined（页面内直接拒绝）。 */
export function uploadContentType(filename: string): "application/json" | "text/csv" | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  return undefined;
}

/**
 * 文件名请求头：百分号编码的 UTF-8。超过 255 字节时保留扩展名、按字符截断主名，
 * 不在中间切断多字节字符。
 */
export function uploadFilenameHeaderValue(filename: string): string | undefined {
  const name = filename.split(/[\\/]/).pop()?.trim() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, "");
  if (!clean) return undefined;
  const encoder = new TextEncoder();
  if (encoder.encode(clean).byteLength <= UPLOAD_FILENAME_MAX_BYTES) return encodeURIComponent(clean);
  const dot = clean.lastIndexOf(".");
  const extension = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : "";
  const budget = UPLOAD_FILENAME_MAX_BYTES - encoder.encode(extension).byteLength;
  let base = "";
  let used = 0;
  for (const char of clean.slice(0, clean.length - extension.length)) {
    const size = encoder.encode(char).byteLength;
    if (used + size > budget) break;
    base += char;
    used += size;
  }
  return encodeURIComponent(base + extension);
}

const UPLOAD_ERROR_REASONS: Record<string, string> = {
  INVALID_FILE_FORMAT: "文件无法解析：JSON 须是字符串数组或含 question 字段的对象数组，CSV 第一行须有 question 列，文件须为 UTF-8 编码。",
  NO_QUESTIONS: "文件里没有有效问题（空行不算题）。",
  TOO_MANY_QUESTIONS: `一个文件最多 ${USER_QUESTION_MAX_QUESTIONS} 道题，请拆分后再上传。`,
  UPLOAD_TOO_LARGE: `文件超过 ${USER_QUESTION_UPLOAD_LIMIT_BYTES / 1024 / 1024} MiB 上限。`,
  UNSUPPORTED_MEDIA_TYPE: "只支持 .json 或 .csv 文件。",
  CROSS_SITE_REQUEST_REJECTED: "上传只接受本站页面发起的请求，请刷新页面后重试。",
  BACKEND_NOT_CONFIGURED: "上传服务尚未配置，请联系维护人员。",
  UPSTREAM_AUTH_FAILED: "上传服务拒绝了控制台的服务端凭据，请联系维护人员。",
  UPSTREAM_UNAVAILABLE: "上传服务暂时不可用，请稍后重试。",
};

/** 文件内容类错误：中台说明里带具体位置（如「第 3 个对象缺少字符串字段 question」），附在固定说明后面。 */
const UPLOAD_DETAIL_CODES = new Set(["INVALID_FILE_FORMAT", "NO_QUESTIONS", "TOO_MANY_QUESTIONS"]);
/** 没有错误码时（例如反向代理返回的 HTML 错误页）按 HTTP 状态归类。 */
const UPLOAD_STATUS_CODES: Record<number, string> = { 413: "UPLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE", 502: "UPSTREAM_UNAVAILABLE", 503: "UPSTREAM_UNAVAILABLE", 504: "UPSTREAM_UNAVAILABLE" };

/** 上传失败的中文原因：已知错误码给固定说明（文件内容类错误附上中台的具体说明），其余用中台返回的说明。 */
export function uploadErrorReason(code: string | undefined, message?: string, status?: number): string {
  const resolved = code ?? (status === undefined ? undefined : UPLOAD_STATUS_CODES[status]);
  const fixed = resolved ? UPLOAD_ERROR_REASONS[resolved] : undefined;
  if (!fixed) return message || "上传失败，请稍后重试。";
  const detail = message?.trim();
  return resolved && UPLOAD_DETAIL_CODES.has(resolved) && detail && detail !== fixed ? `${fixed}具体原因：${detail}` : fixed;
}

/** 用 XHR 上传，以便显示进度；请求体由浏览器从文件流式读取，不整体载入内存。 */
export function uploadUserQuestionFile(file: File, onProgress?: (fraction: number) => void): Promise<UserQuestionUploadCreated> {
  return new Promise((resolve, reject) => {
    const contentType = uploadContentType(file.name);
    if (!contentType) { reject(new ConsoleV2ApiError(uploadErrorReason("UNSUPPORTED_MEDIA_TYPE"), 415, "UNSUPPORTED_MEDIA_TYPE")); return; }
    if (file.size > USER_QUESTION_UPLOAD_LIMIT_BYTES) { reject(new ConsoleV2ApiError(uploadErrorReason("UPLOAD_TOO_LARGE"), 413, "UPLOAD_TOO_LARGE")); return; }
    if (file.size === 0) { reject(new ConsoleV2ApiError(uploadErrorReason("NO_QUESTIONS"), 400, "NO_QUESTIONS")); return; }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/console/user-questions/uploads");
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader(USER_QUESTION_WRITE_MARKER_HEADER, USER_QUESTION_WRITE_MARKER_VALUE);
    const filename = uploadFilenameHeaderValue(file.name);
    if (filename) xhr.setRequestHeader(UPLOAD_FILENAME_HEADER, filename);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onerror = () => reject(new ConsoleV2ApiError(uploadErrorReason("UPSTREAM_UNAVAILABLE"), 0, "UPSTREAM_UNAVAILABLE"));
    xhr.onload = () => {
      let payload: unknown = {};
      try { payload = JSON.parse(xhr.responseText); } catch { /* 非 JSON 响应按失败处理 */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(decodeUserQuestionUploadCreated(payload)); } catch (error) { reject(error); }
      } else {
        const body = record(payload);
        const code = typeof body.code === "string" ? body.code : undefined;
        const message = typeof body.message === "string" ? body.message : undefined;
        reject(new ConsoleV2ApiError(uploadErrorReason(code, message, xhr.status), xhr.status, code));
      }
    };
    xhr.send(file);
  });
}

// ───────────────────────── 下载 ─────────────────────────

export function singleDownloadHref(sandbox: string): string {
  return `/api/console/downloads/sandboxes/${encodeURIComponent(sandbox)}/archive?variant=original&asset_kind=${USER_QUESTION_ASSET_KIND}`;
}

export const BATCH_DOWNLOAD_ACTION = "/api/console/downloads/sandboxes/archives:batch";

/** 批量下载隐藏表单的字段；ID 用逗号分隔（表单提交会把换行改成 CRLF，逗号更短也更稳定）。 */
export function batchDownloadFields(ids: readonly string[]): Record<string, string> {
  if (!ids.length) throw new Error("没有可下载的 Sandbox。");
  if (ids.length > USER_QUESTION_MAX_BATCH_IDS) throw new Error(`一次最多下载 ${USER_QUESTION_MAX_BATCH_IDS} 份 Sandbox。`);
  if (new Set(ids).size !== ids.length) throw new Error("Sandbox ID 不能重复。");
  return { sandbox_ids: ids.join(","), variant: "original", asset_kind: USER_QUESTION_ASSET_KIND };
}

// ───────────────────────── 展示 ─────────────────────────

export const DISPLAY_STATUS_LABELS: Record<UserQuestionDisplayStatus | UserQuestionBuildStatus, string> = {
  WAITING: "等待构建", BUILDING: "构建中", SUCCEEDED: "成功", FAILED: "失败",
  PENDING: "等待构建", RUNNING: "构建中", SKIPPED: "已跳过",
};

/** 映射到 `Status` 组件已有的颜色 class。 */
export const DISPLAY_STATUS_TONES: Record<UserQuestionDisplayStatus | UserQuestionBuildStatus, string> = {
  WAITING: "pending", BUILDING: "running", SUCCEEDED: "done", FAILED: "failed",
  PENDING: "pending", RUNNING: "running", SKIPPED: "default",
};

export function isActiveDisplayStatus(status: UserQuestionDisplayStatus): boolean {
  return status === "WAITING" || status === "BUILDING";
}

/**
 * 这道题是否值得继续轮询：构建中，或本轮已排上（有当前轮的 build）但还在等待。
 * 16:30 之前上传、本轮还没排上的题也显示「等待构建」，但几个小时内都不会变，不轮询。
 */
export function questionNeedsPolling(item: Pick<UserQuestion, "displayStatus" | "currentBuild">): boolean {
  return item.displayStatus === "BUILDING" || (item.displayStatus === "WAITING" && item.currentBuild !== undefined);
}

/** 文件级只看「构建中」：等待数里混有本轮还没排上的题，靠它轮询会从上传一直刷到 16:30。 */
export function uploadHasActiveBuilds(upload: Pick<UserQuestionUpload, "progress">): boolean {
  return upload.progress.building > 0;
}

// ───────────────────────── 小工具 ─────────────────────────

const SANDBOX_ID = /^[A-Za-z0-9._-]{1,160}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function record(value: unknown, field?: string): RawRecord {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as RawRecord;
  if (field) throw new ConsoleV2ContractError(`用户问题接口缺少有效 ${field}`);
  return {};
}
function fail(field: string): never { throw new ConsoleV2ContractError(`用户问题接口缺少有效 ${field}`); }
function positiveInteger(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) fail(field); return value; }
function nonNegativeInteger(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(field); return value; }
function optionalNonNegativeInteger(value: unknown, field: string): number | null { return value === null || value === undefined ? null : nonNegativeInteger(value, field); }
function requiredString(value: unknown, field: string): string { if (typeof value !== "string") fail(field); return value; }
function requiredText(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) fail(field); return value; }
function optionalText(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function requiredTime(value: unknown, field: string): string { if (typeof value !== "string" || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) fail(field); return value; }
function optionalTime(value: unknown, field: string): string | undefined { return value === null || value === undefined || value === "" ? undefined : requiredTime(value, field); }
function businessDate(value: unknown, field: string): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) fail(field); return value; }
function sandboxId(value: unknown, field: string): string { if (typeof value !== "string" || !SANDBOX_ID.test(value) || value === "." || value === "..") fail(field); return value; }
function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T { if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail(field); return value as T; }

function apiError(payload: unknown, status: number): ConsoleV2ApiError {
  const body = record(payload);
  const code = typeof body.code === "string" ? body.code : undefined;
  const message = typeof body.message === "string" && body.message ? body.message : "控制台接口请求失败";
  return new ConsoleV2ApiError(message, status, code);
}
