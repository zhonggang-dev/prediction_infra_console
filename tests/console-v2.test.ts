import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GET, POST } from "../app/api/console/v2/[...path]/route.ts";
import { ConsoleV2ApiError, ConsoleV2ContractError, consoleV2 } from "../app/lib/console-v2.ts";

const envNames = ["PREDICTION_INFRA_BASE_URL", "CONSOLE_API_TOKEN", "TRADING_EXECUTION_BASE_URL", "TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN"];

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  try { await run(); } finally {
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("V2 decoder preserves bounded envelope, identities, nullable fields and server filters", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ data: { items: [{ generation_id: 8, running_market_id: 17, source_selection_run_id: 4, source_selected_market_id: 99, market_id: "pm-1", condition_id: "condition-1", question: "Question", matched_domains: ["macro"], volume_24h: null, domain_rank: null, prediction_enabled: false, market_observed_at: "2026-10-16T00:00:00Z", end_at: null }], limit: 20, offset: 0, has_more: true, observed_at: "2026-10-16T00:01:00Z", summary: { basis: "published_generation" } } }));
  }) as typeof fetch;
  try {
    const result = await consoleV2.infra.runningMarkets({ q: "Question", generation_id: 8 });
    assert.equal(result.data.items[0].generationId, "8");
    assert.equal(result.data.items[0].predictionEnabled, false);
    assert.equal(result.data.items[0].volume24h, null);
    assert.equal(result.data.hasMore, true);
    assert.equal(result.data.summary?.basis, "published_generation");
    assert.match(calls[0], /\/api\/console\/v2\/infra\/running-markets\?/);
    assert.match(calls[0], /q=Question/);
    assert.match(calls[0], /generation_id=8/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("V2 decoder rejects a list without an observation timestamp", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [], limit: 20, offset: 0, has_more: false } }))) as typeof fetch;
  try {
    await assert.rejects(() => consoleV2.infra.runningMarkets(), ConsoleV2ContractError);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("V2 client preserves nested Trading error code and message", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: "CYCLE_UNAVAILABLE", message: "cycle read unavailable" } }), { status: 503, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await assert.rejects(() => consoleV2.trading.decisionCycles(), (error: unknown) => error instanceof ConsoleV2ApiError && error.status === 503 && error.code === "CYCLE_UNAVAILABLE" && error.message === "cycle read unavailable");
  } finally { globalThis.fetch = previousFetch; }
});

test("V2 service metrics normalizes the Trading service identity", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { service: "trading_execution", observed_at: "2026-10-16T00:00:00Z", uptime_seconds: 10, runtime: { goroutines: 2, go_version: "go1.26" }, memory: {}, availability: {} } }))) as typeof fetch;
  try {
    const result = await consoleV2.trading.serviceMetrics();
    assert.equal(result.data.service, "trading-execution");
  } finally { globalThis.fetch = previousFetch; }
});

test("Trading filters and V2 detail rows expose only backend status values and keyboard actions", async () => {
  const trading = await readFile(new URL("../app/components/trading-v2-page.tsx", import.meta.url), "utf8");
  const resource = await readFile(new URL("../app/components/console-v2-resource.tsx", import.meta.url), "utf8");
  const live = await readFile(new URL("../app/components/live-trading-page.tsx", import.meta.url), "utf8");
  for (const value of ["INPUT_RECORDED", "OUTPUT_RECORDED", "DELIVERY_PENDING", "DELIVERY_ATTENTION", "RECEIVED", "VALIDATING", "RESERVED", "SUBMITTING", "ACKNOWLEDGED", "LIVE", "PARTIALLY_FILLED", "FILLED", "REJECTED", "UNKNOWN", "CANCEL_PENDING", "CANCELLED", "RECONCILING", "MANUAL_REVIEW", "READY", "APPROVAL_SUBMITTING", "APPROVAL_SUBMITTED", "REDEEM_SUBMITTING", "REDEEM_SUBMITTED"]) assert.match(trading, new RegExp(value));
  assert.doesNotMatch(trading, /value="COMPLETED"/);
  assert.doesNotMatch(trading, /value="ACCEPTED"/);
  assert.doesNotMatch(trading, /value="PARTIAL"/);
  assert.match(resource, /查看详情/);
  assert.match(resource, /v2-action-cell/);
  assert.match(resource, /useSearchParams/);
  assert.match(resource, /searchParams\.get\("q"\)/);
  assert.match(trading, /BindingTable/);
  assert.match(trading, /CycleEvidence/);
  assert.match(trading, /OrderTraceEvidence/);
  assert.match(trading, /confirmed_at/);
  assert.match(trading, /applied_at/);
  assert.match(live, /SnapshotStatusBadge/);
  assert.doesNotMatch(live, /activeSnapshot\.engine\.health/);
});

