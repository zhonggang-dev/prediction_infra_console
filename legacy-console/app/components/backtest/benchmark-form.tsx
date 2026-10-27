"use client";

import { useMemo, useState } from "react";
import type { EngineInfo } from "../../lib/backtest-platform";
import { initialParamValues, paramsPayload, validateParams, type ParamValues } from "../../lib/backtest-params";
import { ALL_DOMAINS, datasetConflict, domainState, domainsPayload, type DomainSelection, type ModelInfo } from "../../lib/backtest-selection";
import { paramDefsFor, type CatalogData } from "./catalog-context";
import { CatalogGate, SubmitBar, useLauncher } from "./forms-common";
import { DomainPicker, ModelPicker, ParamForm, WindowPicker, useModelWindow } from "./pickers";

/** 目录分组与说明文案（只是导航标签，不含口径；口径与默认值在引擎参数定义里）。 */
const FAMILIES = [
  { id: "overview", label: "总览", blurb: "一次运行全部默认口径的 Benchmark，并排成一张宽表：5 个策略列 + Model Signal + 交易 + 概率质量。", items: ["overview"] },
  { id: "signal", label: "信号（1）", blurb: "模型预测相对中价的 edge 与未来中价变动的相关性。", items: ["model_signal"] },
  { id: "trading", label: "交易（1）", blurb: "固定 Baseline 规则下每股结算 PnL，共同样本上比较。", items: ["directional_roi"] },
  { id: "probability", label: "概率质量（4）", blurb: "概率本身准不准：Brier、固定 TTE Brier、校准、偏离。", items: ["resolved_event_brier", "fixed_horizon_brier", "calibration", "deviation"] },
] as const;

const ITEM_INFO: Record<string, { label: string; rank: string; desc: string }> = {
  overview: { label: "总览（全部默认口径）", rank: "各列独立，不合成总分", desc: "5 个策略（原生仓位、无限资金）+ 6 个 Benchmark 的默认口径；已有成功结果的子项直接复用。" },
  model_signal: { label: "Model Signal IC / ICIR", rank: "所选 horizon 的 Pearson IC", desc: "与 Signal Test 同一个评估器，相同配置下 IC / ICIR 相同。" },
  directional_roi: { label: "交易 · Baseline V1.1 · 结算 PnL/share", rank: "每股结算 PnL", desc: "共同 3 小时样本网格上的方向交易，附 95% 置信区间。" },
  resolved_event_brier: { label: "已结算市场 · Brier Score", rank: "市场等权 Brier", desc: "只评已结算市场；与 Market 的配对差给出「更准 / 更差 / 分不出」。" },
  fixed_horizon_brier: { label: "固定 TTE · Brier Score", rank: "Brier（结算前 x 天）", desc: "把每个市场固定在结算前 x 天打分，消除时间点差异。" },
  calibration: { label: "概率校准 · Calibration", rank: "ECE（expected_calibration_error）", desc: "按概率桶比较预测与实际 YES 率；排名用 ECE，MCB 作为参考列保留。" },
  deviation: { label: "偏离校准 · 不抄市场时准不准", rank: "不排名（market brier ÷ 模型 brier）", desc: "只给偏离中价超过 τ 的格子打分；比值 > 1 表示胜过市场；这不是排行榜。" },
};

const itemLabel = (key: string) => ITEM_INFO[key]?.label ?? key;
const itemRank = (key: string) => ITEM_INFO[key]?.rank ?? "";

export function BenchmarkForm() { return <CatalogGate>{(data) => <BenchmarkFormInner data={data} />}</CatalogGate>; }

const modelRef = (m: ModelInfo) => ({ key: m.catalogKey, version: m.version });

