"use client";

import { useMemo, useState } from "react";
import type { EngineInfo } from "../../lib/backtest-platform";
import { initialParamValues, paramsPayload, validateParams, type ParamValues } from "../../lib/backtest-params";
import {
  ALL_DOMAINS, datasetConflict, domainState, domainsPayload, strategyDomainPlan, type DomainSelection, type ModelInfo,
} from "../../lib/backtest-selection";
import { paramDefsFor, type CatalogData } from "./catalog-context";
import { CatalogGate, SubmitBar, useLauncher } from "./forms-common";
import { DomainPicker, ModelPicker, ParamForm, WindowPicker, useModelWindow } from "./pickers";

export function TradingForm() { return <CatalogGate>{(data) => <TradingFormInner data={data} />}</CatalogGate>; }

const modelRef = (m: ModelInfo) => ({ key: m.catalogKey, version: m.version });

function TradingFormInner({ data }: { data: CatalogData }) {
  const engine = data.engine as EngineInfo;
  const defs = useMemo(() => paramDefsFor(engine, "trading", "strategy_comparison"), [engine]);
  const [params, setParams] = useState<ParamValues>(() => initialParamValues(defs));
  const [strategyKeys, setStrategyKeys] = useState<string[]>(() => data.strategies[0] ? [data.strategies[0].id] : []);
  const [domains, setDomains] = useState<DomainSelection>({ mode: "include", values: [ALL_DOMAINS] });
  const [priceDataset, setPriceDataset] = useState(data.datasets[0]?.key ?? "");
  const [force, setForce] = useState(false);
  const launcher = useLauncher();

  const strategies = useMemo(() => data.strategies.filter((s) => strategyKeys.includes(s.id)), [data.strategies, strategyKeys]);
  const priceOnly = strategies.length > 0 && strategies.every((s) => s.priceOnly);
  const strict = String(params.scope ?? "strict") !== "own";
  // 严格口径 = 沙盒标签模型（含 market-view）；各模型自有全集 = 去掉 market-view（旧 scope_models）
  const pool = useMemo(() => data.models.filter((m) => strict ? m.tags.includes("sandbox") || m.marketView : !m.marketView), [data.models, strict]);
  const mw = useModelWindow(pool);

  const changeParam = (name: string, value: string | boolean) => {
    setParams((current) => ({ ...current, [name]: value }));
    if (name === "scope") {
      const nextStrict = String(value) !== "own";
      const allowed = new Set(data.models.filter((m) => nextStrict ? m.tags.includes("sandbox") || m.marketView : !m.marketView).map((m) => m.key));
      mw.setSelected(mw.selected.filter((key) => allowed.has(key)));
    }
  };

  const conflict = datasetConflict(mw.selected, pool, data.datasets);
  const domain = domainState(domains, data.domains);
  const plan = strategyDomainPlan(strategies, domains);
  const paramErrors = validateParams(defs, params);
  const dataset = priceOnly ? priceDataset : mw.infos[0]?.dataset;
  const datasetInfo = data.datasets.find((d) => d.key === dataset);
  const hourly = strategies.some((s) => s.readsHourlyFactors) ? datasetInfo?.hourlyFactorNote : undefined;
  const nonSandbox = strict && !priceOnly ? mw.infos.filter((m) => !m.marketView && !m.tags.includes("sandbox")) : [];
  const staleCache = strategies.some((s) => s.needsExecutionCache) ? mw.infos.filter((m) => m.cacheStale) : [];

  const blockers: string[] = [];
  if (strategies.length === 0) blockers.push("请至少选择一个策略。");
  if (!priceOnly && mw.selected.length === 0) blockers.push("请至少选择一个模型。");
  if (priceOnly && !priceDataset) blockers.push("请选择盘口数据集。");
  if (domain.blocked) blockers.push(domain.error ?? domain.warning ?? "Domain 选择无效。");
  if (plan.empty.length) blockers.push(`以下策略与所选 domain 没有交集：${plan.empty.join("、")}。`);
  if (conflict) blockers.push("所选模型来自不同数据集。");
  if (mw.invalid) blockers.push("结束日期必须晚于开始日期。");
  for (const [name, message] of Object.entries(paramErrors)) blockers.push(`${defs.find((d) => d.name === name)?.label ?? name}${message}`);

  const submit = () => {
    const window = mw.window;
    void launcher.launch([{
      board: "trading", item: "strategy_comparison", engine: engine.version, dataset,
      window: { start: window.start, end_exclusive: window.endExclusive, align: window.align },
      domains: domainsPayload(domains),
      objects: { models: priceOnly ? [] : mw.infos.map(modelRef), strategies: strategies.map((s) => ({ key: s.key, version: s.version })), factors: [] },
      params: { ...paramsPayload(defs, params), ...(priceOnly && defs.some((d) => d.name === "price_dataset") ? { price_dataset: priceDataset } : {}) },
    }], force);
  };

  return <form className="bt-form" onSubmit={(event) => { event.preventDefault(); if (blockers.length === 0) submit(); }}>
    <p className="bt-caption">选择策略与模型后运行：策略在同一资金口径下并排比较。按北京时间，结束日不含；纯价格策略（V4/V5）不读模型预测。</p>

    <fieldset className="bt-picker">
      <legend>策略（可多选）</legend>
      <div className="bt-options bt-strategy-options" role="group" aria-label="策略">
        {data.strategies.map((strategy) => <label className={`bt-option ${strategyKeys.includes(strategy.id) ? "selected" : ""}`} key={strategy.id}>
          <input type="checkbox" checked={strategyKeys.includes(strategy.id)} onChange={() => setStrategyKeys(strategyKeys.includes(strategy.id) ? strategyKeys.filter((k) => k !== strategy.id) : [...strategyKeys, strategy.id])} />
          <span><span className="bt-option-head"><strong>{strategy.label}</strong>{strategy.validatedDomains && <em>（只在 {strategy.validatedDomains.join(" / ")} 成交）</em>}{strategy.priceOnly && <em>（纯价格）</em>}</span>{strategy.description && <small>{strategy.description}</small>}</span>
        </label>)}
      </div>
    </fieldset>

    <DomainPicker allDomains={data.domains} value={domains} onChange={setDomains} allowExclude={false} />
    {plan.narrowed.length > 0 && <p className="bt-note">以下策略只在其研究验证过的 domain 上成交，已自动收窄（与上面的选择无关）：{plan.narrowed.map((n) => `${n.strategy} → ${n.domains.join(" / ")}`).join("；")}</p>}

    <fieldset className="bt-picker">
      <legend>口径、仓位与资金</legend>
      <ParamForm defs={defs} values={params} errors={paramErrors} onChange={changeParam} hide={["price_dataset"]} />
      {defs.length === 0 && <p className="bt-warn">引擎没有登记 trading/strategy_comparison 的参数定义，将使用服务端默认值。</p>}
    </fieldset>

    {priceOnly
      ? <fieldset className="bt-picker"><legend>数据集（盘口）</legend><label><span>纯价格策略读哪一套盘口</span><select className="select" value={priceDataset} onChange={(event) => setPriceDataset(event.target.value)}>{data.datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label></fieldset>
      : <ModelPicker pool={pool} selected={mw.selected} onChange={mw.setSelected} datasets={data.datasets} />}

    {nonSandbox.length > 0 && <p className="bt-warn">严格交集口径只对沙盒表有意义，以下模型不是沙盒表：{nonSandbox.map((m) => m.name).join("、")}。逐题交集题数与各模型答题率会在结果的口径卡片里给出。</p>}
    {strict && !priceOnly && mw.selected.length > 0 && <p className="bt-note">严格口径预览：逐题交集题数与各模型答题率需要读数据，运行后在口径卡片查看。</p>}
    {hourly && <p className="bt-warn">{hourly}</p>}
    {staleCache.length > 0 && <p className="bt-note">首次运行的模型（需要先建执行缓存，耗时较长）：{staleCache.map((m) => m.name).join("、")}</p>}

    <WindowPicker state={mw} selectedCount={mw.selected.length} showCovering={!priceOnly} />
    <SubmitBar blockers={blockers} busy={launcher.busy} error={launcher.error} label="运行回测" onSubmit={submit} force={force} onForce={setForce} />
  </form>;
}
