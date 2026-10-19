"use client";

import { useMemo, useState } from "react";
import type { CatalogItem, EngineInfo } from "../../lib/backtest-platform";
import { text as asText, record } from "../../lib/backtest-platform";
import { initialParamValues, paramsPayload, validateParams, type ParamValues } from "../../lib/backtest-params";
import {
  ALL_DOMAINS, beijingDate, compareInstant, dayStartIso, modelLabel, parseInstant, shiftDate, type DateWindow, type Instant, type ModelInfo,
} from "../../lib/backtest-selection";
import { paramDefsFor, type CatalogData } from "./catalog-context";
import { CatalogGate, SubmitBar, useLauncher } from "./forms-common";
import { ParamForm } from "./pickers";
import { V2Notice } from "../console-v2-resource";

type ObjectKind = "model" | "factor_pool" | "factor_experiment" | "batch" | "correlation";
const OBJECTS: Array<{ id: ObjectKind; label: string }> = [
  { id: "model", label: "模型 Signal Test" }, { id: "factor_pool", label: "单因子（因子池）" }, { id: "factor_experiment", label: "单因子（实验空间）" },
  { id: "batch", label: "自定义因子表（批量）" }, { id: "correlation", label: "因子池 Correlation" },
];

export function SignalForm() { return <CatalogGate>{(data) => <SignalFormInner data={data} />}</CatalogGate>; }

interface FactorView { item: CatalogItem; id: string; /** 页面内唯一：同一因子可有多个表版本 */ uid: string; label: string; table?: string; direction?: number; available: boolean; reason?: string; coverage?: { start: Instant; end: Instant }; description?: string }

function factorView(item: CatalogItem): FactorView {
  const meta = item.metadata;
  const coverage = record(meta.coverage);
  const start = parseInstant(asText(coverage.start)); const end = parseInstant(asText(coverage.end));
  return {
    item, id: item.key, uid: `${item.key}@${item.version}`, label: asText(meta.label) ?? item.key, table: item.version.includes("/") ? item.version.split("/")[0] : undefined,
    direction: meta.direction === undefined ? undefined : Number(meta.direction), available: meta.available !== false, reason: asText(meta.unavailable_reason),
    coverage: start && end ? { start, end } : undefined, description: asText(meta.description),
  };
}

function intersect(ranges: Array<{ start: Instant; end: Instant } | undefined>): { start: Instant; end: Instant } | undefined {
  if (ranges.length === 0 || ranges.some((r) => !r)) return undefined;
  const rs = ranges as Array<{ start: Instant; end: Instant }>;
  const start = rs.reduce((a, r) => compareInstant(a, r.start) >= 0 ? a : r.start, rs[0].start);
  const end = rs.reduce((a, r) => compareInstant(a, r.end) <= 0 ? a : r.end, rs[0].end);
  return compareInstant(start, end) <= 0 ? { start, end } : undefined;
}

/** 日期框：默认铺满对象覆盖区间；对象变化（key 变）时回到默认。 */
function useCoverageDates(key: string, coverage: { start: Instant; end: Instant } | undefined) {
  const [stored, setStored] = useState<{ key: string; dates: DateWindow }>();
  const defaults: DateWindow | undefined = coverage ? { startDate: beijingDate(coverage.start) as string, endDate: shiftDate(beijingDate(coverage.end) as string, 1) } : undefined;
  const dates = stored?.key === key ? stored.dates : defaults ?? { startDate: "", endDate: "" };
  const set = (patch: Partial<DateWindow>) => setStored({ key, dates: { ...dates, ...patch } });
  let error: string | undefined;
  if (!coverage) error = "所选对象没有共同的数据时间区间。";
  else if (!dates.startDate || !dates.endDate || dates.endDate <= dates.startDate) error = "结束日期必须晚于开始日期。";
  else if (defaults && (dates.startDate < defaults.startDate || dates.endDate > defaults.endDate)) error = `所选区间超出对象覆盖（${defaults.startDate} → ${defaults.endDate}，不含）。`;
  return { dates, set, error, defaults };
}

