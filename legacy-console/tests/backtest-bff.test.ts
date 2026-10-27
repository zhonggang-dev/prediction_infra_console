import assert from "node:assert/strict";
import test from "node:test";
import { DELETE, GET, PATCH, POST, PUT } from "../app/api/console/backtest/[...path]/route.ts";
import { UPLOAD_LIMIT_BYTES, WRITE_MARKER_HEADER, WRITE_MARKER_VALUE } from "../app/lib/backtest-platform.ts";

const envNames = ["PREDICTION_INFRA_BASE_URL", "BACKTEST_PLATFORM_CONSOLE_TOKEN", "BACKTEST_PLATFORM_OPERATOR"];
const params = (path: string[]) => ({ params: Promise.resolve({ path }) });
const BASE = "http://console.test/api/console/backtest";
/** 页面发起写操作时带的标记头 */
const W = { [WRITE_MARKER_HEADER]: WRITE_MARKER_VALUE };

async function withUpstream(values: Record<string, string | undefined>, upstream: typeof fetch | undefined, run: (calls: Array<{ url: string; init?: RequestInit & { duplex?: string } }>) => Promise<void>) {
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  for (const name of envNames) { if (values[name] === undefined) delete process.env[name]; else process.env[name] = values[name]; }
  const calls: Array<{ url: string; init?: RequestInit & { duplex?: string } }> = [];
  if (upstream) globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return upstream(input, init); }) as typeof fetch;
  try { await run(calls); } finally {
    globalThis.fetch = previousFetch;
    for (const name of envNames) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  }
}
const configured = { PREDICTION_INFRA_BASE_URL: "http://infra.test", BACKTEST_PLATFORM_CONSOLE_TOKEN: "console-secret-token-000000000000" };
const ok = () => Response.json({ data: { ok: true } }, { headers: { "set-cookie": "leak=1", "x-request-id": "r1", "x-internal": "no" } });

test("未配置返回 503，上游不可达返回 502，且不暴露令牌", async () => {
  await withUpstream({}, undefined, async () => {
    const response = await GET(new Request(`${BASE}/catalog?kind=model`), params(["catalog"]));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "BACKEND_NOT_CONFIGURED");
  });
  await withUpstream({ PREDICTION_INFRA_BASE_URL: "http://infra.test" }, undefined, async () => {
    assert.equal((await GET(new Request(`${BASE}/catalog?kind=model`), params(["catalog"]))).status, 503, "缺令牌同样视为未配置");
  });
  await withUpstream(configured, async () => { throw new TypeError("connect ECONNREFUSED"); }, async () => {
    const response = await GET(new Request(`${BASE}/runs`), params(["runs"]));
    assert.equal(response.status, 502);
    const body = JSON.stringify(await response.json());
    assert.ok(!body.includes("console-secret") && !body.includes("ECONNREFUSED"));
  });
});

