/**
 * 回测平台唯一的 wire DTO 解码入口与浏览器侧客户端。
 *
 * 浏览器只请求同源 `/api/console/backtest/*`（BFF 在服务端携带令牌与操作人头）。
 * 组件不得自行 cast 原始响应；所有后端字段在这里转成 camelCase 的类型。
 * 契约来源：父任务 design.md 第 3-8 节、infra 任务 design.md 第 3 节。
 * 契约未覆盖、由本前端约定的可选扩展见任务目录 decisions.md。
 */

import { ConsoleV2ApiError, ConsoleV2ContractError } from "./console-v2.ts";

export const RESULT_SCHEMA = "backtest.result.v1";
/** 页面内上传上限，需与 BFF `UPLOAD_LIMIT_BYTES` 保持一致（测试断言）。 */
export const UPLOAD_LIMIT_BYTES = 1024 * 1024 * 1024;
/** 写操作必带的标记头（BFF 据此挡掉跨站伪造请求；需与 BFF 里的值一致）。 */
export const WRITE_MARKER_HEADER = "x-requested-with";
export const WRITE_MARKER_VALUE = "backtest-console";

export type RawRecord = Record<string, unknown>;

export type BacktestBoard = "trading" | "benchmark" | "signal" | "intake" | "admin";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(["succeeded", "failed", "cancelled"]);

export interface BacktestPage<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
  observedAt?: string;
  summary?: RawRecord;
}

// ───────────────────────── 目录 ─────────────────────────

export type CatalogKind = "strategy" | "factor" | "model" | "dataset" | "engine";

