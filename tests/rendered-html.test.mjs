import assert from "node:assert/strict";
import test from "node:test";
import { appliedFilterFromUrl, appliedListOffset, mergeSharedQuery, workspaceHrefWithAppliedQuery } from "../app/lib/console-workspace.ts";

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
  assert.equal(workspaceHrefWithAppliedQuery("/trading/orders?status=stale", "http://localhost/trading/cycles?status=cycle", "status=FILLED&execution_account_id=wallet-1&limit=50"), "/trading/orders?status=FILLED&execution_account_id=wallet-1&limit=50");
});

test("参数回放时保留目标列表已提交的 offset", () => {
  assert.equal(appliedListOffset("http://localhost/trading/orders?offset=20", 20), 20);
  assert.equal(appliedListOffset("http://localhost/trading/orders?offset=21", 20), 20);
  assert.equal(appliedListOffset("http://localhost/trading/orders", 20), 0);
});

test("预测视图切换只继承共享范围，不继承结果/任务私有筛选", () => {
  const current = new URLSearchParams("scope=current&model=model-fixture&generation_id=7&source=POLYMARKET&status=PENDING");
  assert.equal(mergeSharedQuery("", current, ["scope", "model", "generation_id", "prediction_as_of"]), "scope=current&model=model-fixture&generation_id=7");
  assert.equal(workspaceHrefWithAppliedQuery("/predictions/tasks", "http://localhost/predictions", "scope=current&model=model-fixture&generation_id=7"), "/predictions/tasks?scope=current&model=model-fixture&generation_id=7");
});

test("共享上下文重置后切回目标 panel 会清除旧身份与日期", () => {
  const ordersApplied = "q=order&execution_account_id=account-a&from=2026-10-15&to=2026-10-16&limit=50";
  assert.equal(mergeSharedQuery(ordersApplied, new URLSearchParams(""), ["execution_account_id", "model_id", "strategy_id", "from", "to"]), "q=order&limit=50");
});

test("隐藏 panel 的私有筛选在 workspace URL 缺失时保留，popstate 才清空", () => {
  const current = new URLSearchParams("scope=current&model=model-fixture");
  assert.equal(appliedFilterFromUrl(current, "source", "", true), undefined);
  assert.equal(appliedFilterFromUrl(current, "source", "", false), "");
  assert.equal(appliedFilterFromUrl(new URLSearchParams("source=GENERATED"), "source", "", true), "GENERATED");
});

test("服务端可渲染 Prediction Console 首页", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Prediction Console/);
  assert.doesNotMatch(html, /新版/);
  assert.match(html, /运行概览/);
  assert.match(html, /业务运行/);
  assert.match(html, /市场工作区/);
  assert.match(html, /预测工作区/);
  assert.match(html, /数据集轮转/);
  assert.match(html, /交易工作区/);
  assert.match(html, /系统运行/);
  assert.match(html, /href="\/system"[^>]*>.*系统工作区/s);
  assert.match(html, /href="\/questions"[^>]*>.*题目库/s);
  assert.match(html, /市场工作区/);
  assert.doesNotMatch(html, /回测数据产品/);
  assert.doesNotMatch(html, /href="\/backtests"/);
  assert.doesNotMatch(html, /href="http:\/\/172\.21\.20\.221:8501\/"[^>]*>.*PM Backtest/s);
  assert.doesNotMatch(html, /Your site is taking shape/);

  const sidebar = html.match(/<aside id="console-sidebar"[\s\S]*?<\/aside>/)?.[0] ?? "";
  assert.ok(sidebar, "sidebar should render");
  for (const href of ["/markets", "/predictions", "/dataset-rotation", "/sandboxes", "/trading"]) {
    assert.equal((sidebar.match(new RegExp(`<a[^>]*href="${href}"`, "g")) ?? []).length, 1, `sidebar should expose one ${href} entry`);
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

test("中文列表详情 dialog 具有实例身份并正确关联标题", async () => {
  const html = await (await render("/markets")).text();
  const dialogs = [...html.matchAll(/<dialog id="([^"]+)"[^>]*aria-labelledby="([^"]+)"/g)];
  assert.ok(dialogs.length >= 1, "长期运行池应提供中文详情 dialog");
  assert.equal(new Set(dialogs.map((match) => match[1])).size, dialogs.length, "详情 dialog ID 必须唯一");
  for (const [, dialogId, headingId] of dialogs) {
    assert.equal(dialogId, `${headingId}-dialog`);
    assert.notEqual(headingId, "v2-detail-title--", "中文标题不能退化为共享的常量ID");
    assert.match(html, new RegExp(`<h2 id="${headingId}"[^>]*>[^<]+</h2>`));
  }
  assert.match(html, /<h2[^>]*>长期运行池<\/h2>/);
  assert.match(html, /查看运行池维护记录/);
});

test("交易对账默认打开开放问题并保留局部视图范围", async () => {
  const response = await render("/trading/reconciliation");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="v2-tab-issues"[^>]*aria-selected="true"/);
  assert.match(html, /aria-label="问题状态"[\s\S]*?<option value="OPEN" selected/);

  const runsResponse = await render("/trading/reconciliation?reconciliation_view=runs");
  assert.equal(runsResponse.status, 200);
  const runsHtml = await runsResponse.text();
  assert.match(runsHtml, /id="v2-tab-runs"[^>]*aria-selected="true"/);
});

