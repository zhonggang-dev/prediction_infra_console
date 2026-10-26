type RouteParams = { params: Promise<{ path: string[] }> };

type ProxyTarget = {
  baseUrl?: string;
  token?: string;
  endpoint: string;
  serviceName: string;
  legacyEnvelope?: "outbox";
};

const INFRA_RESOURCES = new Set([
  "overview",
  "running-markets",
  "running-pool",
  "running-generations",
  "selection-runs",
  "selected-markets",
  "predictions",
  "prediction-models",
  "prediction-batches",
  "prediction-tasks",
  "assets",
  "dataset-members",
  "market-data",
  "market-settlements",
  "page-jobs",
  "backtest-products",
  "outbox-events",
  "service-metrics",
]);

const TRADING_RESOURCES = new Set([
  "runtime",
  "decision-cycles",
  "orders",
  "holdings",
  "position-lots",
  "reconciliation-runs",
  "reconciliation-issues",
  "redemptions",
  "service-metrics",
]);

// Opaque cycle IDs may contain a colon (for example main:20260818T042000Z),
// while slash, control characters and traversal segments remain impossible.
const SAFE_ID = /^[A-Za-z0-9_:-]{1,160}$/;

export async function GET(request: Request, { params }: RouteParams) {
  return forward(request, (await params).path);
}

/** V2 is intentionally read-only.  Keep the boundary explicit for clients and tests. */
export async function POST() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

async function forward(request: Request, path: string[]): Promise<Response> {
  const target = resolveTarget(path);
  if (!target) return json({ code: "V2_ROUTE_NOT_FOUND", message: "不支持的控制台接口。" }, 404);
  if (!target.baseUrl || !target.token) return json({ code: "BACKEND_NOT_CONFIGURED", message: `${target.serviceName} 的只读连接尚未配置。` }, 503);

  const url = new URL(target.endpoint, target.baseUrl);
  url.search = new URL(request.url).search;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${target.token}`, accept: request.headers.get("accept") ?? "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return json({ code: "UPSTREAM_UNAVAILABLE", message: `${target.serviceName} 暂时不可用。` }, 502);
  }
  const headers = copyHeaders(response.headers);
  if (target.legacyEnvelope === "outbox") {
    if (!response.ok) return new Response(response.body, { status: response.status, headers });
    const payload = await response.json().catch(() => ({}));
    const root = asRecord(payload);
    const data = asRecord(root.data);
    const items = Array.isArray(data.items) ? data.items : [];
    const limit = exactPageInteger(data.limit, false);
    const offset = exactPageInteger(data.offset, true);
    const total = exactPageInteger(data.total, true);
    if (limit === undefined || offset === undefined) {
      return json({ code: "PAGINATION_UNAVAILABLE", message: "Outbox 列表返回了无效的分页范围。" }, 502);
    }
    if (total === undefined) {
      return json({ code: "TOTAL_UNAVAILABLE", message: "Outbox 列表没有返回当前筛选下的准确总数。" }, 502);
    }
    const hasMore = offset + items.length < total;
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    return Response.json({ ...root, data: { items, total, limit, offset, has_more: hasMore, observed_at: new Date().toISOString(), summary: { basis: "legacy_outbox_projection" } } }, { status: response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

function resolveTarget(path: string[]): ProxyTarget | undefined {
  const [service, ...segments] = path;
  if (!service || segments.length === 0) return undefined;
  const resource = segments[0];
  if (service === "infra") {
    if (segments.length !== 1 || !INFRA_RESOURCES.has(resource)) return undefined;
    if (resource === "outbox-events") return { baseUrl: process.env.PREDICTION_INFRA_BASE_URL, token: process.env.CONSOLE_API_TOKEN, endpoint: "/api/v1/console/outbox-events", serviceName: "Prediction Infra", legacyEnvelope: "outbox" };
    return { baseUrl: process.env.PREDICTION_INFRA_BASE_URL, token: process.env.CONSOLE_API_TOKEN, endpoint: `/api/v1/console/v2/${resource}`, serviceName: "Prediction Infra" };
  }
  if (service !== "trading") return undefined;
  if (resource === "decision-cycles" && segments.length === 2 && SAFE_ID.test(segments[1])) {
    return { baseUrl: process.env.TRADING_EXECUTION_BASE_URL, token: process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN, endpoint: `/api/v1/console/v2/decision-cycles/${encodeURIComponent(segments[1])}`, serviceName: "Trading Execution" };
  }
  if (resource === "orders" && segments.length === 3 && segments[2] === "trace" && SAFE_ID.test(segments[1])) {
    return { baseUrl: process.env.TRADING_EXECUTION_BASE_URL, token: process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN, endpoint: `/api/v1/console/v2/orders/${encodeURIComponent(segments[1])}/trace`, serviceName: "Trading Execution" };
  }
  if (resource === "holdings" && segments.length === 2 && segments[1] === "lots") {
    return { baseUrl: process.env.TRADING_EXECUTION_BASE_URL, token: process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN, endpoint: "/api/v1/console/v2/holdings/lots", serviceName: "Trading Execution" };
  }
  if (segments.length !== 1 || !TRADING_RESOURCES.has(resource)) return undefined;
  return { baseUrl: process.env.TRADING_EXECUTION_BASE_URL, token: process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN, endpoint: `/api/v1/console/v2/${resource}`, serviceName: "Trading Execution" };
}

function copyHeaders(source: Headers): Headers {
  const result = new Headers();
  for (const name of ["content-type", "content-length", "etag", "x-request-id"]) {
    const value = source.get(name);
    if (value) result.set(name, value);
  }
  result.set("cache-control", "no-store");
  return result;
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ code: "READ_ONLY", message: "控制台只读接口仅允许 GET。" }), { status: 405, headers: { allow: "GET", "content-type": "application/json", "cache-control": "no-store" } });
}

function json(body: Record<string, string>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Legacy outbox values must already be JSON numbers; coercing null/false/""
 * to zero would turn a missing count into a successful empty page. */
function exactPageInteger(value: unknown, allowZero: boolean): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) return undefined;
  return value;
}
