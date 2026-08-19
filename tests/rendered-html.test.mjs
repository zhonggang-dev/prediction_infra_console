import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
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

test("服务端可渲染 Prediction Console 首页", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Prediction Console/);
  assert.match(html, /运行概览/);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("服务端可渲染独立的市场页面", async () => {
  const response = await render("/markets");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /已选市场/);
});

test("服务端可渲染真实交易记录页面", async () => {
  const response = await render("/trades");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /交易记录/);
  assert.match(html, /已确认并写入资金与仓位账本/);
});

test("服务端可渲染实盘监控页面", async () => {
  const response = await render("/live");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /实盘监控/);
  assert.match(html, /从机会扫描到成交入账/);
});

test("能力接口在未配置令牌时安全关闭写能力", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/capabilities"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: { console_read: false, trade_read: false, live_read: false, backtest_create: false },
  });
});

test("实时接口未配置后端时返回稳定错误", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/overview"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "BACKEND_NOT_CONFIGURED");
});

test("交易记录接口未配置执行服务时安全失败", async () => {
  const response = await withoutBackendConfig(() => render("/api/console/trades?limit=20&offset=0"));
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

test("BFF 拒绝非白名单回测路径", async () => {
  const response = await render("/api/console/backtest-datasets/example/files/secret.txt");
  assert.equal(response.status, 404);
});
