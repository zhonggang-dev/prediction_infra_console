import assert from "node:assert/strict";
import test from "node:test";

import { buildWalletPnlChartGeometry, buildWalletPnlView, chooseWalletPnlQuery, formatWalletPnlUsd, isOfficialWalletPnlResponse, nearestWalletPnlPointIndex } from "../app/lib/wallet-pnl.ts";

const hour = 60 * 60;

test("官方周线按首点基线计算截图金额", () => {
  const asOf = Date.UTC(2026, 9, 26, 6, 0, 0) / 1000;
  const view = buildWalletPnlView([
    { timestamp: asOf - 7 * 24 * hour, tradePnl: -62.686659 },
    { timestamp: asOf - 4 * 24 * hour, tradePnl: -148.037827 },
    { timestamp: asOf, tradePnl: -155.522367 },
  ], "1W", asOf * 1000);
  assert.equal(view.absolute, false);
  assert.ok(Math.abs((view.amount ?? 0) - -92.835708) < 1e-9);
  assert.ok(Math.abs(view.points[1].value - -85.351168) < 1e-9);
});

test("全部历史返回累计绝对值，短历史周期也不伪造区间差值", () => {
  const asOf = Date.UTC(2026, 9, 26) / 1000;
  const points = [{ timestamp: asOf - 2 * 24 * hour, tradePnl: -10 }, { timestamp: asOf, tradePnl: -12.5 }];
  assert.equal(buildWalletPnlView(points, "ALL", asOf * 1000).amount, -12.5);
  assert.equal(buildWalletPnlView(points, "1M", asOf * 1000).absolute, true);
  assert.equal(buildWalletPnlView(points, "1M", asOf * 1000).amount, -12.5);
});

test("一个有效点不显示成盈利数字，且窗口外的旧点不会回退展示", () => {
  const asOf = Date.UTC(2026, 9, 26) / 1000;
  const onePoint = buildWalletPnlView([{ timestamp: asOf, tradePnl: 0 }], "1W", asOf * 1000);
  assert.equal(onePoint.points.length, 1);
  assert.equal(onePoint.amount, null);

  const stale = buildWalletPnlView([{ timestamp: asOf - 30 * 24 * hour, tradePnl: 18 }], "1D", asOf * 1000);
  assert.equal(stale.points.length, 0);
  assert.equal(stale.amount, null);
});

test("一个月窗口使用30天展示范围和31天短历史阈值", () => {
  const asOf = Date.UTC(2026, 9, 26) / 1000;
  const points = [
    { timestamp: asOf - 30 * 24 * hour, tradePnl: 10 },
    { timestamp: asOf, tradePnl: 13 },
  ];
  const under31Days = buildWalletPnlView(points, "1M", asOf * 1000, asOf - 30 * 24 * hour);
  assert.equal(under31Days.absolute, true);
  assert.equal(under31Days.amount, 13);

  const exactly31Days = buildWalletPnlView(points, "1M", asOf * 1000, asOf - 31 * 24 * hour);
  assert.equal(exactly31Days.absolute, false);
  assert.equal(exactly31Days.amount, 3);
});

test("YTD使用本地年初并保留合法零盈亏", () => {
  const asOf = Date.UTC(2026, 9, 26, 0, 0, 0);
  const view = buildWalletPnlView([
    { timestamp: Date.UTC(2025, 11, 31) / 1000, tradePnl: 8 },
    { timestamp: Date.UTC(2026, 0, 1) / 1000, tradePnl: 8 },
    { timestamp: Date.UTC(2026, 9, 26) / 1000, tradePnl: 8 },
  ], "YTD", asOf);
  assert.equal(view.amount, 0);
  assert.equal(view.points.length, 2);
});

test("无效采样点被丢弃而不是转换成零", () => {
  const view = buildWalletPnlView([
    { timestamp: 0, tradePnl: 3 },
    { timestamp: 1, tradePnl: Number.NaN },
    { timestamp: 2, tradePnl: 0 },
  ], "ALL", 2_000);
  assert.equal(view.points.length, 1);
  assert.equal(view.amount, null);
});