test("对账全部状态使用可恢复的 UI sentinel", async () => {
  const response = await render("/trading/reconciliation?status=ALL");
  const html = await response.text();
  assert.match(html, /aria-label="问题状态"[\s\S]*?<option value="ALL" selected/);
});

test("服务端可渲染独立的市场页面", async () => {
  const response = await render("/markets");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1>运行市场<\/h1>/);
  assert.match(html, /id="v2-tab-markets-running"[^>]*aria-selected="true"/);
  assert.doesNotMatch(html, /id="v2-tab-markets-selection"[^>]*aria-selected="true"/);
});

test("选盘批次直达链接先展示目标成员列表", async () => {
  const response = await render("/markets/selection?selection_run_id=477");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /选盘批次(?:\s|<!-- -->)+477/);
  assert.match(html, /<h2[^>]*>入选成员<\/h2>/);
  assert.doesNotMatch(html, /<h2[^>]*>选盘批次<\/h2>/);
  assert.match(html, /返回选盘批次/);
});

test("数据集轮转的三个兼容入口复用同一类型→版本→用途页面", async () => {
  for (const path of ["/dataset-rotation", "/datasets", "/assets"]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /<h1>数据集轮转<\/h1>/, path);
    assert.match(html, /选择资料类型 → 版本/, path);
    assert.match(html, /刷新/, path);
    assert.doesNotMatch(html, /高级归档工具/, path);
    assert.doesNotMatch(html, /打开 PM Backtest/, path);
    assert.doesNotMatch(html, /历史回测导出/, path);
    assert.equal((html.match(/class="brand"/g) ?? []).length, 1, `${path} should have one ConsoleShell`);
  }
});

test("资料工作区把真实版本/变体/用途和轮换嵌入同一业务壳", async () => {
  const datasets = await (await render("/datasets")).text();
  assert.match(datasets, /<h1>数据集轮转<\/h1>/);
  assert.match(datasets, /选择资料类型 → 版本/);
  assert.match(datasets, /轮换执行、发布历史与规则/);
  assert.equal((datasets.match(/class="brand"/g) ?? []).length, 1, "资料工作区只能有一个 ConsoleShell");

  const sandboxes = await (await render("/sandboxes")).text();
  assert.match(sandboxes, /<h1>Sandbox<\/h1>/);
  assert.doesNotMatch(sandboxes, /高级归档工具|全部资料类型|模式 \/ 交易|历史回测导出|打开 PM Backtest/);
  assert.equal((sandboxes.match(/class="brand"/g) ?? []).length, 1, "资料归档只能有一个 ConsoleShell");
  assert.doesNotMatch(datasets, /高级归档工具/);
  assert.doesNotMatch(datasets, /v2-tab-sandboxes/);
  assert.doesNotMatch(sandboxes, /v2-tab-datasets/);
});

