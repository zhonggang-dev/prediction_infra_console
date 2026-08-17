const CONSOLE_RESOURCES = new Set(["overview", "selection-runs", "selected-markets", "sandboxes", "predictions", "orderbook-series", "outbox-events"]);
const BACKTEST_FILES = new Set(["sandboxes.parquet", "predictions.parquet", "clob_orderbooks.parquet", "settlements.parquet", "manifest.json"]);
const DATASET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type RouteParams = { params: Promise<{ path: string[] }> };
type ProxyTarget = { baseUrl?: string; token?: string; endpoint: string; stream: boolean };

/** 同源 BFF 只转发白名单接口，浏览器不会获得任一服务令牌。 */
export async function GET(request: Request, { params }: RouteParams) {
  return forward(request, (await params).path);
}

/** 只有回测数据集创建和下载走独立的回测令牌。 */
export async function POST(request: Request, { params }: RouteParams) {
  return forward(request, (await params).path);
}

async function forward(request: Request, path: string[]): Promise<Response> {
  if (request.method === "GET" && path.length === 1 && path[0] === "capabilities") {
    return Response.json({ data: { console_read: Boolean(process.env.PREDICTION_INFRA_BASE_URL && process.env.CONSOLE_API_TOKEN), backtest_create: Boolean(process.env.PREDICTION_INFRA_BASE_URL && process.env.BACKTEST_DATASET_TOKEN) } });
  }
  const target = resolveTarget(path, request.method);
  if (!target) return Response.json({ error: "不支持的控制台接口" }, { status: 404 });
  if (!target.baseUrl || !target.token) return Response.json({ error: "后端连接尚未配置，请在前端服务环境中设置对应变量。", code: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  const url = new URL(target.endpoint, target.baseUrl);
  url.search = new URL(request.url).search;
  const headers = new Headers({ authorization: `Bearer ${target.token}`, accept: request.headers.get("accept") ?? "application/json" });
  if (request.method !== "GET") headers.set("content-type", request.headers.get("content-type") ?? "application/json");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (request.method === "POST" && idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.text(),
      signal: target.stream ? undefined : AbortSignal.timeout(10_000),
    });
  } catch {
    return Response.json({ message: "上游 Prediction Infra 暂时不可用。", code: "UPSTREAM_UNAVAILABLE" }, { status: 502 });
  }
  const passthroughHeaders = copyResponseHeaders(response.headers);
  return new Response(response.body, { status: response.status, headers: passthroughHeaders });
}

/** 只允许代理固定的 Console 与回测数据集路径。 */
function resolveTarget(path: string[], method: string): ProxyTarget | undefined {
  const first = path[0];
  if (!first) return undefined;
  if (first === "backtest-datasets") return resolveBacktestTarget(path, method);
  if (!CONSOLE_RESOURCES.has(first) || path.length !== 1) return undefined;
  return {
    baseUrl: process.env.PREDICTION_INFRA_BASE_URL,
    token: process.env.CONSOLE_API_TOKEN,
    endpoint: `/api/v1/console/${first}`,
    stream: false,
  };
}

/** 回测代理只开放创建、详情和固定制品下载。 */
function resolveBacktestTarget(path: string[], method: string): ProxyTarget | undefined {
  const baseUrl = process.env.PREDICTION_INFRA_BASE_URL;
  if (method === "GET" && path.length === 1) {
    return { baseUrl, token: process.env.CONSOLE_API_TOKEN, endpoint: "/api/v1/console/backtest-datasets", stream: false };
  }
  if (method === "POST" && path.length === 1) {
    return { baseUrl, token: process.env.BACKTEST_DATASET_TOKEN, endpoint: "/api/v1/backtest-datasets", stream: false };
  }
  const datasetID = path[1];
  if (method !== "GET" || !datasetID || !DATASET_ID_PATTERN.test(datasetID)) return undefined;
  if (path.length === 2) {
    return { baseUrl, token: process.env.BACKTEST_DATASET_TOKEN, endpoint: `/api/v1/backtest-datasets/${datasetID}`, stream: false };
  }
  const fileName = path[3];
  if (path.length !== 4 || path[2] !== "files" || !fileName || !BACKTEST_FILES.has(fileName)) return undefined;
  return {
    baseUrl,
    token: process.env.BACKTEST_DATASET_TOKEN,
    endpoint: `/api/v1/backtest-datasets/${datasetID}/files/${fileName}`,
    stream: true,
  };
}

/** 只透传下载和诊断需要的安全响应头。 */
function copyResponseHeaders(source: Headers): Headers {
  const result = new Headers();
  for (const name of ["content-type", "content-disposition", "content-length", "etag", "x-checksum-sha256", "x-request-id"]) {
    const value = source.get(name);
    if (value) result.set(name, value);
  }
  return result;
}