test("V2 BFF is GET-only, allowlisted, authenticated server-side and bounded to the V2 upstream path", async () => {
  await withEnv({ PREDICTION_INFRA_BASE_URL: "http://infra.test", CONSOLE_API_TOKEN: "infra-secret", TRADING_EXECUTION_BASE_URL: "http://trading.test", TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN: "trading-secret" }, async () => {
    const previousFetch = globalThis.fetch;
    const calls: Array<{ url: string; method?: string; authorization: string | null }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), method: init?.method, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ data: { items: [], limit: 20, offset: 0, has_more: false, observed_at: "2026-10-16T00:00:00Z" } }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "v2-1", "set-cookie": "secret=never" } });
    }) as typeof fetch;
    try {
      const response = await GET(new Request("http://console.test/api/console/v2/infra/running-markets?q=macro"), { params: Promise.resolve({ path: ["infra", "running-markets"] }) });
      assert.equal(response.status, 200);
      assert.equal(calls[0].url, "http://infra.test/api/v1/console/v2/running-markets?q=macro");
      assert.equal(calls[0].method, "GET");
      assert.equal(calls[0].authorization, "Bearer infra-secret");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");

      const post = await POST();
      assert.equal(post.status, 405);
      assert.equal(post.headers.get("allow"), "GET");
      const unknown = await GET(new Request("http://console.test/api/console/v2/infra/unknown"), { params: Promise.resolve({ path: ["infra", "unknown"] }) });
      assert.equal(unknown.status, 404);
      const colonCycle = await GET(new Request("http://console.test/api/console/v2/trading/decision-cycles/main:20260818T042000Z"), { params: Promise.resolve({ path: ["trading", "decision-cycles", "main:20260818T042000Z"] }) });
      assert.equal(colonCycle.status, 200);
      assert.equal(calls[1].url, "http://trading.test/api/v1/console/v2/decision-cycles/main%3A20260818T042000Z");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("V2 BFF returns a stable configuration error without making an upstream request", async () => {
  await withEnv({}, async () => {
    const response = await GET(new Request("http://console.test/api/console/v2/trading/runtime"), { params: Promise.resolve({ path: ["trading", "runtime"] }) });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "BACKEND_NOT_CONFIGURED");
  });
});

test("Outbox V2 projection keeps the legacy read model bounded and preserves status/attempt fields", async () => {
  await withEnv({ PREDICTION_INFRA_BASE_URL: "http://infra.test", CONSOLE_API_TOKEN: "infra-secret" }, async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [{ outbox_event_id: 4, aggregate_type: "prediction", aggregate_id: "p-1", event_type: "READY", attempt_count: 3, created_at: "2026-10-16T00:00:00Z", last_attempt_at: null, published_at: null, has_last_error: true, delivery_status: "FAILED" }], total: 1, limit: 20, offset: 0 } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const response = await GET(new Request("http://console.test/api/console/v2/infra/outbox-events?status=FAILED"), { params: Promise.resolve({ path: ["infra", "outbox-events"] }) });
      const payload = await response.json();
      assert.equal(payload.data.items[0].attempt_count, 3);
      assert.equal(payload.data.items[0].delivery_status, "FAILED");
      assert.equal(payload.data.has_more, false);
      assert.equal(payload.data.summary.basis, "legacy_outbox_projection");
      assert.match(payload.data.observed_at, /^20/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
