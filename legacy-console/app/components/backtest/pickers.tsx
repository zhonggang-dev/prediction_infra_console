"use client";

import { useMemo, useState } from "react";
import type { ParamDef } from "../../lib/backtest-platform";
import {
  ALL_DOMAINS, applyCombo, beijingDate, buildWindow, coverageWarnings, datasetConflict, defaultDates, deriveCombos, domainState, keepSingleDataset, modelLabel, modelsCoveringWindow, shiftDate, strictModelIntersection,
  type DatasetInfo, type DateWindow, type DomainMode, type DomainSelection, type ModelInfo, type Window,
} from "../../lib/backtest-selection";
import { isVisible, type ParamContext, type ParamValues } from "../../lib/backtest-params";
import { V2Notice } from "../console-v2-resource";

// ───────────────────────── 模型 + 窗口状态 ─────────────────────────

export type Notice = { tone: "info" | "warn" | "error"; text: string } | undefined;

/** 模型选择与窗口联动：换模型重置日期并退出公共区间；一键对齐公共区间；一键选全量覆盖模型。 */
export function useModelWindow(pool: ModelInfo[], options: { autoPin?: boolean } = {}) {
  const [selected, setSelectedRaw] = useState<string[]>([]);
  const [override, setOverride] = useState<DateWindow>();
  const [pinned, setPinned] = useState<Window>();
  const [notice, setNotice] = useState<Notice>();
  const infos = useMemo(() => pool.filter((model) => selected.includes(model.key)), [pool, selected]);
  const defaults = useMemo(() => defaultDates(infos, pool), [infos, pool]);
  const dates: DateWindow = override ?? defaults ?? { startDate: "", endDate: "" };

  const pinCommon = (keys: string[]): Window | undefined => {
    const chosen = pool.filter((model) => keys.includes(model.key));
    if (chosen.length < 2) return undefined;
    try { return strictModelIntersection(chosen); } catch { return undefined; }
  };

  const setSelected = (keys: string[], preserveDates = false) => {
    setSelectedRaw(keys);
    setNotice(undefined);
    if (preserveDates) return;
    setOverride(undefined);
    setPinned(options.autoPin ? pinCommon(keys) : undefined);
  };
  const setStartDate = (startDate: string) => { setOverride({ ...dates, startDate }); setPinned(undefined); };
  const setEndDate = (endDate: string) => { setOverride({ ...dates, endDate }); setPinned(undefined); };
  const alignCommon = () => {
    try {
      const common = strictModelIntersection(infos);
      setPinned(common);
      setOverride({ startDate: beijingDate(common.start) ?? dates.startDate, endDate: beijingDate(common.endExclusive) ?? dates.endDate });
      setNotice(undefined);
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "无法对齐公共时间区间" }); }
  };
  const window = buildWindow(dates, pinned);
  const selectCovering = () => {
    const covering = modelsCoveringWindow(pool, window);
    setSelectedRaw(covering.map((model) => model.key));
    setNotice(covering.length
      ? { tone: "info", text: `已选择 ${covering.length} 个全量覆盖当前北京时间区间的模型；日期保持不变，当前为${pinned ? "公共区间" : "自然日区间"}模式。` }
      : { tone: "warn", text: "当前北京时间区间内没有模型全量覆盖，模型选择已清空。" });
  };
  const invalid = !pinned && (!dates.startDate || !dates.endDate || dates.endDate <= dates.startDate);
  return { selected, setSelected, infos, dates, pinned, window, setStartDate, setEndDate, alignCommon, selectCovering, notice, setNotice, invalid };
}

// ───────────────────────── 模型选择器 ─────────────────────────

