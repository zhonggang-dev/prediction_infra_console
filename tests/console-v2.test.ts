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
    return new Response(JSON.stringify({ data: { items: [{ generation_id: 8, running_market_id: 17, source_selection_run_id: 4, source_selected_market_id: 99, market_id: "pm-1", condition_id: "condition-1", question: "Question", matched_domains: ["macro"], volume_24h: null, domain_rank: null, prediction_enabled: false, market_observed_at: "2026-10-16T00:00:00Z", end_at: null }], total: 21, limit: 20, offset: 0, has_more: true, observed_at: "2026-10-16T00:01:00Z", summary: { basis: "published_generation" } } }));
  }) as typeof fetch;
  try {
    const result = await consoleV2.infra.runningMarkets({ q: "Question", generation_id: 8 });
    assert.equal(result.data.items[0].generationId, "8");
    assert.equal(result.data.items[0].predictionEnabled, false);
    assert.equal(result.data.items[0].volume24h, null);
    assert.equal(result.data.hasMore, true);
    assert.equal(result.data.total, 21);
    assert.equal(result.data.summary?.basis, "published_generation");
    assert.match(calls[0], /\/api\/console\/v2\/infra\/running-markets\?/);
    assert.match(calls[0], /q=Question/);
    assert.match(calls[0], /generation_id=8/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("prediction model catalogue exposes historical Sandbox models separately from current coverage", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ data: { items: [{ model_id: "v4.1 flash", task_count: 10, result_count: 8, direct_result_count: 0, sandbox_result_count: 8, latest_prediction_as_of: "2026-10-21T16:10:13Z", latest_received_at: "2026-10-21T17:44:52Z" }], total: 1, limit: 100, offset: 0, has_more: false, observed_at: "2026-10-23T00:00:00Z" } }));
  }) as typeof fetch;
  try {
    const result = await consoleV2.infra.predictionModels({ limit: 100 });
    assert.equal(result.data.items[0].modelId, "v4.1 flash");
    assert.equal(result.data.items[0].sandboxResultCount, 8);
    assert.match(calls[0], /prediction-models/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("prediction batches preserve source counts, original as-of precision and watermarks", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [{ model_id: "v4.1 flash", market_source: "POLYMARKET", prediction_as_of: "2026-10-22T01:10:13.833397Z", result_count: 297, sandbox_count: 297, direct_result_count: 0, sandbox_result_count: 297, unknown_result_count: 0, max_result_id: 42, source_kinds: ["SANDBOX"], generation_ids: [324], latest_received_at: "2026-10-22T03:09:57.287707Z" }], total: 1, limit: 20, offset: 0, has_more: false, observed_at: "2026-10-23T00:00:00Z" } }))) as typeof fetch;
  try {
    const result = await consoleV2.infra.predictionBatches({ model: "v4.1 flash", source: "POLYMARKET" });
    assert.equal(result.data.items[0].predictionAsOf, "2026-10-22T01:10:13.833397Z");
    assert.equal(result.data.items[0].maxResultId, "42");
    assert.deepEqual(result.data.items[0].generationIds, ["324"]);
  } finally { globalThis.fetch = previousFetch; }
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

test("V2 decoder rejects a list without an exact total", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [], limit: 20, offset: 0, has_more: false, observed_at: "2026-10-16T00:00:00Z" } }))) as typeof fetch;
  try {
    await assert.rejects(() => consoleV2.infra.runningMarkets(), (error: unknown) => error instanceof ConsoleV2ContractError && /total/.test(error.message));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("V2 decoder rejects coerced total values instead of treating them as zero", async () => {
  const previousFetch = globalThis.fetch;
  try {
    for (const total of [null, false, "", "0"]) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [], total, limit: 20, offset: 0, has_more: false, observed_at: "2026-10-16T00:00:00Z" } }))) as typeof fetch;
      await assert.rejects(() => consoleV2.infra.runningMarkets(), (error: unknown) => error instanceof ConsoleV2ContractError && /total/.test(error.message), `total=${String(total)}`);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Prediction source kind requires sandbox_id proof or a complete Direct identity", async () => {
  const previousFetch = globalThis.fetch;
  const base = { prediction_id: "p-1", source_job_id: "job-1", selected_market_id: "sm-1", market_id: "m-1", condition_id: "c-1", question: "Q", model_name: "model-1", market_source: "POLYMARKET", execution_mode: "LIVE", prediction_as_of: "2026-10-16T00:00:00Z" };
  try {
    const cases = [
      [{ ...base, sandbox_id: "sandbox-1", origin: "DIRECT" }, "SANDBOX"],
      [{ ...base, sandbox_id: null, origin: "SANDBOX" }, "DIRECT"],
      [{ ...base, sandbox_id: null, selected_market_id: null, origin: "DIRECT" }, "UNKNOWN"],
      [{ ...base, origin: "SANDBOX" }, "UNKNOWN"],
    ] as const;
    for (const [item, expected] of cases) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [item], total: 1, limit: 20, offset: 0, has_more: false, observed_at: "2026-10-16T00:01:00Z" } }))) as typeof fetch;
      const result = await consoleV2.infra.predictions();
      assert.equal(result.data.items[0].sourceKind, expected);
    }
  } finally { globalThis.fetch = previousFetch; }
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

