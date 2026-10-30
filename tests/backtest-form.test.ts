import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeCatalogItem, decodeEngine, decodeRun, type BacktestPage, type BacktestRun, type CatalogItem, type ParamDef } from "../app/lib/backtest-platform.ts";
import { CHOICE_LABELS, groupParamDefs, decorateParamDefs, STRATEGY_PARAMS_NAME } from "../app/lib/backtest-param-ui.ts";
import { initialParamValues, isVisible, paramsPayload, validateParams, type ParamContext, type ParamValues } from "../app/lib/backtest-params.ts";
import { strategyDescription, strategyInfo } from "../app/lib/backtest-selection.ts";
import { modelNeed, planStrategyParams, strategyParamsJson } from "../app/lib/backtest-stepwise.ts";
import { DROP_REASON_LABELS, LEGACY_STEPWISE_REASON_LABELS, PM_SIM_REASON_LABELS, prettyHeadline, requesterLabel, runSummary, sampleScopeLabel } from "../app/lib/backtest-labels.ts";
import { collectRuns, submissionHistory } from "../app/lib/backtest-runs.ts";
import { evaluateHref, factorChange, factorGroups, factorNames, factorTableVersion, factorVersionSuffix } from "../app/lib/backtest-factors.ts";
import { normalizeDropReasons } from "../app/lib/backtest-table.ts";
import { DEFAULT_LEGACY_BACKTEST_URL, legacyBacktestUrl } from "../app/lib/legacy-platform.ts";

const dir = new URL("./fixtures/backtest/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const items = (name: string): CatalogItem[] => fixture(name).data.items.map(decodeCatalogItem);
const engine = decodeEngine(items("catalog-engines.json")[0]);
const strategies = items("catalog-strategies.json").map(strategyInfo);
const strategy = (key: string) => strategies.find((s) => s.key === key)!;
const run = (id: string) => decodeRun(fixture(`run-${id}.json`).data);

const BOARD_ITEM = "trading/strategy_comparison";
const raw = engine.paramDefinitions[BOARD_ITEM];
const decorated = decorateParamDefs(BOARD_ITEM, raw);

/** infra `ResolveParams` 的等价实现（prediction_infra/internal/service/backtest/platform/params.go）：
 * 未知参数报错；没给的参数补引擎定义里的默认值；数字按 precision 取整；输出嵌套对象。配置摘要就是对这个结果取的。 */
function resolveParams(defs: ParamDef[], given: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const walk = (prefix: string, object: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(object)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) walk(name, value as Record<string, unknown>);
      else flat[name] = value;
    }
  };
  walk("", given);
  assert.deepEqual(Object.keys(flat).filter((name) => !defs.some((def) => def.name === name)), [], "infra 拒绝未知参数");
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    let value = flat[def.name] ?? def.defaultValue;
    if (typeof value === "number" && def.precision !== undefined) value = Number(value.toFixed(def.precision));
    const parts = def.name.split(".");
    let cursor = out;
    for (const part of parts.slice(0, -1)) cursor = (cursor[part] ??= {}) as Record<string, unknown>;
    cursor[parts[parts.length - 1]] = value;
  }
  return out;
}

/** 改前的表单：所有定义的参数都显示、都提交（没有分组、没有条件显示）。 */
const oldPayload = (values: ParamValues) => paramsPayload(raw, values);
/** 改后的表单：套用展示规则，按上下文决定提交哪些参数。 */
const newPayload = (values: ParamValues, context: ParamContext, strategyParams?: string) =>
  paramsPayload(decorated, strategyParams === undefined ? values : { ...values, [STRATEGY_PARAMS_NAME]: strategyParams }, context);

// ───────────────────────── 提交的配置与改前一致 ─────────────────────────

test("只选旧策略：提交 pm_sim 规则与版本、不提交逐时点策略参数；infra 补默认值后的参数与改前完全一致（配置摘要不变）", () => {
  const values = initialParamValues(raw);
  const next = newPayload(values, { stepwise: false, models: true, legacy: true });
  assert.deepEqual(Object.keys(next.stepwise as Record<string, unknown>).sort(), ["buy_fee_bps", "levels", "max_book_age_minutes", "next_bar_fill", "pm_sim_version", "sell_fee_bps", "whole_shares"], "旧策略也由 pm_sim 撮合，规则与版本都提交；strategy_params 不提交");
  assert.deepEqual(resolveParams(raw, next), resolveParams(raw, oldPayload(values)));
  assert.deepEqual(next.position_sizing, { mode: "native" }, "仓位模式为策略自带时，每笔股数 / 金额隐藏、不提交");
  assert.deepEqual(next.bankroll, { mode: "unlimited" });
  assert.equal(next.include_market, false);
});

