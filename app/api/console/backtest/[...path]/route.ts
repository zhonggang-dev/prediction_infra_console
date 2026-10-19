type RouteParams = { params: Promise<{ path: string[] }> };
type Method = "GET" | "POST" | "PUT";

/** 回测平台 BFF：新开路由空间，不改只读的 /api/console/v2/*。令牌与操作人只在服务端拼装。 */

const IDENTITY = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,159}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
// 因子 ID 允许冒号（infra 的 factor_id 规则），所以产物路径也放行 ":"
const ARTIFACT_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./@=+,:-]{0,511}$/;
// 与 infra 的操作人规则一致（首字符必须是字母或数字）
/** 页面发起写操作时带的标记头值（lib/backtest-platform.ts 里同名常量，测试断言一致） */
const WRITE_MARKER = "backtest-console";
const OPERATOR = /^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,95}$/;
// 允许内联展示的产物图片类型（不含 svg：避免同源脚本执行）
const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;

const CATALOG_QUERY = ["kind", "dataset", "tag", "covers_start", "covers_end", "q", "status", "pool_state", "limit", "offset"];
const RUNS_QUERY = ["board", "item", "status", "batch_id", "requested_by", "config_sha256", "parent_run_id", "limit", "offset"];

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_POOL_BYTES = 16 * 1024;
const JSON_TIMEOUT_MS = 30_000;

/**
 * 页面内上传上限。生产是 `vinext start`（Node 服务器，请求体按流转发，不缓冲）；
 * 本地 `vinext dev` 才在 workerd 上运行。验证结论见任务目录 decisions.md 第 1 条：
 * 1 GiB 流式上传在两种运行方式下都完整到达上游，这里取 1 GiB 作为页面内上限；
 * 更大的文件（因子表、预测表上限默认 2 GiB）由研究侧 / 训练侧直接调 infra 接口。
 * infra 另有按类型的上限（策略包默认 64 MiB），超过时由 infra 返回 413。
 */
const UPLOAD_LIMIT_BYTES = 1024 * 1024 * 1024;

type UploadKind = { endpoint: (segments: string[]) => string | undefined; types: string[]; label: string };

const UPLOAD_KINDS: Record<string, UploadKind> = {
  strategies: { label: "策略", types: ["application/gzip", "application/x-tar"], endpoint: (s) => s.length === 2 ? `/api/v1/backtest/strategies/${enc(s[0])}/versions/${enc(s[1])}` : undefined },
  "factor-tables": { label: "因子表", types: ["application/vnd.apache.parquet"], endpoint: (s) => s.length === 2 ? `/api/v1/backtest/factor-tables/${enc(s[0])}/versions/${enc(s[1])}` : undefined },
  predictions: { label: "预测表", types: ["application/vnd.apache.parquet"], endpoint: (s) => s.length === 3 ? `/api/v1/backtest/predictions/${enc(s[0])}/versions/${enc(s[1])}/${enc(s[2])}` : undefined },
};

type Target = {
  method: Method;
  endpoint: string;
  query: URLSearchParams;
  kind: "json" | "stream-download" | "upload" | "empty";
  maxBody?: number;
  upload?: UploadKind;
  /** 单个产物文件（图片）可内联展示 */
  inlineImages?: boolean;
};

export async function GET(request: Request, { params }: RouteParams) { return handle(request, "GET", (await params).path); }
export async function POST(request: Request, { params }: RouteParams) { return handle(request, "POST", (await params).path); }
export async function PUT(request: Request, { params }: RouteParams) { return handle(request, "PUT", (await params).path); }
export async function PATCH() { return methodNotAllowed(); }
export async function DELETE() { return methodNotAllowed(); }