test("Trading runtime preserves the three independent disable arrays", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: {
    observed_at: "2026-10-16T00:00:00Z",
    runner: { enabled: true, running: true, state: "running" },
    bindings: [],
    submission: {
      order_submission_enabled: false,
      entry_submission_disabled: true,
      submission_disabled_accounts: ["wallet-1"],
      entry_disabled_accounts: ["wallet-6"],
      strategy_disabled_accounts: ["wallet-7"],
      kalshi_strategy_input_enabled: null,
    },
    account_data_state: "unavailable",
    accounts: [],
  } }))) as typeof fetch;
  try {
    const result = await consoleV2.trading.runtime();
    assert.equal(result.data.submission.orderSubmissionEnabled, false);
    assert.equal(result.data.submission.entrySubmissionDisabled, true);
    assert.deepEqual(result.data.submission.submissionDisabledAccounts, ["wallet-1"]);
    assert.deepEqual(result.data.submission.entryDisabledAccounts, ["wallet-6"]);
    assert.deepEqual(result.data.submission.strategyDisabledAccounts, ["wallet-7"]);
  } finally { globalThis.fetch = previousFetch; }
});

test("Trading filters and V2 detail rows expose only backend status values and keyboard actions", async () => {
  const trading = await readFile(new URL("../app/components/trading-v2-page.tsx", import.meta.url), "utf8");
  const resource = await readFile(new URL("../app/components/console-v2-resource.tsx", import.meta.url), "utf8");
  const live = await readFile(new URL("../app/components/live-trading-page.tsx", import.meta.url), "utf8");
  for (const value of ["RECEIVED", "VALIDATING", "RESERVED", "SUBMITTING", "ACKNOWLEDGED", "LIVE", "PARTIALLY_FILLED", "FILLED", "REJECTED", "UNKNOWN", "CANCEL_PENDING", "CANCELLED", "RECONCILING", "MANUAL_REVIEW", "READY", "APPROVAL_SUBMITTING", "APPROVAL_SUBMITTED", "REDEEM_SUBMITTING", "REDEEM_SUBMITTED"]) assert.match(trading, new RegExp(value));
  assert.doesNotMatch(trading, /value="COMPLETED"/);
  assert.doesNotMatch(trading, /value="ACCEPTED"/);
  assert.doesNotMatch(trading, /value="PARTIAL"/);
  assert.match(resource, /查看详情/);
  assert.match(resource, /v2-action-cell/);
  assert.match(resource, /useSearchParams/);
  assert.match(resource, /searchParams\.get\("q"\)/);
  assert.doesNotMatch(trading, /BindingTable/);
  assert.match(trading, /成交凭证/);
  assert.match(trading, /confirmed_at/);
  assert.match(trading, /applied_at/);
  assert.match(live, /SnapshotStatusBadge/);
  assert.doesNotMatch(live, /activeSnapshot\.engine\.health/);
});