test("条件显示：每笔股数只在固定股数、每笔金额只在固定金额、初始资金只在有限资金时提交；归一化后与改前一致", () => {
  const context = { stepwise: false, models: true, legacy: true };
  const find = (name: string) => decorated.find((d) => d.name === name)!;
  const base = initialParamValues(decorated);
  assert.equal(isVisible(find("position_sizing.shares"), base, context), false);
  assert.equal(isVisible(find("position_sizing.stake"), base, context), false);
  assert.equal(isVisible(find("bankroll.amount"), base, context), false);

  const shares = { ...base, "position_sizing.mode": "fixed_shares", "position_sizing.shares": "2.5" };
  assert.equal(isVisible(find("position_sizing.shares"), shares, context), true);
  assert.equal(isVisible(find("position_sizing.stake"), shares, context), false);
  assert.deepEqual(newPayload(shares, context).position_sizing, { mode: "fixed_shares", shares: 2.5 });

  const stake = { ...base, "position_sizing.mode": "fixed_stake", "position_sizing.stake": "25" };
  assert.deepEqual(newPayload(stake, context).position_sizing, { mode: "fixed_stake", stake: 25 });

  const finite = { ...base, "bankroll.mode": "finite", "bankroll.amount": "5000" };
  assert.equal(isVisible(find("bankroll.amount"), finite, context), true);
  assert.deepEqual(newPayload(finite, context).bankroll, { mode: "finite", amount: 5000 });

  for (const values of [shares, stake, finite]) assert.deepEqual(resolveParams(raw, newPayload(values, context)), resolveParams(raw, oldPayload(values)));
});

test("混选（旧策略 + 逐时点策略）且不改参数：strategy_params 提交 \"{}\"，其余逐时点参数提交默认值，归一化后与改前一致", () => {
  const values = initialParamValues(decorated);
  const next = newPayload(values, { stepwise: true, models: true, legacy: true }, "{}");
  const stepwise = next.stepwise as Record<string, unknown>;
  assert.equal(stepwise.strategy_params, "{}");
  assert.deepEqual(Object.keys(stepwise).sort(), ["buy_fee_bps", "levels", "max_book_age_minutes", "next_bar_fill", "pm_sim_version", "sell_fee_bps", "strategy_params", "whole_shares"], "8 个 stepwise.* 全部提交");
  assert.deepEqual(next.position_sizing, { mode: "native" }, "混选时仓位模式照常提交（逐时点策略不适用）");
  assert.deepEqual(resolveParams(raw, next), resolveParams(raw, oldPayload(initialParamValues(raw))));
  // 改过 pm_sim 参数时照常提交
  const changed = newPayload({ ...values, "stepwise.buy_fee_bps": "5", "stepwise.next_bar_fill": false, "stepwise.levels": "3" }, { stepwise: true, models: true, legacy: true }, "{\"edge_threshold\":0.2}");
  const sent = changed.stepwise as Record<string, unknown>;
  assert.equal(sent.buy_fee_bps, 5);
  assert.equal(sent.next_bar_fill, false);
  assert.equal(sent.levels, 3);
  assert.equal(sent.strategy_params, "{\"edge_threshold\":0.2}");
});

test("只选逐时点策略：仓位模式及每笔股数 / 金额隐藏、不校验、不提交；infra 补默认值后与「显示并保持默认」等价", () => {
  const context = { stepwise: true, models: true, legacy: false };
  const find = (name: string) => decorated.find((d) => d.name === name)!;
  for (const name of ["position_sizing.mode", "position_sizing.shares", "position_sizing.stake"]) {
    assert.equal(find(name).requires, "legacy");
    assert.equal(isVisible(find(name), { ...initialParamValues(decorated), "position_sizing.mode": "fixed_shares" }, context), false, `${name} 隐藏`);
  }
  const values = { ...initialParamValues(decorated), "position_sizing.mode": "fixed_shares", "position_sizing.shares": "-1" };
  assert.equal(validateParams(decorated, values, context)["position_sizing.shares"], undefined, "隐藏的仓位参数填了非法值也不拦截");
  const next = newPayload(initialParamValues(decorated), context, "{}");
  assert.equal("position_sizing" in next, false);
  assert.deepEqual(next.bankroll, { mode: "unlimited" }, "资金模式对逐时点策略照常生效");
  assert.equal("pm_sim_version" in (next.stepwise as Record<string, unknown>), false, "逐时点策略用登记时的 pm_sim 版本，不提交旧策略的版本");
  assert.deepEqual(resolveParams(raw, next), resolveParams(raw, oldPayload(initialParamValues(raw))));
});

