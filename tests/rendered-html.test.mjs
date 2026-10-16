import assert from "node:assert/strict";
import test from "node:test";
import { workspaceHrefWithAppliedQuery } from "../app/lib/console-workspace.ts";

async function render(pathname = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" }, ...init }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

async function withoutBackendConfig(run) {
  const names = ["PREDICTION_INFRA_BASE_URL", "CONSOLE_API_TOKEN", "BACKTEST_DATASET_TOKEN", "TRADING_EXECUTION_BASE_URL", "TRADING_EXECUTION_API_TOKEN", "TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    return await run();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

async function withRedisUpstream(upstreamFetch, run) {
  const names = ["PREDICTION_INFRA_BASE_URL", "CONSOLE_API_TOKEN"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  process.env.PREDICTION_INFRA_BASE_URL = "http://prediction-infra.test";
  process.env.CONSOLE_API_TOKEN = "redis-console-test-token";
  globalThis.fetch = upstreamFetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("工作区切换 URL 只携带目标面板已应用的查询", () => {
  assert.equal(workspaceHrefWithAppliedQuery("/trading/orders", "http://localhost/trading/cycles?q=draft-not-applied", "v2-order"), "/trading/orders?q=v2-order");
  assert.equal(workspaceHrefWithAppliedQuery("/trading/orders", "http://localhost/trading/cycles?q=draft-not-applied", " v2-order "), "/trading/orders?q=v2-order");
  assert.equal(workspaceHrefWithAppliedQuery("/trading/orders?q=stale", "http://localhost/trading/cycles?q=cycle", ""), "/trading/orders");
});

test("服务端可渲染 Prediction Console 首页", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Prediction Console/);
  assert.match(html, /新版/);
  assert.match(html, /运行概览/);
  assert.match(html, /业务运行/);
  assert.match(html, /市场工作区/);
  assert.match(html, /预测工作区/);
  assert.match(html, /资料数据工作区/);
  assert.match(html, /交易工作区/);
  assert.match(html, /独立页面/);
  assert.match(html, /系统运行/);
  assert.match(html, /href="\/observability"[^>]*>.*服务监控/s);
  assert.match(html, /href="\/questions"[^>]*>.*题目库/s);
  assert.match(html, /市场工作区/);
  assert.doesNotMatch(html, /回测数据产品/);
  assert.doesNotMatch(html, /href="\/backtests"/);
  assert.match(html, /href="http:\/\/172\.21\.20\.221:8501\/"[^>]*>.*PM Backtest/s);
  assert.doesNotMatch(html, /Your site is taking shape/);

  for (const href of ["/markets", "/predictions", "/assets", "/trading/cycles"]) {
    assert.equal((html.match(new RegExp(`<a[^>]*href="${href}"`, "g")) ?? []).length, 1, `sidebar should expose one ${href} entry`);
  }
});

test("服务端直达工作区只渲染当前选中的面板", async () => {
  const response = await render("/markets/data");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="v2-tab-markets-data"[^>]*aria-selected="true"/);
  assert.doesNotMatch(html, /id="v2-tab-markets-running"[^>]*aria-selected="true"/);
  assert.match(html, /id="v2-panel-markets-data"[^>]*role="tabpanel"[^>]*aria-hidden="false"/);
  assert.doesNotMatch(html, /id="v2-panel-markets-running"/);
});

test("服务端直达订单页应用 URL 查询并暴露 tab 语义", async () => {
  const response = await render("/trading/orders?q=v2-order");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="v2-tab-trading-orders"[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="v2-panel-trading-orders"/);
  assert.match(html, /id="v2-panel-trading-orders"[^>]*role="tabpanel"[^>]*aria-labelledby="v2-tab-trading-orders"/);
  assert.match(html, /data-v2-search-applied="v2-order"[^>]*value="v2-order"/);
});

test("服务端可渲染独立的市场页面", async () => {
  const response = await render("/markets");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /选盘批次与历史/);
});

test("服务端可渲染数据集轮换页面并显示导航入口", async () => {
  const response = await render("/dataset-rotation");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /数据集轮换/);
  assert.match(html, /href="\/dataset-rotation"[^>]*>.*数据集轮换/s);
});

test("服务端可渲染交易与结算记录页面", async () => {
  const response = await render("/trades");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /交易与结算记录/);
  assert.match(html, /已确认并入账的成交与结算/);
  assert.match(html, /REDEEM · 赎回结算/);
});

