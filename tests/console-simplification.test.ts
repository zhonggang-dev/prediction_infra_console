import assert from "node:assert/strict";
import test from "node:test";
import { decodeSandboxArchiveOptions, archiveOptionLabel } from "../app/lib/sandbox-downloads.ts";
import { decodeOfficialPnlAccounts, decodeWalletPnl } from "../app/lib/wallet-pnl-api.ts";
import { workspacePathMatches } from "../app/lib/console-workspace.ts";
import { legacyTradingDestination } from "../app/lib/trading-navigation.ts";
import { GET as download } from "../app/api/console/downloads/[...path]/route.ts";
import { GET as consoleGet } from "../app/api/console/[...path]/route.ts";

const observed = "2026-10-30T08:00:00Z";
const options = { sandbox_id: "pm-one", observed_at: observed, variants: [{ variant: "original", status: "available" }, { variant: "masked", status: "missing" }] };

test("原始已登记但masked缺失只允许明确可用的版本，未知不冒充缺失", () => {
  const data = decodeSandboxArchiveOptions(options, "pm-one");
  assert.equal(data.variants[0].status, "available");
  assert.equal(archiveOptionLabel(data.variants[1]), "暂无 masked 资料");
  assert.match(archiveOptionLabel({ variant: "masked", status: "unknown" }), /无法核对/);
  assert.throws(() => decodeSandboxArchiveOptions(options, "pm-other"), /不一致/);
  assert.throws(() => decodeSandboxArchiveOptions({ ...options, variants: [options.variants[0]] }, "pm-one"), /不完整/);
  assert.throws(() => decodeSandboxArchiveOptions({ ...options, variants: [options.variants[0], options.variants[0]] }, "pm-one"), /无效/);
  assert.throws(() => decodeSandboxArchiveOptions({ ...options, variants: [{ variant: "original", status: "complete" }, options.variants[1]] }, "pm-one"), /无效/);
});

test("官方曲线支持账户来自服务端，不硬编码四钱包，不接受Kalshi冒充PM", () => {
  assert.deepEqual(decodeOfficialPnlAccounts({ observed_at: observed, accounts: [{ execution_account_id: "pm-new-wallet", market_source: "POLYMARKET" }] }), [{ executionAccountId: "pm-new-wallet", marketSource: "POLYMARKET" }]);
  assert.throws(() => decodeOfficialPnlAccounts({ observed_at: observed, accounts: [{ execution_account_id: "kalshi:one", market_source: "KALSHI" }] }), /无效/);
  assert.throws(() => decodeOfficialPnlAccounts({ observed_at: observed, accounts: null }), /无效/);
});

test("官方曲线解码保留合法0和缺失的区别，冲突或坏点不伪装空收益", () => {
  const base = { execution_account_id: "pm-one", wallet_address: `0x${"1".repeat(40)}`, metric: "trade_pnl", interval: "1w", fidelity: "3h", fetched_at: observed, points: [{ timestamp: 100, trade_pnl: "0" }, { timestamp: 200, trade_pnl: null }] };
  assert.deepEqual(decodeWalletPnl(base).points, [{ timestamp: 100, tradePnl: 0 }]);
  for (const trade_pnl of [false, "", undefined]) assert.throws(() => decodeWalletPnl({ ...base, points: [{ timestamp: 100, trade_pnl }] }));
  assert.throws(() => decodeWalletPnl({ ...base, points: [{ timestamp: 100, trade_pnl: "1" }, { timestamp: 100, trade_pnl: "2" }] }), /无效/);
});

test("旧决策/赎回地址只带兼容账户，不把旧状态和offset套到订单", () => {
  assert.equal(legacyTradingDestination("orders", { execution_account_id: "wallet-6", offset: "20", q: "old-cycle", status: "OUTPUT_RECORDED" }), "/trading/orders?execution_account_id=wallet-6");
  assert.equal(legacyTradingDestination("redemptions", { execution_account_id: "wallet-7", status: "APPLIED", offset: "80" }), "/trading/positions?execution_account_id=wallet-7&position_view=redemptions");
});

async function mockBackend(run: () => Promise<void>) {
  const keys = ["PREDICTION_INFRA_BASE_URL", "SANDBOX_DOWNLOAD_TOKEN", "TRADING_EXECUTION_BASE_URL", "TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const fetch = globalThis.fetch;
  Object.assign(process.env, { PREDICTION_INFRA_BASE_URL: "http://infra.test", SANDBOX_DOWNLOAD_TOKEN: "download-test", TRADING_EXECUTION_BASE_URL: "http://trading.test", TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN: "live-test" });
  try { await run(); } finally { globalThis.fetch = fetch; for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
}

test("状态查询使用独立下载token并保留JSON，不创建下载附件", async () => {
  await mockBackend(async () => {
    let seen = "";
    globalThis.fetch = (async (url, init) => {
      seen = String(url);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer download-test");
      return Response.json({ data: options });
    }) as typeof fetch;
    const response = await download(new Request("http://console.test/api/console/downloads/sandboxes/pm-one/archive-options"), { params: Promise.resolve({ path: ["sandboxes", "pm-one", "archive-options"] }) });
    assert.equal(seen, "http://infra.test/api/v1/sandboxes/pm-one/archive-options");
    assert.deepEqual((await response.json()).data, options);
    assert.equal(response.headers.get("content-disposition"), null);
  });
});

test("原生下载失败显示安全HTML，不把JSON错误作为archive附件", async () => {
  await mockBackend(async () => {
    globalThis.fetch = (async () => Response.json({ code: "SANDBOX_NOT_FOUND", message: "secret-object-path" }, { status: 404, headers: { "content-disposition": "attachment; filename=archive.json" } })) as typeof fetch;
    const response = await download(new Request("http://console.test/api/console/downloads/sandboxes/pm-one/archive?variant=masked", { headers: { accept: "text/html,application/xhtml+xml" } }), { params: Promise.resolve({ path: ["sandboxes", "pm-one", "archive"] }) });
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(response.headers.get("content-disposition"), "inline");
    const html = await response.text();
    assert.match(html, /文件暂时无法下载/);
    assert.doesNotMatch(html, /secret-object-path|archive.json/);
  });
});

test("官方账户BFF仅开放固定只读路径并使用live token", async () => {
  await mockBackend(async () => {
    globalThis.fetch = (async (url, init) => {
      assert.equal(String(url), "http://trading.test/api/v1/wallet-pnl/accounts");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer live-test");
      return Response.json({ data: { accounts: [], observed_at: observed } });
    }) as typeof fetch;
    const response = await consoleGet(new Request("http://console.test/api/console/wallet-pnl/accounts"), { params: Promise.resolve({ path: ["wallet-pnl", "accounts"] }) });
    assert.equal(response.status, 200);
    const unknown = await consoleGet(new Request("http://console.test/api/console/wallet-pnl/arbitrary"), { params: Promise.resolve({ path: ["wallet-pnl", "arbitrary"] }) });
    assert.equal(unknown.status, 404);
  });
});

test("默认交易别名归订单面板，URL回放不会落到已删除概况或外部面板", () => {
  assert.equal(workspacePathMatches("/trading/orders", "/trading"), true);
  assert.equal(workspacePathMatches("/trading/overview", "/trading"), false);
  assert.equal(workspacePathMatches("/trading/orders", "/trading/positions"), false);
  assert.equal(workspacePathMatches("/trading/ledger", "/trades"), true);
});