test("不读模型（盘口数据集）时 include_market 不提交，等于默认的 false", () => {
  const values = initialParamValues(decorated);
  const next = newPayload(values, { stepwise: false, models: false });
  assert.equal("include_market" in next, false);
  assert.deepEqual(resolveParams(raw, next), resolveParams(raw, oldPayload(initialParamValues(raw))));
});

test("pm_sim 规则对旧策略同样校验；隐藏的参数（只选逐时点策略时的仓位）不校验", () => {
  const values = { ...initialParamValues(decorated), "stepwise.levels": "999" };
  assert.match(validateParams(decorated, values, { stepwise: false, models: true, legacy: true })["stepwise.levels"], /不大于 15/);
  assert.match(validateParams(decorated, values, { stepwise: true, models: true, legacy: true })["stepwise.levels"], /不大于 15/);
});

// ───────────────────────── 展示规则 ─────────────────────────

test("分组：口径 / 仓位 / 资金与撮合记账（pm_sim）分开；include_market 与 strategy_params 不在任何分组里", () => {
  const { groups, rest } = groupParamDefs(BOARD_ITEM, decorated);
  const scope = groups.find((g) => g.id === "scope")!;
  const stepwise = groups.find((g) => g.id === "stepwise")!;
  assert.deepEqual(scope.defs.map((d) => d.name), ["scope", "position_sizing.mode", "position_sizing.shares", "position_sizing.stake", "bankroll.mode", "bankroll.amount"]);
  assert.deepEqual(stepwise.defs.map((d) => d.name), ["stepwise.pm_sim_version", "stepwise.next_bar_fill", "stepwise.max_book_age_minutes", "stepwise.levels", "stepwise.whole_shares", "stepwise.buy_fee_bps", "stepwise.sell_fee_bps"]);
  // pm_sim 规则对全部策略生效；pm_sim 版本只管旧策略（逐时点策略用登记时的版本）；逐时点策略参数只在选了逐时点策略时提交
  assert.equal(stepwise.defs.find((d) => d.name === "stepwise.pm_sim_version")!.requires, "legacy");
  assert.ok(stepwise.defs.filter((d) => d.name !== "stepwise.pm_sim_version").every((d) => d.requires === undefined));
  assert.equal(rest.find((d) => d.name === STRATEGY_PARAMS_NAME)!.requires, "stepwise");
  assert.equal(stepwise.title, "撮合记账（pm_sim）");
  assert.match(stepwise.note!, /^全部策略（旧策略与逐时点策略）都由研究侧的 pm_sim 撮合记账/);
  for (const retired of ["depth_levels", "fee_rate", "allow_cash_partial_fill", "quote_tolerance_minutes", "max_source_staleness_minutes", "bounded_gap_fill", "rebalance_order", "end_valuation"]) {
    assert.equal(raw.some((d) => d.name === `stepwise.${retired}`), false, `旧账户规则参数 stepwise.${retired} 已删除`);
  }
  assert.deepEqual(rest.map((d) => d.name).sort(), ["include_market", STRATEGY_PARAMS_NAME]);
  assert.equal(groupParamDefs("benchmark/calibration", raw).groups.length, 0, "没有展示规则的项目不分组");
});

test("选项中文名：值不变，只改按钮文字；没有规则的参数保持原样", () => {
  const labelOf = (defs: ParamDef[], name: string) => defs.find((d) => d.name === name)!.choices!.map((c) => [String(c.value), c.label]);
  assert.deepEqual(labelOf(decorated, "scope"), [["strict", "严格交集"], ["own", "各模型自有全集"]]);
  assert.deepEqual(labelOf(decorated, "position_sizing.mode"), [["native", "策略自带"], ["fixed_shares", "固定股数"], ["fixed_stake", "固定金额"]]);
  assert.deepEqual(labelOf(decorated, "bankroll.mode"), [["finite", "有限资金"], ["unlimited", "无限资金"]]);
  assert.equal(Object.keys(CHOICE_LABELS).some((name) => name.startsWith("stepwise.")), false, "旧账户规则的枚举标签已删除");
  const signal = decorateParamDefs("benchmark/model_signal", engine.paramDefinitions["benchmark/model_signal"]);
  assert.deepEqual(labelOf(signal, "sample_scope"), [["full", "各模型自身全量"], ["common", "共同样本"]]);
  assert.deepEqual(signal.find((d) => d.name === "horizon_h")!.choices!.map((c) => c.label), ["1", "12", "24", "48", "96", "168"], "整数选项不翻译");
});