export interface CatalogItem {
  kind: CatalogKind;
  key: string;
  version: string;
  origin: "platform" | "legacy";
  status: "available" | "retired";
  submissionId?: string;
  metadata: RawRecord;
  poolState?: "experiment" | "pool";
  poolChangedBy?: string;
  poolChangedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ParamChoice { value: string | number | boolean; label: string }
export type ParamType = "integer" | "number" | "enum" | "bool" | "list" | "text";

export interface ParamDef {
  name: string;
  type: ParamType;
  label: string;
  help?: string;
  defaultValue: unknown;
  choices?: ParamChoice[];
  min?: number;
  max?: number;
  /** 数值保留的小数位（infra 在落库前取整，用于摘要去重；前端仅提示）。 */
  precision?: number;
  /** list 的元素类型与个数范围；text 的最大长度（均为 infra 定义的字段）。 */
  itemType?: "number" | "integer" | "text";
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  /**
   * 以下 minExclusive / maxExclusive / step / presets / when 是前端预留的扩展：infra 登记引擎时
   * 会拒绝未知的参数定义字段（decisions.md 第 7 节），所以当前真实链路里它们不会出现，
   * 缺省时表单只按 min / max / choices / default 渲染。
   */
  minExclusive?: boolean;
  maxExclusive?: boolean;
  step?: number;
  presets?: Array<{ label: string; value: unknown }>;
  when?: Record<string, unknown>;
  /**
   * 前端本地的显示条件（`backtest-param-ui.ts` 按名字写入，不来自 infra）：
   * stepwise = 只在选中了逐时点策略时显示；models = 只在需要模型的表单里显示。
   */
  requires?: "stepwise" | "models";
}

export interface EngineInfo {
  version: string;
  protocol?: string;
  releasedAt?: string;
  isDefault: boolean;
  paramDefinitions: Record<string, ParamDef[]>;
  /** `board/item` → 拒收 market-view 的理由；缺项表示接受。 */
  marketViewExclusions: Record<string, string>;
  domains: string[];
  /** Signal Test 卷子固定的盘口窗口（北京时间，右开）；缺省不夹取。 */
  signalWindow?: { start: string; endExclusive: string };
}

export function decodeCatalogItem(value: unknown): CatalogItem {
  const raw = record(value);
  const kind = requiredText(raw.kind, "catalog.kind");
  if (!["strategy", "factor", "model", "dataset", "engine"].includes(kind)) throw new ConsoleV2ContractError(`回测目录含未知 kind: ${kind}`);
  const poolState = text(raw.pool_state);
  return {
    kind: kind as CatalogKind,
    key: requiredText(raw.key, "catalog.key"),
    version: text(raw.version) ?? "",
    origin: raw.origin === "legacy" ? "legacy" : "platform",
    status: raw.status === "retired" ? "retired" : "available",
    submissionId: text(raw.submission_id),
    metadata: record(raw.metadata),
    poolState: poolState === "pool" || poolState === "experiment" ? poolState : undefined,
    poolChangedBy: text(raw.pool_changed_by),
    poolChangedAt: text(raw.pool_changed_at),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
  };
}

const PARAM_TYPE_ALIASES: Record<string, ParamType> = {
  integer: "integer", int: "integer", number: "number", float: "number", enum: "enum", choice: "enum", select: "enum",
  bool: "bool", boolean: "bool", list: "list", array: "list", float_list: "list", text: "text", string: "text", str: "text",
};

export function decodeParamDef(value: unknown): ParamDef {
  const raw = record(value);
  const name = requiredText(raw.name, "param.name");
  const type = PARAM_TYPE_ALIASES[String(raw.type ?? "").toLowerCase()];
  if (!type) throw new ConsoleV2ContractError(`参数 ${name} 的类型未知: ${String(raw.type)}`);
  // infra 的 choices 是标量数组（任何类型的参数都可以带 choices：整数 / 数值 / 文本 / list 的元素）；
  // 同时容忍 `{value, label}` 形式。
  const choices = Array.isArray(raw.choices) ? raw.choices.map((choice): ParamChoice => {
    if (choice !== null && typeof choice === "object") {
      const item = record(choice);
      const choiceValue = item.value as string | number | boolean;
      if (!["string", "number", "boolean"].includes(typeof choiceValue)) throw new ConsoleV2ContractError(`参数 ${name} 的选项缺少 value`);
      return { value: choiceValue, label: text(item.label) ?? String(choiceValue) };
    }
    if (!["string", "number", "boolean"].includes(typeof choice)) throw new ConsoleV2ContractError(`参数 ${name} 的选项无效`);
    return { value: choice as string | number | boolean, label: String(choice) };
  }) : undefined;
  if (type === "enum" && (!choices || choices.length === 0)) throw new ConsoleV2ContractError(`枚举参数 ${name} 没有选项`);
  let itemType: ParamDef["itemType"];
  if (type === "list") {
    const declared = PARAM_TYPE_ALIASES[String(raw.item_type ?? "number").toLowerCase()];
    if (declared !== "number" && declared !== "integer" && declared !== "text") throw new ConsoleV2ContractError(`列表参数 ${name} 的元素类型未知: ${String(raw.item_type)}`);
    itemType = declared;
  }
  const presets = Array.isArray(raw.presets) ? raw.presets.map((preset) => { const item = record(preset); return { label: requiredText(item.label, "preset.label"), value: item.value }; }) : undefined;
  return {
    name, type, label: text(raw.label) ?? name, help: text(raw.help), defaultValue: raw.default ?? null,
    choices, min: finiteOrUndefined(raw.min), max: finiteOrUndefined(raw.max), precision: finiteOrUndefined(raw.precision),
    itemType, minItems: finiteOrUndefined(raw.min_items), maxItems: finiteOrUndefined(raw.max_items), maxLength: finiteOrUndefined(raw.max_length),
    minExclusive: raw.min_exclusive === true, maxExclusive: raw.max_exclusive === true,
    step: finiteOrUndefined(raw.step), presets,
    when: raw.when !== undefined && raw.when !== null ? record(raw.when) : undefined,
  };
}

export function decodeEngine(item: CatalogItem): EngineInfo {
  const meta = item.metadata;
  const definitions: Record<string, ParamDef[]> = {};
  for (const [key, defs] of Object.entries(record(meta.param_definitions))) {
    if (!Array.isArray(defs)) throw new ConsoleV2ContractError(`引擎参数定义 ${key} 必须是数组`);
    definitions[key] = defs.map(decodeParamDef);
  }
  const exclusions: Record<string, string> = {};
  for (const [key, reason] of Object.entries(record(meta.market_view_exclusions))) exclusions[key] = String(reason);
  return {
    version: item.version || item.key,
    protocol: text(meta.protocol),
    releasedAt: text(meta.released_at),
    isDefault: meta.is_default === true,
    paramDefinitions: definitions,
    marketViewExclusions: exclusions,
    domains: textArray(meta.domains),
    signalWindow: meta.signal_window !== undefined && meta.signal_window !== null && text(record(meta.signal_window).start) && text(record(meta.signal_window).end_exclusive) ? { start: text(record(meta.signal_window).start) as string, endExclusive: text(record(meta.signal_window).end_exclusive) as string } : undefined,
  };
}

// ───────────────────────── result.json ─────────────────────────

export interface ResultFilterOption { value: string; label: string }
export interface ResultFilter { key: string; label: string; options: ResultFilterOption[]; defaultValue: string }

export type TableColumnKind = "number" | "percent" | "text" | "interval" | "badge";
export interface TableColumn {
  key: string;
  label: string;
  kind: TableColumnKind;
  digits?: number;
  sortable: boolean;
  /** 排序时「最优在前」的方向：low = 越小越好。首次点击该列按此方向排。 */
  best?: "low" | "high";
  signed?: boolean;
  prefix?: string;
  suffix?: string;
  /** percent 列的值是小数（0.617）而不是百分点（61.7）。 */
  fraction?: boolean;
  help?: string;
}
export interface SortSpec { key: string; direction: "asc" | "desc" }

/**
 * `when`：区块仅在结果级筛选取这些值时显示（前端扩展，用于「按周期切换」一类每档一个区块的结果）。
 * `tab`：同一结果（批量因子时为同一因子）里带 tab 的区块合成一组标签页，按 tab 名切换（前端扩展）。
 */
interface SectionBase { id: string; title?: string; caption?: string; collapsed?: boolean; filters: ResultFilter[]; when?: RawRecord; tab?: string }
export interface MetricItem { label: string; value: unknown; kind?: string; help?: string; digits?: number }
export interface MetricsSection extends SectionBase { type: "metrics"; items: MetricItem[] }
export interface TableSection extends SectionBase {
  type: "table"; columns: TableColumn[]; rows: RawRecord[]; defaultSort?: SortSpec; notes: string[];
  searchable?: boolean; pinSortedColumns?: boolean; rankColumn?: boolean;
}
export interface SeriesPoint { x: number; y: number | null; size?: number; lower?: number; upper?: number; lowSample?: boolean; label?: string }
export interface SeriesLine { name: string; group?: string; variant?: string; color?: string; dashed?: boolean; highlight?: boolean; filters?: RawRecord; points: SeriesPoint[] }
export interface SeriesReference { axis: "x" | "y" | "diagonal"; value?: number; label?: string }
export interface SeriesSection extends SectionBase {
  type: "series"; xKind: "time" | "number" | "category"; xLabel?: string; yLabel?: string; yFormat?: "money" | "number" | "percent";
  series: SeriesLine[]; references: SeriesReference[]; mode: "line" | "scatter";
}
export interface BarItem { label: string; value: number | null; lower?: number | null; upper?: number | null; highlight?: string | boolean; x0?: number; x1?: number; note?: string; filters?: RawRecord; group?: string }
export interface BarsSection extends SectionBase {
  type: "bars"; bars: BarItem[]; referenceLines: Array<{ value: number; label?: string }>; orientation: "horizontal" | "vertical"; digits: number; valueLabel?: string;
}
export interface MatrixSection extends SectionBase {
  type: "matrix"; rows: string[]; cols: string[]; values: Array<Array<number | null>>; counts?: Array<Array<number | null>>; domain: [number, number]; digits: number;
}
export interface TextSection extends SectionBase { type: "text"; text: string; format: "markdown" | "plain" | "json" }
export interface ImageSection extends SectionBase { type: "image"; artifact: string; alt: string }
export interface UnsupportedSection extends SectionBase { type: "unsupported"; originalType: string }
export type ResultSection = MetricsSection | TableSection | SeriesSection | BarsSection | MatrixSection | TextSection | ImageSection | UnsupportedSection;

export interface ScopeCard {
  window?: { start?: string; endExclusive?: string; align?: string };
  domains: string[];
  dataset?: string;
  engine?: string;
  protocol?: string;
  sampleScope?: string;
  sampleCounts: Array<{ label: string; value: string }>;
  batchMembers: string[];
}
export interface ResultWarning { level: "info" | "warning" | "error"; text: string }
export interface ResultArtifact { name: string; path: string; bytes?: number }
export interface BacktestResult {
  board: string;
  item: string;
  headline: string;
  scopeCard: ScopeCard;
  warnings: ResultWarning[];
  filters: ResultFilter[];
  sections: ResultSection[];
  artifacts: ResultArtifact[];
}

export function decodeResult(value: unknown): BacktestResult {
  const raw = record(value);
  if (raw.schema_version !== RESULT_SCHEMA) throw new ConsoleV2ContractError(`result.json 的 schema_version 必须是 ${RESULT_SCHEMA}`);
  if (!Array.isArray(raw.sections)) throw new ConsoleV2ContractError("result.json 缺少 sections 数组");
  const sections = raw.sections.map(decodeSection);
  const seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.id)) throw new ConsoleV2ContractError(`result.json 的区块 id 重复: ${section.id}`);
    seen.add(section.id);
  }
  return {
    board: requiredText(raw.board, "result.board"),
    item: requiredText(raw.item, "result.item"),
    headline: text(raw.headline) ?? "",
    scopeCard: decodeScopeCard(raw.scope_card),
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : []).map((entry) => {
      const item = record(entry);
      const level = item.level === "error" || item.level === "info" ? item.level : "warning";
      return { level, text: requiredText(item.text, "warning.text") } as ResultWarning;
    }),
    filters: decodeFilters(raw.filters),
    sections,
    artifacts: (Array.isArray(raw.artifacts) ? raw.artifacts : []).map((entry) => {
      const item = record(entry);
      return { name: requiredText(item.name, "artifact.name"), path: requiredText(item.path, "artifact.path"), bytes: finiteOrUndefined(item.bytes) };
    }),
  };
}

