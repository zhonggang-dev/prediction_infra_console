"use client";

import { useMemo, useState } from "react";
import type { EngineInfo, ParamDef } from "../../lib/backtest-platform";
import { INCLUDE_MARKET_NAME, PM_SIM_VERSION_NAME, STRATEGY_PARAMS_NAME, groupParamDefs } from "../../lib/backtest-param-ui";
import { initialParamValues, isVisible, paramsPayload, validateParams, type ParamContext, type ParamValues } from "../../lib/backtest-params";
import {
  ALL_DOMAINS, datasetConflict, domainState, domainsPayload, strategyDescription, strategyDomainPlan, type DomainSelection, type ModelInfo, type StrategyInfo,
} from "../../lib/backtest-selection";
import { POSITION_MODE_NAME, modelNeed, planStrategyParams, strategyParamsJson } from "../../lib/backtest-stepwise";
import { paramDefsFor, type CatalogData } from "./catalog-context";
import { CatalogGate, SubmitBar, useLauncher } from "./forms-common";
import { DomainPicker, ModelPicker, ParamForm, WindowPicker, useModelWindow } from "./pickers";

/** 「带上 Market 基准行」的默认值跟着口径走：严格口径勾上，各模型自有全集不勾（旧平台在自有全集下不提供 Market 行）。 */
export function withMarketDefault(values: ParamValues, defs: ParamDef[]): ParamValues {
  if (!defs.some((def) => def.name === INCLUDE_MARKET_NAME)) return values;
  return { ...values, [INCLUDE_MARKET_NAME]: String(values.scope ?? "strict") !== "own" };
}

export function TradingForm() { return <CatalogGate>{(data) => <TradingFormInner data={data} />}</CatalogGate>; }

const modelRef = (m: ModelInfo) => ({ key: m.catalogKey, version: m.version });
const PREDICTION_NOTE = { none: "不读模型", optional: "模型可选", required: "" } as const;

/** `runVersion` = 本次运行里旧策略用的 pm_sim 版本；逐时点策略固定用登记时的版本，只有和它不同才在卡片上标出来（相同就没有区别可说）。 */
function StrategyOption({ strategy, checked, onToggle, runVersion }: { strategy: StrategyInfo; checked: boolean; onToggle: () => void; runVersion: string }) {
  const description = strategyDescription(strategy);
  return <label className={`bt-option ${checked ? "selected" : ""}`}>
    <input type="checkbox" checked={checked} onChange={onToggle} />
    <span><span className="bt-option-head"><strong>{strategy.label}</strong>
      {strategy.validatedDomains && <em>（只在 {strategy.validatedDomains.join(" / ")} 成交）</em>}
      {strategy.priceOnly && <em>（纯价格）</em>}
      {strategy.stepwise && strategy.predictions !== "required" && <em>（{PREDICTION_NOTE[strategy.predictions]}）</em>}
      {strategy.stepwise && strategy.pmSimVersion && strategy.pmSimVersion !== runVersion && <em>（pm_sim {strategy.pmSimVersion}）</em>}
    </span>{description && <small>{description}</small>}</span>
  </label>;
}