test("标签兜底：引擎文案仍是英文时用中文，引擎已是中文时以引擎为准", () => {
  const english = raw.map((d) => d.name === "position_sizing.mode" ? { ...d, label: "Position sizing" } : d.name === "bankroll.amount" ? { ...d, label: "我自己的标签" } : d);
  const next = decorateParamDefs(BOARD_ITEM, english);
  assert.equal(next.find((d) => d.name === "position_sizing.mode")!.label, "仓位模式");
  assert.equal(next.find((d) => d.name === "bankroll.amount")!.label, "我自己的标签");
  assert.equal(raw.find((d) => d.name === "position_sizing.mode")!.label, "仓位模式", "执行器已改中文");
});

// ───────────────────────── 策略能力 ─────────────────────────

test("逐时点策略：kind、对模型的需求、pm_sim 版本、Domain 限制、参数都读自清单；旧策略保持原行为", () => {
  const v3 = strategy("baseline_v3_stepwise");
  assert.equal(v3.stepwise, true);
  assert.equal(v3.id, "baseline_v3_stepwise@1.0.0");
  assert.equal(v3.predictions, "required");
  assert.deepEqual(v3.sizingModes, ["native", "fixed_shares", "fixed_stake"], "旧接口定义里的仓位模式仍能解码");
  assert.equal(v3.pmSimVersion, undefined, "旧接口定义没有 pm_sim 版本");
  assert.equal(v3.validatedDomains, null, "domains: null = 全部");
  assert.deepEqual(v3.params, []);
  const edge = strategy("edge_filter_stepwise");
  assert.equal(edge.predictions, "optional");
  assert.deepEqual(edge.params.map((p) => p.name), ["edge_threshold", "hold_hours", "use_depth", "side_mode"]);
  assert.equal(edge.pmSimVersion, "6.3.0");
  assert.equal(edge.sizingModes, undefined, "pm_sim 接口的定义没有仓位模式");
  assert.equal("decisionInterval" in edge, false, "不再解析决策间隔");
  assert.equal(strategyInfo({ ...items("catalog-strategies.json").find((i) => i.key === "edge_filter_stepwise")!, metadata: { definition: { kind: "stepwise" }, pm_sim_version: "6.4.0" } }).pmSimVersion, "6.4.0", "definition 没有时读 metadata");
  const reversion = strategy("mid_reversion_stepwise");
  assert.equal(reversion.predictions, "none");
  assert.deepEqual(reversion.validatedDomains, ["Politics", "Sports"]);
  assert.equal(strategy("baseline").stepwise, false);
  assert.equal(strategy("baseline").predictions, "required");
  assert.equal(strategy("price_v4").predictions, "none");
  assert.equal(strategy("price_v4").priceOnly, true);
  assert.equal(strategy("baseline").sizingModes, undefined);
  assert.equal(strategy("baseline").pmSimVersion, undefined);
});

test("策略说明与名字相同（旧策略的说明就是名字）时不重复显示", () => {
  assert.equal(strategyDescription(strategy("baseline")), undefined);
  assert.equal(strategyDescription({ label: " Baseline  V1.1 ", description: "baseline v1.1" }), undefined);
  assert.equal(strategyDescription({ label: "Baseline @v2", description: "Baseline" }), undefined, "带版本后缀的名字也算相同");
  assert.equal(strategyDescription({ label: "A", description: "按预测与盘口价差入场" }), "按预测与盘口价差入场");
  assert.equal(strategyDescription({ label: "A", description: undefined }), undefined);
});

test("模型需求按所选策略合并", () => {
  const picked = (...keys: string[]) => keys.map(strategy);
  assert.deepEqual(modelNeed(picked("baseline")), { required: true, reads: true, ignoring: [] });
  assert.equal(modelNeed(picked("price_v4")).reads, false);
  assert.equal(modelNeed(picked("mid_reversion_stepwise")).reads, false, "predictions=none 不强制选模型");
  const optional = modelNeed(picked("edge_filter_stepwise"));
  assert.deepEqual([optional.required, optional.reads], [false, true]);
  const mixed = modelNeed(picked("edge_filter_stepwise", "mid_reversion_stepwise"));
  assert.deepEqual(mixed.ignoring.map((s) => s.key), ["mid_reversion_stepwise"]);
});