test("收益页默认官方曲线与精简账本，四个主Tab不恢复旧概况", async () => {
  const response = await render("/trades");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /官方钱包盈亏/);
  assert.match(html, /成交与结算明细/);
  assert.match(html, /曲线为 Polymarket 官方钱包口径/);
  assert.match(html, /id="v2-tab-trading-ledger"[^>]*aria-selected="true"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /账户经营摘要|决策记录|钱包 PnL 对比/);
  assert.equal((html.match(/class="brand"/g) ?? []).length, 1);
});

test("旧实盘与决策URL转订单，旧赎回转持仓次级入口且不携带旧分页", async () => {
  for (const path of ["/live", "/trading/overview", "/trading/cycles"]) {
    const response = await render(`${path}?execution_account_id=wallet-6&offset=20&status=OUTPUT_RECORDED`);
    assert.ok([307, 308].includes(response.status), path);
    assert.equal(response.headers.get("location"), "/trading/orders?execution_account_id=wallet-6");
  }
  const redemption = await render("/trading/redemptions?execution_account_id=wallet-7&offset=100");
  assert.equal(redemption.headers.get("location"), "/trading/positions?execution_account_id=wallet-7&position_view=redemptions");
});

test("交易入口默认订单，四个主Tab保留一个业务壳", async () => {
  const html = await (await render("/trading")).text();
  assert.match(html, /id="v2-tab-trading-orders"[^>]*aria-selected="true"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  assert.equal((html.match(/class="brand"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /实盘概况|决策记录|连接设置|所有时间均为 UTC/);
});

test("账本嵌入工作区只共享账户，模型策略和日期保留本页筛选", async () => {
  const response = await render("/trading/ledger?execution_account_id=wallet-1&model_id=model-1&strategy_id=strategy-1&from=2026-10-15&to=2026-10-16");
  const html = await response.text();
  const filters = html.match(/<form class="trade-filters"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.ok(filters, "嵌入账本应渲染筛选区域");
  assert.match(filters, /开始日期/);
  assert.match(filters, /结束日期/);
  assert.match(filters, /模型/);
  assert.match(filters, /策略/);
  assert.doesNotMatch(filters, /执行账户（共享范围）/);
  assert.match(filters, /历史模型与策略筛选/);
  assert.doesNotMatch(filters, /顶部上下文|账本共享时间上下文/);
});

test("账本保留已应用列表状态供工作区切换恢复", async () => {
  const response = await render("/trading/ledger?activity_type=REDEEM&ledger_range=7d&q=chain-hash&limit=50&offset=50");
  const html = await response.text();
  const state = html.match(/<div[^>]*data-v2-list-state[\s\S]*?>/)?.[0] ?? "";
  assert.ok(state, "账本应暴露工作区列表状态");
  assert.match(state, /data-v2-list-query="chain-hash"/);
  assert.match(state, /data-v2-list-limit="50"/);
  assert.match(state, /data-v2-list-offset="50"/);
  assert.match(html, /activity_type/);
  assert.match(html, /ledger_range/);
});

test("服务端可渲染双服务基础监控页面", async () => {
  const response = await render("/observability");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /服务监控/);
  assert.match(html, /查看服务运行快照与 Redis 状态/);
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

test("侧栏分离数据集轮转与 Sandbox，旧 PM Backtest 只在回测相关页面保留", async () => {
  const html = await (await render("/")).text();
  const sidebar = html.match(/<aside id="console-sidebar"[\s\S]*?<\/aside>/)?.[0] ?? "";
  assert.equal((sidebar.match(/<a[^>]*href="\/backtest-platform"/g) ?? []).length, 1);
  assert.match(sidebar, /href="\/backtest-platform"[^>]*>.*回测平台/s);
  assert.equal((sidebar.match(/<a[^>]*href="\/(?:live|trades)"/g) ?? []).length, 0);
  assert.match(sidebar, /href="\/dataset-rotation"[^>]*>.*数据集轮转/s);
  assert.match(sidebar, /href="\/sandboxes"[^>]*>.*Sandbox/s);
  assert.doesNotMatch(sidebar, /独立页面/);
  assert.doesNotMatch(sidebar, /href="http:\/\/172\.21\.20\.221:8501\/"[^>]*>.*PM Backtest/s);
  assert.doesNotMatch(sidebar, /href="\/backtests"/);
  assert.doesNotMatch(sidebar, /回测数据产品/);
});

test("回测平台工作区：Tab ARIA、默认交易回测、只渲染当前面板", async () => {
  const response = await render("/backtest-platform");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<nav[^>]*aria-label="回测平台视图"[^>]*role="tablist"/);
  for (const tab of ["trading", "benchmark", "signal", "factors", "submissions", "runs"]) {
    assert.match(html, new RegExp(`id="v2-tab-backtest-platform-${tab}"[^>]*role="tab"`));
  }
  assert.match(html, /id="v2-tab-backtest-platform-trading"[^>]*aria-selected="true"[^>]*aria-controls="v2-panel-backtest-platform-trading"/);
  assert.match(html, /id="v2-panel-backtest-platform-trading"[^>]*role="tabpanel"[^>]*aria-labelledby="v2-tab-backtest-platform-trading"/);
  assert.doesNotMatch(html, /id="v2-panel-backtest-platform-runs"/, "未访问的 Tab 不挂载面板、不预抓数据");
  assert.match(html, /交易回测/);
  assert.match(html, /href="\/backtest-platform"[^>]*aria-current="page"/, "侧栏高亮回测平台");
  assert.match(html, /打开旧平台 PM Backtest/);
});

test("回测平台旧平台外链是运行时配置：改地址、设为 off 都在请求时生效（不是构建时写死）", async () => {
  const name = "BACKTEST_LEGACY_PLATFORM_URL";
  const previous = process.env[name];
  try {
    process.env[name] = "https://legacy.example.test/pm/";
    const custom = await (await render("/backtest-platform/trading")).text();
    assert.match(custom, /href="https:\/\/legacy\.example\.test\/pm\/"[^>]*>打开旧平台 PM Backtest/);
    assert.doesNotMatch(custom, /href="http:\/\/172\.21\.20\.221:8501\/"[^>]*>打开旧平台/);
    process.env[name] = "off";
    const off = await (await render("/backtest-platform/runs")).text();
    assert.doesNotMatch(off, /打开旧平台 PM Backtest/);
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

test("回测平台直达各 Tab 选中对应视图", async () => {
  for (const [path, tab] of [["/backtest-platform/runs", "runs"], ["/backtest-platform/submissions", "submissions"], ["/backtest-platform/benchmark", "benchmark"], ["/backtest-platform/factors", "factors"], ["/backtest-platform/signal", "signal"], ["/backtest-platform/trading", "trading"]]) {
    const html = await (await render(path)).text();
    assert.match(html, new RegExp(`id="v2-tab-backtest-platform-${tab}"[^>]*aria-selected="true"`), path);
    assert.match(html, new RegExp(`id="v2-panel-backtest-platform-${tab}"[^>]*aria-hidden="false"`), path);
  }
});

test("运行结果页有独立 URL，可直接打开", async () => {
  const response = await render("/backtest-platform/runs/btr-20261019-k3m9q2xa");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /运行详情/);
  assert.match(html, /btr-20261019-k3m9q2xa/);
  assert.match(html, /href="\/backtest-platform\/runs"/);
});

test("回测平台 BFF 未配置时安全失败，写方法不走只读 V2 BFF", async () => {
  const unconfigured = await withoutBackendConfig(() => render("/api/console/backtest/catalog?kind=model"));
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).code, "BACKEND_NOT_CONFIGURED");
  const v2Write = await render("/api/console/v2/infra/overview", { method: "POST" });
  assert.equal(v2Write.status, 405, "只读的 V2 BFF 仍然拒绝写请求");
  const patch = await render("/api/console/backtest/runs", { method: "PATCH" });
  assert.equal(patch.status, 405);
});
