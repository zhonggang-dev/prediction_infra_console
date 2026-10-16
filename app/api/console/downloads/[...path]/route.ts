type RouteParams = { params: Promise<{ path: string[] }> };

const SANDBOX_ID = /^[A-Za-z0-9._-]{1,160}$/;
const DATASET_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const SANDBOX_VARIANTS = new Set(["original", "masked"]);
const DATASET_VARIANTS = new Set(["original", "mv", "ms", "syn"]);
const MARKET_SOURCES = new Set(["POLYMARKET", "KALSHI"]);
const ASSET_KINDS = new Set(["MARKET", "GENERATED_MARKET", "GENERATED_QA"]);
const MAX_FORM_BYTES = 64 * 1024;
const MAX_BATCH_IDS = 20;

type ProxyRequest = { endpoint: string; query: URLSearchParams; body?: string };
type BodyFields = Record<string, unknown>;

/**
 * Download BFF for the existing read-only Sandbox and dataset archives.
 * Credentials and the upstream URL are intentionally server-only. The body
 * is parsed here so a native browser form can stream the upstream response
 * without buffering an archive in the browser or in this worker.
 */
export async function GET(request: Request, { params }: RouteParams) {
  return forward(request, "GET", (await params).path);
}

export async function POST(request: Request, { params }: RouteParams) {
  return forward(request, "POST", (await params).path);
}

export async function PUT() { return methodNotAllowed(); }
export async function PATCH() { return methodNotAllowed(); }
export async function DELETE() { return methodNotAllowed(); }

async function forward(request: Request, method: "GET" | "POST", path: string[]): Promise<Response> {
  let target: ProxyRequest;
  try {
    target = method === "GET" ? resolveGet(request, path) : await resolvePost(request, path);
  } catch (error) {
    return jsonError(400, error instanceof Error ? error.message : "下载请求参数无效", "DOWNLOAD_REQUEST_INVALID");
  }

  const baseUrl = process.env.PREDICTION_INFRA_BASE_URL;
  const token = process.env.SANDBOX_DOWNLOAD_TOKEN;
  if (!baseUrl || !token) return jsonError(503, "Sandbox 下载连接尚未配置。", "BACKEND_NOT_CONFIGURED");

  let url: URL;
  try {
    url = new URL(target.endpoint, baseUrl);
  } catch {
    return jsonError(503, "Sandbox 下载连接配置无效。", "BACKEND_NOT_CONFIGURED");
  }
  url.search = target.query.toString();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/x-tar, application/json",
        ...(target.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: target.body,
      signal: request.signal,
      // A download must remain streamable. Do not attach a wall-clock
      // timeout: large archives can take longer than the connection setup.
    });
  } catch {
    return jsonError(502, "Sandbox 下载上游暂时不可用。", "UPSTREAM_UNAVAILABLE");
  }

  return new Response(response.body, { status: response.status, headers: copyDownloadHeaders(response.headers) });
}

function resolveGet(request: Request, path: string[]): ProxyRequest {
  const url = new URL(request.url);
  if (path.length === 3 && path[0] === "sandboxes" && path[2] === "archive") {
    const sandboxId = safePathID(path[1], "Sandbox ID");
    assertOnlyQuery(url.searchParams, ["variant", "asset_kind"]);
    const variant = oneQuery(url.searchParams, "variant") || "original";
    if (!SANDBOX_VARIANTS.has(variant)) throw new Error("Sandbox variant 仅支持 original 或 masked");
    const assetKind = (oneQuery(url.searchParams, "asset_kind") || "").toUpperCase();
    if (assetKind && !ASSET_KINDS.has(assetKind)) throw new Error("asset_kind 不在下载白名单内");
    if (assetKind === "GENERATED_QA" && variant !== "original") throw new Error("Generated QA 资料只允许下载 original");
    const query = new URLSearchParams({ variant });
    return { endpoint: `/api/v1/sandboxes/${encodeURIComponent(sandboxId)}/archive`, query };
  }
  if (path.length === 2 && path[0] === "testsets") {
    const version = safeDatasetVersion(path[1]);
    assertOnlyQuery(url.searchParams, ["variant"]);
    const variant = oneQuery(url.searchParams, "variant") || "mv";
    if (!DATASET_VARIANTS.has(variant)) throw new Error("测试集 variant 仅支持 original、mv、ms 或 syn");
    return { endpoint: `/api/v1/testsets/${encodeURIComponent(version)}`, query: new URLSearchParams({ variant }) };
  }
  if (path.length === 1 && path[0] === "trainsets") {
    assertOnlyQuery(url.searchParams, ["variant", "start_time", "end_time"]);
    const variant = oneQuery(url.searchParams, "variant") || "mv";
    if (!DATASET_VARIANTS.has(variant)) throw new Error("训练集 variant 仅支持 original、mv、ms 或 syn");
    const start = oneQuery(url.searchParams, "start_time");
    const end = oneQuery(url.searchParams, "end_time");
    const query = new URLSearchParams({ variant });
    addRangeQuery(query, "start_time", "end_time", start, end);
    return { endpoint: "/api/v1/trainsets", query };
  }
  throw new Error("不支持的下载接口");
}