test("逐时点策略参数：单选时全部可改；多选时只有都声明且定义一致的可改，其余说明原因", () => {
  const single = planStrategyParams([strategy("edge_filter_stepwise")]);
  assert.deepEqual(single.shared.map((d) => d.name), ["edge_threshold", "hold_hours", "use_depth", "side_mode"]);
  assert.equal(single.locked.length, 0);
  assert.deepEqual(planStrategyParams([strategy("baseline_v3_stepwise")]), { shared: [], locked: [] }, "策略没有参数时不出表单");
  assert.deepEqual(planStrategyParams([strategy("baseline")]), { shared: [], locked: [] }, "旧策略没有逐时点参数");

  const both = planStrategyParams([strategy("edge_filter_stepwise"), strategy("mid_reversion_stepwise")]);
  assert.deepEqual(both.shared.map((d) => d.name), ["edge_threshold"]);
  assert.deepEqual(both.locked.map((l) => l.def.name).sort(), ["hold_hours", "side_mode", "use_depth", "window_steps"]);
  assert.match(both.locked.find((l) => l.def.name === "hold_hours")!.reason, /只有 边际过滤（逐时点）/);

  const withEmpty = planStrategyParams([strategy("edge_filter_stepwise"), strategy("baseline_v3_stepwise")]);
  assert.equal(withEmpty.shared.length, 0, "有一个策略没声明任何参数，就没有共有参数");
  assert.equal(withEmpty.locked.length, 4);

  const differing = planStrategyParams([strategy("edge_filter_stepwise"), { ...strategy("mid_reversion_stepwise"), params: [{ ...strategy("mid_reversion_stepwise").params[0], defaultValue: 0.5 }] }]);
  assert.equal(differing.shared.length, 0, "同名但默认值不同：不能共用一个输入框");
  assert.match(differing.locked.find((l) => l.def.name === "edge_threshold")!.reason, /定义不一致/);
});

test("strategy_params JSON：没有改动是 {}；只含与默认值不同的项；键按字母序；类型保持", () => {
  const shared = strategy("edge_filter_stepwise").params;
  const base = initialParamValues(shared);
  assert.equal(strategyParamsJson(shared, base), "{}");
  assert.equal(strategyParamsJson(shared, { ...base, edge_threshold: "0.1" }), "{}", "改回默认值等于没改");
  assert.equal(strategyParamsJson(shared, { ...base, edge_threshold: "0.25" }), "{\"edge_threshold\":0.25}");
  assert.equal(strategyParamsJson(shared, { ...base, side_mode: "yes_only", hold_hours: "8", edge_threshold: "0.3", use_depth: false }), "{\"edge_threshold\":0.3,\"hold_hours\":8,\"side_mode\":\"yes_only\",\"use_depth\":false}");
  assert.match(validateParams(shared, { ...base, hold_hours: "100" }).hold_hours, /不大于 48/);
  assert.match(validateParams(shared, { ...base, side_mode: "both_sides" }).side_mode, /不在可选范围/);
});

// ───────────────────────── 运行记录 / 提交历史 / 因子库 ─────────────────────────

test("发起人显示可读名称，未知的原样显示", () => {
  assert.equal(requesterLabel("console:console"), "控制台");
  assert.equal(requesterLabel("console:alice"), "控制台（alice）");
  assert.equal(requesterLabel("console:accept"), "测试（控制台）");
  assert.equal(requesterLabel("console:e2e"), "测试（控制台）");
  assert.equal(requesterLabel("research"), "研究侧接口");
  assert.equal(requesterLabel("trainer"), "训练侧接口");
  assert.equal(requesterLabel("legacy-import"), "旧平台导入");
  assert.equal(requesterLabel("somebody"), "somebody");
  assert.equal(requesterLabel(undefined), "未知");
});

test("运行记录副行：所选对象与窗口；提交校验显示提交的类型与标识", () => {
  assert.equal(runSummary(run("btr-20261021-stepw001")), "策略 baseline_v3_stepwise · 模型 pswarm_v2 · 2026-08-07 → 2026-08-31");
  assert.equal(runSummary(run("btr-20261019-intake002")), "因子表 research_0919 / 20260919-a");
  assert.equal(runSummary(run("btr-20261019-intake001")), "预测表 team_03 / v2 / p3");
  assert.equal(runSummary({ config: undefined }), undefined);
});