function decodeScopeCard(value: unknown): ScopeCard {
  const raw = record(value);
  const window = raw.window !== undefined && raw.window !== null ? record(raw.window) : undefined;
  const counts = record(raw.sample_counts);
  return {
    window: window ? { start: text(window.start), endExclusive: text(window.end_exclusive ?? window.end), align: text(window.align) } : undefined,
    domains: textArray(raw.domains),
    dataset: text(raw.dataset),
    engine: text(raw.engine),
    protocol: text(raw.protocol),
    sampleScope: text(raw.sample_scope),
    sampleCounts: Object.entries(counts).map(([label, v]) => ({ label, value: v === null || v === undefined ? "未知" : String(v) })),
    batchMembers: textArray(raw.batch_members),
  };
}

function decodeFilters(value: unknown): ResultFilter[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ConsoleV2ContractError("filters 必须是数组");
  return value.map((entry) => {
    const raw = record(entry);
    const key = requiredText(raw.key, "filter.key");
    if (!Array.isArray(raw.options) || raw.options.length === 0) throw new ConsoleV2ContractError(`筛选 ${key} 没有选项`);
    const options = raw.options.map((option): ResultFilterOption => {
      if (option !== null && typeof option === "object") { const o = record(option); return { value: String(o.value), label: text(o.label) ?? String(o.value) }; }
      return { value: String(option), label: String(option) };
    });
    const defaultValue = raw.default === undefined || raw.default === null ? options[0].value : String(raw.default);
    if (!options.some((option) => option.value === defaultValue)) throw new ConsoleV2ContractError(`筛选 ${key} 的默认值不在选项内`);
    return { key, label: text(raw.label) ?? key, options, defaultValue };
  });
}