test("采样精度按历史长度和官方目标点数选择", () => {
  const asOf = Date.UTC(2026, 9, 26);
  const day = 24 * 60 * 60 * 1000;
  assert.deepEqual(chooseWalletPnlQuery("1D", asOf / 1000 - 24 * hour, asOf), { interval: "1d", fidelity: "1h" });
  assert.deepEqual(chooseWalletPnlQuery("1W", asOf / 1000 - 7 * 24 * hour, asOf), { interval: "1w", fidelity: "3h" });
  assert.deepEqual(chooseWalletPnlQuery("1M", asOf / 1000 - 10 * day / 1000, asOf), { interval: "all", fidelity: "12h" });
  assert.deepEqual(chooseWalletPnlQuery("1M", asOf / 1000 - 31 * day / 1000, asOf), { interval: "1m", fidelity: "18h" });
  assert.deepEqual(chooseWalletPnlQuery("ALL", asOf / 1000 - 60 * day / 1000, asOf), { interval: "all", fidelity: "1d" });
});

test("非均匀采样按时间寻找最近点，曲线几何使用真实时间轴", () => {
  const points = [
    { timestamp: 1, tradePnl: 1 },
    { timestamp: 11, tradePnl: 5 },
    { timestamp: 101, tradePnl: 2 },
  ];
  const view = buildWalletPnlView(points, "ALL", 101_000);
  assert.equal(nearestWalletPnlPointIndex(view.points, 0.1), 1);
  const geometry = buildWalletPnlChartGeometry(view);
  assert.ok(geometry);
  assert.ok(geometry.points[2].x - geometry.points[1].x > geometry.points[1].x - geometry.points[0].x);
  assert.match(geometry.linePath, /^M /);
});

test("金额格式化不显示负零", () => {
  assert.equal(formatWalletPnlUsd(-0), "$0.00");
  assert.equal(formatWalletPnlUsd(0), "$0.00");
  assert.equal(formatWalletPnlUsd(-1.236), "−$1.24");
});

test("响应合同拒绝串账户和串采样参数，支持集合由服务端决定", () => {
  const base = { executionAccountId: "main" as const, interval: "1w" as const, fidelity: "3h" as const };
  assert.equal(isOfficialWalletPnlResponse(base, base), true);
  assert.equal(isOfficialWalletPnlResponse({ ...base, executionAccountId: "wallet-1" }, base), false);
  assert.equal(isOfficialWalletPnlResponse({ ...base, fidelity: "1d" }, base), false);
  assert.equal(isOfficialWalletPnlResponse({ ...base, executionAccountId: "wallet-9" }, { ...base, executionAccountId: "wallet-9" }), true);
});

test("重复采样点必须一致，冲突点不能静默覆盖", () => {
  assert.throws(() => buildWalletPnlView([
    { timestamp: 1, tradePnl: 1 },
    { timestamp: 1, tradePnl: 2 },
  ], "ALL", 1_000), /冲突的重复时间点/);
});

// Custom windows are financial differences on the same official cumulative series.
import { buildCustomWalletPnlView, validateWalletPnlRange, walletPnlLocalDate } from "../app/lib/wallet-pnl.ts";