async function resolvePost(request: Request, path: string[]): Promise<ProxyRequest> {
  const url = new URL(request.url);
  if (path.length !== 2 || path[0] !== "sandboxes" || !["archives:batch", "archives:range"].includes(path[1])) {
    throw new Error("不支持的下载接口");
  }
  assertOnlyQuery(url.searchParams, ["variant", "market_source"]);
  const fields = await readBody(request);
  if (path[1] === "archives:batch") return resolveBatch(url.searchParams, fields);
  return resolveRange(url.searchParams, fields);
}

function resolveBatch(query: URLSearchParams, fields: BodyFields): ProxyRequest {
  assertOnlyFields(fields, ["sandbox_ids", "ids", "variant", "asset_kind"]);
  const variant = fieldText(fields.variant) || oneQuery(query, "variant") || "original";
  if (!SANDBOX_VARIANTS.has(variant)) throw new Error("Sandbox variant 仅支持 original 或 masked");
  const assetKind = (fieldText(fields.asset_kind) || "").toUpperCase();
  if (assetKind && !ASSET_KINDS.has(assetKind)) throw new Error("asset_kind 不在下载白名单内");
  if (assetKind === "GENERATED_QA" && variant !== "original") throw new Error("Generated QA 资料只允许下载 original");
  const ids = normalizeIDs(fields.sandbox_ids ?? fields.ids);
  if (!ids.length || ids.length > MAX_BATCH_IDS) throw new Error(`Sandbox ID 必须是 1 到 ${MAX_BATCH_IDS} 个少量 ID`);
  return {
    endpoint: "/api/v1/sandboxes/archives:batch",
    query: new URLSearchParams({ variant }),
    body: JSON.stringify(ids),
  };
}

function resolveRange(query: URLSearchParams, fields: BodyFields): ProxyRequest {
  assertOnlyFields(fields, ["frozen_at_start", "frozen_at_end", "variant", "market_source"]);
  const variant = fieldText(fields.variant) || oneQuery(query, "variant") || "original";
  if (!SANDBOX_VARIANTS.has(variant)) throw new Error("Sandbox variant 仅支持 original 或 masked");
  const marketSource = (fieldText(fields.market_source) || oneQuery(query, "market_source") || "").toUpperCase();
  if (marketSource && !MARKET_SOURCES.has(marketSource)) throw new Error("market_source 仅支持 POLYMARKET 或 KALSHI");
  const start = requiredRfc3339(fields.frozen_at_start, "frozen_at_start");
  const end = requiredRfc3339(fields.frozen_at_end, "frozen_at_end");
  if (new Date(start).getTime() >= new Date(end).getTime()) throw new Error("冻结时间范围必须是左闭右开且 start 早于 end");
  const outputQuery = new URLSearchParams({ variant });
  if (marketSource) outputQuery.set("market_source", marketSource);
  return {
    endpoint: "/api/v1/sandboxes/archives:range",
    query: outputQuery,
    body: JSON.stringify({ frozen_at_start: start, frozen_at_end: end }),
  };
}