export function ModelPicker({ pool, catalogModels, selected, onChange, datasets, label = "模型", disabled = false, disabledNote, exclusionReason, max, extra }: {
  pool: ModelInfo[];
  /** 全部模型（不按口径过滤）：快捷按钮按它出，和旧平台一样不管口径都显示；点了只从 pool 里加，没命中就提示 */
  catalogModels?: ModelInfo[]; selected: string[]; onChange: (keys: string[], preserveDates?: boolean) => void; datasets: DatasetInfo[]; label?: string; disabled?: boolean; disabledNote?: string; exclusionReason?: string; max?: number; extra?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<Notice>();
  const datasetLabels = useMemo(() => Object.fromEntries(datasets.map((d) => [d.key, d.label])), [datasets]);
  const combos = useMemo(() => deriveCombos(catalogModels ?? pool, datasets), [catalogModels, pool, datasets]);
  const conflict = useMemo(() => datasetConflict(selected, pool, datasets), [selected, pool, datasets]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool.filter((model) => !q || modelLabel(model, datasetLabels).toLowerCase().includes(q));
  }, [pool, query, datasetLabels]);
  const toggle = (key: string) => {
    if (selectedSet.has(key)) onChange(selected.filter((k) => k !== key));
    else if (max !== undefined && selected.length >= max) setMessage({ tone: "warn", text: `最多选择 ${max} 个。` });
    else onChange([...selected, key]);
  };
  const groups = datasets.filter((dataset) => combos.some((combo) => combo.datasetKey === dataset.key));

  if (disabled) return <fieldset className="bt-picker" disabled><legend>{label}</legend><p className="bt-muted">{disabledNote ?? "当前口径不需要选择模型。"}</p></fieldset>;
  return <fieldset className="bt-picker">
    <legend>{label}（括号内为预测可用区间，北京时间）</legend>
    {exclusionReason && <p className="bt-note">本口径不提供 Market 基准行：{exclusionReason}</p>}
    {extra}
    {groups.length > 0 && <div className="bt-combos" aria-label="按标签一键加入">
      {groups.map((dataset) => <div className="bt-combo-row" key={dataset.key}>
        <span className="bt-combo-label">{dataset.label}</span>
        {combos.filter((combo) => combo.datasetKey === dataset.key).map((combo) => <button type="button" className="button bt-combo" key={combo.id} title={combo.help} onClick={() => {
          const result = applyCombo(selected, pool, combo);
          if (result.error) setMessage({ tone: "warn", text: result.error });
          else { onChange(result.selected); setMessage({ tone: "info", text: `${combo.label} 选入 ${result.hits} 个模型（已与原有选择合并，新增 ${result.added} 个）。` }); }
        }}>＋ {combo.label.slice(dataset.label.length + 1)}</button>)}
      </div>)}
    </div>}
    <div className="bt-picker-bar">
      <input className="input" aria-label={`搜索${label}`} placeholder="搜索模型名、数据集或标签" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" className="button" disabled={visible.length === 0 || (query.trim() === "" && visible.length > 200)} onClick={() => { const union = new Set([...selected, ...visible.map((m) => m.key)]); onChange(pool.map((m) => m.key).filter((k) => union.has(k))); }}>选入当前列表（{visible.length}）</button>
      <button type="button" className="button" disabled={selected.length === 0} onClick={() => { onChange([]); setMessage(undefined); }}>✕ 清空（{selected.length}）</button>
    </div>
    {message && <p className={message.tone === "warn" ? "bt-warn" : "bt-note"} role="status">{message.text}</p>}
    <div className="bt-options" role="group" aria-label={`${label}选项`}>
      {visible.length === 0 ? <p className="bt-muted">没有匹配的模型。</p> : visible.map((model) => <label className={`bt-option ${selectedSet.has(model.key) ? "selected" : ""}`} key={model.key}>
        <input type="checkbox" checked={selectedSet.has(model.key)} onChange={() => toggle(model.key)} /><span>{modelLabel(model, datasetLabels)}</span>
      </label>)}
    </div>
    <div className="bt-chips" aria-label={`已选${label}`}>
      {selected.length === 0 ? <span className="bt-muted">尚未选择{label}</span> : selected.map((key) => {
        const model = pool.find((m) => m.key === key);
        return <span className="bt-chip" key={key}><span title={model ? modelLabel(model, datasetLabels) : key}>{model?.name ?? key}</span><button type="button" aria-label={`移除 ${model?.name ?? key}`} onClick={() => onChange(selected.filter((k) => k !== key))}>×</button></span>;
      })}
    </div>
    {conflict && <div className="bt-conflict" role="alert"><V2Notice error title="混用了不同数据集" description={conflict.message} />
      <div className="bt-combo-row">{conflict.datasets.map((d) => <button type="button" className="button" key={d.key} onClick={() => onChange(keepSingleDataset(selected, pool, d.key, datasets))}>只保留「{d.label}」（{d.count} 个）</button>)}</div></div>}
  </fieldset>;
}

