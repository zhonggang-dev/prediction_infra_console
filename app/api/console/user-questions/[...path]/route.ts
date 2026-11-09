type RouteParams = { params: Promise<{ path: string[] }> };

/**
 * 用户问题上传 BFF：浏览器上传 JSON / CSV 问题文件，服务端注入 USER_QUESTION_CONSOLE_TOKEN
 * 后流式转发到中台 `POST /api/v1/console/user-question-uploads`。只读列表与历史走 V2 只读代理，
 * 下载走 `/api/console/downloads/*`，这里只有这一个写接口。
 * 写法照回测平台 BFF：同源标记头 + Sec-Fetch-Site、Content-Type 白名单、必须带 Content-Length、
 * 上限内按流转发（不缓冲进内存）。
 */

/** 页面发起上传时带的标记头值（lib/user-questions.ts 里同名常量，测试断言一致） */
const WRITE_MARKER = "user-question-console";
/** 页面内上传上限，与中台 USER_QUESTION_UPLOAD_MAX_BYTES 默认值一致；中台另有自己的上限，超过时由中台返回 413。 */
const UPLOAD_LIMIT_BYTES = 64 * 1024 * 1024;
const CONTENT_TYPES = new Set(["application/json", "text/csv"]);
const FILENAME_MAX_BYTES = 255;
const UPSTREAM_ENDPOINT = "/api/v1/console/user-question-uploads";

export async function POST(request: Request, { params }: RouteParams) { return handle(request, (await params).path); }
export async function GET() { return methodNotAllowed(); }
export async function PUT() { return methodNotAllowed(); }
export async function PATCH() { return methodNotAllowed(); }
export async function DELETE() { return methodNotAllowed(); }

async function handle(request: Request, path: string[]): Promise<Response> {
  if (path.length !== 1 || path[0] !== "uploads") return jsonError(404, "不支持的用户问题接口。", "USER_QUESTION_ROUTE_NOT_FOUND");
  if (new URL(request.url).search) return jsonError(400, "上传接口不接受查询参数。", "USER_QUESTION_REQUEST_INVALID");
  if (!isSameOrigin(request)) return jsonError(403, "上传只接受本站页面发起的请求。", "CROSS_SITE_REQUEST_REJECTED");

  const baseUrl = process.env.PREDICTION_INFRA_BASE_URL;
  const token = process.env.USER_QUESTION_CONSOLE_TOKEN;
  if (!baseUrl || !token) return jsonError(503, "用户问题上传连接尚未配置。", "BACKEND_NOT_CONFIGURED");
  let url: URL;
  try { url = new URL(UPSTREAM_ENDPOINT, baseUrl); } catch { return jsonError(503, "用户问题上传连接配置无效。", "BACKEND_NOT_CONFIGURED"); }

  let prepared: { body: ReadableStream<Uint8Array>; headers: Record<string, string> };
  try {
    prepared = prepareUpload(request);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.status, error.message, error.code);
    return jsonError(400, "上传请求无效。", "USER_QUESTION_REQUEST_INVALID");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/json", ...prepared.headers },
      body: prepared.body,
      duplex: "half",
      // 不设整体超时：文件按流转发，浏览器取消时断开上游。
      signal: request.signal,
    } as RequestInit & { duplex: "half" });
  } catch (error) {
    // 计数器里抛出的 HttpError 会被 fetch 包成 TypeError("fetch failed")，原因在 cause 里
    const reason = error instanceof HttpError ? error : (error as { cause?: unknown } | null)?.cause;
    if (reason instanceof HttpError) return jsonError(reason.status, reason.message, reason.code);
    return jsonError(502, "用户问题上传服务暂时不可用。", "UPSTREAM_UNAVAILABLE");
  }
  // 令牌被中台拒绝是服务端配置问题：不把 401/403 原样交给页面
  if (response.status === 401 || response.status === 403) {
    void response.body?.cancel().catch(() => undefined);
    return jsonError(502, "中台拒绝了控制台的服务端凭据，请检查 USER_QUESTION_CONSOLE_TOKEN 配置。", "UPSTREAM_AUTH_FAILED");
  }
  return new Response(response.body, { status: response.status, headers: copyHeaders(response.headers) });
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