async function readBody(request: Request): Promise<BodyFields> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_FORM_BYTES) throw new Error("下载请求表单过大");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_FORM_BYTES) throw new Error("下载请求表单过大");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType === "application/json") {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error("请求体必须是合法 JSON"); }
    if (Array.isArray(value)) return { sandbox_ids: value };
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as BodyFields;
    throw new Error("请求体必须是 JSON 数组或对象");
  }
  if (contentType === "application/x-www-form-urlencoded" || !contentType) {
    const fields: BodyFields = {};
    for (const [key, value] of new URLSearchParams(raw).entries()) {
      if (fields[key] !== undefined) throw new Error(`字段 ${key} 不能重复`);
      fields[key] = value;
    }
    return fields;
  }
  throw new Error("下载表单必须使用 application/x-www-form-urlencoded 或 application/json");
}

function normalizeIDs(value: unknown): string[] {
  const values = Array.isArray(value) ? value.map((item) => {
    if (typeof item !== "string") throw new Error("Sandbox ID 必须是字符串");
    return item;
  }) : typeof value === "string" ? value.split(/[\s,]+/) : [];
  const ids = values.map((item) => item.trim()).filter(Boolean);
  if (ids.some((id) => id === "." || id === "..")) throw new Error("Sandbox ID 不能是路径片段");
  if (ids.some((id) => !SANDBOX_ID.test(id))) throw new Error("Sandbox ID 含有不允许的字符");
  if (new Set(ids).size !== ids.length) throw new Error("Sandbox ID 不能重复");
  return ids;
}

function safePathID(value: string | undefined, label: string): string {
  if (!value || value === "." || value === ".." || !SANDBOX_ID.test(value)) throw new Error(`${label} 无效`);
  return value;
}

function safeDatasetVersion(value: string | undefined): string {
  if (!value || !DATASET_VERSION.test(value)) throw new Error("数据集版本无效");
  return value;
}

function requiredRfc3339(value: unknown, field: string): string {
  const text = fieldText(value)?.replaceAll(" ", "+");
  if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(new Date(text).getTime())) {
    throw new Error(`${field} 必须是带时区的 RFC3339 时间`);
  }
  return text;
}

function addRangeQuery(query: URLSearchParams, startKey: string, endKey: string, start: string | undefined, end: string | undefined) {
  if (!start && !end) return;
  if (!start || !end) throw new Error(`${startKey} 与 ${endKey} 必须同时提供`);
  const normalizedStart = requiredRfc3339(start, startKey);
  const normalizedEnd = requiredRfc3339(end, endKey);
  if (new Date(normalizedStart).getTime() >= new Date(normalizedEnd).getTime()) throw new Error("T0 范围必须是左闭右开且 start 早于 end");
  query.set(startKey, normalizedStart);
  query.set(endKey, normalizedEnd);
}

function assertOnlyQuery(query: URLSearchParams, allowed: string[]) {
  for (const key of query.keys()) if (!allowed.includes(key)) throw new Error(`不支持的下载参数 ${key}`);
}

function assertOnlyFields(fields: BodyFields, allowed: string[]) {
  for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`不支持的下载字段 ${key}`);
}

function oneQuery(query: URLSearchParams, key: string): string | undefined {
  const values = query.getAll(key);
  if (values.length > 1) throw new Error(`参数 ${key} 不能重复`);
  return values[0]?.trim() || undefined;
}

function fieldText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function copyDownloadHeaders(source: Headers): Headers {
  const result = new Headers();
  for (const name of ["content-type", "content-disposition", "content-length", "etag", "retry-after", "www-authenticate", "x-request-id", "x-testset-version", "x-testset-variant", "x-testset-count", "x-testset-roster-sha256", "x-trainset-versions", "x-trainset-variant", "x-trainset-count", "x-trainset-roster-sha256"]) {
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
  return new Response(JSON.stringify({ code: "READ_ONLY", message: "下载接口仅允许 GET 或受控 POST。" }), { status: 405, headers: { allow: "GET, POST", "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