test("GET 目录：只放行白名单查询，令牌与操作人头由服务端附加，响应头白名单", async () => {
  await withUpstream({ ...configured, BACKTEST_PLATFORM_OPERATOR: "zhangyan" }, async () => ok(), async (calls) => {
    const response = await GET(new Request(`${BASE}/catalog?kind=model&dataset=telonex&tag=sandbox&q=ps&limit=100&offset=0`, { headers: { authorization: "Bearer attacker", cookie: "s=1" } }), params(["catalog"]));
    assert.equal(response.status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/backtest/catalog?kind=model&dataset=telonex&tag=sandbox&q=ps&limit=100&offset=0");
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get("authorization"), "Bearer console-secret-token-000000000000");
    assert.equal(headers.get("x-backtest-operator"), "zhangyan");
    assert.equal(headers.get("cookie"), null);
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-internal"), null);
    assert.equal(response.headers.get("x-request-id"), "r1");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  await withUpstream(configured, async () => ok(), async (calls) => {
    assert.equal((await GET(new Request(`${BASE}/catalog?kind=model&evil=1`), params(["catalog"]))).status, 400);
    assert.equal((await GET(new Request(`${BASE}/catalog?kind=a&kind=b`), params(["catalog"]))).status, 400);
    assert.equal((await GET(new Request(`${BASE}/runs?board=trading&status=failed&batch_id=btb-1`), params(["runs"]))).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(new Headers(calls[0].init?.headers).get("x-backtest-operator"), "console", "默认操作人");
  });
});

test("运行与提交详情：ID 白名单，路径穿越被拒", async () => {
  await withUpstream(configured, async () => ok(), async (calls) => {
    assert.equal((await GET(new Request(`${BASE}/runs/btr-20261019-k3m9q2xa`), params(["runs", "btr-20261019-k3m9q2xa"]))).status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/backtest/runs/btr-20261019-k3m9q2xa");
    assert.equal((await GET(new Request(`${BASE}/submissions/bts-1`), params(["submissions", "bts-1"]))).status, 200);
    for (const bad of ["..", ".", "a/b", "a b", "", "x".repeat(200), "../etc"]) {
      assert.equal((await GET(new Request(`${BASE}/runs/x`), params(["runs", bad]))).status, 400, `拒绝 ${JSON.stringify(bad)}`);
    }
    assert.equal((await GET(new Request(`${BASE}/unknown`), params(["unknown"]))).status, 404);
    assert.equal((await GET(new Request(`${BASE}/runs/a/b/c/d`), params(["runs", "a", "b", "c", "d"]))).status, 404);
    assert.equal(calls.length, 2);
  });
});

test("产物下载：流式透传、不设超时、path 校验", async () => {
  await withUpstream(configured, async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "application/x-tar", "content-disposition": 'attachment; filename="artifacts.tar"', "content-length": "4", "set-cookie": "x=1" } }), async (calls) => {
    const response = await GET(new Request(`${BASE}/runs/btr-1/artifacts`), params(["runs", "btr-1", "artifacts"]));
    assert.equal(response.status, 200);
    assert.equal(new Uint8Array(await response.arrayBuffer()).byteLength, 4);
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="artifacts.tar"');
    assert.equal(response.headers.get("content-length"), "4");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(calls[0].url, "http://infra.test/api/v1/backtest/runs/btr-1/artifacts");
    const upstreamSignal = calls[0].init?.signal as AbortSignal;
    assert.ok(upstreamSignal instanceof AbortSignal, "浏览器取消时断开上游");

    const image = await GET(new Request(`${BASE}/runs/btr-1/artifacts?path=report/rev_momentum_3h/quantiles_compact_v2.png`), params(["runs", "btr-1", "artifacts"]));
    assert.equal(image.status, 200);
    assert.equal(calls[1].url, "http://infra.test/api/v1/backtest/runs/btr-1/artifacts?path=report%2Frev_momentum_3h%2Fquantiles_compact_v2.png");
    for (const bad of ["../secret", "/etc/passwd", "a/../b", "a//b/../../c", "a\\b", "a?b#c"]) {
      assert.equal((await GET(new Request(`${BASE}/runs/btr-1/artifacts?path=${encodeURIComponent(bad)}`), params(["runs", "btr-1", "artifacts"]))).status, 400, `拒绝 ${bad}`);
    }
    assert.equal((await GET(new Request(`${BASE}/runs/btr-1/artifacts?path=a&x=1`), params(["runs", "btr-1", "artifacts"]))).status, 400);
  });
  // 压缩响应不转发过期的 content-length
  await withUpstream(configured, async () => new Response("{}", { headers: { "content-encoding": "gzip", "content-length": "999", "content-type": "application/json" } }), async () => {
    const response = await GET(new Request(`${BASE}/runs/btr-1`), params(["runs", "btr-1"]));
    assert.equal(response.headers.get("content-length"), null);
  });
});

test("POST 发起运行：JSON 体上限、Content-Type、幂等键透传", async () => {
  await withUpstream(configured, async () => Response.json({ data: { runs: [] } }, { status: 201 }), async (calls) => {
    const body = JSON.stringify({ runs: [{ board: "benchmark", item: "overview" }], force: false });
    const response = await POST(new Request(`${BASE}/runs`, { method: "POST", headers: { ...W, "content-type": "application/json", "idempotency-key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" }, body }), params(["runs"]));
    assert.equal(response.status, 201);
    assert.equal(calls[0].url, "http://infra.test/api/v1/backtest/runs");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.body, body);
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get("idempotency-key"), "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
    assert.equal(headers.get("content-type"), "application/json");

    await POST(new Request(`${BASE}/runs`, { method: "POST", headers: { ...W, "content-type": "application/json", "idempotency-key": "bad key\n" }, body }), params(["runs"]));
    assert.equal(new Headers(calls[1].init?.headers).get("idempotency-key"), null, "非法幂等键不转发");

    assert.equal((await POST(new Request(`${BASE}/runs`, { method: "POST", headers: { ...W, "content-type": "text/plain" }, body }), params(["runs"]))).status, 415);
    assert.equal((await POST(new Request(`${BASE}/runs`, { method: "POST", headers: { ...W, "content-type": "application/json" }, body: "{oops" }), params(["runs"]))).status, 400);
    assert.equal((await POST(new Request(`${BASE}/runs`, { method: "POST", headers: { ...W, "content-type": "application/json" }, body: "[1]" }), params(["runs"]))).status, 400);
    const huge = JSON.stringify({ runs: [{ pad: "x".repeat(1024 * 1024 + 10) }] });
    assert.equal((await POST(new Request(`${BASE}/runs`, { method: "POST", headers: { ...W, "content-type": "application/json" }, body: huge }), params(["runs"]))).status, 413);
    assert.equal(calls.length, 2, "被拒绝的请求不会到达上游");
  });
});