function BenchmarkFormInner({ data }: { data: CatalogData }) {
  const engine = data.engine as EngineInfo;
  const [item, setItem] = useState("overview");
  const family = FAMILIES.find((f) => (f.items as readonly string[]).includes(item)) ?? FAMILIES[0];
  const [paramsByItem, setParamsByItem] = useState<Record<string, ParamValues>>({});
  const [domains, setDomains] = useState<DomainSelection>({ mode: "include", values: [ALL_DOMAINS] });
  const [parked, setParked] = useState<string[]>([]);
  const [force, setForce] = useState(false);
  const launcher = useLauncher();

  const exclusionReason = engine.marketViewExclusions[`benchmark/${item}`];
  const rejectsMarketView = item === "overview" || exclusionReason !== undefined;
  const pool = useMemo(() => rejectsMarketView ? data.models.filter((m) => !m.marketView) : data.models, [data.models, rejectsMarketView]);
  const defs = useMemo(() => paramDefsFor(engine, "benchmark", item), [engine, item]);
  const params = paramsByItem[item] ?? initialParamValues(defs);
  const mw = useModelWindow(pool, { autoPin: item === "overview" });

  const changeItem = (next: string) => {
    const nextRejects = next === "overview" || engine.marketViewExclusions[`benchmark/${next}`] !== undefined;
    const marketKeys = data.models.filter((m) => m.marketView).map((m) => m.key);
    if (nextRejects) {
      // 寄存已选的 market-view 模型，切回接受它们的 benchmark 时放回（旧 _park_market_view_models）
      const hold = mw.selected.filter((k) => marketKeys.includes(k));
      if (hold.length) { setParked((current) => Array.from(new Set([...current, ...hold]))); mw.setSelected(mw.selected.filter((k) => !hold.includes(k)), true); }
    } else if (parked.length) {
      mw.setSelected(Array.from(new Set([...mw.selected, ...parked])), true);
      setParked([]);
    }
    setItem(next);
  };

  const conflict = datasetConflict(mw.selected, pool, data.datasets);
  const domain = domainState(domains, data.domains);
  const errors = validateParams(defs, params);
  const nonSandbox = item === "overview" ? mw.infos.filter((m) => !m.tags.includes("sandbox")) : [];
  const info = ITEM_INFO[item] ?? { label: item, rank: "", desc: "" };

  const blockers: string[] = [];
  if (mw.selected.length === 0) blockers.push("请至少选择一个模型。");
  if (domain.blocked) blockers.push(domain.error ?? domain.warning ?? "Domain 选择无效。");
  if (conflict) blockers.push("所选模型来自不同数据集。");
  if (mw.invalid) blockers.push("结束日期必须晚于开始日期。");
  for (const [name, message] of Object.entries(errors)) blockers.push(`${defs.find((d) => d.name === name)?.label ?? name}${message}`);

  const submit = () => {
    const window = mw.window;
    void launcher.launch([{
      board: "benchmark", item, engine: engine.version, dataset: mw.infos[0]?.dataset,
      window: { start: window.start, end_exclusive: window.endExclusive, align: window.align },
      domains: domainsPayload(domains),
      objects: { models: mw.infos.map(modelRef), strategies: [], factors: [] },
      params: paramsPayload(defs, params),
    }], force);
  };

  return <form className="bt-form" onSubmit={(event) => { event.preventDefault(); if (blockers.length === 0) submit(); }}>
    <p className="bt-caption">不可配置策略、仓位与资金。按北京时间，结束日不含。</p>
    <fieldset className="bt-picker">
      <legend>Benchmark 目录</legend>
      <div className="v2-local-tabs" role="radiogroup" aria-label="Benchmark 族">
        {FAMILIES.map((f) => <button type="button" role="radio" aria-checked={f.id === family.id} key={f.id} className={f.id === family.id ? "active" : ""} onClick={() => changeItem(f.items[0])}>{f.label}</button>)}
      </div>
      <p className="bt-note">{family.blurb}</p>
      {family.items.length > 1 && <div className="bt-options" role="radiogroup" aria-label="Benchmark">{family.items.map((key) => <label className={`bt-option ${item === key ? "selected" : ""}`} key={key}><input type="radio" name="benchmark-item" checked={item === key} onChange={() => changeItem(key)} /><span>{itemLabel(key)}<small>排名指标：{itemRank(key)}</small></span></label>)}</div>}
      <p className="bt-note"><strong>{info.label}</strong>：{info.desc}{info.rank && item !== "overview" ? ` 排名指标：${info.rank}。` : ""}</p>
    </fieldset>

    <DomainPicker allDomains={data.domains} value={domains} onChange={setDomains} allowExclude />
    {defs.length > 0 && <fieldset className="bt-picker"><legend>参数</legend><ParamForm defs={defs} values={params} errors={errors} onChange={(name, value) => setParamsByItem((current) => ({ ...current, [item]: { ...(current[item] ?? params), [name]: value } }))} /></fieldset>}

    <ModelPicker pool={pool} selected={mw.selected} onChange={mw.setSelected} datasets={data.datasets} exclusionReason={item === "overview" ? "总览的 Market 行由执行器自动带上，不需要手选。" : exclusionReason} />
    {nonSandbox.length > 0 && <p className="bt-warn">所选模型含非沙盒表（{nonSandbox.map((m) => m.name).join("、")}）：五个策略列会退到「各模型自有全集」口径，不是严格交集；这会写进结果的口径卡片。</p>}
    {item === "overview" && <p className="bt-note">更换模型会自动钉住公共时间区间（可手动改日期解除）。五个策略列固定原生仓位 + 无限资金，MultFactor 只在 World / Geopolitics 成交。</p>}

    <WindowPicker state={mw} selectedCount={mw.selected.length} />
    <SubmitBar blockers={blockers} busy={launcher.busy} error={launcher.error} label={item === "overview" ? "一键运行全部默认 Benchmark" : "运行 Benchmark"} onSubmit={submit} force={force} onForce={setForce} />
  </form>;
}
