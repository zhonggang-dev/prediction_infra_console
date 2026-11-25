/**
 * 金融题（系统按规则建的价格预测题）：类型、严格解码与浏览器侧只读客户端。
 *
 * 列表、详情、各轮 Sandbox 与轮次摘要走只读 `/api/console/v2/infra/*`，下载走
 * `/api/console/downloads/*`，没有写操作。价格、门槛、系数一律按中台返回的十进制
 * 字符串原样保存和展示，不转成 number。
 */

import { ConsoleV2ApiError, ConsoleV2ContractError, type ConsoleV2Page } from "./console-v2.ts";

export const FINANCIAL_QUESTION_ASSET_KIND = "FINANCIAL_QUESTION";
/** 批量下载一次最多的 Sandbox 个数，需与下载 BFF 的 `MAX_BATCH_IDS` 一致（测试断言）。 */
export const FINANCIAL_QUESTION_MAX_BATCH_IDS = 1000;

export type FinancialBatch = "CN" | "OVERSEAS";
export type FinancialFrequency = "D" | "W" | "M";
export type FinancialDirection = "GTE" | "LTE";
export type FinancialQuestionStatus = "ACTIVE" | "PAUSED" | "PENDING_RESULT" | "RESOLVED" | "VOID";
export type FinancialBuildStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
export type FinancialLabel = "YES" | "NO";
export type FinancialResolutionState = "PROVISIONAL" | "FINAL";

const BATCHES: readonly FinancialBatch[] = ["CN", "OVERSEAS"];
export const FREQUENCIES: readonly FinancialFrequency[] = ["D", "W", "M"];
const DIRECTIONS: readonly FinancialDirection[] = ["GTE", "LTE"];
export const QUESTION_STATUSES: readonly FinancialQuestionStatus[] = ["ACTIVE", "PAUSED", "PENDING_RESULT", "RESOLVED", "VOID"];
const BUILD_STATUSES: readonly FinancialBuildStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"];
const LABELS: readonly FinancialLabel[] = ["YES", "NO"];
const RESOLUTION_STATES: readonly FinancialResolutionState[] = ["PROVISIONAL", "FINAL"];

export interface FinancialSandboxRef { sandboxId: string; committedAt: string; pageCount: number | null; archiveSizeBytes: number | null }