const COLUMN_KINDS: ReadonlySet<string> = new Set(["number", "percent", "text", "interval", "badge"]);

function decodeSection(value: unknown): ResultSection {
  const raw = record(value);
  const id = requiredText(raw.id, "section.id");
  const type = requiredText(raw.type, `section(${id}).type`);
  const base: SectionBase = { id, title: text(raw.title), caption: text(raw.caption), collapsed: typeof raw.collapsed === "boolean" ? raw.collapsed : undefined, filters: decodeFilters(raw.filters), when: raw.when !== undefined && raw.when !== null ? record(raw.when) : undefined, tab: text(raw.tab) };
  switch (type) {
    case "metrics": {
      if (!Array.isArray(raw.items)) throw new ConsoleV2ContractError(`区块 ${id}: metrics.items 必须是数组`);
      return { ...base, type, items: raw.items.map((entry) => { const item = record(entry); return { label: requiredText(item.label, "metric.label"), value: item.value ?? null, kind: text(item.kind), help: text(item.help), digits: finiteOrUndefined(item.digits) }; }) };
    }
    case "table": {
      if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) throw new ConsoleV2ContractError(`区块 ${id}: table 需要 columns 与 rows 数组`);
      const columns = raw.columns.map((entry): TableColumn => {
        const col = record(entry);
        const key = requiredText(col.key, "column.key");
        const kind = String(col.kind ?? "text");
        const best = col.best === "low" || col.best === "high" ? col.best : undefined;
        return { key, label: text(col.label) ?? key, kind: (COLUMN_KINDS.has(kind) ? kind : "text") as TableColumnKind, digits: finiteOrUndefined(col.digits), sortable: col.sortable !== false, best, signed: col.signed === true, prefix: text(col.prefix), suffix: text(col.suffix), fraction: col.fraction === true, help: text(col.help) };
      });
      const keys = new Set<string>();
      for (const column of columns) { if (keys.has(column.key)) throw new ConsoleV2ContractError(`区块 ${id}: 列 key 重复 ${column.key}`); keys.add(column.key); }
      const rows = raw.rows.map((row) => { if (row === null || typeof row !== "object" || Array.isArray(row)) throw new ConsoleV2ContractError(`区块 ${id}: rows 必须是对象数组`); return row as RawRecord; });
      return { ...base, type, columns, rows, defaultSort: decodeSort(raw.default_sort, keys, id), notes: Array.isArray(raw.notes) ? raw.notes.map(String) : raw.notes ? [String(raw.notes)] : [], searchable: raw.searchable === false ? false : undefined, pinSortedColumns: raw.pin_sorted_columns === true, rankColumn: raw.rank_column === true };
    }
    case "series": {
      if (!Array.isArray(raw.series)) throw new ConsoleV2ContractError(`区块 ${id}: series.series 必须是数组`);
      const xKind = raw.x === "number" || raw.x === "category" ? raw.x : "time";
      const series = raw.series.map((entry): SeriesLine => {
        const line = record(entry);
        if (!Array.isArray(line.points)) throw new ConsoleV2ContractError(`区块 ${id}: 序列 ${String(line.name)} 缺少 points`);
        return { name: requiredText(line.name, "series.name"), group: text(line.group), variant: text(line.variant), color: text(line.color), dashed: line.style === "dashed", highlight: line.highlight === true, filters: line.filters !== undefined ? record(line.filters) : undefined, points: line.points.map((point) => decodePoint(point, xKind, id)) };
      });
      const references = (Array.isArray(raw.reference_lines) ? raw.reference_lines : []).map((entry): SeriesReference => {
        const ref = record(entry);
        const axis = ref.axis === "x" || ref.axis === "diagonal" ? ref.axis : "y";
        return { axis, value: finiteOrUndefined(ref.value), label: text(ref.label) };
      });
      const yFormat = raw.y_format === "money" || raw.y_format === "percent" ? raw.y_format : "number";
      return { ...base, type, xKind, xLabel: text(raw.x_label), yLabel: text(raw.y_label), yFormat, series, references, mode: raw.mode === "scatter" ? "scatter" : "line" };
    }
    case "bars": {
      if (!Array.isArray(raw.bars)) throw new ConsoleV2ContractError(`区块 ${id}: bars.bars 必须是数组`);
      const bars = raw.bars.map((entry): BarItem => {
        const bar = record(entry);
        return { label: requiredText(bar.label, "bar.label"), value: nullableNumber(bar.value), lower: bar.lower === undefined ? undefined : nullableNumber(bar.lower), upper: bar.upper === undefined ? undefined : nullableNumber(bar.upper), highlight: typeof bar.highlight === "string" || typeof bar.highlight === "boolean" ? bar.highlight : undefined, x0: finiteOrUndefined(bar.x0), x1: finiteOrUndefined(bar.x1), note: text(bar.note), filters: bar.filters !== undefined ? record(bar.filters) : undefined, group: text(bar.group) };
      });
      const refs = raw.reference_lines ?? (raw.reference_line !== undefined && raw.reference_line !== null ? [raw.reference_line] : []);
      const referenceLines = (Array.isArray(refs) ? refs : []).map((entry) => { const ref = typeof entry === "number" ? { value: entry } : record(entry); const refValue = finiteOrUndefined(ref.value); if (refValue === undefined) throw new ConsoleV2ContractError(`区块 ${id}: 参考线缺少 value`); return { value: refValue, label: text(ref.label) }; });
      return { ...base, type, bars, referenceLines, orientation: raw.orientation === "vertical" ? "vertical" : "horizontal", digits: finiteOrUndefined(raw.digits) ?? 3, valueLabel: text(raw.value_label) };
    }
    case "matrix": {
      if (!Array.isArray(raw.rows) || !Array.isArray(raw.cols) || !Array.isArray(raw.values)) throw new ConsoleV2ContractError(`区块 ${id}: matrix 需要 rows、cols、values`);
      const rows = raw.rows.map(String); const cols = raw.cols.map(String);
      const grid = (source: unknown, label: string) => {
        if (!Array.isArray(source) || source.length !== rows.length) throw new ConsoleV2ContractError(`区块 ${id}: ${label} 行数与 rows 不一致`);
        return source.map((line) => { if (!Array.isArray(line) || line.length !== cols.length) throw new ConsoleV2ContractError(`区块 ${id}: ${label} 列数与 cols 不一致`); return line.map(nullableNumber); });
      };
      const domain = Array.isArray(raw.domain) && raw.domain.length === 2 && raw.domain.every((n) => Number.isFinite(Number(n))) ? [Number(raw.domain[0]), Number(raw.domain[1])] as [number, number] : [-1, 1] as [number, number];
      return { ...base, type, rows, cols, values: grid(raw.values, "values"), counts: raw.counts === undefined || raw.counts === null ? undefined : grid(raw.counts, "counts"), domain, digits: finiteOrUndefined(raw.digits) ?? 2 };
    }
    case "text": {
      const body = raw.markdown ?? raw.text;
      if (typeof body !== "string") throw new ConsoleV2ContractError(`区块 ${id}: text 需要 markdown 或 text 字符串`);
      return { ...base, type, text: body, format: raw.format === "json" ? "json" : raw.format === "plain" ? "plain" : "markdown" };
    }
    case "image": {
      return { ...base, type, artifact: requiredText(raw.artifact, "image.artifact"), alt: text(raw.alt) ?? base.title ?? id };
    }
    default:
      return { ...base, type: "unsupported", originalType: type };
  }
}