function fakePages(all: BacktestRun[]) {
  const calls: Array<[number, number]> = [];
  const fetchPage = async (offset: number, limit: number): Promise<BacktestPage<BacktestRun>> => {
    calls.push([offset, limit]);
    return { items: all.slice(offset, offset + limit), limit, offset, hasMore: offset + limit < all.length };
  };
  return { fetchPage, calls };
}
const fakeRun = (id: string, board: string) => ({ ...run("btr-20261019-fail0001"), runId: id, board });

test("运行视图排除提交校验：连续取页凑满一页，nextOffset 指向下一条要显示的服务端记录", async () => {
  // 服务端列表：每 3 条里有 2 条是 intake
  const all = Array.from({ length: 200 }, (_, i) => fakeRun(`r${i}`, i % 3 === 0 ? "trading" : "intake"));
  const { fetchPage } = fakePages(all);
  const exclude = (r: BacktestRun) => r.board === "intake";
  const first = await collectRuns(fetchPage, 0, 20, exclude);
  assert.equal(first.items.length, 20, "页内条数是满的");
  assert.ok(first.items.every((r) => r.board === "trading"));
  assert.equal(first.items[19].runId, "r57");
  assert.equal(first.nextOffset, 60, "r58、r59 是被排除的行，下一页直接从下一条要显示的 r60 开始");
  assert.equal(first.hasMore, true);
  const second = await collectRuns(fetchPage, first.nextOffset, 20, exclude);
  assert.equal(second.items[0].runId, "r60");
  assert.equal(second.items.length, 20);
  // 翻到底
  const last = await collectRuns(fetchPage, 190, 20, exclude);
  assert.equal(last.hasMore, false);
  assert.deepEqual(last.items.map((r) => r.runId), ["r192", "r195", "r198"]);
  // 恰好凑满一页、后面全是被排除的行：没有下一页（不能给出一个空的「下一页」）
  const tail = Array.from({ length: 120 }, (_, i) => fakeRun(`t${i}`, i < 20 ? "trading" : "intake"));
  const exhausted = await collectRuns(fakePages(tail).fetchPage, 0, 20, exclude);
  assert.equal(exhausted.items.length, 20);
  assert.equal(exhausted.hasMore, false);
  // 被排除的行占满整个列表：连续取页有上限，不会一次取遍全部历史
  const allIntake = fakePages(Array.from({ length: 5000 }, (_, i) => fakeRun(`i${i}`, "intake")));
  const none = await collectRuns(allIntake.fetchPage, 0, 20, exclude);
  assert.equal(none.items.length, 0);
  assert.equal(none.hasMore, true, "还没到底，下一页从已查到的位置继续");
  assert.ok(allIntake.calls.length <= 20);
  // 不排除时一次取一页
  const plain = fakePages(all);
  const unfiltered = await collectRuns(plain.fetchPage, 0, 20);
  assert.equal(unfiltered.items.length, 20);
  assert.equal(unfiltered.nextOffset, 20);
  assert.deepEqual(plain.calls, [[0, 20]]);
});

test("提交历史：按校验运行配置里的 submission 还原，按提交编号去重并保留最新的一条", () => {
  const runs = ["btr-20261021-intake005", "btr-20261019-intake001", "btr-20261019-intake002", "btr-20261019-intake003", "btr-20261019-intake004", "btr-20261019-trade001"].map(run);
  const history = submissionHistory(runs);
  assert.deepEqual(history.map((h) => h.submissionId), ["bts-20261021-baseline_", "bts-20261019-val00001", "bts-20261019-ok000001", "bts-20261019-bad00001"]);
  assert.equal(history.find((h) => h.submissionId === "bts-20261019-ok000001")!.runId, "btr-20261019-intake002", "重复提交保留较新的校验运行");
  assert.equal(history[0].identity, "baseline_v3_stepwise / 1.0.0");
  assert.equal(history[1].kind, "prediction");
});