async function handle(request: Request, method: Method, path: string[]): Promise<Response> {
  let target: Target | undefined;
  try {
    target = resolve(request, method, path);
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : "回测请求参数无效", "BACKTEST_REQUEST_INVALID");
  }
  if (!target) return jsonError(404, "不支持的回测平台接口。", "BACKTEST_ROUTE_NOT_FOUND");
  // 写操作只接受本站页面发起的请求：停止运行是无请求体的 POST（跨站 no-cors 也能发出），V2 又没有登录态。
  if (method !== "GET" && !isSameOrigin(request)) return jsonError(403, "回测平台写操作只接受本站页面发起的请求。", "CROSS_SITE_REQUEST_REJECTED");

  const baseUrl = process.env.PREDICTION_INFRA_BASE_URL;
  const token = process.env.BACKTEST_PLATFORM_CONSOLE_TOKEN;
  if (!baseUrl || !token) return jsonError(503, "回测平台连接尚未配置。", "BACKEND_NOT_CONFIGURED");
  let url: URL;
  try { url = new URL(target.endpoint, baseUrl); } catch { return jsonError(503, "回测平台连接配置无效。", "BACKEND_NOT_CONFIGURED"); }
  url.search = target.query.toString();

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: target.kind === "stream-download" ? "*/*" : "application/json",
    // 当前 V2 没有登录身份；接入登录后改为用户名。infra 把它记入 requested_by / submitted_by / pool_changed_by。
    "x-backtest-operator": operatorName(),
  };
  const idempotency = request.headers.get("idempotency-key");
  if (idempotency && IDEMPOTENCY_KEY.test(idempotency)) headers["idempotency-key"] = idempotency;

  let init: RequestInit & { duplex?: "half" };
  try {
    if (target.kind === "upload") {
      const prepared = prepareUpload(request, target);
      Object.assign(headers, prepared.headers);
      init = { method, headers, body: prepared.body, duplex: "half", signal: request.signal };
    } else if (target.kind === "json") {
      const raw = await readJsonBody(request, target.maxBody ?? MAX_JSON_BYTES);
      headers["content-type"] = "application/json";
      init = { method, headers, body: raw, signal: AbortSignal.timeout(JSON_TIMEOUT_MS) };
    } else if (target.kind === "empty") {
      init = { method, headers, signal: AbortSignal.timeout(JSON_TIMEOUT_MS) };
    } else {
      // 下载：流式透传，不设整体超时；浏览器取消时断开上游。
      init = { method, headers, signal: request.signal };
    }
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.status, error.message, error.code);
    return jsonError(400, error instanceof Error ? error.message : "回测请求无效", "BACKTEST_REQUEST_INVALID");
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // 上传流在 TransformStream 里抛出的 HttpError 会被 fetch 包成 TypeError("fetch failed")，原因在 cause 里
    const reason = error instanceof HttpError ? error : (error as { cause?: unknown } | null)?.cause;
    if (reason instanceof HttpError) return jsonError(reason.status, reason.message, reason.code);
    return jsonError(502, "回测平台上游暂时不可用。", "UPSTREAM_UNAVAILABLE");
  }
  // 令牌被 infra 拒绝是服务端配置问题，不是浏览器用户的问题：不把 401/403 原样交给页面（避免被当成登录失效）
  if (response.status === 401 || response.status === 403) {
    void response.body?.cancel().catch(() => undefined);
    return jsonError(502, "回测平台拒绝了控制台的服务端凭据，请检查 BACKTEST_PLATFORM_CONSOLE_TOKEN 配置。", "UPSTREAM_AUTH_FAILED");
  }
  const out = copyHeaders(response.headers);
  // 结果页里的图片（?path=）要能在页面内直接显示 / 新窗口打开；infra 对所有产物都给 attachment
  if (target.inlineImages && response.ok && INLINE_IMAGE.test(out.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "")) out.set("content-disposition", "inline");
  return new Response(response.body, { status: response.status, headers: out });
}

function resolve(request: Request, method: Method, path: string[]): Target | undefined {
  const url = new URL(request.url);
  const [head, second, third] = path;
  if (method === "GET") {
    if (path.length === 1 && head === "catalog") return { method, endpoint: "/api/v1/backtest/catalog", query: pickQuery(url.searchParams, CATALOG_QUERY), kind: "empty" };
    if (path.length === 1 && head === "runs") return { method, endpoint: "/api/v1/backtest/runs", query: pickQuery(url.searchParams, RUNS_QUERY), kind: "empty" };
    if (path.length === 2 && head === "runs") return { method, endpoint: `/api/v1/backtest/runs/${enc(safeId(second, "运行 ID"))}`, query: new URLSearchParams(), kind: "empty" };
    if (path.length === 3 && head === "runs" && third === "artifacts") {
      const query = new URLSearchParams();
      const artifact = oneQuery(url.searchParams, "path");
      if (artifact) query.set("path", safeArtifactPath(artifact));
      assertOnly(url.searchParams, ["path"]);
      return { method, endpoint: `/api/v1/backtest/runs/${enc(safeId(second, "运行 ID"))}/artifacts`, query, kind: "stream-download", inlineImages: query.has("path") };
    }
    if (path.length === 2 && head === "submissions") return { method, endpoint: `/api/v1/backtest/submissions/${enc(safeId(second, "提交 ID"))}`, query: new URLSearchParams(), kind: "empty" };
    return undefined;
  }
  if (method === "POST") {
    if (path.length === 1 && head === "runs") return { method, endpoint: "/api/v1/backtest/runs", query: new URLSearchParams(), kind: "json" };
    if (path.length === 3 && head === "runs" && third === "cancel") return { method, endpoint: `/api/v1/backtest/runs/${enc(safeId(second, "运行 ID"))}/cancel`, query: new URLSearchParams(), kind: "empty" };
    if (head === "upload" && path.length >= 3) {
      const upload = UPLOAD_KINDS[second];
      if (!upload) return undefined;
      const segments = path.slice(2).map((segment) => safeId(segment, "标识"));
      const endpoint = upload.endpoint(segments);
      return endpoint ? { method, endpoint, query: new URLSearchParams(), kind: "upload", upload } : undefined;
    }
    return undefined;
  }
  if (path.length === 3 && head === "factors" && third === "pool") return { method, endpoint: `/api/v1/backtest/factors/${enc(safeId(second, "因子 ID"))}/pool`, query: new URLSearchParams(), kind: "json", maxBody: MAX_POOL_BYTES };
  return undefined;
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readJsonBody(request: Request, limit: number): Promise<string> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpError(415, "请求体必须是 application/json。", "UNSUPPORTED_MEDIA_TYPE");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw new HttpError(413, "请求体过大。", "REQUEST_TOO_LARGE");
  // 不信任 Content-Length（分块传输可以不带）：边读边计数，超限立即中止，不把超大请求体读进内存
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { void reader.cancel().catch(() => undefined); throw new HttpError(413, "请求体过大。", "REQUEST_TOO_LARGE"); }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new HttpError(400, "请求体必须是合法 JSON。", "BACKTEST_REQUEST_INVALID"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "请求体必须是 JSON 对象。", "BACKTEST_REQUEST_INVALID");
  return raw;
}