function decodeSort(value: unknown, columnKeys: Set<string>, id: string): SortSpec | undefined {
  if (value === undefined || value === null) return undefined;
  let spec: SortSpec;
  if (typeof value === "string") {
    spec = value.startsWith("-") ? { key: value.slice(1), direction: "desc" } : { key: value.replace(/^\+/, ""), direction: "asc" };
  } else {
    const raw = record(value);
    spec = { key: requiredText(raw.key, "default_sort.key"), direction: raw.direction === "desc" ? "desc" : "asc" };
  }
  if (!columnKeys.has(spec.key)) throw new ConsoleV2ContractError(`区块 ${id}: default_sort 引用了不存在的列 ${spec.key}`);
  return spec;
}

function decodePoint(value: unknown, xKind: string, id: string): SeriesPoint {
  let rawX: unknown; let rawY: unknown; let extra: RawRecord = {};
  if (Array.isArray(value)) { if (value.length < 2) throw new ConsoleV2ContractError(`区块 ${id}: 点必须至少有 [x, y]`); [rawX, rawY] = value; }
  else { extra = record(value); rawX = extra.x; rawY = extra.y; }
  const x = xKind === "time" ? (typeof rawX === "number" ? rawX : Date.parse(String(rawX))) : Number(rawX);
  if (!Number.isFinite(x)) throw new ConsoleV2ContractError(`区块 ${id}: 点的 x 无效`);
  const y = rawY === null || rawY === undefined ? null : Number(rawY);
  if (y !== null && !Number.isFinite(y)) throw new ConsoleV2ContractError(`区块 ${id}: 点的 y 无效`);
  return { x, y, size: finiteOrUndefined(extra.size), lower: finiteOrUndefined(extra.lower), upper: finiteOrUndefined(extra.upper), lowSample: extra.low_sample === true ? true : undefined, label: text(extra.label) };
}

// ───────────────────────── 运行 ─────────────────────────

export interface RunProgress { done: number; total: number }
export interface BacktestRun {
  runId: string;
  batchId?: string;
  parentRunId?: string;
  origin: "platform" | "legacy";
  board: string;
  item: string;
  status: RunStatus;
  lost: boolean;
  stage?: string;
  stageLabel?: string;
  progress?: RunProgress;
  logTail?: string;
  heartbeatAt?: string;
  attempt?: number;
  cancelRequested: boolean;
  configSha256?: string;
  config?: RawRecord;
  result?: BacktestResult;
  reproduce?: { text: string; fields: RawRecord };
  inputFingerprints?: { dataGeneration?: string; files: Record<string, string> };
  restoredInputs: string[];
  error?: { code?: string; message: string; logTail?: string };
  hasArtifacts: boolean;
  rerunnable: boolean;
  requestedBy?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  reused: boolean;
}