test("业务工作区复用真实资料轮换与交易视图，不回退到 ready 成员猜版本", async () => {
  const assets = await readFile(new URL("../app/components/assets-v2-page.tsx", import.meta.url), "utf8");
  const trading = await readFile(new URL("../app/components/trading-v2-page.tsx", import.meta.url), "utf8");
  const ledger = await readFile(new URL("../app/components/trade-records-page.tsx", import.meta.url), "utf8");
  const resource = await readFile(new URL("../app/components/console-v2-resource.tsx", import.meta.url), "utf8");
  const markets = await readFile(new URL("../app/components/markets-v2-page.tsx", import.meta.url), "utf8");
  const predictions = await readFile(new URL("../app/components/predictions-v2-page.tsx", import.meta.url), "utf8");
  const overview = await readFile(new URL("../app/components/overview-v2-page.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/lib/console-api.ts", import.meta.url), "utf8");
  assert.match(assets, /consoleApi\.datasetRotation\(\)/);
  assert.match(assets, /currentVersions/);
  assert.match(assets, /trainingSets/);
  assert.match(assets, /<DatasetRotationPage embedded/);
  assert.doesNotMatch(assets, /datasetMembers\(\{ limit: 1, status: "ready" \}\)/);
  assert.match(overview, /consoleApi\.datasetRotation/);
  assert.doesNotMatch(overview, /datasetMembers\(\{ limit: 1 \}\)/);
  assert.doesNotMatch(trading, /<LiveTradingPage/);
  assert.match(trading, /<TradeRecordsPage embedded sharedAccountOnly compact \/>/);
  assert.match(trading, /consoleV2\.trading\.holdings/);
  assert.match(trading, /OfficialWalletPnlPanel/);
  assert.match(trading, /\/trading\/ledger/);
  assert.match(trading, /aliases: \["\/trading"\]/);
  assert.match(trading, /23:59:59\.999999Z/);
  assert.match(trading, /sharedQueryKeys: \["execution_account_id"\]/);
  assert.doesNotMatch(trading, /<TradingOverview/);
  assert.match(ledger, /params\.get\("from"\)/);
  assert.match(ledger, /params\.get\("to"\)/);
  assert.match(ledger, /date\.setUTCDate\(date\.getUTCDate\(\) \+ 1\)/);
  assert.match(ledger, /WORKSPACE_FILTER_CHANGE_EVENT/);
  assert.match(resource, /WORKSPACE_FILTER_CHANGE_EVENT/);
  assert.match(resource, /parentPanel\?\.active/);
  assert.match(resource, /while \(ancestor\)/);
  assert.doesNotMatch(resource, /closest<HTMLElement>\("\[role=\\"tabpanel\\"\]"\)/);
  assert.match(trading, /WORKSPACE_FILTER_CHANGE_EVENT/);
  assert.match(trading, /reconciliation_view: "issues"/);
  assert.match(trading, /delete next\.reconciliation_view/);
  assert.match(trading, /next\.status === "ALL"/);
  assert.match(trading, /apiParams\(params\)/);
  assert.match(trading, /loadIssues/);
  assert.match(trading, /loadRuns/);
  assert.doesNotMatch(trading, /load=\{\(requestParams\) => consoleV2\.trading\.reconciliation/);
  assert.match(markets, /href: "\/markets\/running", label: "运行市场", aliases: \["\/markets"\]/);
  assert.doesNotMatch(markets, /href: "\/markets\/selection", label: "选盘批次与历史", aliases/);
  assert.match(markets, /本批次预测资格/);
  assert.match(markets, /本批次启用/);
  assert.match(markets, /预计结束时间不等同于结算/);
  assert.match(markets, /实时有效性另查/);
  assert.match(predictions, /activePredictionAsOf/);
  assert.match(predictions, /item\.sourceKind/);
  assert.doesNotMatch(predictions, /sandboxId \? "SANDBOX" : "DIRECT"/);
  assert.match(api, /ledger-activities[^\n]*[\s\S]*?total: exactListTotal\(result\.data\.total, "ledger-activities"\)/);
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
      const holdingLots = await GET(new Request("http://console.test/api/console/v2/trading/holdings/lots?limit=5&offset=5"), { params: Promise.resolve({ path: ["trading", "holdings", "lots"] }) });
      assert.equal(holdingLots.status, 200);
      assert.equal(calls[2].url, "http://trading.test/api/v1/console/v2/holdings/lots?limit=5&offset=5");
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
      assert.equal(payload.data.total, 1);
      assert.equal(payload.data.summary.basis, "legacy_outbox_projection");
      assert.match(payload.data.observed_at, /^20/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("Outbox V2 projection rejects a legacy response without exact total", async () => {
  await withEnv({ PREDICTION_INFRA_BASE_URL: "http://infra.test", CONSOLE_API_TOKEN: "infra-secret" }, async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [], limit: 20, offset: 0 } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const response = await GET(new Request("http://console.test/api/console/v2/infra/outbox-events"), { params: Promise.resolve({ path: ["infra", "outbox-events"] }) });
      assert.equal(response.status, 502);
      assert.equal((await response.json()).code, "TOTAL_UNAVAILABLE");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("Outbox V2 projection rejects null, boolean and empty-string totals", async () => {
  await withEnv({ PREDICTION_INFRA_BASE_URL: "http://infra.test", CONSOLE_API_TOKEN: "infra-secret" }, async () => {
    const previousFetch = globalThis.fetch;
    try {
      for (const total of [null, false, "", "1"]) {
        globalThis.fetch = (async () => new Response(JSON.stringify({ data: { items: [], total, limit: 20, offset: 0 } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
        const response = await GET(new Request("http://console.test/api/console/v2/infra/outbox-events"), { params: Promise.resolve({ path: ["infra", "outbox-events"] }) });
        assert.equal(response.status, 502, `total=${String(total)}`);
        assert.equal((await response.json()).code, "TOTAL_UNAVAILABLE");
      }
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