/**
 * 写操作的 CSRF 防护：页面请求必须带自定义头 x-requested-with（跨站页面不先过 CORS 预检就加不了自定义头，
 * 而本 BFF 不提供 CORS）；浏览器如果带了 Sec-Fetch-Site，也必须是同源。
 * 不比较 Origin 与 Host：BFF 常在反向代理后面，Host 可能被改写。
 */
function isSameOrigin(request: Request): boolean {
  if (request.headers.get("x-requested-with") !== WRITE_MARKER) return false;
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

function prepareUpload(request: Request, target: Target) {
  const upload = target.upload as UploadKind;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!upload.types.includes(contentType)) throw new HttpError(415, `${upload.label}上传的 Content-Type 必须是 ${upload.types.join(" 或 ")}。`, "UNSUPPORTED_MEDIA_TYPE");
  const lengthHeader = request.headers.get("content-length");
  const length = lengthHeader === null ? NaN : Number(lengthHeader);
  // 必须声明长度：超限在读取任何内容前就拒绝；声明与实际不符时下面的计数器会截断。
  if (!Number.isSafeInteger(length) || length <= 0) throw new HttpError(411, "上传必须带 Content-Length。", "LENGTH_REQUIRED");
  if (length > UPLOAD_LIMIT_BYTES) throw new HttpError(413, `页面内上传上限 ${UPLOAD_LIMIT_BYTES / 1024 / 1024} MiB，更大的文件请直接调用接口。`, "UPLOAD_TOO_LARGE");
  if (!request.body) throw new HttpError(400, "上传缺少请求体。", "BACKTEST_REQUEST_INVALID");
  let seen = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > length || seen > UPLOAD_LIMIT_BYTES) controller.error(new HttpError(413, "上传内容超过声明长度或上限。", "UPLOAD_TOO_LARGE"));
      else controller.enqueue(chunk);
    },
    flush(controller) {
      if (seen !== length) controller.error(new HttpError(400, "上传内容少于声明长度。", "BACKTEST_REQUEST_INVALID"));
    },
  });
  return { body: request.body.pipeThrough(counter), headers: { "content-type": contentType, "content-length": String(length) } };
}

function pickQuery(source: URLSearchParams, allowed: string[]): URLSearchParams {
  assertOnly(source, allowed);
  const query = new URLSearchParams();
  for (const key of allowed) {
    const value = oneQuery(source, key);
    if (value !== undefined) query.set(key, value);
  }
  return query;
}

function assertOnly(query: URLSearchParams, allowed: string[]) {
  for (const key of query.keys()) if (!allowed.includes(key)) throw new Error(`不支持的查询参数 ${key}`);
}

function oneQuery(query: URLSearchParams, key: string): string | undefined {
  const values = query.getAll(key);
  if (values.length > 1) throw new Error(`参数 ${key} 不能重复`);
  const value = values[0]?.trim();
  if (value === undefined || value === "") return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value) || value.length > 512) throw new Error(`参数 ${key} 含有不允许的字符`);
  return value;
}

function safeId(value: string | undefined, label: string): string {
  if (!value || value === "." || value === ".." || !IDENTITY.test(value)) throw new Error(`${label}无效`);
  return value;
}

function safeArtifactPath(value: string): string {
  if (!ARTIFACT_PATH.test(value) || value.split("/").some((segment) => segment === ".." || segment === ".")) throw new Error("产物路径无效");
  return value;
}

function enc(value: string) { return encodeURIComponent(value); }

function operatorName() {
  const configured = process.env.BACKTEST_PLATFORM_OPERATOR?.trim();
  return configured && OPERATOR.test(configured) ? configured : "console";
}

function copyHeaders(source: Headers): Headers {
  const result = new Headers();
  const encoded = source.get("content-encoding") !== null;
  for (const name of ["content-type", "content-disposition", "etag", "retry-after", "x-request-id", ...(encoded ? [] : ["content-length"])]) {
    const value = source.get(name);
    if (value) result.set(name, value);
  }
  result.set("cache-control", "no-store");
  result.set("x-content-type-options", "nosniff");
  return result;
}

function jsonError(status: number, message: string, code: string): Response {
  return Response.json({ code, message }, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ code: "METHOD_NOT_ALLOWED", message: "回测平台接口仅允许 GET、POST、PUT。" }), { status: 405, headers: { allow: "GET, POST, PUT", "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