export interface FinancialBuild {
  buildId: number;
  runId: number;
  status: FinancialBuildStatus;
  attemptCount: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface FinancialResolution { label: FinancialLabel; state: FinancialResolutionState; value: string; resolvedAt: string }

export interface FinancialQuestion {
  questionId: number;
  assetKey: string;
  assetName: string;
  batch: FinancialBatch;
  frequency: FinancialFrequency;
  periodKey: string;
  typeCode: string;
  questionText: string;
  direction: FinancialDirection;
  /** 十进制字符串，原样展示。 */
  threshold: string;
  unit: string;
  contractCode?: string;
  targetDate: string;
  stopAt: string;
  status: FinancialQuestionStatus;
  statusReason?: string;
  createdAt: string;
  sandboxCount: number;
  latestSandbox?: FinancialSandboxRef;
  currentBuild?: FinancialBuild;
  resolution?: FinancialResolution;
}

export interface FinancialReference { value: string; unit: string; source: string; sourceSymbol: string; contractCode?: string; observedAt: string; collectedAt: string }
export interface FinancialResolutionRule { resultSource: string; resultRule: string; timezone: string; observeStartAt: string; observeEndAt: string }
export interface FinancialResolutionRecord { label: FinancialLabel; state: FinancialResolutionState; value: string; source: string; observedAt: string; collectedAt: string; createdAt: string }

export interface FinancialQuestionDetail extends FinancialQuestion {
  reference: FinancialReference;
  coefficient: string;
  rawProduct: string;
  resolutionRule: FinancialResolutionRule;
  /** 按时间倒序，第一条是当前结果。 */
  resolutions: FinancialResolutionRecord[];
}

export interface FinancialSandboxItem extends FinancialBuild { roundPlannedAt: string; sandbox?: FinancialSandboxRef }

export interface FinancialRunSummary {
  expectedAssets: number | null;
  createdQuestions: number | null;
  reusedQuestions: number | null;
  selectedBuilds: number | null;
  succeededBuilds: number | null;
  failedBuilds: number | null;
  closedSkipped: number | null;
  expiredQuestions: number | null;
  pendingResults: number | null;
  elapsedSeconds: number | null;
  /** 轮次未完成或错过的原因（如 ROUND_MISSED），放悬浮提示。 */
  reason?: string;
}

export interface FinancialRun {
  runId: number;
  batch: FinancialBatch;
  businessDate: string;
  plannedAt: string;
  status: string;
  frozenAt?: string;
  summary: FinancialRunSummary;
}

type RawRecord = Record<string, unknown>;

// ───────────────────────── 解码 ─────────────────────────

export function decodeFinancialPage<T>(payload: unknown, decode: (value: RawRecord) => T): ConsoleV2Page<T> {
  const data = record(record(payload).data ?? payload, "data");
  const observedAt = requiredTime(data.observed_at, "observed_at");
  if (!Array.isArray(data.items)) fail("items");
  const items = data.items.map((item, index) => decode(record(item, `items[${index}]`)));
  const limit = positiveInteger(data.limit, "limit");
  const offset = nonNegativeInteger(data.offset, "offset");
  const total = nonNegativeInteger(data.total, "total");
  return { items, limit, offset, total, hasMore: data.has_more === true, observedAt };
}

export function decodeFinancialQuestion(value: RawRecord): FinancialQuestion {
  return {
    questionId: positiveInteger(value.question_id, "question_id"),
    assetKey: requiredText(value.asset_key, "asset_key"),
    assetName: requiredText(value.asset_name, "asset_name"),
    batch: oneOf(value.batch, BATCHES, "batch"),
    frequency: oneOf(value.frequency, FREQUENCIES, "frequency"),
    periodKey: requiredText(value.period_key, "period_key"),
    typeCode: requiredText(value.type_code, "type_code"),
    questionText: requiredText(value.question_text, "question_text"),
    direction: oneOf(value.direction, DIRECTIONS, "direction"),
    threshold: decimal(value.threshold, "threshold"),
    unit: requiredText(value.unit, "unit"),
    contractCode: optionalText(value.contract_code, "contract_code"),
    targetDate: calendarDate(value.target_date, "target_date"),
    stopAt: requiredTime(value.stop_at, "stop_at"),
    status: oneOf(value.status, QUESTION_STATUSES, "status"),
    statusReason: optionalText(value.status_reason, "status_reason"),
    createdAt: requiredTime(value.created_at, "created_at"),
    sandboxCount: nonNegativeInteger(value.sandbox_count, "sandbox_count"),
    latestSandbox: nullable(value.latest_sandbox, "latest_sandbox", decodeSandboxRef),
    currentBuild: nullable(value.current_build, "current_build", decodeBuild),
    resolution: nullable(value.resolution, "resolution", (raw, prefix) => ({
      label: oneOf(raw.label, LABELS, `${prefix}.label`),
      state: oneOf(raw.state, RESOLUTION_STATES, `${prefix}.state`),
      value: decimal(raw.value, `${prefix}.value`),
      resolvedAt: requiredTime(raw.resolved_at, `${prefix}.resolved_at`),
    })),
  };
}

export function decodeFinancialQuestionDetail(payload: unknown, expectedQuestionId: number): FinancialQuestionDetail {
  const data = record(record(payload).data ?? payload, "data");
  const question = decodeFinancialQuestion(data);
  if (question.questionId !== expectedQuestionId) throw new ConsoleV2ContractError("金融题接口返回的题目与当前选择不一致");
  const reference = record(data.reference, "reference");
  const rule = record(data.resolution_rule, "resolution_rule");
  if (!Array.isArray(data.resolutions)) fail("resolutions");
  return {
    ...question,
    reference: {
      value: decimal(reference.value, "reference.value"),
      unit: requiredText(reference.unit, "reference.unit"),
      source: requiredText(reference.source, "reference.source"),
      sourceSymbol: requiredText(reference.source_symbol, "reference.source_symbol"),
      contractCode: optionalText(reference.contract_code, "reference.contract_code"),
      observedAt: requiredTime(reference.observed_at, "reference.observed_at"),
      collectedAt: requiredTime(reference.collected_at, "reference.collected_at"),
    },
    coefficient: decimal(data.coefficient, "coefficient"),
    rawProduct: decimal(data.raw_product, "raw_product"),
    resolutionRule: {
      resultSource: requiredText(rule.result_source, "resolution_rule.result_source"),
      resultRule: requiredText(rule.result_rule, "resolution_rule.result_rule"),
      timezone: requiredText(rule.timezone, "resolution_rule.timezone"),
      observeStartAt: requiredTime(rule.observe_start_at, "resolution_rule.observe_start_at"),
      observeEndAt: requiredTime(rule.observe_end_at, "resolution_rule.observe_end_at"),
    },
    resolutions: data.resolutions.map((item, index) => {
      const prefix = `resolutions[${index}]`;
      const raw = record(item, prefix);
      return {
        label: oneOf(raw.label, LABELS, `${prefix}.label`),
        state: oneOf(raw.state, RESOLUTION_STATES, `${prefix}.state`),
        value: decimal(raw.value, `${prefix}.value`),
        source: requiredText(raw.source, `${prefix}.source`),
        observedAt: requiredTime(raw.observed_at, `${prefix}.observed_at`),
        collectedAt: requiredTime(raw.collected_at, `${prefix}.collected_at`),
        createdAt: requiredTime(raw.created_at, `${prefix}.created_at`),
      };
    }),
  };
}

export function decodeFinancialSandboxItem(value: RawRecord): FinancialSandboxItem {
  const build = decodeBuild(value, "sandboxes");
  const sandbox = nullable(value.sandbox, "sandbox", decodeSandboxRef);
  if (build.status === "SUCCEEDED" && !sandbox) throw new ConsoleV2ContractError("金融题接口：成功的构建缺少 sandbox");
  if (build.status !== "SUCCEEDED" && sandbox) throw new ConsoleV2ContractError("金融题接口：未成功的构建不应有 sandbox");
  return { ...build, roundPlannedAt: requiredTime(value.round_planned_at, "round_planned_at"), sandbox };
}

export function decodeFinancialRun(value: RawRecord): FinancialRun {
  const summary = record(value.summary, "summary");
  const count = (key: string) => optionalNonNegativeInteger(summary[key], `summary.${key}`);
  return {
    runId: positiveInteger(value.run_id, "run_id"),
    batch: oneOf(value.batch, BATCHES, "batch"),
    businessDate: calendarDate(value.business_date, "business_date"),
    plannedAt: requiredTime(value.planned_at, "planned_at"),
    status: requiredText(value.status, "status"),
    frozenAt: value.frozen_at === null || value.frozen_at === undefined ? undefined : requiredTime(value.frozen_at, "frozen_at"),
    summary: {
      expectedAssets: count("expected_assets"),
      createdQuestions: count("created_questions"),
      reusedQuestions: count("reused_questions"),
      selectedBuilds: count("selected_builds"),
      succeededBuilds: count("succeeded_builds"),
      failedBuilds: count("failed_builds"),
      closedSkipped: count("closed_skipped"),
      expiredQuestions: count("expired_questions"),
      pendingResults: count("pending_results"),
      elapsedSeconds: optionalNonNegativeNumber(summary.elapsed_seconds, "summary.elapsed_seconds"),
      reason: optionalText(summary.reason, "summary.reason"),
    },
  };
}

function decodeBuild(value: RawRecord, prefix: string): FinancialBuild {
  return {
    buildId: positiveInteger(value.build_id, `${prefix}.build_id`),
    runId: positiveInteger(value.run_id, `${prefix}.run_id`),
    status: oneOf(value.status, BUILD_STATUSES, `${prefix}.status`),
    attemptCount: nonNegativeInteger(value.attempt_count, `${prefix}.attempt_count`),
    errorCode: optionalText(value.error_code, `${prefix}.error_code`),
    errorMessage: optionalText(value.error_message, `${prefix}.error_message`),
  };
}

function decodeSandboxRef(value: RawRecord, prefix: string): FinancialSandboxRef {
  return {
    sandboxId: sandboxId(value.sandbox_id, `${prefix}.sandbox_id`),
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
  if (!response.ok) {
    const body = record(payload);
    throw new ConsoleV2ApiError(typeof body.message === "string" && body.message ? body.message : "控制台接口请求失败", response.status, typeof body.code === "string" ? body.code : undefined);
  }
  return payload;
}

export interface FinancialQuestionQuery { assetKey?: string; frequency?: FinancialFrequency | ""; status?: FinancialQuestionStatus | ""; q?: string; limit?: number; offset?: number }

export const financialQuestionApi = {
  questions: (params: FinancialQuestionQuery = {}, signal?: AbortSignal) =>
    getJson("financial-questions", { asset_key: params.assetKey, frequency: params.frequency, status: params.status, q: params.q, limit: params.limit ?? 20, offset: params.offset }, signal).then((payload) => decodeFinancialPage(payload, decodeFinancialQuestion)),
  detail: (questionId: number, signal?: AbortSignal) =>
    getJson(`financial-questions/${encodeURIComponent(String(questionId))}`, {}, signal).then((payload) => decodeFinancialQuestionDetail(payload, questionId)),
  sandboxes: (questionId: number, params: { limit?: number; offset?: number } = {}, signal?: AbortSignal) =>
    getJson(`financial-questions/${encodeURIComponent(String(questionId))}/sandboxes`, { limit: params.limit ?? 100, offset: params.offset }, signal).then((payload) => decodeFinancialPage(payload, decodeFinancialSandboxItem)),
  runs: (params: { limit?: number; offset?: number } = {}, signal?: AbortSignal) =>
    getJson("financial-question-runs", { limit: params.limit ?? 20, offset: params.offset }, signal).then((payload) => decodeFinancialPage(payload, decodeFinancialRun)),
};

// ───────────────────────── 下载 ─────────────────────────

export function financialSingleDownloadHref(sandbox: string): string {
  return `/api/console/downloads/sandboxes/${encodeURIComponent(sandbox)}/archive?variant=original&asset_kind=${FINANCIAL_QUESTION_ASSET_KIND}`;
}

/** 批量下载隐藏表单的字段；ID 用逗号分隔。 */
export function financialBatchDownloadFields(ids: readonly string[]): Record<string, string> {
  if (!ids.length) throw new Error("没有可下载的 Sandbox。");
  if (ids.length > FINANCIAL_QUESTION_MAX_BATCH_IDS) throw new Error(`一次最多下载 ${FINANCIAL_QUESTION_MAX_BATCH_IDS} 份 Sandbox。`);
  if (new Set(ids).size !== ids.length) throw new Error("Sandbox ID 不能重复。");
  return { sandbox_ids: ids.join(","), variant: "original", asset_kind: FINANCIAL_QUESTION_ASSET_KIND };
}

// ───────────────────────── 展示 ─────────────────────────

export const BATCH_LABELS: Record<FinancialBatch, string> = { CN: "A 股", OVERSEAS: "海外" };
export const FREQUENCY_LABELS: Record<FinancialFrequency, string> = { D: "日题", W: "周题", M: "月题" };
export const QUESTION_STATUS_LABELS: Record<FinancialQuestionStatus, string> = { ACTIVE: "进行中", PAUSED: "已暂停", PENDING_RESULT: "待结果", RESOLVED: "已判定", VOID: "已作废" };
/** 映射到全站 `.status` 已有的颜色 class。 */
export const QUESTION_STATUS_TONES: Record<FinancialQuestionStatus, string> = { ACTIVE: "active", PAUSED: "pending", PENDING_RESULT: "pending", RESOLVED: "done", VOID: "default" };
export const BUILD_STATUS_LABELS: Record<FinancialBuildStatus, string> = { PENDING: "等待构建", RUNNING: "构建中", SUCCEEDED: "成功", FAILED: "失败", SKIPPED: "已跳过" };
export const BUILD_STATUS_TONES: Record<FinancialBuildStatus, string> = { PENDING: "pending", RUNNING: "running", SUCCEEDED: "done", FAILED: "failed", SKIPPED: "default" };
const RUN_STATUS_LABELS: Record<string, string> = { PREPARING: "准备中", FROZEN: "构建中", FINISHED: "已完成", MISSED: "已错过" };

/** 轮次状态以中台为准，没有对应中文名的原样显示。 */
export function runStatusLabel(status: string): string { return Object.hasOwn(RUN_STATUS_LABELS, status) ? RUN_STATUS_LABELS[status] : status; }

/** 例如 `≥ 210.00`；数值原样拼接，不做格式化。 */
export function thresholdText(item: Pick<FinancialQuestion, "direction" | "threshold">): string {
  return `${item.direction === "GTE" ? "≥" : "≤"} ${item.threshold}`;
}

export function elapsedText(seconds: number | null): string {
  if (seconds === null) return "—";
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole} 秒` : `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`;
}

/** 本轮还在排队或构建时才轮询；两者都有截止时刻，不会一直刷。 */
export function financialQuestionNeedsPolling(item: Pick<FinancialQuestion, "currentBuild">): boolean {
  return item.currentBuild?.status === "PENDING" || item.currentBuild?.status === "RUNNING";
}

export interface FinancialAssetOption { key: string; name: string; batch: FinancialBatch }

/** 筛选下拉用的 32 个标的；中台没有标的列表接口，标的范围变化时同步修改。 */
export const FINANCIAL_ASSETS: readonly FinancialAssetOption[] = [
  ...([
    ["US_SPX", "标普500指数（SPX）"], ["US_SPY", "标普500 ETF（SPY）"], ["US_QQQ", "纳斯达克100 ETF（QQQ）"], ["US_IWM", "罗素2000 ETF（IWM）"],
    ["COMEX_GC", "黄金期货（GC）"], ["US_GLD", "黄金 ETF（GLD）"], ["NYMEX_CL", "WTI 原油期货（CL）"], ["CRYPTO_BTC", "比特币（BTC）"], ["CRYPTO_ETH", "以太币（ETH）"],
    ["US_IBIT", "比特币 ETF（IBIT）"], ["US_NVDA", "英伟达（NVDA）"], ["US_MU", "美光科技（MU）"], ["US_AMD", "超威半导体（AMD）"], ["US_AVGO", "博通（AVGO）"],
    ["US_MSFT", "微软（MSFT）"], ["US_AAPL", "苹果（AAPL）"], ["US_TSLA", "特斯拉（TSLA）"], ["US_GOOGL", "Alphabet（GOOGL）"], ["US_META", "Meta（META）"],
    ["US_AMZN", "亚马逊（AMZN）"], ["US_SPCX", "SpaceX（SPCX）"], ["US_ANT", "Anthropic（ANT）"], ["US_BABA", "阿里巴巴（BABA）"], ["US_TSM", "台积电（TSM）"],
  ] as const).map(([key, name]) => ({ key, name, batch: "OVERSEAS" as const })),
  ...([
    ["CN_SSE_COMPOSITE", "上证指数"], ["CN_SZSE_COMPONENT", "深证成指"], ["CN_CSI300", "沪深300"], ["CN_SSE50", "上证50"],
    ["CN_CSI500", "中证500"], ["CN_CSI1000", "中证1000"], ["CN_CHINEXT", "创业板指"], ["CN_STAR50", "科创50"],
  ] as const).map(([key, name]) => ({ key, name, batch: "CN" as const })),
];

/** 内置标的之外，再补上接口里实际出现的标的和地址里已选中的标的，避免筛不到。 */
export function financialAssetOptions(items: readonly Pick<FinancialQuestion, "assetKey" | "assetName" | "batch">[], selected: string): FinancialAssetOption[] {
  const options = [...FINANCIAL_ASSETS];
  const known = new Set(options.map((option) => option.key));
  for (const item of items) {
    if (known.has(item.assetKey)) continue;
    known.add(item.assetKey);
    options.push({ key: item.assetKey, name: item.assetName, batch: item.batch });
  }
  if (selected && !known.has(selected)) options.push({ key: selected, name: selected, batch: selected.startsWith("CN_") ? "CN" : "OVERSEAS" });
  return options;
}

// ───────────────────────── 小工具 ─────────────────────────

const SANDBOX_ID = /^[A-Za-z0-9._-]{1,160}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

function fail(field: string): never { throw new ConsoleV2ContractError(`金融题接口缺少有效 ${field}`); }
function record(value: unknown, field?: string): RawRecord {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as RawRecord;
  if (field) fail(field);
  return {};
}
function nullable<T>(value: unknown, field: string, decode: (value: RawRecord, prefix: string) => T): T | undefined { return value === null || value === undefined ? undefined : decode(record(value, field), field); }
function positiveInteger(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) fail(field); return value; }
function nonNegativeInteger(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(field); return value; }
function optionalNonNegativeInteger(value: unknown, field: string): number | null { return value === null || value === undefined ? null : nonNegativeInteger(value, field); }
function optionalNonNegativeNumber(value: unknown, field: string): number | null { if (value === null || value === undefined) return null; if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(field); return value; }
function requiredText(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) fail(field); return value; }
/** 可选文本：null、缺失、空串或纯空白都当作没有（中台只把空串置 null，构建服务回报的错误信息可能是纯空白）；非字符串仍报错。 */
function optionalText(value: unknown, field: string): string | undefined { if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return undefined; return requiredText(value, field); }
function decimal(value: unknown, field: string): string { if (typeof value !== "string" || !DECIMAL.test(value)) fail(field); return value; }
function requiredTime(value: unknown, field: string): string { if (typeof value !== "string" || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) fail(field); return value; }
function calendarDate(value: unknown, field: string): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) fail(field); return value; }
function sandboxId(value: unknown, field: string): string { if (typeof value !== "string" || !SANDBOX_ID.test(value) || value === "." || value === "..") fail(field); return value; }
function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T { if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail(field); return value as T; }