test("停止运行、因子池移入移出", async () => {
  await withUpstream(configured, async () => ok(), async (calls) => {
    assert.equal((await POST(new Request(`${BASE}/runs/btr-1/cancel`, { method: "POST", headers: W }), params(["runs", "btr-1", "cancel"]))).status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/backtest/runs/btr-1/cancel");
    assert.equal(calls[0].init?.method, "POST");
    const pool = await PUT(new Request(`${BASE}/factors/rev_momentum_3h/pool`, { method: "PUT", headers: { ...W, "content-type": "application/json" }, body: JSON.stringify({ version: "legacy/pool-v1", state: "experiment" }) }), params(["factors", "rev_momentum_3h", "pool"]));
    assert.equal(pool.status, 200);
    assert.equal(calls[1].url, "http://infra.test/api/v1/backtest/factors/rev_momentum_3h/pool");
    assert.equal(calls[1].init?.method, "PUT");
    assert.equal((await PUT(new Request(`${BASE}/runs/x`, { method: "PUT", headers: { ...W, "content-type": "application/json" }, body: "{}" }), params(["runs", "x"]))).status, 404);
  });
});

test("其它方法 405：PATCH / DELETE", async () => {
  for (const handler of [PATCH, DELETE]) {
    const response = await handler();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, POST, PUT");
  }
});

function streamOf(size: number, chunk = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({ pull(controller) { const n = Math.min(chunk, size - sent); if (n <= 0) { controller.close(); return; } controller.enqueue(new Uint8Array(n).fill(7)); sent += n; } });
}
const upload = (path: string, headers: Record<string, string>, body?: BodyInit | null) => new Request(`${BASE}/upload/${path}`, { method: "POST", headers: { ...W, ...headers }, body, duplex: "half" } as RequestInit);

test("上传：流式转发请求体，原样携带长度与类型，令牌只在服务端", async () => {
  let received = 0;
  await withUpstream(configured, async (_input, init) => {
    const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; received += value.byteLength; }
    return Response.json({ data: { id: "bts-1", kind: "prediction", status: "validating" } }, { status: 201 });
  }, async (calls) => {
    const size = 3 * 1024 * 1024 + 17;
    const response = await POST(upload("predictions/team_03/v2/p3", { "content-type": "application/vnd.apache.parquet", "content-length": String(size) }, streamOf(size)), params(["upload", "predictions", "team_03", "v2", "p3"]));
    assert.equal(response.status, 201);
    assert.equal(received, size);
    assert.equal(calls[0].url, "http://infra.test/api/v1/backtest/predictions/team_03/versions/v2/p3");
    assert.equal(calls[0].init?.duplex, "half");
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get("content-length"), String(size));
    assert.equal(headers.get("content-type"), "application/vnd.apache.parquet");
    assert.equal(headers.get("authorization"), "Bearer console-secret-token-000000000000");
    assert.ok(!(await response.clone().text()).includes("console-secret"));
  });
  await withUpstream(configured, async (_input, init) => { await new Response(init?.body).arrayBuffer(); return ok(); }, async (calls) => {
    assert.equal((await POST(upload("factor-tables/research_0919/20260919-a", { "content-type": "application/vnd.apache.parquet", "content-length": "4" }, new Uint8Array([1, 2, 3, 4])), params(["upload", "factor-tables", "research_0919", "20260919-a"]))).status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/backtest/factor-tables/research_0919/versions/20260919-a");
    assert.equal((await POST(upload("strategies/my_strat/v1", { "content-type": "application/x-tar", "content-length": "4" }, new Uint8Array([1, 2, 3, 4])), params(["upload", "strategies", "my_strat", "v1"]))).status, 200);
    assert.equal(calls[1].url, "http://infra.test/api/v1/backtest/strategies/my_strat/versions/v1");
  });
});