// ───────────────────────── 窗口选择器 ─────────────────────────

export function WindowPicker({ state, selectedCount, showCovering = true }: { state: ReturnType<typeof useModelWindow>; selectedCount: number; showCovering?: boolean }) {
  const { dates, pinned, window, infos, notice } = state;
  const warnings = useMemo(() => coverageWarnings(infos, window, !!pinned), [infos, window, pinned]);
  return <fieldset className="bt-picker">
    <legend>时间窗口（北京时间，结束日不含）</legend>
    <div className="bt-form-row">
      <button type="button" className="button" disabled={selectedCount < 2} onClick={state.alignCommon}>对齐到所有已选模型的公共时间区间</button>
      {showCovering && <button type="button" className="button" disabled={!pinned && (!dates.startDate || dates.endDate <= dates.startDate)} onClick={state.selectCovering}>一键选择当前时间区间内有全量数据的所有模型</button>}
    </div>
    <div className="bt-form-row">
      <label><span>开始日期</span><input className="input" type="date" value={dates.startDate} onChange={(event) => state.setStartDate(event.target.value)} /></label>
      <label><span>结束日期（不含）</span><input className="input" type="date" value={dates.endDate} min={dates.startDate ? shiftDate(dates.startDate, 1) : undefined} onChange={(event) => state.setEndDate(event.target.value)} /></label>
    </div>
    {pinned && <p className="bt-note bt-ok" role="status">当前使用公共时间区间（北京时间）：{pinned.start.replace("T", " ")} → {pinned.endExclusive.replace("T", " ")}（右开；首尾均包含已有预测）</p>}
    {notice && <p className={notice.tone === "error" ? "bt-error" : notice.tone === "warn" ? "bt-warn" : "bt-note"} role="status">{notice.text}</p>}
    {state.invalid && <p className="bt-warn" role="status">结束日期必须晚于开始日期。</p>}
    {warnings.map((warning) => <p className="bt-warn" key={warning} role="status">{warning}</p>)}
  </fieldset>;
}

// ───────────────────────── Domain ─────────────────────────