test("因子库展示：名字去重、表 / 版本、最近变更的来源、分组、去评估链接", () => {
  const factors = items("catalog-factors.json");
  const legacy = factors.find((f) => f.key === "spread_pct")!;
  assert.deepEqual(factorNames(legacy), { title: "spread_pct", subtitle: "旧平台" }, "label 等于 key 只显示一次");
  const labelled = factors.find((f) => f.key === "rev_momentum_3h")!;
  assert.deepEqual(factorNames(labelled), { title: "REV 动量 3h", subtitle: "rev_momentum_3h · 旧平台" });
  assert.deepEqual(factorTableVersion(legacy), { primary: "旧平台登记" });
  assert.equal(factorVersionSuffix(legacy), "", "下拉框里旧平台因子不显示内部版本 legacy/legacy");
  const platform = factors.find((f) => f.key === "vol_burst")!;
  assert.deepEqual(factorTableVersion(platform), { primary: "表 research_0919", secondary: "版本 20260919-a" });
  assert.equal(factorVersionSuffix(platform), " · research_0919/20260919-a");
  assert.deepEqual(factorNames(platform), { title: "成交突增", subtitle: "vol_burst" });
  assert.deepEqual([factorChange(legacy).actor, factorChange(legacy).manual], ["迁移导入", false], "没有操作人 = 导入时登记");
  assert.deepEqual([factorChange(platform).actor, factorChange(platform).manual], ["控制台（alice）", true]);
  assert.deepEqual(factorChange({ ...legacy, poolChangedBy: "migration" }), { actor: "迁移导入", manual: false, at: legacy.poolChangedAt });
  assert.deepEqual(factorGroups(factors), ["momentum", "orderbook", "talib", "volume", "未分组"]);
  assert.ok(factors.length > 100, "fixture 超过两页");
  assert.equal(evaluateHref(platform), "/backtest-platform/signal?factor=vol_burst%40research_0919%2F20260919-a");
});

// ───────────────────────── 结果页兜底 ─────────────────────────

test("样本口径中文：严格交集 / 自有全集 / 混合 / 各模型自身全量 / 共同样本；未知原样", () => {
  assert.equal(sampleScopeLabel("strict"), "严格交集");
  assert.equal(sampleScopeLabel("own"), "各模型自有全集");
  assert.match(sampleScopeLabel("mixed"), /^混合/);
  assert.equal(sampleScopeLabel("full"), "各模型自身全量");
  assert.equal(sampleScopeLabel("common"), "共同样本");
  assert.equal(sampleScopeLabel("whatever"), "whatever");
});

test("旧运行标题行兜底：英文词换中文、时间去掉秒与纳秒；新标题行原样通过（幂等）", () => {
  const old = "Baseline · All domains · native sizing · unlimited · pswarm_v2_subset · 2026-08-07T21:16:28+08:00 → 2026-08-31T21:00:35.000000001+08:00";
  assert.equal(prettyHeadline(old), "Baseline · 全部 Domain · 策略自带仓位 · 无限资金 · pswarm_v2_subset · 2026-08-07 21:16+08:00 → 2026-08-31 21:00+08:00");
  assert.equal(prettyHeadline("A · All domains · fixed shares 2 · bankroll $5000 · 3 models · x"), "A · 全部 Domain · 固定股数 2 · 有限资金 $5000 · 3 个模型 · x");
  const fresh = "Baseline V3（逐时点包装） · 全部 Domain · 策略自带仓位 · 无限资金 · pswarm_v2 · 2026-08-07 21:16 → 2026-08-31 21:00（UTC+08:00）";
  assert.equal(prettyHeadline(fresh), fresh);
  assert.equal(prettyHeadline(prettyHeadline(old)), prettyHeadline(old));
});

