import assert from "node:assert/strict";
import test from "node:test";
import { buildKalshiPnlView, chooseKalshiPnlRange, decodeKalshiPnl, decodeKalshiPnlAccounts, kalshiPnl } from "../app/lib/kalshi-pnl.ts";
import { buildWalletPnlChartGeometry, validateWalletPnlRange } from "../app/lib/wallet-pnl.ts";
import { GET, POST } from "../app/api/console/[...path]/route.ts";

const now = Date.parse("2026-11-05T07:00:00Z"), hour = 3600, day = 24 * hour;
const second = now / 1000;
const payload = (patch: Record<string, unknown> = {}) => ({ execution_account_id: "kalshi:main", market_source: "KALSHI", metric: "cumulative_pnl", range: "1w", period_interval_minutes: 60, fetched_at: new Date(now).toISOString(), processed_through: new Date(now - hour * 1000).toISOString(), points: [{ timestamp: second - 7 * day, cumulative_pnl: "-10", portfolio_value: "990" }, { timestamp: second, cumulative_pnl: "-6", portfolio_value: "994" }], ...patch });
const decode = (patch: Record<string, unknown> = {}) => decodeKalshiPnl(payload(patch), { account: "kalshi:main", range: "1w" });
const range = (startMs: number, endMs: number) => ({ startMs, endMs, startDate: "", endDate: "", timeZone: "Asia/Shanghai", startOffset: "UTC+08:00", endOffset: "UTC+08:00" });