function SignalFormInner({ data }: { data: CatalogData }) {
  const engine = data.engine as EngineInfo;
  const [kind, setKind] = useState<ObjectKind>("model");
  const [force, setForce] = useState(false);
  const launcher = useLauncher();
  const factors = useMemo(() => data.factors.map(factorView), [data.factors]);
  const signalWindow = useMemo(() => engine.signalWindow ? { start: parseInstant(engine.signalWindow.start), end: parseInstant(engine.signalWindow.endExclusive) } : undefined, [engine]);

  const item = kind === "model" ? "model" : kind === "batch" ? "factor_batch" : kind === "correlation" ? "correlation" : "factor";
  const defs = useMemo(() => paramDefsFor(engine, "signal", item), [engine, item]);
  const [paramsByItem, setParamsByItem] = useState<Record<string, ParamValues>>({});
  const params = paramsByItem[item] ?? initialParamValues(defs);
  const errors = validateParams(defs, params);
  const supportsValidation = defs.some((d) => d.name === "validation_start");

  // ── 单对象状态 ──
  const [modelKey, setModelKey] = useState(data.models[0]?.key ?? "");
  const poolFactors = factors.filter((f) => kind === "factor_pool" ? f.item.poolState === "pool" : f.item.poolState !== "pool");
  const [factorKey, setFactorKey] = useState<string>();
  const factor = poolFactors.find((f) => f.uid === factorKey && f.available) ?? poolFactors.find((f) => f.available);
  const tables = useMemo(() => Array.from(new Set(factors.map((f) => f.item.version).filter((v) => v.includes("/") && !v.startsWith("legacy/")))).sort(), [factors]);
  const [tableVersion, setTableVersion] = useState<string>();
  const table = tableVersion ?? tables[0];
  const tableFactors = factors.filter((f) => f.item.version === table);
  const [pickedFactors, setPickedFactors] = useState<string[]>();
  const batchFactors = pickedFactors ? tableFactors.filter((f) => pickedFactors.includes(f.id)) : tableFactors;
  const [features, setFeatures] = useState<string[]>(() => factors.filter((f) => f.item.poolState === "pool" && f.available).map((f) => `factor:${f.uid}`).slice(0, 12));
  const [corrDataset, setCorrDataset] = useState(data.datasets[0]?.key ?? "");
  const [corrDomain, setCorrDomain] = useState(ALL_DOMAINS);
  const [batchStart, setBatchStart] = useState("");
  const [batchEnd, setBatchEnd] = useState("");
  const [validation, setValidation] = useState(false);
  const [validationStart, setValidationStart] = useState("");

  const model: ModelInfo | undefined = data.models.find((m) => m.key === modelKey);
  const featureModels = features.filter((f) => f.startsWith("model:")).map((f) => data.models.find((m) => m.key === f.slice(6))).filter((m): m is ModelInfo => !!m);
  const featureFactors = features.filter((f) => f.startsWith("factor:")).map((f) => factors.find((x) => x.uid === f.slice(7))).filter((f): f is FactorView => !!f);

  const coverage = kind === "model"
    ? intersect([model?.start && model.end ? { start: model.start, end: model.end } : undefined, ...(signalWindow?.start && signalWindow.end ? [{ start: signalWindow.start, end: signalWindow.end }] : [])])
    : kind === "correlation" ? intersect([...featureFactors.map((f) => f.coverage), ...featureModels.map((m) => m.start && m.end ? { start: m.start, end: m.end } : undefined)])
      : kind === "batch" ? undefined : factor?.coverage;
  const coverageKey = `${kind}:${modelKey}:${factor?.id}:${features.join(",")}`;
  const cdates = useCoverageDates(coverageKey, coverage);

  const blockers: string[] = [];
  let runBody: Record<string, unknown> | undefined;
  const common = { board: "signal", item, engine: engine.version };
  if (kind === "model") {
    if (!model) blockers.push("请选择模型。");
    if (cdates.error) blockers.push(cdates.error);
    if (model) runBody = { ...common, dataset: model.dataset, window: { start: dayStartIso(cdates.dates.startDate), end_exclusive: dayStartIso(cdates.dates.endDate), align: "natural_day" }, domains: { mode: "include", values: ["all"] }, objects: { models: [{ key: model.catalogKey, version: model.version }], strategies: [], factors: [] }, params: paramsPayload(defs, params) };
  } else if (kind === "factor_pool" || kind === "factor_experiment") {
    if (!factor) blockers.push(kind === "factor_pool" ? "因子池里没有可用的因子。" : "实验空间里没有可用的因子。");
    if (cdates.error) blockers.push(cdates.error);
    if (factor) runBody = { ...common, window: { start: dayStartIso(cdates.dates.startDate), end_exclusive: dayStartIso(cdates.dates.endDate), align: "natural_day" }, domains: { mode: "include", values: ["all"] }, objects: { models: [], strategies: [], factors: [{ key: factor.item.key, version: factor.item.version }] }, params: paramsPayload(defs, params) };
  } else if (kind === "batch") {
    if (!table) blockers.push("还没有提交过因子表；先到「提交」页上传。");
    if (batchFactors.length === 0 && table) blockers.push("请至少选择一个因子。");
    if (!batchStart || !batchEnd) blockers.push("请填写评估窗口的开始与结束时间（UTC）。");
    else if (batchEnd <= batchStart) blockers.push("结束时间必须晚于开始时间。");
    if (validation && supportsValidation && (!validationStart || validationStart <= batchStart || validationStart >= batchEnd)) blockers.push("对照期起点必须在评估区间内。");
    if (table && batchStart && batchEnd) runBody = { ...common, window: { start: `${batchStart}:00Z`, end_exclusive: `${batchEnd}:00Z`, align: "utc_exact" }, domains: { mode: "include", values: ["all"] }, objects: { models: [], strategies: [], factors: batchFactors.map((f) => ({ key: f.item.key, version: f.item.version })) }, params: { ...paramsPayload(defs, params), ...(validation && validationStart && supportsValidation ? { validation_start: `${validationStart}:00Z` } : {}) } };
  } else {
    if (features.length < 2) blockers.push("相关性测试至少选择两个因子或模型。");
    if (cdates.error) blockers.push(cdates.error);
    const mixed = new Set(featureModels.map((m) => m.dataset)); mixed.delete(corrDataset); mixed.delete(undefined);
    if (mixed.size > 0) blockers.push("所选模型没有挂在选中的数据集上。");
    runBody = { ...common, dataset: corrDataset, window: { start: dayStartIso(cdates.dates.startDate), end_exclusive: dayStartIso(cdates.dates.endDate), align: "natural_day" }, domains: { mode: "include", values: [corrDomain === ALL_DOMAINS ? "all" : corrDomain] }, objects: { models: featureModels.map((m) => ({ key: m.catalogKey, version: m.version })), strategies: [], factors: featureFactors.map((f) => ({ key: f.item.key, version: f.item.version })) }, params: paramsPayload(defs, params) };
  }
  for (const [name, message] of Object.entries(errors)) blockers.push(`${defs.find((d) => d.name === name)?.label ?? name}${message}`);
  const datasetLabels = Object.fromEntries(data.datasets.map((d) => [d.key, d.label]));

  const dateRow = <fieldset className="bt-picker"><legend>时间窗口（北京时间，结束日不含）</legend>
    <div className="bt-form-row">
      <label><span>开始日期</span><input className="input" type="date" value={cdates.dates.startDate} onChange={(event) => cdates.set({ startDate: event.target.value })} /></label>
      <label><span>结束日期（不含）</span><input className="input" type="date" value={cdates.dates.endDate} onChange={(event) => cdates.set({ endDate: event.target.value })} /></label>
    </div>
    {cdates.defaults && <p className="bt-note">对象覆盖区间：{cdates.defaults.startDate} → {cdates.defaults.endDate}（不含）{kind === "model" && signalWindow ? "；已与 Signal Test 卷子固定的盘口窗口求交" : ""}。</p>}
    {cdates.error && <p className="bt-warn" role="alert">{cdates.error}</p>}
  </fieldset>;

  return <form className="bt-form" onSubmit={(event) => { event.preventDefault(); if (blockers.length === 0 && runBody) void launcher.launch([runBody], force); }}>
    <p className="bt-caption">与交易无关。同一份卷子：24h Pearson IC 主筛、Rank IC 人工复审、六周期 10 桶（仅 YES）、分 domain 诊断；北京时间。</p>
    <fieldset className="bt-picker"><legend>测试对象</legend>
      <div className="v2-local-tabs" role="radiogroup" aria-label="测试对象">{OBJECTS.map((o) => <button type="button" role="radio" aria-checked={kind === o.id} key={o.id} className={kind === o.id ? "active" : ""} onClick={() => setKind(o.id)}>{o.label}</button>)}</div>
    </fieldset>

    {kind === "model" && <fieldset className="bt-picker"><legend>模型</legend>
      <label><span>模型（含 market-view；括号内为预测可用区间）</span><select className="select" value={modelKey} onChange={(event) => setModelKey(event.target.value)}>{data.models.map((m) => <option key={m.key} value={m.key}>{modelLabel(m, datasetLabels)}</option>)}</select></label>
      <p className="bt-note">模型 edge = 本侧概率 − 本侧 mid；覆盖 = 模型区间 ∩ 卷子窗口。</p></fieldset>}

    {(kind === "factor_pool" || kind === "factor_experiment") && <fieldset className="bt-picker"><legend>{kind === "factor_pool" ? "单因子（因子池）" : "单因子（实验空间）"}</legend>
      {poolFactors.length === 0 ? <p className="bt-muted">这里还没有因子。</p> : <label><span>因子</span><select className="select" value={factor?.uid ?? ""} onChange={(event) => setFactorKey(event.target.value)}>{poolFactors.map((f) => <option key={f.uid} value={f.uid} disabled={!f.available}>{f.label}{f.item.version.includes("/") ? ` · ${f.item.version}` : ""}{f.available ? "" : "（无可用数据）"}</option>)}</select></label>}
      {factor?.description && <p className="bt-note">{factor.description}</p>}
      {kind === "factor_pool" && factor?.direction !== undefined && <p className="bt-note">入池方向：{factor.direction < 0 ? "−1（反转后评估）" : "+1（原方向）"}</p>}
      {poolFactors.filter((f) => !f.available).map((f) => <p className="bt-warn" key={f.uid}>{f.label}：{f.reason ?? "无可用数据"}</p>)}
    </fieldset>}

    {kind === "batch" && <fieldset className="bt-picker"><legend>自定义因子表（批量）</legend>
      <p className="bt-note">Pearson IC · Δmid · YES + NO · 24h 主口径 · 1h / 12h / 24h / 48h / 96h / 7d。因子表通过「提交」页上传，这里选已通过校验的表。</p>
      {tables.length === 0 ? <V2Notice title="还没有因子表" description="先到「提交」页上传因子表（五列 Parquet）。" /> : <>
        <label><span>因子表（表名 / 版本）</span><select className="select" value={table} onChange={(event) => { setTableVersion(event.target.value); setPickedFactors(undefined); }}>{tables.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <div className="bt-chips bt-domain-chips" role="group" aria-label="参与评估的因子">{tableFactors.map((f) => { const on = batchFactors.some((x) => x.id === f.id); return <button type="button" key={f.id} className={`bt-toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={() => { const current = pickedFactors ?? tableFactors.map((x) => x.id); setPickedFactors(on ? current.filter((id) => id !== f.id) : [...current, f.id]); }}>{f.label}</button>; })}</div>
        <p className="bt-note">共 {tableFactors.length} 个因子，已选 {batchFactors.length} 个。Holm 校正按本批所选因子数计算。</p></>}
      <div className="bt-form-row">
        <label><span>评估开始（UTC）</span><input className="input" type="datetime-local" value={batchStart} onChange={(event) => setBatchStart(event.target.value)} /></label>
        <label><span>评估结束（UTC）</span><input className="input" type="datetime-local" value={batchEnd} onChange={(event) => setBatchEnd(event.target.value)} /></label>
      </div>
      <label className="bt-check"><input type="checkbox" checked={validation && supportsValidation} disabled={!supportsValidation} onChange={(event) => setValidation(event.target.checked)} /><span>研究期 / 对照期分开显示{supportsValidation ? "" : "（当前引擎没有登记 validation_start 参数）"}</span></label>
      {validation && supportsValidation && <label><span>对照期起点（UTC）</span><input className="input" type="datetime-local" value={validationStart} onChange={(event) => setValidationStart(event.target.value)} /></label>}
    </fieldset>}

    {kind === "correlation" && <fieldset className="bt-picker"><legend>搜索并添加单因子或模型（2–12 个）</legend>
      <div className="bt-form-row">
        <button type="button" className="button" onClick={() => setFeatures(factors.filter((f) => f.item.poolState === "pool" && f.available).map((f) => `factor:${f.uid}`).slice(0, 12))}>一键载入全部因子池（{factors.filter((f) => f.item.poolState === "pool" && f.available).length}）</button>
        <button type="button" className="button" disabled={features.length === 0} onClick={() => setFeatures([])}>清空选择</button>
      </div>
      <div className="bt-options" role="group" aria-label="相关性特征">{[...factors.filter((f) => f.available).map((f) => ({ id: `factor:${f.uid}`, label: `[${f.item.poolState === "pool" ? "因子池" : "实验空间"}] ${f.label}${f.item.version.includes("/") ? ` · ${f.item.version}` : ""}` })), ...data.models.map((m) => ({ id: `model:${m.key}`, label: `[模型] ${m.name} · edge` }))].map((option) => <label className={`bt-option ${features.includes(option.id) ? "selected" : ""}`} key={option.id}><input type="checkbox" checked={features.includes(option.id)} onChange={() => setFeatures(features.includes(option.id) ? features.filter((f) => f !== option.id) : features.length >= 12 ? features : [...features, option.id])} /><span>{option.label}</span></label>)}</div>
      <div className="bt-chips">{features.map((f) => <span className="bt-chip" key={f}><span>{f.replace(/^factor:/, "").replace(/^model:/, "模型 ")}</span><button type="button" aria-label={`移除 ${f}`} onClick={() => setFeatures(features.filter((x) => x !== f))}>×</button></span>)}</div>
      <div className="bt-form-row">
        <label><span>数据集</span><select className="select" value={corrDataset} onChange={(event) => setCorrDataset(event.target.value)}>{data.datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label>
        <label><span>Domain</span><select className="select" value={corrDomain} onChange={(event) => setCorrDomain(event.target.value)}>{[ALL_DOMAINS, ...data.domains].map((d) => <option key={d}>{d}</option>)}</select></label>
      </div>
      <p className="bt-note">方向与模型因子定义：REV 表示取反后参与，模型特征为 MODEL:…:EDGE。新提交的因子是否能参与，取决于引擎脚本是否支持按文件传入因子。</p>
    </fieldset>}

    {kind !== "batch" && dateRow}
    {defs.length > 0 && <fieldset className="bt-picker"><legend>参数</legend><ParamForm defs={defs} values={params} errors={errors} hide={["validation_start"]} onChange={(name, value) => setParamsByItem((current) => ({ ...current, [item]: { ...(current[item] ?? params), [name]: value } }))} /></fieldset>}
    <SubmitBar blockers={blockers} busy={launcher.busy} error={launcher.error} label={kind === "correlation" ? "运行相关性测试" : kind === "batch" ? "评估批次" : "运行信号评估"} onSubmit={() => runBody && void launcher.launch([runBody], force)} force={force} onForce={setForce} />
  </form>;
}