test("未成交原因码表：16 个 pm_sim 拒单原因与执行器 pmbt/stepwise/reasons.py 逐字一致；旧逐时点账户的码保留并标明旧口径", () => {
  // 原样抄自执行器 pmbt/stepwise/reasons.py 的 REASON_LABELS（改那边就同步这里与 app/lib/backtest-labels.ts）
  const executor: Record<string, string> = {
    unknown_market: "结算表里没有这个市场",
    market_closed: "市场已关闭",
    no_book: "没有盘口：这个市场不在本次允许交易的范围（Domain / 数据集）内，或此刻没有盘口",
    stale_book: "盘口超过年龄上限（看簿、买卖、估值同一标准）",
    book_before_decision: "下一格成交时只有决策之前观测到的盘口（那一格缺数据），订单作废",
    no_visible_depth: "盘口深度不够，只成交了可见的部分（或一股都没有）",
    crossed_book: "盘口交叉（无风险套利，只可能来自数据瑕疵），不成交",
    limit_price_not_reached: "没有达到限价",
    below_min_size: "按整股成交，取整后不足一股",
    nothing_to_sell: "没有可卖的持仓",
    unknown_lot: "指定平仓的那一手不存在",
    insufficient_cash: "现金不足",
    event_exposure_cap: "超过事件敞口上限",
    invalid_order: "订单不合规（股数 / 金额 / 限价不合法）",
    ambiguous_target: "同一市场方向上已有更早的单，调到目标仓位算不出要买卖多少，拒绝",
    window_end: "区间结束时还没到执行时刻",
  };
  assert.deepEqual(PM_SIM_REASON_LABELS, executor);
  assert.equal(Object.keys(PM_SIM_REASON_LABELS).length, 16);
  for (const [code, label] of Object.entries(executor)) assert.equal(DROP_REASON_LABELS[code], label, `${code} 用 pm_sim 文案`);
  const legacy = ["no_quote", "thin_book", "no_liquidity", "below_one_share", "domain_not_allowed", "duplicate_order", "exceeds_position", "already_at_target"];
  assert.deepEqual(Object.keys(LEGACY_STEPWISE_REASON_LABELS).sort(), [...legacy].sort());
  for (const code of legacy) assert.match(DROP_REASON_LABELS[code], /（旧逐时点账户口径）$/, `${code} 标明旧口径`);
  for (const code of ["stale_book", "insufficient_cash", "invalid_order", "market_closed"]) assert.doesNotMatch(DROP_REASON_LABELS[code], /旧/, `同名码 ${code} 用新文案`);
});

test("未成交原因表兜底：旧结果里说明 = 原因码时翻译、挪动原因代码列；新码两列相同时只留一列", () => {
  const old = run("btr-20261019-trade001").result!.sections.find((s) => s.id === "drop_reasons")!;
  assert.equal(old.type, "table");
  if (old.type !== "table") return;
  const next = normalizeDropReasons(old);
  assert.deepEqual(next.columns.map((c) => c.label), ["策略", "模型", "未成交原因", "笔数", "占 selected", "原因代码"], "原因代码挪到最后并改名");
  const byReason = new Map(next.rows.map((r) => [r.reason as string, r.description as string]));
  assert.equal(byReason.get("below_one_share"), "按整股成交，目标不足一股（旧逐时点账户口径）");
  assert.equal(byReason.get("no_liquidity"), "对手盘一档有效报价都没有（旧逐时点账户口径）");
  assert.equal(byReason.get("thin_book"), "盘口过薄无法成交", "旧引擎原因保持执行器写的中文");

  // 码表里没有的新码：说明列与原因列相同 → 隐藏重复的说明列
  const unknown = { ...old, rows: [{ strategy: "S", model: "M", reason: "brand_new_code", description: "brand_new_code", count: 1, share: 1 }] };
  const hidden = normalizeDropReasons(unknown);
  assert.equal(hidden.columns.some((c) => c.key === "description"), false);
  assert.equal(hidden.columns.some((c) => c.key === "reason"), true);

  // 新结果：已经翻译好、原因代码在最后，原样通过
  const fresh = run("btr-20261021-stepw001").result!.sections.find((s) => s.id === "drop_reasons")!;
  if (fresh.type !== "table") throw new Error("应是表格");
  const same = normalizeDropReasons(fresh);
  assert.deepEqual(same.columns.map((c) => c.key), fresh.columns.map((c) => c.key));
  assert.deepEqual(same.rows, fresh.rows);
  // 其它区块不受影响
  const other = run("btr-20261019-trade001").result!.sections.find((s) => s.id === "metrics_main")!;
  assert.equal(normalizeDropReasons(other as never), other);
});

// ───────────────────────── 旧平台外链配置 ─────────────────────────

test("旧平台外链：未配置沿用默认；空串或 off 不显示；非 http(s) 视为未配置不显示", () => {
  assert.equal(legacyBacktestUrl({}), DEFAULT_LEGACY_BACKTEST_URL);
  assert.equal(legacyBacktestUrl({ BACKTEST_LEGACY_PLATFORM_URL: "https://old.example/pm/" }), "https://old.example/pm/");
  assert.equal(legacyBacktestUrl({ BACKTEST_LEGACY_PLATFORM_URL: "" }), undefined);
  assert.equal(legacyBacktestUrl({ BACKTEST_LEGACY_PLATFORM_URL: " OFF " }), undefined);
  assert.equal(legacyBacktestUrl({ BACKTEST_LEGACY_PLATFORM_URL: "javascript:alert(1)" }), undefined);
});