test("服务端可渲染实盘监控页面", async () => {
  const response = await render("/live");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /实盘监控/);
  assert.match(html, /从机会扫描到成交入账/);
  assert.match(html, /选择钱包/);
  assert.match(html, /系统管理持仓/);
  assert.match(html, /当前持仓价值/);
  assert.match(html, /Peak Cash Used/);
  assert.match(html, /累计投入成本/);
  assert.match(html, /Realized PnL/);
  assert.match(html, /Unrealized PnL/);
  assert.match(html, /Total PnL/);
  assert.match(html, /Return/);
  assert.match(html, /最大回撤/);
  assert.match(html, /钱包 PnL 对比/);
  assert.match(html, /多选钱包比较累计已实现 PnL/);
  assert.match(html, /SELL 平仓 \+ REDEEM 赎回/);
  assert.match(html, /模型 Edge 分布/);
  assert.match(html, /模型概率 − 盘口中间价/);
  assert.match(html, /正在读取真实实盘快照/);
  assert.doesNotMatch(html, /\$12,842\.36/);
  assert.doesNotMatch(html, />LIVE</);
});

test("服务端可渲染双服务基础监控页面", async () => {
  const response = await render("/observability");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /服务监控/);
  assert.match(html, /服务端采样的运行指标/);
  assert.match(html, /Redis 队列监控/);
  assert.match(html, /业务消息与缓存分开统计/);
});

test("能力接口在未配置令牌时安全关闭写能力", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/capabilities"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: { console_read: false, trade_read: false, live_read: false, backtest_create: false, sandbox_download: false },
  });
});

test("实时接口未配置后端时返回稳定错误", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/overview"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BACKEND_NOT_CONFIGURED");
});

test("服务监控聚合接口允许两个后端独立离线", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/service-metrics"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.services.length, 2);
  assert.deepEqual(payload.data.services.map((service) => service.status), ["unavailable", "unavailable"]);
});

test("Redis 监控 BFF 未配置后端时安全失败", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/redis-monitor"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BACKEND_NOT_CONFIGURED");
});

test("Redis 监控 BFF 只读转发上游并隐藏服务器令牌", async () => {
  const calls = [];
  const response = await withRedisUpstream(async (input, init) => {
    calls.push({ url: String(input), method: init?.method, authorization: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify({ code: "CONSOLE_REDIS_MONITOR_FOUND", request_id: "redis-upstream-1", data: { status: "ok", source: "upstream" } }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "redis-upstream-1", "set-cookie": "secret=must-not-forward" },
    });
  }, () => render("/api/console/redis-monitor?scope=queue"));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://prediction-infra.test/api/v1/console/redis-monitor?scope=queue");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].authorization, "Bearer redis-console-test-token");
  assert.equal(response.headers.get("x-request-id"), "redis-upstream-1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { code: "CONSOLE_REDIS_MONITOR_FOUND", request_id: "redis-upstream-1", data: { status: "ok", source: "upstream" } });
});

test("Redis 监控 BFF 保留上游 503，不回落为演示数据", async () => {
  const response = await withRedisUpstream(async () => new Response(JSON.stringify({ code: "CONSOLE_REDIS_MONITOR_UNAVAILABLE", message: "Redis snapshot unavailable" }), {
    status: 503,
    headers: { "content-type": "application/json", "x-request-id": "redis-upstream-503" },
  }), () => render("/api/console/redis-monitor"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-request-id"), "redis-upstream-503");
  assert.deepEqual(await response.json(), { code: "CONSOLE_REDIS_MONITOR_UNAVAILABLE", message: "Redis snapshot unavailable" });
});

test("Redis 监控 BFF 拒绝写请求", async () => {
  const response = await render("/api/console/redis-monitor", { method: "POST" });
  assert.equal(response.status, 404);
});

test("交易记录接口未配置执行服务时安全失败", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/trades?limit=20&offset=0"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BACKEND_NOT_CONFIGURED");
});

test("账本活动接口未配置执行服务时安全失败", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/ledger-activities?limit=20&offset=0&activity_type=REDEEM"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BACKEND_NOT_CONFIGURED");
});

test("每日盈亏接口未配置执行服务时安全失败", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/daily-pnl?days=14"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BACKEND_NOT_CONFIGURED");
});

test("实盘聚合接口未配置执行服务时安全失败", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/live-operations"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BACKEND_NOT_CONFIGURED");
});

test("Edge 分布接口未配置执行服务时安全失败", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/edge-distribution"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BACKEND_NOT_CONFIGURED");
});

test("BFF 拒绝非白名单回测路径", async () => {
  const response = await render("/api/console/backtest-datasets/example/files/secret.txt");
  assert.equal(response.status, 404);
});

test("数据集轮换 BFF 未配置后端时安全失败", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/dataset-rotation"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BACKEND_NOT_CONFIGURED");
});

test("数据集轮换 BFF 拒绝写请求", async () => {
  const response = await render("/api/console/dataset-rotation", { method: "POST" });
  assert.equal(response.status, 404);
});
