/**
 * 回测表单的选择辅助逻辑（纯函数）。
 *
 * 这些是「选择辅助」，不是指标口径：规则与旧页面一致（registry.py:1486 combo_models、
 * 2646 strict_model_intersection、2660 models_covering_window、539 _keep_single_dataset，
 * app.py:301 _coverage_warnings、1689-1730 / 161-207 的 Domain 校验、R:1381 strategy_domains），
 * 数据全部来自目录接口返回的元数据。
 */

import { decodeParamDef, record, text, textArray, type CatalogItem, type ParamDef, type RawRecord } from "./backtest-platform.ts";

export const BEIJING_OFFSET = "+08:00";
export const ALL_DOMAINS = "All domains";

// ───────────────────────── 时间（北京时间，纳秒精度） ─────────────────────────

export interface Instant { sec: number; ns: number }

const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;

/** 解析 ISO 时间（缺时区按北京时间），保留到纳秒；无法解析返回 undefined。 */
export function parseInstant(value: string | undefined): Instant | undefined {
  if (!value) return undefined;
  const match = ISO.exec(value.trim());
  if (!match) return undefined;
  const [, date, time = "00:00:00", fraction = "", zone] = match;
  const offset = zone ? (zone === "Z" ? "Z" : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone) : BEIJING_OFFSET;
  const ms = Date.parse(`${date}T${time}${offset}`);
  if (!Number.isFinite(ms)) return undefined;
  return { sec: ms / 1000, ns: Number(fraction.padEnd(9, "0")) };
}

export function compareInstant(a: Instant, b: Instant): number { return a.sec !== b.sec ? a.sec - b.sec : a.ns - b.ns; }
export function addNanoseconds(a: Instant, delta: number): Instant {
  const total = a.ns + delta;
  const carry = Math.floor(total / 1e9);
  return { sec: a.sec + carry, ns: total - carry * 1e9 };
}
export function addDays(a: Instant, days: number): Instant { return { sec: a.sec + days * 86400, ns: a.ns }; }