test("上传：超限 413（不读取内容）、缺长度 411、类型 415、路径与标识非法 400/404", async () => {
  await withUpstream(configured, async () => ok(), async (calls) => {
    const over = await POST(upload("predictions/a/b/c", { "content-type": "application/vnd.apache.parquet", "content-length": String(UPLOAD_LIMIT_BYTES + 1) }, new Uint8Array([1])), params(["upload", "predictions", "a", "b", "c"]));
    assert.equal(over.status, 413);
    assert.equal((await over.json()).code, "UPLOAD_TOO_LARGE");
    const noLength = await POST(upload("predictions/a/b/c", { "content-type": "application/vnd.apache.parquet" }, streamOf(10)), params(["upload", "predictions", "a", "b", "c"]));
    assert.equal(noLength.status, 411);
    assert.equal((await POST(upload("predictions/a/b/c", { "content-type": "text/csv", "content-length": "1" }, new Uint8Array([1])), params(["upload", "predictions", "a", "b", "c"]))).status, 415);
    assert.equal((await POST(upload("strategies/a/b", { "content-type": "application/vnd.apache.parquet", "content-length": "1" }, new Uint8Array([1])), params(["upload", "strategies", "a", "b"]))).status, 415, "策略只收 tar / gzip");
    assert.equal((await POST(upload("predictions/a/b", { "content-type": "application/vnd.apache.parquet", "content-length": "1" }, new Uint8Array([1])), params(["upload", "predictions", "a", "b"]))).status, 404, "预测需要三段标识");
    assert.equal((await POST(upload("movies/a/b", { "content-type": "application/gzip", "content-length": "1" }, new Uint8Array([1])), params(["upload", "movies", "a", "b"]))).status, 404);
    assert.equal((await POST(upload("predictions/../b/c", { "content-type": "application/vnd.apache.parquet", "content-length": "1" }, new Uint8Array([1])), params(["upload", "predictions", "..", "b", "c"]))).status, 400);
    assert.equal(calls.length, 0, "被拒绝的上传不会到达上游");
    // 恰好等于上限的声明长度通过预检（内容不足时在流里中断，而不是 413）
    const atLimit = await POST(upload("predictions/a/b/c", { "content-type": "application/vnd.apache.parquet", "content-length": String(UPLOAD_LIMIT_BYTES) }, streamOf(10)), params(["upload", "predictions", "a", "b", "c"]));
    assert.notEqual(atLimit.status, 413);
    assert.notEqual(atLimit.status, 411);
  });
});