/** 导出供 SSR 测试直接用目录数据渲染（组件本身只在目录就绪后由 TradingForm 挂载）；`initialStrategyIds` 只给测试预选多个策略用，缺省选第一个。 */
export function TradingFormInner({ data, initialStrategyIds }: { data: CatalogData; initialStrategyIds?: string[] }) {
  const engine = data.engine as EngineInfo;
  const defs = useMemo(() => paramDefsFor(engine, "trading", "strategy_comparison"), [engine]);
  const ui = useMemo(() => groupParamDefs("trading/strategy_comparison", defs), [defs]);
  // 严格口径默认带上 Market 基准行（同旧平台：严格口径的默认模型里有 Market Favorite，用来对照“跟着市场买”）
  const [params, setParams] = useState<ParamValues>(() => withMarketDefault(initialParamValues(defs), defs));
  const [strategyKeys, setStrategyKeys] = useState<string[]>(() => initialStrategyIds ?? (data.strategies[0] ? [data.strategies[0].id] : []));
  const [strategyOverrides, setStrategyOverrides] = useState<ParamValues>({});
  const [domains, setDomains] = useState<DomainSelection>({ mode: "include", values: [ALL_DOMAINS] });
  const [priceDataset, setPriceDataset] = useState(data.datasets[0]?.key ?? "");
  const [force, setForce] = useState(false);
  const launcher = useLauncher();

  const strategies = useMemo(() => data.strategies.filter((s) => strategyKeys.includes(s.id)), [data.strategies, strategyKeys]);
  const need = modelNeed(strategies);
  const hasStepwise = strategies.some((s) => s.stepwise);
  // 仓位模式只对旧策略生效：只选了逐时点策略时隐藏（不校验、不提交，infra 补默认值）；还没选策略时照常显示
  const hasLegacy = strategies.length === 0 || strategies.some((s) => !s.stepwise);
  const invalidParams = strategies.filter((s) => s.paramsInvalid);
  // 所选策略全都不读模型（纯价格策略，或声明 predictions=none 的逐时点策略）：不选模型，改选盘口数据集
  const priceOnly = strategies.length > 0 && !need.reads;
  const context: ParamContext = { stepwise: hasStepwise, models: !priceOnly, legacy: hasLegacy };
  const strict = String(params.scope ?? "strict") !== "own";
  // 严格口径 = 沙盒标签模型（含 market-view）；各模型自有全集 = 去掉 market-view（旧 scope_models）
  const pool = useMemo(() => data.models.filter((m) => strict ? m.tags.includes("sandbox") || m.marketView : !m.marketView), [data.models, strict]);
  const mw = useModelWindow(pool);

  // 逐时点策略参数：按所选策略清单声明的参数出表单，只提交与默认值不同的项（没有改动就是 "{}"）
  const plan = useMemo(() => planStrategyParams(strategies), [strategies]);
  const strategyValues = useMemo<ParamValues>(() => {
    const initial = initialParamValues(plan.shared);
    for (const def of plan.shared) if (def.name in strategyOverrides) initial[def.name] = strategyOverrides[def.name];
    return initial;
  }, [plan.shared, strategyOverrides]);
  const strategyErrors = validateParams(plan.shared, strategyValues);
  const effective = useMemo<ParamValues>(() => ({ ...params, [STRATEGY_PARAMS_NAME]: strategyParamsJson(plan.shared, strategyValues) }), [params, plan.shared, strategyValues]);

  const changeParam = (name: string, value: string | boolean) => {
    setParams((current) => name === "scope" ? withMarketDefault({ ...current, [name]: value }, defs) : { ...current, [name]: value });
    if (name === "scope") {
      const nextStrict = String(value) !== "own";
      const allowed = new Set(data.models.filter((m) => nextStrict ? m.tags.includes("sandbox") || m.marketView : !m.marketView).map((m) => m.key));
      mw.setSelected(mw.selected.filter((key) => allowed.has(key)));
    }
  };

  const conflict = datasetConflict(mw.selected, pool, data.datasets);
  const domain = domainState(domains, data.domains);
  const plans = strategyDomainPlan(strategies, domains);
  const paramErrors = validateParams(defs, effective, context);
  // 没有选模型、又没有策略强制要求时，要从盘口数据集取数据
  const useDatasetPick = strategies.length > 0 && (priceOnly || (!need.required && mw.selected.length === 0));
  const dataset = useDatasetPick ? priceDataset : mw.infos[0]?.dataset;
  const datasetInfo = data.datasets.find((d) => d.key === dataset);
  const hourly = strategies.some((s) => s.readsHourlyFactors) ? datasetInfo?.hourlyFactorNote : undefined;
  const nonSandbox = strict && !priceOnly ? mw.infos.filter((m) => !m.marketView && !m.tags.includes("sandbox")) : [];
  const staleCache = strategies.some((s) => s.needsExecutionCache) ? mw.infos.filter((m) => m.cacheStale) : [];
  // 混选时在仓位模式旁注明它只管旧策略
  const markLegacyOnly = (group: ParamDef[]) => hasStepwise && hasLegacy ? group.map((def) => def.name === POSITION_MODE_NAME || def.name === PM_SIM_VERSION_NAME ? { ...def, label: `${def.label}（逐时点策略不适用）` } : def) : group;

  const blockers: string[] = [];
  if (strategies.length === 0) blockers.push("请至少选择一个策略。");
  if (!priceOnly && mw.selected.length === 0 && (need.required || strategies.length === 0)) blockers.push("请至少选择一个模型。");
  if (useDatasetPick && !priceDataset) blockers.push("请选择盘口数据集。");
  if (domain.blocked) blockers.push(domain.error ?? domain.warning ?? "Domain 选择无效。");
  if (plans.empty.length) blockers.push(`以下策略与所选 domain 没有交集：${plans.empty.join("、")}。`);
  if (conflict) blockers.push("所选模型来自不同数据集。");
  if (mw.invalid) blockers.push("结束日期必须晚于开始日期。");
  for (const [name, message] of Object.entries(paramErrors)) blockers.push(`${defs.find((d) => d.name === name)?.label ?? name}${message}`);
  for (const [name, message] of Object.entries(strategyErrors)) blockers.push(`策略参数「${plan.shared.find((d) => d.name === name)?.label ?? name}」${message}`);

  const submit = () => {
    const window = mw.window;
    void launcher.launch([{
      board: "trading", item: "strategy_comparison", engine: engine.version, dataset,
      window: { start: window.start, end_exclusive: window.endExclusive, align: window.align },
      domains: domainsPayload(domains),
      objects: { models: priceOnly ? [] : mw.infos.map(modelRef), strategies: strategies.map((s) => ({ key: s.key, version: s.version })), factors: [] },
      params: { ...paramsPayload(defs, effective, context), ...(useDatasetPick && defs.some((d) => d.name === "price_dataset") ? { price_dataset: priceDataset } : {}) },
    }], force);
  };

  const toggleStrategy = (id: string) => setStrategyKeys(strategyKeys.includes(id) ? strategyKeys.filter((k) => k !== id) : [...strategyKeys, id]);
  const runPmSimVersion = String(params[PM_SIM_VERSION_NAME] ?? "");
  const marketDefs = ui.rest.filter((d) => d.name === INCLUDE_MARKET_NAME);

  return <form className="bt-form" onSubmit={(event) => { event.preventDefault(); if (blockers.length === 0) submit(); }}>
    <p className="bt-caption">选择策略与模型后运行：策略在同一资金口径下并排比较。按北京时间，结束日不含。</p>

    <fieldset className="bt-picker">
      <legend>策略（可多选）</legend>
      <div className="bt-options bt-strategy-options" role="group" aria-label="策略">
        {[...data.strategies.filter((s) => !s.stepwise), ...data.strategies.filter((s) => s.stepwise)].map((strategy) => <StrategyOption key={strategy.id} strategy={strategy} checked={strategyKeys.includes(strategy.id)} onToggle={() => toggleStrategy(strategy.id)} runVersion={runPmSimVersion} />)}
      </div>
    </fieldset>

    <DomainPicker allDomains={data.domains} value={domains} onChange={setDomains} allowExclude={false} />
    {plans.narrowed.length > 0 && <p className="bt-note">以下策略只在其研究验证过的 domain 上成交，已自动收窄（与上面的选择无关）：{plans.narrowed.map((n) => `${n.strategy} → ${n.domains.join(" / ")}`).join("；")}</p>}

    {ui.groups.map((group) => {
      if (!group.defs.some((def) => isVisible(def, effective, context))) return null;
      return <fieldset className="bt-picker" key={group.id}>
        <legend>{group.title}</legend>
        {group.note && <p className="bt-note">{group.note}</p>}
        <ParamForm defs={markLegacyOnly(group.defs)} values={params} errors={paramErrors} onChange={changeParam} hide={["price_dataset"]} context={context} />
        {group.id === "scope" && hasStepwise && !hasLegacy && defs.some((d) => d.name === POSITION_MODE_NAME) && <p className="bt-note">逐时点策略的仓位由策略自己决定，这里不设仓位模式。</p>}
        {group.id === "scope" && hasStepwise && strict && <p className="bt-note">逐时点策略不做严格交集裁剪，按各模型自有全集计算；结果的口径卡片会如实标注。</p>}
      </fieldset>;
    })}
    {defs.length === 0 && <p className="bt-warn">引擎没有登记 trading/strategy_comparison 的参数定义，将使用服务端默认值。</p>}

    {hasStepwise && (plan.shared.length > 0 || plan.locked.length > 0 || invalidParams.length > 0) && <fieldset className="bt-picker">
      <legend>逐时点策略参数</legend>
      <p className="bt-note">按所选策略清单里声明的参数生成；只提交与默认值不同的项。同时选多个逐时点策略时，只有它们都声明了的参数可以改。</p>
      <ParamForm defs={plan.shared} values={strategyValues} errors={strategyErrors} onChange={(name, value) => setStrategyOverrides((current) => ({ ...current, [name]: value }))} idPrefix="bt-sparam" />
      {invalidParams.length > 0 && <p className="bt-warn" role="alert">{invalidParams.map((s) => s.label).join("、")} 的参数声明无法解析，这里不显示它的参数，运行时按策略默认值。</p>}
      {plan.locked.length > 0 && <ul className="bt-locked-params" aria-label="暂时不能修改的策略参数">{plan.locked.map((item) => <li key={item.def.name}><strong>{item.def.label}</strong><small>{item.reason}</small></li>)}</ul>}
    </fieldset>}

    {priceOnly
      ? <fieldset className="bt-picker"><legend>数据集（盘口）</legend><label><span>所选策略不读模型预测，读哪一套盘口</span><select className="select" value={priceDataset} onChange={(event) => setPriceDataset(event.target.value)}>{data.datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label></fieldset>
      : <>
        <ModelPicker pool={pool} selected={mw.selected} onChange={mw.setSelected} datasets={data.datasets}
          extra={marketDefs.length > 0 ? <ParamForm defs={marketDefs} values={params} errors={paramErrors} onChange={changeParam} context={context} /> : undefined} />
        {need.ignoring.length > 0 && <p className="bt-note">以下策略不读模型预测，选了模型也会被忽略：{need.ignoring.map((s) => s.label).join("、")}。</p>}
        {useDatasetPick && <fieldset className="bt-picker"><legend>数据集（盘口）</legend><label><span>没有选模型时，读哪一套盘口</span><select className="select" value={priceDataset} onChange={(event) => setPriceDataset(event.target.value)}>{data.datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label></fieldset>}
      </>}

    {nonSandbox.length > 0 && <p className="bt-warn">严格交集口径只对沙盒表有意义，以下模型不是沙盒表：{nonSandbox.map((m) => m.name).join("、")}。逐题交集题数与各模型答题率会在结果的口径卡片里给出。</p>}
    {strict && !priceOnly && mw.selected.length > 0 && <p className="bt-note">严格口径预览：逐题交集题数与各模型答题率需要读数据，运行后在口径卡片查看。</p>}
    {hourly && <p className="bt-warn">{hourly}</p>}
    {staleCache.length > 0 && <p className="bt-note">首次运行的模型（需要先建执行缓存，耗时较长）：{staleCache.map((m) => m.name).join("、")}</p>}

    <WindowPicker state={mw} selectedCount={mw.selected.length} showCovering={!priceOnly} />
    <SubmitBar blockers={blockers} busy={launcher.busy} error={launcher.error} label="运行回测" onSubmit={submit} force={force} onForce={setForce} />
  </form>;
}
