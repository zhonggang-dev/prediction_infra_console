import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../app/api/console/downloads/[...path]/route.ts";

const envNames = ["PREDICTION_INFRA_BASE_URL", "SANDBOX_DOWNLOAD_TOKEN"];

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

function params(path: string[]) { return { params: Promise.resolve({ path }) }; }

test("单个 Sandbox GET 使用服务端 token 并保持归档流式响应", async () => {
  await withEnv({ PREDICTION_INFRA_BASE_URL: "http://infra.test", SANDBOX_DOWNLOAD_TOKEN: "download-secret" }, async () => {
    const previousFetch = globalThis.fetch;
    const calls: Array<{ url: string; method?: string; authorization: string | null }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), method: init?.method, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/x-tar", "content-disposition": 'attachment; filename="pm-001.tar"', "set-cookie": "secret=never", "x-request-id": "download-1" } });
    }) as typeof fetch;
    try {
      const response = await GET(new Request("http://console.test/api/console/downloads/sandboxes/pm-001/archive?variant=masked"), params(["sandboxes", "pm-001", "archive"]));
      assert.equal(response.status, 200);
      assert.equal(await response.arrayBuffer().then((value) => value.byteLength), 3);
      assert.equal(calls[0].url, "http://infra.test/api/v1/sandboxes/pm-001/archive?variant=masked");
      assert.equal(calls[0].method, "GET");
      assert.equal(calls[0].authorization, "Bearer download-secret");
      assert.equal(response.headers.get("content-disposition"), 'attachment; filename="pm-001.tar"');
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    } finally { globalThis.fetch = previousFetch; }
  });
});

test("批量和范围表单只转换受限字段，并将 JSON 流式转发", async () => {
  await withEnv({ PREDICTION_INFRA_BASE_URL: "http://infra.test", SANDBOX_DOWNLOAD_TOKEN: "download-secret" }, async () => {
    const previousFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response("tar-stream", { status: 200, headers: { "content-type": "application/x-tar" } });
    }) as typeof fetch;
    try {
      const batch = await POST(new Request("http://console.test/api/console/downloads/sandboxes/archives:batch", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "sandbox_ids=pm-001%0Apm-002&variant=masked" }), params(["sandboxes", "archives:batch"]));
      assert.equal(batch.status, 200);
      assert.equal(calls[0].url, "http://infra.test/api/v1/sandboxes/archives:batch?variant=masked");
      assert.deepEqual(JSON.parse(calls[0].body), ["pm-001", "pm-002"]);

      const range = await POST(new Request("http://console.test/api/console/downloads/sandboxes/archives:range", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ frozen_at_start: "2026-09-01T00:00:00Z", frozen_at_end: "2026-09-02T00:00:00Z", variant: "original", market_source: "KALSHI" }) }), params(["sandboxes", "archives:range"]));
      assert.equal(range.status, 200);
      assert.equal(calls[1].url, "http://infra.test/api/v1/sandboxes/archives:range?variant=original&market_source=KALSHI");
      assert.deepEqual(JSON.parse(calls[1].body), { frozen_at_start: "2026-09-01T00:00:00Z", frozen_at_end: "2026-09-02T00:00:00Z" });
    } finally { globalThis.fetch = previousFetch; }
  });
});

test("固定版本 test/train 路径保留 variant 和 UTC T0 独占上界", async () => {
  await withEnv({ PREDICTION_INFRA_BASE_URL: "http://infra.test", SANDBOX_DOWNLOAD_TOKEN: "download-secret" }, async () => {
    const previousFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input) => { urls.push(String(input)); return new Response("tar", { status: 200 }); }) as typeof fetch;
    try {
      await GET(new Request("http://console.test/api/console/downloads/testsets/20260908-20261008?variant=ms"), params(["testsets", "20260908-20261008"]));
      await GET(new Request("http://console.test/api/console/downloads/trainsets?variant=syn&start_time=2026-09-01T00%3A00%3A00%2B08%3A00&end_time=2026-10-01T00%3A00%3A00%2B08%3A00"), params(["trainsets"]));
      assert.equal(urls[0], "http://infra.test/api/v1/testsets/20260908-20261008?variant=ms");
      assert.equal(urls[1], "http://infra.test/api/v1/trainsets?variant=syn&start_time=2026-09-01T00%3A00%3A00%2B08%3A00&end_time=2026-10-01T00%3A00%3A00%2B08%3A00");
    } finally { globalThis.fetch = previousFetch; }
  });
});

test("下载 BFF 拒绝无效输入、QA masked 和未配置连接，并保留真实上游错误", async () => {
  await withEnv({}, async () => {
    const response = await GET(new Request("http://console.test/api/console/downloads/sandboxes/pm-001/archive"), params(["sandboxes", "pm-001", "archive"]));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "BACKEND_NOT_CONFIGURED");
  });
  await withEnv({ PREDICTION_INFRA_BASE_URL: "http://infra.test", SANDBOX_DOWNLOAD_TOKEN: "download-secret" }, async () => {
    const previousFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response(JSON.stringify({ code: "SANDBOX_NOT_FOUND", message: "missing" }), { status: 404, headers: { "content-type": "application/json" } }); }) as typeof fetch;
    try {
      const qa = await GET(new Request("http://console.test/api/console/downloads/sandboxes/qa-1/archive?variant=masked&asset_kind=GENERATED_QA"), params(["sandboxes", "qa-1", "archive"]));
      assert.equal(qa.status, 400);
      assert.equal(called, false);
      const invalid = await GET(new Request("http://console.test/api/console/downloads/sandboxes/../archive"), params(["sandboxes", "../", "archive"]));
      assert.equal(invalid.status, 400);
      const dot = await GET(new Request("http://console.test/api/console/downloads/sandboxes/./archive"), params(["sandboxes", ".", "archive"]));
      assert.equal(dot.status, 400);
      const upstream = await GET(new Request("http://console.test/api/console/downloads/sandboxes/pm-404/archive"), params(["sandboxes", "pm-404", "archive"]));
      assert.equal(upstream.status, 404);
      assert.deepEqual(await upstream.json(), { code: "SANDBOX_NOT_FOUND", message: "missing" });
    } finally { globalThis.fetch = previousFetch; }
  });
});