test("上传：实际内容超过声明长度时中断，不会把超出的字节送到上游", async () => {
  let received = 0;
  await withUpstream(configured, async (_input, init) => {
    const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; received += value.byteLength; } } catch { return Response.json({ code: "ABORTED" }, { status: 502 }); }
    return ok();
  }, async () => {
    const response = await POST(upload("predictions/a/b/c", { "content-type": "application/vnd.apache.parquet", "content-length": "1000" }, streamOf(5000, 500)), params(["upload", "predictions", "a", "b", "c"]));
    assert.notEqual(response.status, 200);
    assert.ok(received <= 1000, `上游最多收到声明的 1000 字节，实际 ${received}`);
  });
});

test("写操作 CSRF 防护：缺标记头或跨站来源一律 403，且不会到达上游", async () => {
  await withUpstream(configured, async () => ok(), async (calls) => {
    const noHeader = await POST(new Request(`${BASE}/runs/btr-1/cancel`, { method: "POST" }), params(["runs", "btr-1", "cancel"]));
    assert.equal(noHeader.status, 403);
    assert.equal((await noHeader.json()).code, "CROSS_SITE_REQUEST_REJECTED");
    assert.equal((await POST(new Request(`${BASE}/runs/btr-1/cancel`, { method: "POST", headers: { ...W, "sec-fetch-site": "cross-site" } }), params(["runs", "btr-1", "cancel"]))).status, 403);
    assert.equal((await POST(new Request(`${BASE}/runs/btr-1/cancel`, { method: "POST", headers: { ...W, "sec-fetch-site": "same-site" } }), params(["runs", "btr-1", "cancel"]))).status, 403, "同站不同源也不放行");
    assert.equal((await PUT(new Request(`${BASE}/factors/f1/pool`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" }), params(["factors", "f1", "pool"]))).status, 403);
    assert.equal((await POST(new Request(`${BASE}/runs/btr-1/cancel`, { method: "POST", headers: { ...W, "sec-fetch-site": "same-origin" } }), params(["runs", "btr-1", "cancel"]))).status, 200);
    assert.equal(calls.length, 1);
    // 读请求不受影响
    assert.equal((await GET(new Request(`${BASE}/runs`, { headers: { "sec-fetch-site": "cross-site" } }), params(["runs"]))).status, 200);
  });
});

test("上游 401 / 403 是服务端凭据问题：转成 502，不把鉴权失败当成用户问题，也不泄漏令牌", async () => {
  for (const status of [401, 403]) {
    await withUpstream(configured, async () => Response.json({ code: "UNAUTHORIZED", message: "认证失败" }, { status, headers: { "www-authenticate": "Bearer" } }), async () => {
      const response = await GET(new Request(`${BASE}/runs`), params(["runs"]));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("www-authenticate"), null);
      const body = await response.json();
      assert.equal(body.code, "UPSTREAM_AUTH_FAILED");
      assert.ok(!JSON.stringify(body).includes("console-secret"));
    });
  }
  // 其它错误（400 逐项错误、409、429、503）原样透传，页面据此展示
  await withUpstream(configured, async () => Response.json({ code: "TOO_MANY_ACTIVE_RUNS", message: "未完成的运行已达上限" }, { status: 429, headers: { "retry-after": "30" } }), async () => {
    const response = await POST(new Request(`${BASE}/runs`, { method: "POST", headers: { ...W, "content-type": "application/json" }, body: "{}" }), params(["runs"]));
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, "TOO_MANY_ACTIVE_RUNS");
    assert.equal(response.headers.get("retry-after"), "30");
  });
});

test("目录查询放行 infra 的 status / pool_state 过滤，其它未知参数仍然拒绝", async () => {
  await withUpstream(configured, async () => ok(), async (calls) => {
    assert.equal((await GET(new Request(`${BASE}/catalog?kind=factor&status=all&pool_state=pool`), params(["catalog"]))).status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/backtest/catalog?kind=factor&status=all&pool_state=pool");
    assert.equal((await GET(new Request(`${BASE}/catalog?kind=factor&order=desc`), params(["catalog"]))).status, 400);
  });
});

test("请求体不信任 Content-Length：分块传输的超大 JSON 也在读取过程中被拒绝", async () => {
  await withUpstream(configured, async () => ok(), async (calls) => {
    const chunked = new Request(`${BASE}/runs`, { method: "POST", headers: { ...W, "content-type": "application/json" }, body: streamOf(2 * 1024 * 1024), duplex: "half" } as RequestInit);
    assert.equal((await POST(chunked, params(["runs"]))).status, 413);
    assert.equal(calls.length, 0);
  });
});

test("产物图片（?path=）内联展示，整包与非图片保持 attachment", async () => {
  const png = () => new Response(new Uint8Array([137, 80]), { headers: { "content-type": "image/png", "content-disposition": 'attachment; filename="a.png"' } });
  await withUpstream(configured, async () => png(), async () => {
    const image = await GET(new Request(`${BASE}/runs/btr-1/artifacts?path=report/a.png`), params(["runs", "btr-1", "artifacts"]));
    assert.equal(image.headers.get("content-disposition"), "inline");
    const whole = await GET(new Request(`${BASE}/runs/btr-1/artifacts`), params(["runs", "btr-1", "artifacts"]));
    assert.equal(whole.headers.get("content-disposition"), 'attachment; filename="a.png"');
  });
  await withUpstream(configured, async () => new Response("<svg onload=alert(1)/>", { headers: { "content-type": "image/svg+xml", "content-disposition": 'attachment; filename="a.svg"' } }), async () => {
    const svg = await GET(new Request(`${BASE}/runs/btr-1/artifacts?path=report/a.svg`), params(["runs", "btr-1", "artifacts"]));
    assert.equal(svg.headers.get("content-disposition"), 'attachment; filename="a.svg"', "svg 不内联");
  });
  await withUpstream(configured, async () => png(), async (calls) => {
    assert.equal((await GET(new Request(`${BASE}/runs/btr-1/artifacts?path=${encodeURIComponent("factors/a:b/deciles.png")}`), params(["runs", "btr-1", "artifacts"]))).status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/backtest/runs/btr-1/artifacts?path=factors%2Fa%3Ab%2Fdeciles.png");
  });
});

test("操作人配置遵循 infra 规则：首字符必须是字母或数字，否则回落默认值", async () => {
  await withUpstream({ ...configured, BACKTEST_PLATFORM_OPERATOR: "_bad" }, async () => ok(), async (calls) => {
    await GET(new Request(`${BASE}/runs`), params(["runs"]));
    assert.equal(new Headers(calls[0].init?.headers).get("x-backtest-operator"), "console");
  });
  await withUpstream({ ...configured, BACKTEST_PLATFORM_OPERATOR: "zhang.yan@corp" }, async () => ok(), async (calls) => {
    await GET(new Request(`${BASE}/runs`), params(["runs"]));
    assert.equal(new Headers(calls[0].init?.headers).get("x-backtest-operator"), "zhang.yan@corp");
  });
});

test("上传：流里的 413 / 400 经 fetch 包装后仍映射为对应状态，而不是 502", async () => {
  const wrapping = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
    try { for (;;) { const { done } = await reader.read(); if (done) break; } } catch (cause) { throw new TypeError("fetch failed", { cause }); }
    return ok();
  };
  await withUpstream(configured, wrapping, async () => {
    const over = await POST(upload("predictions/a/b/c", { "content-type": "application/vnd.apache.parquet", "content-length": "1000" }, streamOf(5000, 500)), params(["upload", "predictions", "a", "b", "c"]));
    assert.equal(over.status, 413);
    assert.equal((await over.json()).code, "UPLOAD_TOO_LARGE");
    const short = await POST(upload("predictions/a/b/c", { "content-type": "application/vnd.apache.parquet", "content-length": "5000" }, streamOf(1000, 500)), params(["upload", "predictions", "a", "b", "c"]));
    assert.equal(short.status, 400);
  });
});