export function DomainPicker({ allDomains, value, onChange, allowExclude }: { allDomains: string[]; value: DomainSelection; onChange: (next: DomainSelection) => void; allowExclude: boolean }) {
  const state = domainState(value, allDomains);
  const options = value.mode === "include" ? [ALL_DOMAINS, ...allDomains] : allDomains;
  const toggle = (domain: string) => {
    const has = value.values.includes(domain);
    onChange({ ...value, values: has ? value.values.filter((v) => v !== domain) : [...value.values, domain] });
  };
  const setMode = (mode: DomainMode) => onChange({ mode, values: mode === "include" ? [ALL_DOMAINS] : [] });
  return <fieldset className="bt-picker">
    <legend>Domain</legend>
    {allowExclude && <div className="v2-local-tabs" role="radiogroup" aria-label="Domain 选择方式">
      <button type="button" role="radio" aria-checked={value.mode === "include"} className={value.mode === "include" ? "active" : ""} onClick={() => setMode("include")}>只测选中的 domain</button>
      <button type="button" role="radio" aria-checked={value.mode === "exclude"} className={value.mode === "exclude" ? "active" : ""} onClick={() => setMode("exclude")}>排除选中的 domain（其余全测）</button>
    </div>}
    {allDomains.length > 0
      ? <div className="bt-chips bt-domain-chips" role="group" aria-label={value.mode === "include" ? "Domain（可多选）" : "排除的 Domain（可多选）"}>{options.map((domain) => <button type="button" key={domain} className={`bt-toggle ${value.values.includes(domain) ? "on" : ""}`} aria-pressed={value.values.includes(domain)} onClick={() => toggle(domain)}>{domain}</button>)}</div>
      : <label><span>Domain（逗号分隔；目录里没有 Domain 列表）</span><input className="input" value={value.values.join(", ")} onChange={(event) => onChange({ ...value, values: event.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} /></label>}
    {state.error && <p className="bt-error" role="alert">{state.error}</p>}
    {state.warning && <p className="bt-warn" role="alert">{state.warning}</p>}
    {!state.blocked && <p className="bt-note">当前评测 Universe：{state.summary || ALL_DOMAINS}</p>}
  </fieldset>;
}

// ───────────────────────── 参数表单 ─────────────────────────

/** `choiceDisabled(参数名, 选项值)` 返回原因文字时，该选项置灰（不可选）。 */
export function ParamForm({ defs, values, errors, onChange, hide = [], context, choiceDisabled, idPrefix = "bt-param" }: {
  idPrefix?: string; defs: ParamDef[]; values: ParamValues; errors: Record<string, string>; onChange: (name: string, value: string | boolean) => void; hide?: string[]; context?: ParamContext; choiceDisabled?: (name: string, value: string) => string | undefined;
}) {
  const shown = defs.filter((def) => !hide.includes(def.name) && isVisible(def, values, context));
  if (shown.length === 0) return null;
  return <div className="bt-param-grid">{shown.map((def) => {
    const id = `${idPrefix}-${def.name.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    const error = errors[def.name];
    const help = <>{def.help && <small className="bt-help">{def.help}</small>}{error && <small className="bt-error" role="alert">{def.label}{error}</small>}</>;
    if (def.type === "bool") return <div className="bt-param" key={def.name}><label className="bt-check" htmlFor={id}><input id={id} type="checkbox" checked={values[def.name] === true} onChange={(event) => onChange(def.name, event.target.checked)} /><span>{def.label}</span></label>{help}</div>;
    if (def.type === "enum" || (def.choices && def.choices.length > 0 && def.type !== "list")) {
      const choices = def.choices ?? [];
      return <div className="bt-param" key={def.name}><span className="bt-param-label" id={`${id}-label`}>{def.label}</span>
        {choices.length <= 4
          ? <div className="v2-local-tabs" role="radiogroup" aria-labelledby={`${id}-label`}>{choices.map((choice) => { const blocked = choiceDisabled?.(def.name, String(choice.value)); return <button type="button" role="radio" aria-checked={String(values[def.name]) === String(choice.value)} key={String(choice.value)} className={String(values[def.name]) === String(choice.value) ? "active" : ""} disabled={blocked !== undefined} title={blocked} onClick={() => onChange(def.name, String(choice.value))}>{choice.label}</button>; })}</div>
          : <select id={id} className="select" aria-labelledby={`${id}-label`} value={String(values[def.name] ?? "")} onChange={(event) => onChange(def.name, event.target.value)}>{choices.map((choice) => <option key={String(choice.value)} value={String(choice.value)} disabled={choiceDisabled?.(def.name, String(choice.value)) !== undefined}>{choice.label}</option>)}</select>}
        {help}</div>;
    }
    const numeric = def.type === "integer" || def.type === "number";
    return <div className="bt-param" key={def.name}><label htmlFor={id}><span className="bt-param-label">{def.label}</span></label>
      {def.presets && def.presets.length > 0 && <div className="v2-local-tabs" role="group" aria-label={`${def.label}预设`}>{def.presets.map((preset) => { const text = Array.isArray(preset.value) ? preset.value.join(", ") : String(preset.value); return <button type="button" key={preset.label} className={String(values[def.name]) === text ? "active" : ""} onClick={() => onChange(def.name, text)}>{preset.label}</button>; })}</div>}
      <input id={id} className="input" type={numeric ? "number" : "text"} inputMode={numeric ? "decimal" : undefined} value={String(values[def.name] ?? "")} min={numeric ? def.min : undefined} max={numeric ? def.max : undefined} step={numeric ? def.step ?? (def.type === "integer" ? 1 : "any") : undefined} onChange={(event) => onChange(def.name, event.target.value)} aria-invalid={error ? true : undefined} />
      {help}</div>;
  })}</div>;
}