/**
 * 写操作的 CSRF 防护：页面请求必须带自定义头 x-requested-with（跨站页面不先过 CORS 预检就加不了自定义头，
 * 而本 BFF 不提供 CORS）；浏览器如果带了 Sec-Fetch-Site，也必须是同源。
 */
function isSameOrigin(request: Request): boolean {
  if (request.headers.get("x-requested-with") !== WRITE_MARKER) return false;
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

function prepareUpload(request: Request) {
  const rawType = request.headers.get("content-type") ?? "";
  const [mediaType, ...parameters] = rawType.split(";").map((part) => part.trim().toLowerCase());
  const charsetOk = parameters.every((parameter) => !parameter || parameter === "charset=utf-8" || parameter === "charset=\"utf-8\"");
  if (!CONTENT_TYPES.has(mediaType) || !charsetOk) throw new HttpError(415, "只支持 application/json 或 text/csv（UTF-8）的问题文件。", "UNSUPPORTED_MEDIA_TYPE");
  const lengthHeader = request.headers.get("content-length");
  const length = lengthHeader === null || !/^\d+$/.test(lengthHeader) ? NaN : Number(lengthHeader);
  // 必须声明长度：超限在读取任何内容前就拒绝；声明与实际不符时下面的计数器会截断。
  if (!Number.isSafeInteger(length) || length <= 0) throw new HttpError(411, "上传必须带 Content-Length。", "LENGTH_REQUIRED");
  if (length > UPLOAD_LIMIT_BYTES) throw new HttpError(413, `文件超过 ${UPLOAD_LIMIT_BYTES / 1024 / 1024} MiB 上限。`, "UPLOAD_TOO_LARGE");
  const headers: Record<string, string> = { "content-type": mediaType, "content-length": String(length) };
  const filename = request.headers.get("x-upload-filename");
  if (filename !== null) headers["x-upload-filename"] = safeFilenameHeader(filename);
  if (!request.body) throw new HttpError(400, "上传缺少请求体。", "USER_QUESTION_REQUEST_INVALID");
  let seen = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > length || seen > UPLOAD_LIMIT_BYTES) controller.error(new HttpError(413, "上传内容超过声明长度或上限。", "UPLOAD_TOO_LARGE"));
      else controller.enqueue(chunk);
    },
    flush(controller) {
      if (seen !== length) controller.error(new HttpError(400, "上传内容少于声明长度。", "USER_QUESTION_REQUEST_INVALID"));
    },
  });
  return { body: request.body.pipeThrough(counter), headers };
}

/** 文件名头：必须是可解码的百分号编码 UTF-8，解码后 1..255 字节、不含控制字符和路径分隔符；原样转发编码后的值。 */
function safeFilenameHeader(value: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { throw new HttpError(400, "文件名请求头必须是百分号编码的 UTF-8。", "USER_QUESTION_REQUEST_INVALID"); }
  // eslint-disable-next-line no-control-regex
  if (!decoded || /[\u0000-\u001f\u007f/\\]/.test(decoded) || new TextEncoder().encode(decoded).byteLength > FILENAME_MAX_BYTES) {
    throw new HttpError(400, `文件名无效或超过 ${FILENAME_MAX_BYTES} 字节。`, "USER_QUESTION_REQUEST_INVALID");
  }
  return value;
}

function copyHeaders(source: Headers): Headers {
  const result = new Headers();
  const encoded = source.get("content-encoding") !== null;
  for (const name of ["content-type", "retry-after", "x-request-id", ...(encoded ? [] : ["content-length"])]) {
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
  return new Response(JSON.stringify({ code: "METHOD_NOT_ALLOWED", message: "用户问题上传接口仅允许 POST。" }), { status: 405, headers: { allow: "POST", "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
