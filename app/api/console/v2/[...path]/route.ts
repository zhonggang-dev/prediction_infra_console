type RouteParams = { params: Promise<{ path: string[] }> };

type ProxyTarget = {
  baseUrl?: string;
  token?: string;
  endpoint: string;
  serviceName: string;
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
  "tracked-rules",
  "service-metrics",
  "user-question-uploads",
  "user-questions",
]);

/** 用户问题的两条只读子路径：资源名 → 子资源名，中间段是正整数 ID。 */
const INFRA_ID_SUBRESOURCES: Record<string, string> = {
  "user-questions": "sandboxes",
  "user-question-uploads": "latest-sandbox-ids",
};

const TRADING_RESOURCES = new Set([
  "accounts",
  "account-performance",
  "account-core-metrics",
  "account-cohort-metrics",
  "ledger-activities",
  "settlements",
  "runtime",
  "decision-cycles",
  "orders",
  "holdings",
  "portfolio-holdings",
  "position-lots",
  "reconciliation-runs",
  "reconciliation-issues",
  "redemptions",
  "service-metrics",
]);

// Opaque cycle IDs may contain a colon (for example main:20260818T042000Z),
// while slash, control characters and traversal segments remain impossible.
const SAFE_ID = /^[A-Za-z0-9_:-]{1,160}$/;
// 用户问题 / 上传批次 ID 是正整数，在 SAFE_ID 之上再收紧。
const POSITIVE_ID = /^[1-9][0-9]{0,15}$/;

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
  if (path[0] === "infra" && path.length === 4 && INFRA_ID_SUBRESOURCES[path[1]] === path[3] && !(SAFE_ID.test(path[2]) && POSITIVE_ID.test(path[2]))) {
    return json({ code: "INVALID_CONSOLE_V2_ID", message: "ID 必须是正整数。" }, 400);
  }
  const target = resolveTarget(path);
  if (!target) return json({ code: "V2_ROUTE_NOT_FOUND", message: "不支持的控制台接口。" }, 404);
  if (path[0] === "trading" && (path[1] === "account-performance" || path[1] === "account-core-metrics")) {
    const query = new URL(request.url).searchParams;
    const account = query.get("execution_account_id");
    if ([...query.keys()].some((key) => key !== "execution_account_id") || query.getAll("execution_account_id").length > 1 || (account !== null && (!account || account.length > 128 || account.trim() !== account || [...account].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)))) return json({ code: "INVALID_CONSOLE_V2_FILTER", message: "账户筛选无效。" }, 400);
  }
  if (path[0] === "trading" && path[1] === "account-cohort-metrics") {
    const query = new URL(request.url).searchParams;
    const allowed = new Set(["execution_account_id", "account_scope", "opening_from", "opening_to"]);
    const account = query.get("execution_account_id"), scope = query.get("account_scope");
    const from = query.get("opening_from"), to = query.get("opening_to");
    const instant = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
    if ([...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length !== 1 || !query.get(key)) ||
      (account !== null && (account.length > 128 || account.trim() !== account || [...account].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) ||
      (scope !== null && scope !== "active" && scope !== "all") || (account !== null && scope !== null) ||
      (from === null) !== (to === null) || (from !== null && to !== null && (!instant(from) || !instant(to) || Date.parse(from) >= Date.parse(to)))) return json({ code: "INVALID_CONSOLE_V2_FILTER", message: "开仓区间或账户筛选无效。" }, 400);
  }
  if (!target.baseUrl || !target.token) return json({ code: "BACKEND_NOT_CONFIGURED", message: `${target.serviceName} 的只读连接尚未配置。` }, 503);

  const url = new URL(target.endpoint, target.baseUrl);
  url.search = new URL(request.url).search;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${target.token}`, accept: request.headers.get("accept") ?? "application/json" },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
  } catch {
    return json({ code: "UPSTREAM_UNAVAILABLE", message: `${target.serviceName} 暂时不可用。` }, 502);
  }
  const headers = copyHeaders(response.headers);

  return new Response(response.body, { status: response.status, headers });
}

function resolveTarget(path: string[]): ProxyTarget | undefined {
  const [service, ...segments] = path;
  if (!service || segments.length === 0) return undefined;
  const resource = segments[0];
  if (service === "infra") {
    if (segments.length === 3 && INFRA_ID_SUBRESOURCES[resource] === segments[2] && SAFE_ID.test(segments[1]) && POSITIVE_ID.test(segments[1])) {
      return { baseUrl: process.env.PREDICTION_INFRA_BASE_URL, token: process.env.CONSOLE_API_TOKEN, endpoint: `/api/v1/console/v2/${resource}/${encodeURIComponent(segments[1])}/${segments[2]}`, serviceName: "Prediction Infra" };
    }
    if (segments.length !== 1 || !INFRA_RESOURCES.has(resource)) return undefined;
    return { baseUrl: process.env.PREDICTION_INFRA_BASE_URL, token: process.env.CONSOLE_API_TOKEN, endpoint: `/api/v1/console/v2/${resource}`, serviceName: "Prediction Infra" };
  }
  if (service !== "trading") return undefined;
  if (resource === "decision-cycles" && segments.length === 2 && SAFE_ID.test(segments[1])) {
    return { baseUrl: process.env.TRADING_EXECUTION_BASE_URL, token: process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN, endpoint: `/api/v1/console/v2/decision-cycles/${encodeURIComponent(segments[1])}`, serviceName: "Trading Execution" };
  }
  if (resource === "orders" && segments.length === 3 && segments[2] === "trace" && SAFE_ID.test(segments[1])) {
    return { baseUrl: process.env.TRADING_EXECUTION_BASE_URL, token: process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN, endpoint: `/api/v1/console/v2/orders/${encodeURIComponent(segments[1])}/trace`, serviceName: "Trading Execution" };
  }
  if ((resource === "holdings" || resource === "portfolio-holdings") && segments.length === 2 && segments[1] === "lots") {
    return { baseUrl: process.env.TRADING_EXECUTION_BASE_URL, token: process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN, endpoint: `/api/v1/console/v2/${resource}/lots`, serviceName: "Trading Execution" };
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