test("Kalshi目录严格核对平台、账户和重复，空目录为合法未配置", () => {
  const data = { observed_at: new Date(now).toISOString(), accounts: [{ execution_account_id: "kalshi:main", market_source: "KALSHI" }] };
  assert.deepEqual(decodeKalshiPnlAccounts(data), [{ executionAccountId: "kalshi:main", marketSource: "KALSHI" }]);
  assert.deepEqual(decodeKalshiPnlAccounts({ ...data, accounts: [] }), []);
  for (const accounts of [[{ ...data.accounts[0], market_source: "POLYMARKET" }], [data.accounts[0], data.accounts[0]], [{ ...data.accounts[0], execution_account_id: "main" }]]) assert.throws(() => decodeKalshiPnlAccounts({ ...data, accounts }));
});
test("官方金额、历史水位与当前末点分开；不接受串账户串周期", () => {
  const result = decode();
  assert.equal(result.points[1].cumulativePnl, -6);
  assert.ok(Date.parse(result.processedThrough) < result.points[1].timestamp * 1000);
  for (const patch of [{ execution_account_id: "kalshi:other" }, { range: "all" }, { metric: "trade_pnl" }, { market_source: "POLYMARKET" }, { period_interval_minutes: 0 }, { processed_through: undefined }, { processed_through: new Date(now + day * 1000).toISOString() }]) assert.throws(() => decode(patch));
});
test("缺值、非有限数、冲突重复、未来点与超预算不伪装成功", () => {
  for (const amount of [null, undefined, "", "NaN", "Infinity", false, 0, "1e6"]) assert.throws(() => decode({ points: [{ timestamp: second, cumulative_pnl: amount, portfolio_value: "100" }] }));
  const p = payload().points[0];
  assert.throws(() => decode({ points: [p, { ...p, cumulative_pnl: "2" }] }));
  assert.throws(() => decode({ points: [{ ...p, timestamp: second + day }] }));
  assert.throws(() => decode({ points: Array.from({ length: 10001 }, () => p) }));
  assert.equal(decode({ points: [p, p] }).points.length, 1);
  assert.equal(decode({ points: [{ ...p, cumulative_pnl: "0" }] }).points[0].cumulativePnl, 0);
});
test("自定义按开始日期距今选择来源，过去一天不能误取最近1d", () => {
  assert.equal(chooseKalshiPnlRange("CUSTOM", range(now - 3 * day * 1000, now - 3 * day * 1000 + hour * 1000), now), "1w");
  assert.equal(chooseKalshiPnlRange("CUSTOM", range(now - 20 * day * 1000, now - 20 * day * 1000 + hour * 1000), now), "1m");
  assert.equal(chooseKalshiPnlRange("CUSTOM", range(now - 90 * day * 1000, now - 90 * day * 1000 + hour * 1000), now), "all");
  assert.equal(chooseKalshiPnlRange("CUSTOM", range(now - 12 * hour * 1000, now), now), "1d");
  assert.equal(chooseKalshiPnlRange("YTD", undefined, now), "1y");
});
test("快捷周期显示区间差额，全部显示官方累计值，零与缺数据不同", () => {
  assert.equal(buildKalshiPnlView(decode(), "1W").amount, 4);
  assert.equal(buildKalshiPnlView(decode(), "ALL").amount, -6);
  assert.equal(buildKalshiPnlView({ ...decode(), points: [] }, "ALL").amount, null);
  assert.equal(buildKalshiPnlView({ ...decode(), points: decode().points.map(p => ({ ...p, cumulativePnl: 0 })) }, "1W").amount, 0);
});
test("小时自定义金额、悬停和轴域同范围，域外基准不画入图中", () => {
  const start = second - 3 * day, end = start + 12 * hour;
  const points = Array.from({ length: 14 }, (_, i) => ({ timestamp: start + (i - 1) * hour, cumulativePnl: 100 + i, portfolioValue: 1100 + i }));
  const s = { ...decode(), points: [...points, { timestamp: second, cumulativePnl: 200, portfolioValue: 1200 }] };
  const v = buildKalshiPnlView(s, "CUSTOM", range(start * 1000, end * 1000));
  assert.equal(v.amount, 12); assert.equal(v.points[0].value, 0); assert.equal(v.points.at(-1)!.value, 12);
  const chart = buildWalletPnlChartGeometry(v)!;
  assert.equal(chart.domainStartAt, start); assert.equal(chart.domainEndAt, end); assert.match(chart.linePath, / C /);
  const shifted = buildKalshiPnlView(s, "CUSTOM", range((start + 30 * 60) * 1000, end * 1000));
  assert.equal(shifted.points[0].timestamp, start + hour); assert.equal(shifted.baselineAt, start + hour); assert.equal(shifted.points[0].value, 0); assert.equal(shifted.amount, 11); assert.equal(shifted.startAt, start + hour);
});
test("很早的12小时范围只有日采样时不给金额或曲线，不捏造平线", () => {
  const start = second - 60 * day;
  const points = [-day, 0, day, 60 * day].map((offset, i) => ({ timestamp: start + offset, cumulativePnl: i, portfolioValue: 1000 + i }));
  const s = { ...decode(), periodIntervalMinutes: 1440, points };
  const v = buildKalshiPnlView(s, "CUSTOM", range((start + 8 * hour) * 1000, (start + 20 * hour) * 1000));
  assert.match(v.error!, /不足两个/); assert.equal(v.amount, null); assert.equal(buildWalletPnlChartGeometry(v), undefined);
  const whole = buildKalshiPnlView(s, "CUSTOM", range(start * 1000, (start + day) * 1000));
  assert.equal(whole.amount, 1); assert.equal(whole.points[0].value, 0);
});
test("日级长区间使用域内首点，早于已有历史可展示，中间数据缺口不补零", () => {
  const start = second - 60 * day;
  const points = Array.from({ length: 8 }, (_, i) => ({ timestamp: start + i * day, cumulativePnl: i, portfolioValue: 1000 + i }));
  const s = { ...decode(), periodIntervalMinutes: 1440, points: [...points, { timestamp: second, cumulativePnl: 20, portfolioValue: 1020 }] };
  const v = buildKalshiPnlView(s, "CUSTOM", range((start + 8 * hour) * 1000, (start + 6 * day + 8 * hour) * 1000));
  assert.equal(v.amount, 5); assert.equal(v.startAt, start + day); assert.equal(v.endAt, start + 6 * day); assert.equal(v.points[0].value, 0); assert.equal(v.approximate, undefined);
  assert.equal(buildKalshiPnlView(s, "CUSTOM", range((start - 10 * day) * 1000, (start + 6 * day) * 1000)).amount, 6);
  assert.equal(buildKalshiPnlView({ ...s, points: s.points.filter((_, i) => i !== 2 && i !== 3) }, "CUSTOM", range(start * 1000, (start + 6 * day) * 1000)).amount, null);
});
test("年初至今按浏览器本地年初归零，账户年中起始明确部分历史", () => {
  const date = new Date(now), yearStart = new Date(date.getFullYear(), 0, 1).getTime() / 1000;
  const s = { ...decode(), periodIntervalMinutes: 1440, points: [{ timestamp: yearStart, cumulativePnl: 20, portfolioValue: 1020 }, { timestamp: second, cumulativePnl: 25, portfolioValue: 1025 }] };
  // A sparse fixture cannot claim a complete year; actual daily history is required.
  const daily = Array.from({ length: Math.floor((second - yearStart) / day) + 1 }, (_, i) => ({ timestamp: yearStart + i * day, cumulativePnl: 20 + i, portfolioValue: 1020 + i }));
  const v = buildKalshiPnlView({ ...s, points: [...daily, s.points[1]] }, "YTD");
  assert.equal(v.amount, 5); assert.equal(v.baseline, 20);
  const partial = buildKalshiPnlView({ ...s, points: [{ timestamp: second - day, cumulativePnl: 1, portfolioValue: 1001 }, s.points[1]] }, "YTD");
  assert.equal(partial.amount, 24); assert.equal(partial.partialHistory, true); assert.match(partial.notice!, /历史从/);
});
test("时间选择仍仅允许整点，夏令时歧义沿用明确校验", () => {
  assert.ok(validateWalletPnlRange("2026-11-03T10:29", "2026-11-04T10:00", now).error);
});
test("客户端及窄BFF只发固定Kalshi只读请求，非法范围不向上游发送", async () => {
  const oldFetch = globalThis.fetch, oldURL = process.env.TRADING_EXECUTION_BASE_URL, oldToken = process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN;
  try {
    const controller = new AbortController();
    globalThis.fetch = (async (input, init) => { assert.equal(String(input), "/api/console/kalshi-pnl?execution_account_id=kalshi%3Amain&range=1w"); assert.equal(init?.signal, controller.signal); return Response.json({ data: payload() }); }) as typeof fetch;
    await kalshiPnl("kalshi:main", "1w", controller.signal);
    process.env.TRADING_EXECUTION_BASE_URL = "http://trading.test"; process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = "read-only-test";
    let calls = 0;
    globalThis.fetch = (async (input, init) => { calls++; assert.equal(String(input), "http://trading.test/api/v1/kalshi-pnl?execution_account_id=kalshi%3Amain&range=1w"); assert.equal((init?.headers as Headers).get("authorization"), "Bearer read-only-test"); return Response.json({ data: payload() }); }) as typeof fetch;
    const params = { params: Promise.resolve({ path: ["kalshi-pnl"] }) };
    assert.equal((await GET(new Request("http://console.test/api/console/kalshi-pnl?execution_account_id=kalshi%3Amain&range=1w"), params)).status, 200);
    for (const query of ["", "?range=custom", "?execution_account_id=main&range=1d", "?execution_account_id=kalshi:main&range=1d&range=1w", "?execution_account_id=kalshi:main&range=1d&start_ts=1", "?execution_account_id=kalshi:main&range=1d&user_id=secret"]) assert.equal((await GET(new Request("http://console.test/api/console/kalshi-pnl" + query), params)).status, 400);
    assert.equal((await GET(new Request("http://console.test/api/console/kalshi-pnl/accounts?range=all"), { params: Promise.resolve({ path: ["kalshi-pnl", "accounts"] }) })).status, 400);
    assert.equal((await POST(new Request("http://console.test/api/console/kalshi-pnl", { method: "POST" }), params)).status, 404);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = oldFetch; if (oldURL === undefined) delete process.env.TRADING_EXECUTION_BASE_URL; else process.env.TRADING_EXECUTION_BASE_URL = oldURL; if (oldToken === undefined) delete process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN; else process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = oldToken; }
});
test("Kalshi BFF传播调用方取消且不把上游错误正文转成盈利", async () => {
  const oldFetch = globalThis.fetch, oldURL = process.env.TRADING_EXECUTION_BASE_URL, oldToken = process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN;
  try {
    process.env.TRADING_EXECUTION_BASE_URL = "http://trading.test"; process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = "fixture-read";
    const controller = new AbortController();
    globalThis.fetch = (async (_input, init) => { controller.abort(); assert.equal(init?.signal?.aborted, true); throw new Error("private source text"); }) as typeof fetch;
    const response = await GET(new Request("http://console.test/api/console/kalshi-pnl?execution_account_id=kalshi:main&range=1d", { signal: controller.signal }), { params: Promise.resolve({ path: ["kalshi-pnl"] }) });
    assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /private source text/);
  } finally { globalThis.fetch = oldFetch; if (oldURL === undefined) delete process.env.TRADING_EXECUTION_BASE_URL; else process.env.TRADING_EXECUTION_BASE_URL = oldURL; if (oldToken === undefined) delete process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN; else process.env.TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN = oldToken; }
});