/** 以北京时间格式化，保留非零的小数秒。 */
export function formatBeijing(a: Instant): string {
  const shifted = new Date((a.sec + 8 * 3600) * 1000).toISOString().slice(0, 19);
  const fraction = a.ns > 0 ? `.${String(a.ns).padStart(9, "0").replace(/0+$/, "")}` : "";
  return `${shifted}${fraction}${BEIJING_OFFSET}`;
}
export function beijingDate(value: string | Instant | undefined): string | undefined {
  const instant = typeof value === "string" || value === undefined ? parseInstant(value) : value;
  return instant ? new Date((instant.sec + 8 * 3600) * 1000).toISOString().slice(0, 10) : undefined;
}
export function dayStartIso(date: string): string { return `${date}T00:00:00${BEIJING_OFFSET}`; }
export function shiftDate(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
/** 展示用：北京时间到秒，带 +08:00。 */
export function displayBeijing(value: string | undefined): string {
  const instant = parseInstant(value);
  return instant ? formatBeijing({ sec: instant.sec, ns: 0 }).replace("T", " ").replace(BEIJING_OFFSET, "") : "未知";
}

// ───────────────────────── 目录对象的类型化视图 ─────────────────────────

export interface DatasetInfo {
  key: string;
  label: string;
  coverageStart?: string;
  coverageEnd?: string;
  orderbookEnd?: string;
  marketFavoriteModel?: string;
  hourlyFactorNote?: string;
  domains: string[];
}

export function datasetInfo(item: CatalogItem): DatasetInfo {
  const meta = item.metadata;
  const coverage = record(meta.coverage);
  return {
    key: item.key, label: text(meta.label) ?? item.key,
    coverageStart: text(coverage.start), coverageEnd: text(coverage.end), orderbookEnd: text(meta.orderbook_end),
    marketFavoriteModel: text(meta.market_favorite_model), hourlyFactorNote: text(meta.hourly_factor_note), domains: textArray(meta.domains),
  };
}

export interface DatasetCoverage { matchedMarkets?: number; missingSettlement?: number; missingDomain?: number }
export interface ModelInfo {
  /**
   * 页面内唯一的选择标识。旧平台预测（版本 legacy/legacy）就是目录 key；
   * 提交的预测同一个 model_id 可以有多个训练 / 预测版本，所以是 `<model_id>@<训练版本>/<预测版本>`
   * （model_id 不含 @，不会冲突）。发给 infra 的引用用 catalogKey + version。
   */
  key: string;
  /** 目录 key（= model_id） */
  catalogKey: string;
  version: string;
  /** 数据目录里的模型名，脚本据此识别 */
  name: string;
  dataset?: string;
  start?: Instant;
  end?: Instant;
  startIso?: string;
  endIso?: string;
  tags: string[];
  marketView: boolean;
  coverageByDataset: Record<string, DatasetCoverage>;
  origin: "platform" | "legacy";
  /** 执行缓存明确不新鲜（首次运行需要先建缓存）；目录没给就是 undefined。 */
  cacheStale?: boolean;
}

const LEGACY_MODEL_VERSION = "legacy/legacy";

/** 与 infra 的 modelObject 同一规则：提交的预测在脚本里叫 `<model_id>__<训练版本>__<预测版本>`，旧预测保持原名。 */
function scriptModelName(key: string, version: string): string {
  const cut = version.indexOf("/");
  return cut > 0 && version !== LEGACY_MODEL_VERSION ? `${key}__${version.slice(0, cut)}__${version.slice(cut + 1)}` : key;
}

/** 目录里模型的 `coverage` 是 `{<数据集>: {start, end, …}}`；兼容旧约定的扁平 `{start, end}`。 */
function modelCoverage(value: unknown, dataset: string | undefined): { dataset?: string; start?: string; end?: string; counts: Record<string, DatasetCoverage> } {
  const coverage = record(value);
  const counts: Record<string, DatasetCoverage> = {};
  if (text(coverage.start) || text(coverage.end)) return { dataset, start: text(coverage.start), end: text(coverage.end), counts };
  const keys = Object.keys(coverage);
  for (const key of keys) {
    const entry = record(coverage[key]);
    counts[key] = { matchedMarkets: numberOrUndefined(entry.matched_markets ?? entry.markets), missingSettlement: numberOrUndefined(entry.missing_settlement), missingDomain: numberOrUndefined(entry.missing_domain) };
  }
  const chosen = dataset && coverage[dataset] !== undefined ? dataset : keys.length === 1 ? keys[0] : undefined;
  const entry = chosen ? record(coverage[chosen]) : {};
  return { dataset: dataset ?? chosen, start: text(entry.start), end: text(entry.end), counts };
}

export function modelInfo(item: CatalogItem): ModelInfo {
  const meta = item.metadata;
  const tags = textArray(meta.tags);
  const covered = modelCoverage(meta.coverage, text(meta.default_dataset) ?? text(meta.dataset));
  const byDataset: Record<string, DatasetCoverage> = { ...covered.counts };
  for (const [key, value] of Object.entries(record(meta.dataset_coverage))) {
    const v = record(value);
    byDataset[key] = { matchedMarkets: numberOrUndefined(v.matched_markets), missingSettlement: numberOrUndefined(v.missing_settlement), missingDomain: numberOrUndefined(v.missing_domain) };
  }
  const version = item.version || LEGACY_MODEL_VERSION;
  return {
    key: version === LEGACY_MODEL_VERSION ? item.key : `${item.key}@${version}`, catalogKey: item.key, version,
    name: text(meta.model_name) ?? scriptModelName(item.key, version), dataset: covered.dataset,
    start: parseInstant(covered.start), end: parseInstant(covered.end), startIso: covered.start, endIso: covered.end,
    tags, marketView: meta.market_view === true || tags.includes("market_view"), coverageByDataset: byDataset, origin: item.origin,
    cacheStale: meta.execution_cache_fresh === false ? true : undefined,
  };
}

/** 策略对模型预测的需求：none 不读、optional 可读可不读、required 必须选模型。 */
export type PredictionPolicy = "none" | "optional" | "required";

export interface StrategyInfo {
  /** 页面内唯一的选择标识：旧策略（版本 legacy）就是 key，提交的策略是 `<key>@<版本>`。 */
  id: string;
  key: string;
  version: string;
  label: string;
  kind: string;
  /** 逐时点策略（平台提交的新接口策略）；其余是旧平台策略 */
  stepwise: boolean;
  description?: string;
  validatedDomains: string[] | null;
  nativeSizing?: string;
  priceOnly: boolean;
  /** 是否读取模型预测：旧策略除纯价格外都必须选模型；逐时点策略按 `inputs.predictions` 声明 */
  predictions: PredictionPolicy;
  /** 旧接口逐时点定义里声明的仓位模式（只为解码旧目录条目保留）；pm_sim 接口的定义没有这个字段，旧策略也没有（undefined）。
   *  表单不再据此限制仓位模式：逐时点策略的仓位由策略自己决定。 */
  sizingModes?: string[];
  /** 逐时点策略在清单里声明的参数；旧策略为空 */
  params: ParamDef[];
  /** 清单里的参数声明无法解析（解码失败），表单不显示这个策略的参数 */
  paramsInvalid: boolean;
  /** 逐时点策略提交试跑用的 pm_sim 版本（这个策略以后都用它运行）；旧接口定义与旧策略没有 */
  pmSimVersion?: string;
  readsHourlyFactors: boolean;
  needsExecutionCache: boolean;
  definition: RawRecord;
}

const PREDICTION_POLICIES: readonly string[] = ["none", "optional", "required"];

export function strategyInfo(item: CatalogItem): StrategyInfo {
  const meta = item.metadata;
  const definition = record(meta.definition);
  const kind = text(definition.kind ?? meta.kind) ?? "unknown";
  const stepwise = kind === "stepwise";
  // 逐时点策略的 Domain 限制叫 definition.domains（null = 全部）；旧策略叫 validated_domains
  const validated = definition.validated_domains ?? meta.validated_domains ?? (stepwise ? definition.domains : undefined);
  const label = text(meta.label) ?? item.key;
  const priceOnly = meta.price_only === true || kind === "price_probability";
  const declared = text(record(definition.inputs).predictions ?? record(meta.inputs).predictions);
  const predictions: PredictionPolicy = stepwise ? (PREDICTION_POLICIES.includes(declared ?? "") ? declared as PredictionPolicy : "required") : priceOnly ? "none" : "required";
  const sizing = definition.position_sizing ?? meta.position_sizing;
  let params: ParamDef[] = [];
  let paramsInvalid = false;
  if (stepwise) {
    const rawParams = definition.params ?? meta.params;
    try { params = Array.isArray(rawParams) ? rawParams.map(decodeParamDef) : []; } catch { paramsInvalid = true; }
  }
  return {
    id: item.version === "legacy" || !item.version ? item.key : `${item.key}@${item.version}`,
    key: item.key, version: item.version, label: item.version === "legacy" || !item.version ? label : `${label} @${item.version}`, kind, stepwise,
    description: text(meta.description), validatedDomains: Array.isArray(validated) ? validated.map(String) : null,
    nativeSizing: text(meta.native_sizing), priceOnly, predictions, sizingModes: stepwise && Array.isArray(sizing) ? sizing.map(String) : undefined,
    params, paramsInvalid, pmSimVersion: stepwise ? text(definition.pm_sim_version ?? meta.pm_sim_version) : undefined,
    readsHourlyFactors: meta.reads_hourly_factors === true, needsExecutionCache: meta.requires_execution_cache === true, definition: Object.keys(definition).length ? definition : { kind: meta.kind },
  };
}

/** 策略说明：与名字相同（旧策略的说明就是名字）时不重复显示。 */
export function strategyDescription(strategy: Pick<StrategyInfo, "label" | "description">): string | undefined {
  const description = strategy.description?.trim();
  if (!description) return undefined;
  const bare = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  return bare(description) === bare(strategy.label) || bare(strategy.label).startsWith(`${bare(description)}@`) ? undefined : description;
}

function numberOrUndefined(value: unknown): number | undefined { const n = Number(value); return value !== null && value !== undefined && value !== "" && Number.isFinite(n) ? n : undefined; }

// ───────────────────────── 模型标签与 combo ─────────────────────────

const TAG_LABELS: Record<string, string> = {
  sandbox: "沙盒", sandbox_subset: "沙盒子集", live_subset: "实盘子集", legacy_pipeline: "老管线", aligned_sandbox_time: "对齐沙盒时刻", market_view: "盘口基准",
};
export function tagLabel(tag: string): string {
  if (tag.startsWith("min_subset:")) return `最小子集 ${tag.slice("min_subset:".length)}`;
  return TAG_LABELS[tag] ?? tag;
}

const SUBSET_TAGS = ["sandbox_subset", "live_subset"];
const isMinSubset = (tag: string) => tag.startsWith("min_subset:");
const isAnySubset = (m: ModelInfo) => m.tags.some((tag) => SUBSET_TAGS.includes(tag) || isMinSubset(tag));

/** 选项文案：模型名 (start → end) · 数据集标签 · 标签（同旧 model_label）。 */
export function modelLabel(model: ModelInfo, datasetLabels: Record<string, string> = {}): string {
  const range = model.startIso || model.endIso ? ` (${displayBeijing(model.startIso).slice(0, 16)} → ${displayBeijing(model.endIso).slice(0, 16)})` : "";
  const dataset = model.dataset ? ` · ${datasetLabels[model.dataset] ?? model.dataset}` : "";
  const tags = model.tags.filter((tag) => tag !== "market_view").map(tagLabel);
  return `${model.name}${range}${dataset}${tags.length ? ` · ${tags.join(" · ")}` : ""}`;
}

export interface Combo { id: string; label: string; datasetKey: string; help: string; match: (model: ModelInfo) => boolean }

/** 由模型的标签推出「按标签一键加入」的组合：每个数据集 × 标签一个按钮，没有命中的不出现。 */
export function deriveCombos(models: ModelInfo[], datasets: DatasetInfo[]): Combo[] {
  const combos: Combo[] = [];
  for (const dataset of datasets) {
    const pool = models.filter((model) => model.dataset === dataset.key && !model.marketView);
    const add = (id: string, name: string, help: string, match: (model: ModelInfo) => boolean) => {
      if (pool.some(match)) combos.push({ id: `${dataset.key}:${id}`, label: `${dataset.label}·${name}`, datasetKey: dataset.key, help, match });
    };
    add("sandbox", "沙盒", "该数据集中带沙盒标签、且不属于子集 / 实盘子集 / 最小子集的全部模型。", (m) => m.tags.includes("sandbox") && !isAnySubset(m));
    add("sandbox_subset", "沙盒子集", "沙盒子集标签的模型。", (m) => m.tags.includes("sandbox_subset"));
    add("live_subset", "实盘子集", "实盘子集标签的模型。", (m) => m.tags.includes("live_subset"));
    const nodes = Array.from(new Set(pool.flatMap((m) => m.tags.filter(isMinSubset)))).sort();
    for (const node of nodes) add(node, tagLabel(node), "月度轮换名册里该节点的最小子集模型。", (m) => m.tags.includes(node));
    add("legacy_pipeline", "老管线", "老管线产出的模型。", (m) => m.tags.includes("legacy_pipeline"));
  }
  return combos;
}

export interface ComboResult { selected: string[]; added: number; hits: number; error?: string }

/** 命中结果与当前选择取并集，按选项顺序写回（同旧 _apply_model_combo）。 */
export function applyCombo(selected: string[], pool: ModelInfo[], combo: Combo): ComboResult {
  const candidates = pool.filter((model) => model.dataset === combo.datasetKey && combo.match(model));
  if (candidates.length === 0) return { selected, added: 0, hits: 0, error: `「${combo.label}」在当前口径下没有可选模型 —— 这一页的选项表里一个都没命中。` };
  const union = new Set([...selected, ...candidates.map((model) => model.key)]);
  const next = pool.map((model) => model.key).filter((key) => union.has(key));
  // 池外的已选项（例如被其它规则过滤掉的）保留在末尾，避免静默丢失
  for (const key of selected) if (!next.includes(key)) next.push(key);
  return { selected: next, added: next.length - selected.length, hits: candidates.length };
}

export interface DatasetConflict { datasets: Array<{ key: string; label: string; count: number }>; message: string }

export function datasetConflict(selectedKeys: string[], pool: ModelInfo[], datasets: DatasetInfo[]): DatasetConflict | undefined {
  const counts = new Map<string, number>();
  for (const key of selectedKeys) {
    const model = pool.find((item) => item.key === key);
    if (model?.dataset) counts.set(model.dataset, (counts.get(model.dataset) ?? 0) + 1);
  }
  if (counts.size <= 1) return undefined;
  const list = Array.from(counts, ([key, count]) => ({ key, label: datasets.find((d) => d.key === key)?.label ?? key, count }));
  return { datasets: list, message: `所选模型来自 ${list.length} 个数据集（${list.map((d) => `${d.label} ${d.count} 个`).join("、")}），一次运行不能混用数据集；请只保留其中一套。` };
}

/** 只保留某数据集的模型；若原选择里有 market-view 表，补回该数据集自己的那张（同旧 _keep_single_dataset）。 */
export function keepSingleDataset(selectedKeys: string[], pool: ModelInfo[], datasetKey: string, datasets: DatasetInfo[]): string[] {
  const byKey = new Map(pool.map((model) => [model.key, model]));
  const hadMarketView = selectedKeys.some((key) => byKey.get(key)?.marketView);
  const kept = selectedKeys.filter((key) => byKey.get(key)?.dataset === datasetKey);
  if (hadMarketView) {
    const favorite = datasets.find((d) => d.key === datasetKey)?.marketFavoriteModel;
    const model = favorite ? pool.find((item) => item.catalogKey === favorite || item.name === favorite) : undefined;
    if (model && !kept.includes(model.key)) kept.push(model.key);
  }
  return pool.map((model) => model.key).filter((key) => kept.includes(key));
}

// ───────────────────────── 窗口 ─────────────────────────

export interface Window { start: string; endExclusive: string }

/** 公共时间区间：max(各模型 start) → min(各模型 end)+1ns（右开），保留时分秒与小数秒（registry.py:2646）。 */
export function strictModelIntersection(models: ModelInfo[]): Window {
  const ranges = models.map((model) => { if (!model.start || !model.end) throw new Error(`模型 ${model.name} 缺少预测覆盖区间`); return { start: model.start, end: model.end }; });
  if (ranges.length === 0) throw new Error("请先选择模型");
  const start = ranges.reduce((a, b) => compareInstant(a, b.start) >= 0 ? a : b.start, ranges[0].start);
  const end = ranges.reduce((a, b) => compareInstant(a, b.end) <= 0 ? a : b.end, ranges[0].end);
  if (compareInstant(start, end) > 0) throw new Error("所选模型的预测窗口没有交集（selected models have no overlapping prediction window）。");
  return { start: formatBeijing(start), endExclusive: formatBeijing(addNanoseconds(end, 1)) };
}

/** 窗口内有全量数据的模型：start ≤ 窗口开始，且窗口结束 ≤ end + 1 天（registry.py:2660）。 */
export function modelsCoveringWindow(pool: ModelInfo[], window: Window): ModelInfo[] {
  const from = parseInstant(window.start);
  const to = parseInstant(window.endExclusive);
  if (!from || !to || compareInstant(to, from) <= 0) return [];
  return pool.filter((model) => model.start && model.end && compareInstant(model.start, from) <= 0 && compareInstant(to, addDays(model.end, 1)) <= 0);
}

export interface DateWindow { startDate: string; endDate: string }

/** 默认日期：已选模型 start 最小日 → end 最大日 +1 天；未选用全局界（app.py:269）。 */
export function defaultDates(selected: ModelInfo[], all: ModelInfo[]): DateWindow | undefined {
  const source = selected.length ? selected : all;
  const starts = source.map((m) => beijingDate(m.start)).filter((d): d is string => !!d).sort();
  const ends = source.map((m) => beijingDate(m.end)).filter((d): d is string => !!d).sort();
  if (!starts.length || !ends.length) return undefined;
  return { startDate: starts[0], endDate: shiftDate(ends[ends.length - 1], 1) };
}

export function coverageWarnings(selected: ModelInfo[], window: Window, pinned: boolean): string[] {
  const from = parseInstant(window.start);
  const to = parseInstant(window.endExclusive);
  if (!from || !to) return [];
  const warnings: string[] = [];
  for (const model of selected) {
    if (!model.start || !model.end) continue;
    const covered = `${displayBeijing(model.startIso).slice(0, 10)} → ${displayBeijing(model.endIso).slice(0, 10)}`;
    const endExclusive = addDays(model.end, 1);
    if (compareInstant(to, model.start) <= 0 || compareInstant(from, endExclusive) >= 0) warnings.push(`${model.name} 的预测覆盖 ${covered}，与所选区间无交集，曲线会是空的。`);
    else if (!pinned && (compareInstant(from, model.start) < 0 || compareInstant(to, endExclusive) > 0)) warnings.push(`${model.name} 只覆盖 ${covered}，区间超出部分无数据。`);
  }
  return warnings;
}

/** 表单日期 → 窗口。公共区间模式下用钉住的精确时刻，否则用北京自然日 [start, end)。 */
export function buildWindow(dates: DateWindow, pinned?: Window): Window & { align: "strict_common" | "natural_day" } {
  if (pinned) return { ...pinned, align: "strict_common" };
  return { start: dayStartIso(dates.startDate), endExclusive: dayStartIso(dates.endDate), align: "natural_day" };
}

// ───────────────────────── Domain ─────────────────────────

export type DomainMode = "include" | "exclude";
export interface DomainSelection { mode: DomainMode; values: string[] }
export interface DomainState { blocked: boolean; error?: string; warning?: string; summary: string }

export function domainState(selection: DomainSelection, allDomains: string[]): DomainState {
  const { mode, values } = selection;
  if (mode === "include") {
    if (values.length === 0) return { blocked: true, warning: "请至少选择一个 domain。", summary: "" };
    if (values.includes(ALL_DOMAINS) && values.length > 1) return { blocked: true, error: "All domains 不能与具体 domain 同时选择。", summary: "" };
    return { blocked: false, summary: values.join("、") };
  }
  if (values.length === 0) return { blocked: false, summary: ALL_DOMAINS };
  if (allDomains.length > 0 && allDomains.every((domain) => values.includes(domain))) return { blocked: true, error: "排除了全部 domain，评测 Universe 会是空的。", summary: "" };
  return { blocked: false, summary: `${ALL_DOMAINS} − ${values.join(" − ")}` };
}

/** 提交给 infra 的 domains；All 统一写成 ["all"]（运行配置 domains.values）。 */
export function domainsPayload(selection: DomainSelection): { mode: DomainMode; values: string[] } {
  // infra 要求 values 至少一项；「排除 0 个」就是全部 Domain
  if (selection.mode === "exclude" && selection.values.length === 0) return { mode: "include", values: ["all"] };
  return { mode: selection.mode, values: selection.mode === "include" ? selection.values.map((v) => v === ALL_DOMAINS ? "all" : v) : selection.values };
}

export interface StrategyDomainPlan { narrowed: Array<{ strategy: string; domains: string[] }>; empty: string[] }

/** 策略只在其研究验证过的 domain 上成交：与所选 domain 求交集，无交集的策略不能运行（R:1381）。 */
export function strategyDomainPlan(strategies: StrategyInfo[], selection: DomainSelection): StrategyDomainPlan {
  const narrowed: StrategyDomainPlan["narrowed"] = [];
  const empty: string[] = [];
  const all = selection.values.includes(ALL_DOMAINS);
  for (const strategy of strategies) {
    if (!strategy.validatedDomains) continue;
    const effective = all ? strategy.validatedDomains : strategy.validatedDomains.filter((domain) => selection.values.includes(domain));
    if (effective.length === 0) empty.push(strategy.label);
    else narrowed.push({ strategy: strategy.label, domains: effective });
  }
  return { narrowed, empty };
}
