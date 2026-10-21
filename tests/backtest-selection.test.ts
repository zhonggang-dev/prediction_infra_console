import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeCatalogItem, decodeEngine, decodeParamDef, decodeResult, decodeRun, type CatalogItem } from "../app/lib/backtest-platform.ts";
import {
  ALL_DOMAINS, addNanoseconds, applyCombo, beijingDate, buildWindow, coverageWarnings, datasetConflict, datasetInfo, defaultDates, deriveCombos, domainState, domainsPayload, formatBeijing,
  keepSingleDataset, modelInfo, modelLabel, modelsCoveringWindow, parseInstant, strategyDomainPlan, strategyInfo, strictModelIntersection, tagLabel,
} from "../app/lib/backtest-selection.ts";
import { initialParamValues, isVisible, paramsPayload, parseNumberList, validateParams } from "../app/lib/backtest-params.ts";
import { validateIdentity } from "../app/lib/backtest-submit.ts";
import { alignPnlSeries, badgeTone, defaultSelection, formatCell, matchesFilters, matchesWhen, nextSort, pinColumns, pushClicked, rankNumbers, searchRows, sortRows, sortValue, toCsv } from "../app/lib/backtest-table.ts";
import { compareResults, diffFlat, diffRuns, flatten } from "../app/lib/backtest-compare.ts";