const STATUSES: ReadonlySet<string> = new Set(["queued", "running", "succeeded", "failed", "cancelled"]);

export function decodeRun(value: unknown): BacktestRun {
  const raw = record(value);
  const status = requiredText(raw.status, "run.status");
  if (!STATUSES.has(status)) throw new ConsoleV2ContractError(`运行状态未知: ${status}`);
  const progress = raw.progress !== undefined && raw.progress !== null ? record(raw.progress) : undefined;
  const reproduce = raw.reproduce !== undefined && raw.reproduce !== null ? record(raw.reproduce) : undefined;
  const fingerprints = raw.input_fingerprints !== undefined && raw.input_fingerprints !== null ? record(raw.input_fingerprints) : undefined;
  const error = raw.error !== undefined && raw.error !== null ? record(raw.error) : undefined;
  const config = raw.config !== undefined && raw.config !== null ? record(raw.config) : undefined;
  return {
    runId: requiredText(raw.run_id, "run.run_id"),
    batchId: text(raw.batch_id),
    parentRunId: text(raw.parent_run_id),
    origin: raw.origin === "legacy" ? "legacy" : "platform",
    board: requiredText(raw.board, "run.board"),
    item: requiredText(raw.item, "run.item"),
    status: status as RunStatus,
    lost: raw.lost === true,
    stage: text(raw.stage),
    stageLabel: text(raw.stage_label),
    progress: progress && finiteOrUndefined(progress.total) !== undefined ? { done: finiteOrUndefined(progress.done) ?? 0, total: finiteOrUndefined(progress.total) as number } : undefined,
    logTail: typeof raw.log_tail === "string" ? raw.log_tail : undefined,
    heartbeatAt: text(raw.heartbeat_at),
    attempt: finiteOrUndefined(raw.attempt),
    cancelRequested: raw.cancel_requested === true,
    configSha256: text(raw.config_sha256),
    config,
    result: raw.result !== undefined && raw.result !== null ? decodeResult(raw.result) : undefined,
    reproduce: reproduce ? { text: requiredText(reproduce.text, "reproduce.text"), fields: record(reproduce.fields) } : undefined,
    inputFingerprints: fingerprints ? { dataGeneration: text(fingerprints.data_generation), files: stringRecord(fingerprints.files) } : undefined,
    restoredInputs: Array.isArray(raw.restored_inputs) ? raw.restored_inputs.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)) : [],
    error: error ? { code: text(error.code), message: text(error.message) ?? "运行失败", logTail: text(error.log_tail) } : undefined,
    // infra 只在运行已有产物包时给 artifacts_url（OSS key 不对外）
    hasArtifacts: (typeof raw.artifacts_url === "string" && raw.artifacts_url !== "") || (typeof raw.artifacts_sha256 === "string" && raw.artifacts_sha256 !== ""),
    rerunnable: raw.rerunnable !== false,
    requestedBy: text(raw.requested_by),
    createdAt: text(raw.created_at),
    startedAt: text(raw.started_at),
    finishedAt: text(raw.finished_at),
    reused: raw.reused === true,
  };
}

export interface CreateRunsResult { batchId?: string; runs: BacktestRun[] }

export function decodeCreateRuns(payload: unknown): CreateRunsResult {
  const data = envelope(payload);
  if (!Array.isArray(data.runs) || data.runs.length === 0) throw new ConsoleV2ContractError("创建运行的响应缺少 runs");
  return { batchId: text(data.batch_id), runs: data.runs.map(decodeRun) };
}

// ───────────────────────── 提交 ─────────────────────────

export type SubmissionKind = "strategy" | "factor_table" | "prediction";
export interface SubmissionError { path?: string; code?: string; message: string }
export interface Submission {
  id: string;
  kind: SubmissionKind;
  identity: RawRecord;
  status: "validating" | "accepted" | "rejected";
  sha256?: string;
  bytes?: number;
  errors: SubmissionError[];
  intakeRunId?: string;
  /** 重复上传相同内容时 infra 返回 200 并带 already_submitted */
  alreadySubmitted: boolean;
  submittedBy?: string;
  createdAt?: string;
  decidedAt?: string;
}

export function decodeSubmission(value: unknown): Submission {
  const raw = record(value);
  const kind = requiredText(raw.kind, "submission.kind");
  if (!["strategy", "factor_table", "prediction"].includes(kind)) throw new ConsoleV2ContractError(`提交类型未知: ${kind}`);
  const status = requiredText(raw.status, "submission.status");
  if (!["validating", "accepted", "rejected"].includes(status)) throw new ConsoleV2ContractError(`提交状态未知: ${status}`);
  return {
    id: requiredText(raw.submission_id, "submission.submission_id"), kind: kind as SubmissionKind, identity: record(raw.identity), status: status as Submission["status"],
    sha256: text(raw.sha256), bytes: finiteOrUndefined(raw.bytes),
    errors: (Array.isArray(raw.errors) ? raw.errors : []).map((entry) => { if (typeof entry === "string") return { message: entry }; const e = record(entry); return { path: text(e.path ?? e.factor_id ?? e.field), code: text(e.code), message: text(e.message) ?? JSON.stringify(e) }; }),
    intakeRunId: text(raw.intake_run_id), alreadySubmitted: raw.already_submitted === true, submittedBy: text(raw.submitted_by), createdAt: text(raw.created_at), decidedAt: text(raw.decided_at),
  };
}