test("自定义本地日界包含结束全天，基准和轴保持真实前置采样时间", () => {
  const previous = process.env.TZ; process.env.TZ = "Asia/Shanghai";
  try {
    const now = Date.parse("2026-11-04T10:00:00Z");
    const parsed = validateWalletPnlRange("2026-10-31", "2026-11-02", now);
    assert.ok(parsed.range);
    assert.equal(parsed.range.startMs, Date.parse("2026-10-30T16:00:00Z"));
    assert.equal(parsed.range.endExclusiveMs, Date.parse("2026-11-02T16:00:00Z"));
    const point = (time: string, tradePnl: number) => ({ timestamp: Date.parse(time) / 1000, tradePnl });
    const view = buildCustomWalletPnlView([
      point("2026-10-30T00:00:00Z", -200),
      point("2026-10-31T00:00:00Z", -190),
      point("2026-11-01T00:00:00Z", -205),
      point("2026-11-02T00:00:00Z", -180),
      point("2026-11-02T16:00:00Z", 900), // next local day is excluded
    ], parsed.range, now);
    assert.equal(view.amount, 20);
    assert.equal(view.baseline, -200);
    assert.equal(view.absolute, false);
    assert.deepEqual(view.points.map((item) => item.value), [0, 10, -5, 20]);
    assert.equal(view.startAt, Date.parse("2026-10-30T00:00:00Z") / 1000);
    assert.equal(view.partialHistory, false);
    assert.equal(view.points[2].value, -5, "hover points must use the same baseline");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("自定义短历史必须计算差额，历史缺口显示实际覆盖；没有区间新点不伪零", () => {
  const now = new Date(2026, 10, 4, 12).getTime();
  const parsed = validateWalletPnlRange("2026-10-01", "2026-11-04", now);
  assert.ok(parsed.range);
  const first = new Date(2026, 10, 1).getTime() / 1000;
  const second = new Date(2026, 10, 3).getTime() / 1000;
  const points = [{ timestamp: first, tradePnl: -100 }, { timestamp: second, tradePnl: -110 }];
  const view = buildCustomWalletPnlView(points, parsed.range, now);
  assert.equal(view.amount, -10);
  assert.equal(view.partialHistory, true);
  assert.equal(view.startAt, first);
  const afterHistory = validateWalletPnlRange("2026-11-04", "2026-11-04", now);
  assert.ok(afterHistory.range);
  const missing = buildCustomWalletPnlView(points, afterHistory.range, now);
  assert.equal(missing.amount, null);
  assert.equal(missing.points.length, 1);
  assert.equal(buildCustomWalletPnlView([], parsed.range, now).amount, null);
  assert.equal(buildCustomWalletPnlView(points.slice(0, 1), parsed.range, now).amount, null);
});

test("自定义日期拒绝缺失、非法闰日、倒序和未来，跨年同日及DST按本地日历", () => {
  const previous = process.env.TZ; process.env.TZ = "America/New_York";
  try {
    const now = new Date(2026, 10, 4, 12).getTime();
    for (const [start, end] of [["", "2026-01-01"], ["2026-02-29", "2026-03-01"], ["2026-11-03", "2026-11-02"], ["2026-11-04", "2026-11-05"], ["2026-1-1", "2026-01-02"]]) assert.ok(validateWalletPnlRange(start, end, now).error, `${start}/${end}`);
    const dst = validateWalletPnlRange("2026-11-01", "2026-11-01", now);
    assert.ok(dst.range);
    assert.equal(dst.range.endExclusiveMs - dst.range.startMs, 25 * 3_600_000);
    const year = validateWalletPnlRange("2025-12-31", "2026-01-01", now);
    assert.ok(year.range);
    assert.equal(year.range.endExclusiveMs - year.range.startMs, 48 * 3_600_000);
    assert.equal(walletPnlLocalDate(Date.parse("2026-11-04T02:00:00Z")), "2026-11-03");
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("自定义今日范围不把接口观测之后样本纳入，也不插值财务金额", () => {
  const now = new Date(2026, 10, 4, 10).getTime();
  const parsed = validateWalletPnlRange("2026-11-04", "2026-11-04", now);
  assert.ok(parsed.range);
  const view = buildCustomWalletPnlView([
    { timestamp: (parsed.range.startMs - 3_600_000) / 1000, tradePnl: 5 },
    { timestamp: (parsed.range.startMs + 3_600_000) / 1000, tradePnl: 8 },
    { timestamp: (now + 3_600_000) / 1000, tradePnl: 100 },
  ], parsed.range, now);
  assert.equal(view.amount, 3);
  assert.equal(view.points.length, 2);
  assert.equal(view.points[0].value, 0);
});