const dir = new URL("./fixtures/backtest/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const items = (name: string): CatalogItem[] => fixture(name).data.items.map(decodeCatalogItem);
const models = items("catalog-models.json").map(modelInfo);
const datasets = items("catalog-datasets.json").map(datasetInfo);
const strategies = items("catalog-strategies.json").map(strategyInfo);
const model = (key: string) => models.find((m) => m.key === key)!;

// ───────────────────────── 时间 ─────────────────────────

test("时间解析保留纳秒，+1ns 进位后仍按北京时间格式化", () => {
  const a = parseInstant("2026-08-31T21:00:34.250+08:00")!;
  assert.equal(formatBeijing(a), "2026-08-31T21:00:34.25+08:00");
  assert.equal(formatBeijing(addNanoseconds(a, 1)), "2026-08-31T21:00:34.250000001+08:00");
  assert.equal(formatBeijing(addNanoseconds(parseInstant("2026-08-31T21:00:34.999999999+08:00")!, 1)), "2026-08-31T21:00:35+08:00");
  assert.equal(formatBeijing(parseInstant("2026-08-31T13:00:00Z")!), "2026-08-31T21:00:00+08:00");
  assert.equal(beijingDate("2026-08-31T20:00:00Z"), "2026-09-01", "UTC 晚间在北京已是次日");
  assert.equal(parseInstant("2026-08-31", )?.sec, Date.parse("2026-08-31T00:00:00+08:00") / 1000, "无时区按北京时间");
  assert.equal(parseInstant("garbage"), undefined);
});

test("公共时间区间：max(start) → min(end)+1ns（右开），无交集报错（registry.strict_model_intersection）", () => {
  assert.deepEqual(strictModelIntersection([model("pswarm_v2"), model("price50_subset")]), { start: "2026-08-10T00:00:00+08:00", endExclusive: "2026-08-31T21:00:34.250000001+08:00" });
  assert.throws(() => strictModelIntersection([model("min_r2_1"), model("legacy_gbm_1")]), /没有交集/);
  assert.throws(() => strictModelIntersection([]), /请先选择/);
});

test("一键选全量覆盖：start ≤ 窗口开始，窗口结束 ≤ end + 1 天（registry.models_covering_window）", () => {
  const covering = modelsCoveringWindow(models.filter((m) => !m.marketView), { start: "2026-08-10T00:00:00+08:00", endExclusive: "2026-08-31T00:00:00+08:00" }).map((m) => m.key);
  assert.ok(covering.includes("pswarm_v2") && covering.includes("price50_subset"));
  assert.ok(!covering.includes("echo"), "echo 的 end+1 天是 08-30 10:00，不够覆盖到 08-31");
  assert.ok(!covering.includes("live_alpha"), "live_alpha 从 08-12 才开始");
  assert.ok(!covering.includes("legacy_gbm_1"), "旧管线模型在 08-19 就结束");
  assert.ok(!covering.includes("team_04@v2/p4"), "team_04 的预测在 08-25 结束");
  assert.deepEqual(modelsCoveringWindow(models, { start: "2026-08-10T00:00:00+08:00", endExclusive: "2026-08-10T00:00:00+08:00" }), [], "空窗口不选任何模型");
  // end + 1 天的边界：echo 的 end 是 08-29 10:00，窗口结束 08-30 10:00 刚好满足
  assert.ok(modelsCoveringWindow([model("echo")], { start: "2026-08-09T00:00:00+08:00", endExclusive: "2026-08-30T10:00:00+08:00" }).length === 1);
  assert.ok(modelsCoveringWindow([model("echo")], { start: "2026-08-09T00:00:00+08:00", endExclusive: "2026-08-30T10:00:01+08:00" }).length === 0);
});

test("默认日期与覆盖警告（app.py _date_defaults / _coverage_warnings）", () => {
  assert.deepEqual(defaultDates([model("echo"), model("pswarm_v2")], models), { startDate: "2026-08-07", endDate: "2026-09-01" }, "最早 start 日 → 最晚 end 日 + 1");
  assert.deepEqual(defaultDates([], models), { startDate: "2026-07-01", endDate: "2026-09-05" });
  const noOverlap = coverageWarnings([model("legacy_gbm_1")], { start: "2026-08-25T00:00:00+08:00", endExclusive: "2026-08-30T00:00:00+08:00" }, false);
  assert.match(noOverlap[0], /无交集，曲线会是空的/);
  const partial = coverageWarnings([model("echo")], { start: "2026-08-01T00:00:00+08:00", endExclusive: "2026-08-20T00:00:00+08:00" }, false);
  assert.match(partial[0], /只覆盖/);
  assert.deepEqual(coverageWarnings([model("echo")], { start: "2026-08-01T00:00:00+08:00", endExclusive: "2026-08-20T00:00:00+08:00" }, true), [], "公共区间模式不报部分覆盖");
  assert.deepEqual(buildWindow({ startDate: "2026-08-07", endDate: "2026-08-31" }), { start: "2026-08-07T00:00:00+08:00", endExclusive: "2026-08-31T00:00:00+08:00", align: "natural_day" });
  assert.equal(buildWindow({ startDate: "x", endDate: "y" }, { start: "a", endExclusive: "b" }).align, "strict_common");
});

// ───────────────────────── combo / 数据集冲突 ─────────────────────────

test("按标签一键加入：每个数据集 × 标签一个组合，并入而不是替换", () => {
  const pool = models.filter((m) => !m.marketView);
  const combos = deriveCombos(pool, datasets);
  const labels = combos.map((c) => c.label);
  assert.ok(labels.includes("正式·Telonex·沙盒"));
  assert.ok(labels.includes("正式·Telonex·沙盒子集"));
  assert.ok(labels.includes("正式·Telonex·实盘子集"));
  assert.ok(labels.includes("正式·Telonex·最小子集 2026-10-15"));
  assert.ok(labels.includes("正式·Telonex·最小子集 2026-11-15"));
  assert.ok(labels.includes("临时数据·沙盒"));
  assert.ok(labels.includes("正式·本地·老管线"));
  assert.ok(!labels.some((l) => l.startsWith("正式·本地·沙盒")), "没有命中的组合不出现");

  const sandbox = combos.find((c) => c.label === "正式·Telonex·沙盒")!;
  const subset = combos.find((c) => c.label === "正式·Telonex·沙盒子集")!;
  const first = applyCombo([], pool, sandbox);
  assert.ok(first.selected.includes("pswarm_v2") && first.selected.includes("team_01@v2/p1") && first.selected.includes("team_01@v2/p21"), "同一个 model_id 的两个版本是两个选项");
  assert.ok(!first.selected.includes("pswarm_v2_subset"), "「沙盒」不含子集 / 实盘子集 / 最小子集");
  assert.ok(!first.selected.some((k) => k.startsWith("min_r")));
  const merged = applyCombo(["echo"], pool, subset);
  assert.deepEqual(merged.selected.filter((k) => ["echo", "pswarm_v2_subset", "price50_subset"].includes(k)).length, 3, "与原有选择取并集");
  assert.equal(merged.selected[merged.selected.length - 1] !== undefined, true);
  const none = applyCombo([], pool.filter((m) => m.dataset !== "telonex"), subset);
  assert.match(none.error ?? "", /没有可选模型/);
  assert.equal(applyCombo(first.selected, pool, sandbox).added, 0, "重复加入不新增");
});

test("混用数据集：提示冲突；只保留某一套并补回该数据集的 market-view（_keep_single_dataset）", () => {
  const selected = ["market_favorite_tmp", "pswarm_v2", "echo"];
  const conflict = datasetConflict(selected, models, datasets);
  assert.deepEqual(conflict?.datasets.map((d) => [d.key, d.count]).sort(), [["mjj_tmp", 2], ["telonex", 1]]);
  assert.match(conflict?.message ?? "", /一次运行不能混用数据集/);
  assert.equal(datasetConflict(["pswarm_v2", "price50_subset"], models, datasets), undefined);
  const kept = keepSingleDataset(selected, models, "telonex", datasets);
  assert.deepEqual(kept.sort(), ["market_favorite_telonex", "pswarm_v2"].sort(), "tmp 的 market-view 被丢掉后补回 telonex 自己的那张");
  const keptTmp = keepSingleDataset(selected, models, "mjj_tmp", datasets);
  assert.deepEqual(keptTmp.sort(), ["echo", "market_favorite_tmp"].sort());
  assert.deepEqual(keepSingleDataset(["pswarm_v2", "echo"], models, "telonex", datasets), ["pswarm_v2"], "原选择没有 market-view 就不补");
});

test("模型选项文案：名称、覆盖区间、数据集标签、标签", () => {
  const label = modelLabel(model("live_alpha"), { telonex: "正式·Telonex" });
  assert.match(label, /^live_alpha \(2026-08-12 00:00 → 2026-09-03 00:00\) · 正式·Telonex · 沙盒 · 实盘子集$/);
  assert.equal(tagLabel("min_subset:2026-10-15"), "最小子集 2026-10-15");
  assert.equal(model("live_alpha").cacheStale, true);
});

// ───────────────────────── Domain / 策略 ─────────────────────────

test("Domain 校验：All 与具体域互斥、空选、排除全部（Trading / Benchmark 两版）", () => {
  const all = ["Crypto", "Politics", "World"];
  assert.equal(domainState({ mode: "include", values: [ALL_DOMAINS] }, all).blocked, false);
  assert.match(domainState({ mode: "include", values: [ALL_DOMAINS, "World"] }, all).error ?? "", /不能与具体 domain 同时选择/);
  assert.match(domainState({ mode: "include", values: [] }, all).warning ?? "", /至少选择一个/);
  assert.match(domainState({ mode: "exclude", values: all }, all).error ?? "", /排除了全部 domain/);
  assert.equal(domainState({ mode: "exclude", values: ["Crypto"] }, all).summary, "All domains − Crypto");
  assert.deepEqual(domainsPayload({ mode: "include", values: [ALL_DOMAINS] }), { mode: "include", values: ["all"] });
  assert.deepEqual(domainsPayload({ mode: "exclude", values: ["Crypto"] }), { mode: "exclude", values: ["Crypto"] });
});

test("策略 validated_domains 收窄；无交集的策略不能运行（R:1381）", () => {
  const mult = strategies.filter((s) => s.validatedDomains);
  assert.equal(mult.length, 3);
  const plan = strategyDomainPlan(mult, { mode: "include", values: [ALL_DOMAINS] });
  assert.equal(plan.empty.length, 0);
  assert.deepEqual(plan.narrowed[0].domains, ["World", "Geopolitics"]);
  const crypto = strategyDomainPlan(mult, { mode: "include", values: ["Crypto"] });
  assert.equal(crypto.empty.length, 3, "两个 W/G 旧策略 + 只在 Politics / Sports 成交的逐时点策略（definition.domains）");
  const mixed = strategyDomainPlan(mult.filter((s) => !s.stepwise), { mode: "include", values: ["World", "Crypto"] });
  assert.deepEqual(mixed.narrowed[0].domains, ["World"]);
  assert.equal(strategies.find((s) => s.key === "price_v4")?.priceOnly, true, "纯价格策略不读模型");
  assert.equal(strategyDomainPlan(strategies.filter((s) => !s.validatedDomains), { mode: "include", values: ["Crypto"] }).empty.length, 0);
});

// ───────────────────────── 参数表单 ─────────────────────────

const engine = decodeEngine(items("catalog-engines.json")[0]);

test("参数默认值来自引擎定义；点号展开为嵌套；引擎定义本身没有条件显示，未经展示规则处理时所有定义的参数都提交", () => {
  const defs = engine.paramDefinitions["trading/strategy_comparison"];
  const values = initialParamValues(defs);
  assert.equal(values["position_sizing.mode"], "native");
  assert.equal(isVisible(defs.find((d) => d.name === "position_sizing.shares")!, values), true, "infra 的参数定义没有 when，登记里不会出现条件显示");
  const all = paramsPayload(defs, values);
  assert.deepEqual(all.position_sizing, { mode: "native", shares: 1, stake: 10 });
  assert.deepEqual(all.bankroll, { mode: "unlimited", amount: 3000 });
  assert.equal(all.scope, "strict");
  assert.equal((all.stepwise as Record<string, unknown>).strategy_params, "{}");
  const finite = { ...values, "bankroll.mode": "finite", "bankroll.amount": "5000", "position_sizing.mode": "fixed_shares", "position_sizing.shares": "2.5" };
  assert.deepEqual(paramsPayload(defs, finite).bankroll, { mode: "finite", amount: 5000 });
  assert.deepEqual(paramsPayload(defs, finite).position_sizing, { mode: "fixed_shares", shares: 2.5, stake: 10 });
});

test("预留的 when 扩展仍然生效（infra 目前不会下发，但解码器与表单保持兼容）", () => {
  const defs = [decodeParamDef({ name: "a.mode", type: "enum", default: "x", choices: ["x", "y"] }), decodeParamDef({ name: "a.n", type: "number", default: 1, when: { "a.mode": "y" } })];
  const values = initialParamValues(defs);
  assert.equal(isVisible(defs[1], values), false);
  assert.deepEqual(paramsPayload(defs, values), { a: { mode: "x" } });
  assert.deepEqual(paramsPayload(defs, { ...values, "a.mode": "y" }), { a: { mode: "y", n: 1 } });
});

test("参数校验：整数范围、τ 开区间、桶边界（中文逗号 / 递增 / 范围）、枚举", () => {
  const x = engine.paramDefinitions["benchmark/fixed_horizon_brier"];
  assert.deepEqual(validateParams(x, { x_days: "7" }), {});
  assert.match(validateParams(x, { x_days: "2" }).x_days, /不小于 3/);
  assert.match(validateParams(x, { x_days: "7.5" }).x_days, /整数/);
  assert.match(validateParams(x, { x_days: "abc" }).x_days, /数字/);
  const tau = engine.paramDefinitions["benchmark/deviation"];
  assert.deepEqual(validateParams(tau, { tau: "0.1" }), {});
  // 执行器把 τ 的开区间 (0, 1) 写成 min 1e-6、max 0.999999 的闭区间下发
  assert.match(validateParams(tau, { tau: "-0.1" }).tau, /不小于 0\.000001/);
  assert.match(validateParams(tau, { tau: "1.5" }).tau, /不大于 0\.999999/);
  assert.deepEqual(validateParams(tau, { tau: "0.5" }), {});
  const buckets = engine.paramDefinitions["benchmark/calibration"];
  assert.deepEqual(parseNumberList("0，0.5、1"), [0, 0.5, 1]);
  assert.deepEqual(validateParams(buckets, { bucket_edges: "0，0.5，1" }), {});
  assert.match(validateParams(buckets, { bucket_edges: "0, 0.5, 0.4, 1" }).bucket_edges, /严格递增/);
  assert.match(validateParams(buckets, { bucket_edges: "0, 1.5" }).bucket_edges, /不大于 1/);
  assert.match(validateParams(buckets, { bucket_edges: "a, b" }).bucket_edges, /数字/);
  assert.deepEqual(paramsPayload(buckets, { bucket_edges: "0, 0.5, 1" }), { bucket_edges: [0, 0.5, 1] });
  const signal = engine.paramDefinitions["benchmark/model_signal"];
  assert.deepEqual(paramsPayload(signal, initialParamValues(signal)), { sample_scope: "full", horizon_h: 24 }, "带 choices 的整数参数提交数字，不是字符串");
  assert.match(validateParams(signal, { sample_scope: "zzz", horizon_h: "24" }).sample_scope, /不在可选范围/);
  assert.match(validateParams(signal, { sample_scope: "full", horizon_h: "25" }).horizon_h, /不在可选范围/);
  assert.deepEqual(validateParams(signal, { sample_scope: "full", horizon_h: "168" }), {});
});

test("提交标识快检：model_id 规则（不含 _pred、__、@）", () => {
  assert.deepEqual(validateIdentity("prediction", ["team_03", "v2", "p3"]), []);
  assert.ok(validateIdentity("prediction", ["Team", "v2", "p3"]).length > 0, "model_id 必须小写");
  assert.match(validateIdentity("prediction", ["a_pred", "v2", "p3"]).join(), /_pred/);
  assert.match(validateIdentity("prediction", ["a__b", "v2", "p3"]).join(), /__/);
  assert.match(validateIdentity("prediction", ["a@b", "v2", "p3"]).join(), /@|字母/);
  assert.match(validateIdentity("prediction", ["a", "v__2", "p3"]).join(), /训练版本/);
  assert.match(validateIdentity("factor_table", ["", "v1"]).join(), /表名不能为空/);
  assert.match(validateIdentity("strategy", ["a/b", "v1"]).join(), /只能含/);
});

// ───────────────────────── 表格 ─────────────────────────

const table = (name: string, sectionId: string) => {
  const section = decodeResult(fixture(name).data.result).sections.find((s) => s.id === sectionId);
  assert.ok(section && section.type === "table");
  return section;
};

test("排序：空值永远排最后；文本格带 sort 值；点表头方向取该列最优在前", () => {
  const main = table("run-btr-20261019-ovrvw001.json", "main");
  const brier = main.columns.find((c) => c.key === "brier")!;
  const asc = sortRows(main.columns, main.rows, { key: "brier", direction: "asc" });
  assert.equal(asc[0].model, "Market");
  const tte = sortRows(main.columns, main.rows, { key: "fixed_tte", direction: "asc" });
  assert.equal(tte[tte.length - 1].model, "team_01__v2__p1", "空值排最后");
  const tteDesc = sortRows(main.columns, main.rows, { key: "fixed_tte", direction: "desc" });
  assert.equal(tteDesc[tteDesc.length - 1].model, "team_01__v2__p1", "降序时空值也排最后");
  const strategy = sortRows(main.columns, main.rows, { key: "strategy_baseline", direction: "desc" });
  const sortOf = (row: Record<string, unknown>) => (row.strategy_baseline as { sort: number | null }).sort;
  const expectedTop = [...main.rows].filter((r) => sortOf(r) !== null).sort((x, y) => (sortOf(y) as number) - (sortOf(x) as number))[0];
  assert.equal(strategy[0].model, expectedTop.model, "策略列按 sort 数值排序，而不是按三行文本");
  assert.equal(sortValue(main.columns.find((c) => c.key === "strategy_baseline")!, { text: "+1.00", sort: 1 }), 1);
  assert.equal(sortValue(main.columns.find((c) => c.key === "signal_ic")!, { text: "不适用", sort: null }), null);
  assert.deepEqual(nextSort(main.columns, undefined, "brier"), { key: "brier", direction: "asc" });
  assert.deepEqual(nextSort(main.columns, { key: "brier", direction: "asc" }, "brier"), { key: "brier", direction: "desc" });
  assert.deepEqual(nextSort(main.columns, { key: "brier", direction: "asc" }, "deviation"), { key: "deviation", direction: "desc" });
  assert.deepEqual(nextSort(main.columns, undefined, "model"), { key: "model", direction: "asc" });
  assert.equal(brier.best, "low");
});

test("点击列固定在首列之后（最近点击优先）；排名号随排序、空值无号", () => {
  const main = table("run-btr-20261019-ovrvw001.json", "main");
  const clicked = pushClicked(pushClicked([], "ece"), "brier");
  assert.deepEqual(clicked, ["brier", "ece"]);
  assert.deepEqual(pinColumns(main.columns, clicked).slice(0, 3).map((c) => c.key), ["model", "brier", "ece"]);
  assert.equal(pinColumns(main.columns, []), main.columns);
  const sorted = sortRows(main.columns, main.rows, { key: "fixed_tte", direction: "asc" });
  const ranks = rankNumbers(main.columns, sorted, { key: "fixed_tte", direction: "asc" });
  assert.equal(ranks[0], 1);
  assert.equal(ranks[ranks.length - 1], null);
});

test("单元格格式：未知显示 —，百分点 / 小数百分比、区间、徽章色调", () => {
  const trading = table("run-btr-20261019-trade001.json", "metrics_main");
  const col = (key: string) => trading.columns.find((c) => c.key === key)!;
  assert.equal(formatCell(col("pnl"), 180.5), "+$180.50");
  assert.equal(formatCell(col("pnl"), -48), "-$48.00", "符号在前缀之前");
  assert.equal(formatCell(col("pnl"), -0.001), "$0.00", "舍入为 0 不带负号");
  assert.equal(formatCell(col("pnl"), null), "—");
  assert.equal(formatCell(col("return_pct"), 12.345), "+12.35%");
  assert.equal(formatCell({ ...col("return_pct"), fraction: true, signed: false }, 0.1234), "12.34%");
  assert.equal(formatCell(col("sharpe"), [0.4, 2.4, 1.4]), "+1.40  [+0.40, +2.40]");
  assert.equal(formatCell(col("ir"), { lower: -0.3, upper: 2.1 }), "[-0.30, +2.10]");
  assert.equal(formatCell(col("sharpe"), null), "—");
  assert.equal(formatCell(col("writeoff"), { text: "$12.40 (占|总PnL| 6.9%)", sort: 12.4 }), "$12.40 (占|总PnL| 6.9%)");
  assert.equal(badgeTone("更准"), "good");
  assert.equal(badgeTone({ text: "x", tone: "bad" }), "bad");
  assert.equal(badgeTone("分不出"), "warn");
});

test("搜索按屏幕文本；CSV 所见即所得并转义", () => {
  const brier = table("run-btr-20261019-brier001.json", "metrics");
  assert.ok(searchRows(brier.columns, brier.rows, "pswarm").every((r) => String(r.model).includes("pswarm")));
  const csv = toCsv(brier.columns, brier.rows.slice(0, 2));
  const lines = csv.split("\r\n");
  assert.ok(csv.startsWith("﻿模型,已结算市场数,市场等权Brier,区间,对Market差,与Market比,提示"));
  assert.match(lines[1], /^Market,842,0\.19/, "数字按列精度舍入后输出为数字");
  const quoted = toCsv([{ key: "a", label: "a,b", kind: "text", sortable: true }], [{ a: 'x"y,z' }]);
  assert.match(quoted, /"a,b"\r\n"x""y,z"/);
  assert.match(toCsv([{ key: "a", label: "a", kind: "number", sortable: true }], [{ a: null }]), /a\r\n\r\n/, "空值导出为空，不是 0");
});

test("结果级 / 区块级筛选：只看对象自己的 filters；缺该 key 则不受约束，数组表示多档适用", () => {
  const brier = table("run-btr-20261019-brier001.json", "metrics");
  const result = decodeResult(fixture("run-btr-20261019-brier001.json").data.result);
  const selection = defaultSelection(result.filters);
  assert.deepEqual(selection, { odds_scope: "all", ci_level: "95" });
  const shown = brier.rows.filter((row) => matchesFilters(row, selection));
  assert.equal(shown.length, 5);
  assert.ok(shown.every((row) => (row.filters as Record<string, string>).odds_scope === "all" && (row.filters as Record<string, string>).ci_level === "95"));
  assert.equal(matchesFilters({ model: "x" }, selection), true, "没有 filters 的对象总是显示");
  assert.equal(matchesFilters({ ci_level: "99" }, selection), true, "同名数据列不会被当作筛选条件（避免列名碰巧与筛选 key 相同）");
  assert.equal(matchesFilters({ filters: { ci_level: ["90", "95"] } }, selection), true);
  assert.equal(matchesFilters({ filters: { ci_level: ["90"] } }, selection), false);
  assert.equal(matchesFilters({ filters: { ci_level: "99" } }, selection), false);
  assert.equal(matchesFilters({ filters: { other: "x" } }, selection), true);
  assert.equal(matchesFilters(undefined, selection), true);
  assert.equal(matchesWhen({ ci_level: "95" }, selection), true);
  assert.equal(matchesWhen({ ci_level: "99" }, selection), false);
  assert.equal(matchesWhen(undefined, selection), true);
});

// ───────────────────────── PnL Gap ─────────────────────────

test("PnL Gap：时间并集、前向填充、首事件前记 0，Gap = A − B", () => {
  const a = [{ x: 1, y: 10 }, { x: 3, y: 12 }, { x: 3, y: 15 }, { x: 5, y: 9 }];
  const b = [{ x: 2, y: 4 }, { x: 4, y: 6 }];
  const gap = alignPnlSeries(a, b)!;
  assert.deepEqual(gap.times, [1, 2, 3, 4, 5]);
  assert.deepEqual(gap.a, [10, 10, 15, 15, 9], "同一时刻多点取最后一个");
  assert.deepEqual(gap.b, [0, 4, 4, 6, 6], "B 在 t=1 之前没有事件，记 0");
  assert.deepEqual(gap.gap, [10, 6, 11, 9, 3]);
  assert.equal(gap.final, 3);
  assert.equal(gap.max, 11);
  assert.equal(gap.min, 3);
  assert.equal(alignPnlSeries([], b), undefined);
  assert.equal(alignPnlSeries([{ x: 1, y: null }], b), undefined, "缺失值不当作 0");
});

test("Gap 用 fixture 里的两条 MTM 曲线可计算", () => {
  const curves = decodeResult(fixture("run-btr-20261019-trade001.json").data.result).sections.find((s) => s.id === "pnl_curves")!;
  assert.equal(curves.type, "series");
  if (curves.type !== "series") return;
  const mtm = curves.series.filter((l) => l.variant === "mtm");
  assert.equal(mtm.length, 3);
  const gap = alignPnlSeries(mtm[0].points, mtm[1].points)!;
  assert.equal(gap.times.length, 180);
  assert.equal(Number((gap.a[179] - gap.b[179]).toFixed(6)), Number(gap.gap[179].toFixed(6)));
});

// ───────────────────────── 两次运行对比 ─────────────────────────

test("两次运行对比：配置差异忽略 run_id 等易变字段，输入指纹逐文件列出", () => {
  const a = decodeRun(fixture("run-btr-20261019-brier001.json").data);
  const b = decodeRun(fixture("run-btr-20261019-brier002.json").data);
  const diff = diffRuns(a, b);
  const paths = diff.config.map((d) => d.path);
  assert.ok(paths.includes("data_generation"));
  assert.ok(paths.includes("params.ci_level"));
  assert.ok(!paths.includes("run_id") && !paths.includes("created_at") && !paths.includes("parent_run_id"));
  assert.deepEqual(diff.fingerprints.map((d) => d.path), ["backtest/market_data/settlement.parquet"]);
  assert.equal(diff.sameConfigSha, false);
  assert.deepEqual(diffFlat(flatten({ a: [1, 2] }), flatten({ a: [1] })), [{ path: "a[1]", a: "2", b: "（无）" }]);
  assert.equal(diffRuns(a, a).config.length, 0);
});

test("两次运行指标并排：同一对象同一数值列，给出差值", () => {
  const a = decodeRun(fixture("run-btr-20261019-brier001.json").data);
  const b = decodeRun(fixture("run-btr-20261019-brier002.json").data);
  const pairs = compareResults(a, b);
  assert.ok(pairs.length > 0);
  assert.ok(pairs.every((p) => p.delta === 0 || p.delta === null), "同一结果内容重跑，差值为 0");
  const withDiff = { ...b, result: { ...b.result!, sections: b.result!.sections.map((s) => s.type === "table" && s.id === "scope_ranks" ? { ...s, rows: s.rows.map((r) => ({ ...r, brier_all: 0.5 })) } : s) } };
  const changed = compareResults(a, withDiff).filter((p) => p.metric === "全样本Brier");
  assert.ok(changed.length > 0 && changed.every((p) => p.delta !== 0));
  assert.deepEqual(compareResults({ ...a, result: undefined }, b), []);
});

// ───────────────────────── 与 infra 对齐 ─────────────────────────

test("同一个 model_id 的多个版本：选择标识唯一，发给 infra 的引用是目录 key + 版本，脚本名按 infra 规则推导", () => {
  const v1 = model("team_01@v2/p1"); const v21 = model("team_01@v2/p21");
  assert.equal(v1.catalogKey, "team_01");
  assert.equal(v1.version, "v2/p1");
  assert.equal(v21.version, "v2/p21");
  assert.equal(v1.name, "team_01__v2__p1");
  assert.equal(v21.name, "team_01__v2__p21");
  assert.equal(new Set(models.map((m) => m.key)).size, models.length, "页面内选择标识不重复");
  assert.equal(model("pswarm_v2").name, "pswarm_v2", "旧预测保持原名");
  assert.equal(model("pswarm_v2").key, "pswarm_v2");
  assert.equal(modelLabel(v1).startsWith("team_01__v2__p1 ("), true);
  // metadata.model_name 优先（执行器可以覆盖）
  const item = decodeCatalogItem({ kind: "model", key: "m", version: "a/b", metadata: { model_name: "custom" } });
  assert.equal(modelInfo(item).name, "custom");
});

test("模型覆盖按数据集取：coverage 以数据集为键，默认数据集来自 default_dataset；兼容扁平 coverage", () => {
  const two = modelInfo(decodeCatalogItem({ kind: "model", key: "m", version: "legacy/legacy", metadata: { default_dataset: "telonex", coverage: { mjj_tmp: { start: "2026-01-01T00:00:00+08:00", end: "2026-01-05T00:00:00+08:00" }, telonex: { start: "2026-08-07T00:00:00+08:00", end: "2026-08-09T00:00:00+08:00", markets: 12 } } } }));
  assert.equal(two.dataset, "telonex");
  assert.equal(two.startIso, "2026-08-07T00:00:00+08:00");
  assert.equal(two.coverageByDataset.telonex.matchedMarkets, 12);
  const single = modelInfo(decodeCatalogItem({ kind: "model", key: "m", version: "legacy/legacy", metadata: { coverage: { mjj_tmp: { start: "2026-01-01T00:00:00+08:00", end: "2026-01-05T00:00:00+08:00" } } } }));
  assert.equal(single.dataset, "mjj_tmp", "只有一个数据集时即默认数据集");
  const ambiguous = modelInfo(decodeCatalogItem({ kind: "model", key: "m", version: "legacy/legacy", metadata: { coverage: { a: { start: "2026-01-01T00:00:00+08:00", end: "2026-01-05T00:00:00+08:00" }, b: { start: "2026-01-01T00:00:00+08:00", end: "2026-01-05T00:00:00+08:00" } } } }));
  assert.equal(ambiguous.dataset, undefined);
  assert.equal(ambiguous.start, undefined, "多个数据集又没有默认数据集时不猜覆盖区间");
  assert.equal(modelInfo(decodeCatalogItem({ kind: "model", key: "m", version: "legacy/legacy", metadata: { dataset: "telonex", coverage: { start: "2026-01-01T00:00:00+08:00", end: "2026-01-05T00:00:00+08:00" } } })).dataset, "telonex");
});

test("策略多版本：选择标识唯一，旧策略（legacy）保持 key", () => {
  const all = [...strategies, strategyInfo(decodeCatalogItem({ kind: "strategy", key: "baseline", version: "v2", metadata: { label: "Baseline" } }))];
  assert.equal(new Set(all.map((s) => s.id)).size, all.length);
  assert.equal(all.find((s) => s.key === "baseline" && s.version === "legacy")?.id, "baseline");
  const next = all.find((s) => s.version === "v2")!;
  assert.equal(next.id, "baseline@v2");
  assert.equal(next.label, "Baseline @v2");
});

test("Domain：infra 不接受空的 values，排除 0 个等价于全部", () => {
  assert.deepEqual(domainsPayload({ mode: "exclude", values: [] }), { mode: "include", values: ["all"] });
});

test("参数校验：没有 default 的参数必填；文本 / 文本列表 / 个数 / 长度", () => {
  const required = decodeParamDef({ name: "x", type: "integer" });
  assert.match(validateParams([required], { x: "" }).x, /必填/);
  assert.deepEqual(validateParams([required], { x: "3" }), {});
  const optionalText = decodeParamDef({ name: "t", type: "text", default: "", max_length: 5 });
  assert.deepEqual(validateParams([optionalText], { t: "" }), {});
  assert.match(validateParams([optionalText], { t: "abcdef" }).t, /不能超过 5/);
  assert.deepEqual(paramsPayload([optionalText], { t: "" }), {}, "留空不提交，由 infra 补默认值");
  const names = decodeParamDef({ name: "names", type: "list", item_type: "text", default: ["a"], min_items: 1, max_items: 2, choices: ["a", "b", "c"] });
  assert.deepEqual(validateParams([names], { names: "a, b" }), {});
  assert.match(validateParams([names], { names: "a, b, c" }).names, /最多 2 项/);
  assert.match(validateParams([names], { names: "z" }).names, /不在可选范围/);
  assert.deepEqual(paramsPayload([names], { names: "a，b" }), { names: ["a", "b"] });
  const ints = decodeParamDef({ name: "xs", type: "list", item_type: "integer", default: [1, 2] });
  assert.match(validateParams([ints], { xs: "1, 2.5" }).xs, /整数/);
  const emptyList = decodeParamDef({ name: "l", type: "list", item_type: "text", default: [] });
  assert.deepEqual(validateParams([emptyList], { l: "" }), {});
  assert.deepEqual(paramsPayload([emptyList], { l: "" }), { l: [] });
  assert.throws(() => decodeParamDef({ name: "bad", type: "list", item_type: "enum" }), /元素类型未知/);
});

test("数值 choices：任意类型的参数都可以带标量 choices，整数 choices 提交数字", () => {
  const def = decodeParamDef({ name: "h", type: "integer", default: 24, choices: [1, 12, 24] });
  assert.deepEqual(def.choices?.map((c) => c.value), [1, 12, 24]);
  assert.equal(def.defaultValue, 24);
  assert.deepEqual(paramsPayload([def], { h: "12" }), { h: 12 });
  const text = decodeParamDef({ name: "k", type: "text", default: "a", choices: ["a", "b"] });
  assert.deepEqual(paramsPayload([text], { k: "b" }), { k: "b" });
  assert.match(validateParams([text], { k: "c" }).k, /不在可选范围/);
});