// ───────────────────────── 客户端 ─────────────────────────

type Query = Record<string, string | number | undefined>;

async function request(method: string, path: string, options: { query?: Query; body?: unknown; headers?: Record<string, string> } = {}): Promise<unknown> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(options.query ?? {})) if (val !== undefined && val !== "") params.set(key, String(val));
  const suffix = params.size ? `?${params.toString()}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/console/backtest/${path}${suffix}`, {
      method, cache: "no-store",
      headers: { ...(method !== "GET" ? { [WRITE_MARKER_HEADER]: WRITE_MARKER_VALUE } : {}), ...(options.body !== undefined ? { "content-type": "application/json" } : {}), ...options.headers },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ConsoleV2ApiError("回测平台网络不可用，请检查服务连接。", 0, "UPSTREAM_UNAVAILABLE");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(payload, response.status);
  return payload;
}

export function apiError(payload: unknown, status: number): ConsoleV2ApiError {
  const error = record(payload);
  const nested = record(error.error);
  const data = record(error.data);
  // infra 的 400 把逐项问题放在 data.errors[{field, message}]，并给出 total_errors
  const entries = Array.isArray(data.errors) ? data.errors : [];
  const shown = entries.slice(0, 5).map((entry) => {
    if (typeof entry === "string") return entry;
    const item = record(entry);
    const message = text(item.message);
    const field = text(item.field);
    return message ? (field ? `${field}：${message}` : message) : "";
  }).filter(Boolean);
  const total = typeof data.total_errors === "number" ? data.total_errors : entries.length;
  const detail = shown.length ? `：${shown.join("；")}${total > shown.length ? `（共 ${total} 项）` : ""}` : "";
  const code = text(error.code) ?? text(nested.code);
  const message = text(error.message) ?? text(nested.message) ?? "回测平台接口请求失败";
  // infra 的 400 / 409 说明是英文原文（逐项错误里的字段名也是接口字段）；已知错误码换成中文开头，原文仍保留在后面
  const zh = code ? CODE_TEXT[code] : undefined;
  const lead = zh && !/[\u4e00-\u9fff]/.test(message) ? (code === "RUN_NOT_RERUNNABLE" ? `${zh}：${message}` : zh) : message;
  return new ConsoleV2ApiError(`${lead}${detail}`, status, code);
}

const CODE_TEXT: Record<string, string> = {
  INVALID_BACKTEST_RUN: "发起参数不符合要求", INVALID_BACKTEST_IDENTITY: "提交标识不符合规则", INVALID_BACKTEST_SUBMISSION: "提交内容未通过格式检查",
  INVALID_BACKTEST_POOL: "因子池操作参数不符合要求", INVALID_FILTER: "查询条件不被支持", INVALID_PAGINATION: "分页参数不符合要求",
  INVALID_BACKTEST_ARTIFACT_PATH: "产物路径无效", RUN_NOT_RERUNNABLE: "该运行不能重跑", OPERATOR_REQUIRED: "缺少操作人标识",
};

function envelope(payload: unknown): RawRecord { const root = record(payload); return record(root.data ?? payload); }

function pageFrom<T>(payload: unknown, decode: (value: unknown) => T): BacktestPage<T> {
  const data = envelope(payload);
  if (!Array.isArray(data.items)) throw new ConsoleV2ContractError("回测平台列表响应缺少 items");
  return {
    items: data.items.map(decode),
    limit: nonNegativeInt(data.limit, 20), offset: nonNegativeInt(data.offset, 0), hasMore: data.has_more === true,
    observedAt: typeof data.observed_at === "string" && !Number.isNaN(Date.parse(data.observed_at)) ? data.observed_at : undefined,
    summary: data.summary !== undefined && data.summary !== null ? record(data.summary) : undefined,
  };
}

export interface CatalogQuery { kind: CatalogKind; dataset?: string; tag?: string; covers_start?: string; covers_end?: string; q?: string; status?: "available" | "retired" | "all"; pool_state?: "pool" | "experiment"; limit?: number; offset?: number }
export interface RunsQuery { board?: string; item?: string; status?: string; batch_id?: string; requested_by?: string; config_sha256?: string; parent_run_id?: string; limit?: number; offset?: number }

/** 页面可选对象一次取全（逐页 100 条，最多 50 页，超过则报错而不是静默截断）。 */
async function catalogAll(kind: CatalogKind, extra: Omit<CatalogQuery, "kind" | "limit" | "offset"> = {}): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];
  for (let offset = 0, guard = 0; guard < 50; guard += 1) {
    const page = pageFrom(await request("GET", "catalog", { query: { kind, ...extra, limit: 100, offset } }), decodeCatalogItem);
    items.push(...page.items);
    if (!page.hasMore) return items;
    offset = page.offset + page.limit;
  }
  throw new ConsoleV2ContractError(`回测目录 ${kind} 超过 5000 条，请缩小查询范围`);
}

