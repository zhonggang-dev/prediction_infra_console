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

// Custom hourly windows use original upstream grid values and an independent chart domain.
import { buildCustomWalletPnlView, validateWalletPnlRange, walletPnlLocalDate, walletPnlLocalHour, walletPnlHourCandidates, chooseCustomWalletPnlQuery } from "../app/lib/wallet-pnl.ts";

function withTimezone(zone: string, action: () => void) { const previous = process.env.TZ; process.env.TZ = zone; try { action(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; } }

test("小时范围金额与选择域一致，域外基准不画入或参与悬停", () => withTimezone("Asia/Shanghai", () => {
  const now = Date.parse("2026-11-04T10:00:00Z"), parsed = validateWalletPnlRange("2026-10-29T10:00", "2026-11-02T15:00", now);
  assert.ok(parsed.range); const range = parsed.range;
  assert.equal(range.startMs, Date.parse("2026-10-29T02:00:00Z"));
  assert.equal(range.endMs, Date.parse("2026-11-02T07:00:00Z"));
  assert.equal(range.startOffset, "UTC+08:00");
  const points = Array.from({ length: 104 }, (_, i) => ({ timestamp: range.startMs / 1000 + (i - 1) * hour, tradePnl: -200 + i, sourceBlock: "123" }));
  const view = buildCustomWalletPnlView(points, range, now);
  assert.equal(view.amount, 101); assert.equal(view.absolute, false);
  assert.equal(view.startAt, range.startMs / 1000); assert.equal(view.endAt, range.endMs / 1000);
  assert.ok(view.points.every(p => p.timestamp >= range.startMs / 1000 && p.timestamp <= range.endMs / 1000));
  assert.equal(view.points[0].value, 0); assert.equal(view.points.at(-1)?.value, 101);
  const geometry = buildWalletPnlChartGeometry(view)!;
  assert.equal(geometry.domainStartAt, range.startMs / 1000); assert.equal(geometry.domainEndAt, range.endMs / 1000);
  assert.match(geometry.linePath, / C /); assert.doesNotMatch(geometry.linePath, / H | V /);
  assert.equal(nearestWalletPnlPointIndex(view.points, 0, { startAt: view.startAt!, endAt: view.endAt! }), 0);
}));

test("单个域内点可绘制，外部基准仅用于差额；缺边界覆盖保持未知", () => withTimezone("Asia/Shanghai", () => {
  const now = Date.parse("2026-11-04T10:00:00Z"), parsed = validateWalletPnlRange("2026-11-02T10:00", "2026-11-02T11:00", now);
  assert.ok(parsed.range); const range = parsed.range;
  const before = { timestamp: range.startMs / 1000 - hour / 2, tradePnl: -20 };
  const inside = { timestamp: range.endMs / 1000 - hour / 2, tradePnl: -17 };
  const view = buildCustomWalletPnlView([before, inside], range, now);
  assert.equal(view.amount, 3); assert.equal(view.points.length, 1); assert.equal(view.points[0].timestamp, inside.timestamp);
  assert.equal(view.baselineAt, before.timestamp);
  const geometry = buildWalletPnlChartGeometry(view)!; assert.equal(geometry.points.length, 1); assert.equal(geometry.areaPath, "");
  assert.ok(geometry.points[0].x > geometry.left && geometry.points[0].x < geometry.left + geometry.plotWidth);
  assert.equal(nearestWalletPnlPointIndex([{ timestamp: 100 }, { timestamp: 150 }], 0.75, { startAt: 0, endAt: 200 }), 1);
  assert.equal(buildCustomWalletPnlView([inside], range, now).amount, null);
  assert.equal(buildCustomWalletPnlView([{ ...before, timestamp: range.startMs / 1000 - 2 * hour }, inside], range, now).amount, null);
  assert.equal(buildCustomWalletPnlView([before], range, now).amount, null);
}));

test("官方小时同值允许0，不以来源区块重复或源精度日级误判缺数据", () => withTimezone("Asia/Shanghai", () => {
  const now = Date.parse("2026-11-04T10:00:00Z"), parsed = validateWalletPnlRange("2026-11-02T10:00", "2026-11-02T12:00", now);
  assert.ok(parsed.range); const range = parsed.range;
  const pts = [0, 1, 2].map(i => ({ timestamp: range.startMs / 1000 + i * hour, tradePnl: -10, sourceBlock: "42" }));
  assert.equal(buildCustomWalletPnlView(pts, range, now).amount, 0);
  assert.equal(buildCustomWalletPnlView([], range, now).amount, null);
  assert.equal(buildCustomWalletPnlView(pts.slice(0, 1), range, now).amount, null);
  assert.equal(buildCustomWalletPnlView(pts, range, range.startMs).amount, null);
}));

test("小时输入拒绝未来/倒序/非整点，DST缺失与重复小时明确偏移", () => withTimezone("America/New_York", () => {
  const now = Date.parse("2026-11-04T15:30:00Z");
  for (const [start, end] of [["", "2026-01-01T00:00"], ["2026-02-29T00:00", "2026-03-01T00:00"], ["2026-11-03T01:00", "2026-11-02T01:00"], ["2026-11-04T10:00", "2026-11-04T11:00"], ["2026-11-02T01:30", "2026-11-02T02:00"], ["2026-03-08T02:00", "2026-03-08T03:00"]]) assert.ok(validateWalletPnlRange(start, end, now).error, `${start}/${end}`);
  const repeated = walletPnlHourCandidates("2026-11-01T01:00"); assert.equal(repeated.length, 2);
  assert.ok(validateWalletPnlRange("2026-11-01T01:00", "2026-11-01T02:00", now).error);
  const first = validateWalletPnlRange("2026-11-01T01:00", "2026-11-01T02:00", now, { startMs: repeated[0] });
  const second = validateWalletPnlRange("2026-11-01T01:00", "2026-11-01T02:00", now, { startMs: repeated[1] });
  assert.ok(first.range && second.range); assert.equal(first.range.endMs - first.range.startMs, 2 * hour * 1000); assert.equal(second.range.endMs - second.range.startMs, hour * 1000);
  assert.equal(first.range.startOffset, "UTC−04:00"); assert.equal(second.range.startOffset, "UTC−05:00");
  assert.equal(walletPnlLocalDate(Date.parse("2026-11-04T02:00:00Z")), "2026-11-03");
  assert.equal(walletPnlLocalHour(Date.parse("2026-11-04T02:47:00Z")), "2026-11-03T21:00");
}));

test("自定义区间与 Kalshi 一样复用快捷周期请求：1天1h、7天3h、30天18h、更早1d", () => withTimezone("Asia/Shanghai", () => {
  const now = Date.parse("2026-11-04T10:00:00Z"), history = Date.parse("2026-03-01T00:00:00Z") / 1000;
  const make = (start: string) => { const parsed = validateWalletPnlRange(start, "2026-11-04T17:00", now); assert.ok(parsed.range); return parsed.range; };
  const choose = (start: string) => chooseCustomWalletPnlQuery(make(start), now, history);
  assert.deepEqual(choose("2026-11-04T10:00"), { interval: "1d", fidelity: "1h" });
  assert.deepEqual(choose("2026-11-01T10:00"), { interval: "1w", fidelity: "3h" });
  assert.deepEqual(choose("2026-10-10T10:00"), { interval: "1m", fidelity: "18h" });
  assert.deepEqual(choose("2026-08-10T10:00"), { interval: "all", fidelity: "1d" });
  // 与快捷周期请求完全相同。
  for (const [start, period] of [["2026-11-04T10:00", "1D"], ["2026-11-01T10:00", "1W"], ["2026-10-10T10:00", "1M"], ["2026-08-10T10:00", "ALL"]] as const) assert.deepEqual(choose(start), chooseWalletPnlQuery(period, history, now));
  // 每档预留一个采样步长给起点前的基线：北京时间 = UTC+8，now = 11-04 18:00。
  assert.deepEqual(choose("2026-11-03T19:00"), { interval: "1d", fidelity: "1h" });
  assert.deepEqual(choose("2026-11-03T18:00"), { interval: "1w", fidelity: "3h" });
  assert.deepEqual(choose("2026-10-28T21:00"), { interval: "1w", fidelity: "3h" });
  assert.deepEqual(choose("2026-10-28T20:00"), { interval: "1m", fidelity: "18h" });
  assert.deepEqual(choose("2026-10-06T12:00"), { interval: "1m", fidelity: "18h" });
  assert.deepEqual(choose("2026-10-06T11:00"), { interval: "all", fidelity: "1d" });
}));

test("粗网格自定义区间：边界不在3h网格点上标记近似，短于一个步长提示采样间隔", () => withTimezone("UTC", () => {
  const now = Date.parse("2026-11-04T10:00:00Z"), step = 3 * hour;
  const mk = (start: string, end: string) => { const parsed = validateWalletPnlRange(start, end, now); assert.ok(parsed.range); return parsed.range; };
  const pts = Array.from({ length: 9 }, (_, i) => ({ timestamp: Date.parse("2026-11-02T00:00:00Z") / 1000 + i * step, tradePnl: i }));
  const exact = buildCustomWalletPnlView(pts, mk("2026-11-02T03:00", "2026-11-02T12:00"), now, step);
  assert.equal(exact.amount, 3); assert.equal(exact.approximate, false);
  const approx = buildCustomWalletPnlView(pts, mk("2026-11-02T04:00", "2026-11-02T13:00"), now, step);
  assert.equal(approx.amount, 3); assert.equal(approx.approximate, true);
  const short = buildCustomWalletPnlView(pts, mk("2026-11-02T04:00", "2026-11-02T06:00"), now, step);
  assert.equal(short.amount, null); assert.match(short.error ?? "", /采样间隔为3小时/);
}));

test("日网格自定义区间：容差放宽到一天，边界不在采样点上标记近似，不足一天报仅有每日数据", () => withTimezone("Asia/Shanghai", () => {
  const now = Date.parse("2026-11-04T10:00:00Z"), day = 86_400;
  const mk = (start: string, end: string) => { const parsed = validateWalletPnlRange(start, end, now); assert.ok(parsed.range); return parsed.range; };
  const utcMidnight = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
  const pts = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"].map((d, i) => ({ timestamp: utcMidnight(d), tradePnl: -10 * i }));
  // 起止恰好落在日采样点（北京时间 08:00 = UTC 00:00）：精确，不近似。
  const exact = buildCustomWalletPnlView(pts, mk("2026-08-02T08:00", "2026-08-05T08:00"), now, day);
  assert.equal(exact.amount, -30); assert.equal(exact.approximate, false); assert.equal(exact.error, undefined);
  // 起点在采样点之后 6 小时：采用此前采样点，标记近似；终点同理。
  const approx = buildCustomWalletPnlView(pts, mk("2026-08-02T14:00", "2026-08-05T14:00"), now, day);
  assert.equal(approx.amount, -30); assert.equal(approx.approximate, true); assert.equal(approx.baselineAt, utcMidnight("2026-08-02"));
  // 用小时容差时同一输入拿不到基线（证明容差确实随网格放宽）。
  assert.equal(buildCustomWalletPnlView(pts, mk("2026-08-02T14:00", "2026-08-05T14:00"), now, 3600).amount, null);
  // 不足一天且不精确：给出明确原因，而不是用日线冒充小时收益。
  const short = buildCustomWalletPnlView(pts, mk("2026-08-02T10:00", "2026-08-02T20:00"), now, day);
  assert.equal(short.amount, null); assert.match(short.error ?? "", /每日数据/);
  // 终点之后超过一个网格没有数据：仍视为缺采样。
  assert.equal(buildCustomWalletPnlView(pts.slice(0, 2), mk("2026-08-01T08:00", "2026-08-04T08:00"), now, day).amount, null);
  // 小时网格不产生近似标记。
  const hourly = mk("2026-11-02T10:00", "2026-11-02T12:00");
  const hp = [0, 1, 2].map(i => ({ timestamp: hourly.startMs / 1000 + i * hour, tradePnl: i }));
  assert.equal(buildCustomWalletPnlView(hp, hourly, now).approximate, false);
}));