export const backtestApi = {
  catalog: (query: CatalogQuery) => request("GET", "catalog", { query: query as unknown as Query }).then((payload) => pageFrom(payload, decodeCatalogItem)),
  catalogAll,
  runs: (query: RunsQuery = {}) => request("GET", "runs", { query: { limit: 20, ...query } as Query }).then((payload) => pageFrom(payload, decodeRun)),
  run: (runId: string) => request("GET", `runs/${encodeURIComponent(runId)}`).then((payload) => decodeRun(envelope(payload))),
  createRuns: (body: { runs: RawRecord[]; rerun_of?: string | null; force?: boolean }) =>
    request("POST", "runs", { body, headers: { "idempotency-key": newIdempotencyKey() } }).then(decodeCreateRuns),
  cancelRun: (runId: string) => request("POST", `runs/${encodeURIComponent(runId)}/cancel`).then((payload) => decodeRun(envelope(payload))),
  submission: (id: string) => request("GET", `submissions/${encodeURIComponent(id)}`).then((payload) => decodeSubmission(envelope(payload))),
  setFactorPool: (factorId: string, body: { version: string; state: "pool" | "experiment" }) => request("PUT", `factors/${encodeURIComponent(factorId)}/pool`, { body }),
  artifactUrl: (runId: string, path?: string) => `/api/console/backtest/runs/${encodeURIComponent(runId)}/artifacts${path ? `?path=${encodeURIComponent(path)}` : ""}`,
  upload: uploadFile,
};

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `bt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const UPLOAD_CONTENT_TYPES: Record<string, { path: string; contentType: string; accept: string; label: string; segments: string[] }> = {
  strategy: { path: "strategies", contentType: "application/gzip", accept: ".tar.gz,.tgz,.tar,.gz", label: "策略", segments: ["策略标识", "版本"] },
  factor_table: { path: "factor-tables", contentType: "application/vnd.apache.parquet", accept: ".parquet", label: "因子表", segments: ["表名", "数据版本"] },
  prediction: { path: "predictions", contentType: "application/vnd.apache.parquet", accept: ".parquet", label: "预测表", segments: ["模型标识", "训练版本", "预测版本"] },
};

/** 用 XHR 上传，以便显示进度；请求体由浏览器从文件流式读取，不整体载入内存。 */
function uploadFile(kind: SubmissionKind, identity: string[], file: File, onProgress?: (fraction: number) => void): Promise<Submission> {
  const spec = UPLOAD_CONTENT_TYPES[kind];
  return new Promise((resolve, reject) => {
    if (file.size > UPLOAD_LIMIT_BYTES) { reject(new ConsoleV2ApiError(`页面内上传上限 ${UPLOAD_LIMIT_BYTES / 1024 ** 2} MiB，更大的文件请直接调用接口。`, 413, "UPLOAD_TOO_LARGE")); return; }
    const contentType = kind === "strategy" && file.name.endsWith(".tar") ? "application/x-tar" : spec.contentType;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/console/backtest/upload/${spec.path}/${identity.map(encodeURIComponent).join("/")}`);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader(WRITE_MARKER_HEADER, WRITE_MARKER_VALUE);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onerror = () => reject(new ConsoleV2ApiError("上传连接中断。", 0, "UPSTREAM_UNAVAILABLE"));
    xhr.onload = () => {
      let payload: unknown = {};
      try { payload = JSON.parse(xhr.responseText); } catch { /* 非 JSON 响应按失败处理 */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(decodeSubmission(envelope(payload))); } catch (error) { reject(error); }
      } else reject(apiError(payload, xhr.status));
    };
    xhr.send(file);
  });
}

// ───────────────────────── 小工具 ─────────────────────────

export function record(value: unknown): RawRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {}; }
export function text(value: unknown): string | undefined { return value === undefined || value === null || value === "" ? undefined : String(value); }
function requiredText(value: unknown, field: string): string { const result = text(value)?.trim(); if (!result) throw new ConsoleV2ContractError(`回测平台接口缺少 ${field}`); return result; }
export function textArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && String(item).trim() !== "").map(String) : []; }
function stringRecord(value: unknown): Record<string, string> { return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, String(item)])); }
function finiteOrUndefined(value: unknown): number | undefined { if (value === null || value === undefined || value === "") return undefined; const n = Number(value); return Number.isFinite(n) ? n : undefined; }
function nullableNumber(value: unknown): number | null { return finiteOrUndefined(value) ?? null; }
function nonNegativeInt(value: unknown, fallback: number): number { const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : fallback; }

/** 是否应继续轮询：未到终态。 */
export function isActiveRun(run: Pick<BacktestRun, "status">): boolean { return !TERMINAL_STATUSES.has(run.status); }

/** 批量因子结果里，区块 id 形如 `factor:<因子>:<区块名>`：同一因子的区块归为一组，用「因子明细」选择器切换。 */
export function factorGroupOf(sectionId: string): string | undefined {
  const match = /^factor:(.+?):[^:]+$/.exec(sectionId);
  return match ? match[1] : undefined;
}
