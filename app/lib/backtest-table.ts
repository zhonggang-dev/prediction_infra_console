/**
 * 结果表格与筛选的纯函数：排序、格式化、CSV、筛选匹配、点击列固定，以及 PnL Gap 对齐。
 * 前端只做排序 / 筛选 / 格式化；Gap 对齐是前端唯一的数值计算（技术方案 3.12，同旧 pnl_gap.align_pnl_series）。
 */

import type { RawRecord, ResultFilter, SeriesPoint, SortSpec, TableColumn } from "./backtest-platform.ts";

export const EMPTY = "—";

// ───────────────────────── 单元格 ─────────────────────────

export function cellValue(row: RawRecord, column: TableColumn): unknown { return row[column.key]; }

function intervalOf(cell: unknown): { value?: number; lower: number; upper: number } | undefined {
  let lower: unknown; let upper: unknown; let value: unknown;
  if (Array.isArray(cell) && cell.length >= 2) [lower, upper, value] = cell;
  else if (cell !== null && typeof cell === "object" && !Array.isArray(cell)) { const raw = cell as RawRecord; lower = raw.lower; upper = raw.upper; value = raw.value; }
  else return undefined;
  const lo = Number(lower); const hi = Number(upper);
  if (lower === null || upper === null || lower === undefined || upper === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
  const v = value === null || value === undefined ? undefined : Number(value);
  return { value: v !== undefined && Number.isFinite(v) ? v : undefined, lower: lo, upper: hi };
}

/** 排序用的值：数字、字符串，或 null（空值永远排最后）。 */
export function sortValue(column: TableColumn, cell: unknown): number | string | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell === "string") return column.kind === "number" || column.kind === "percent" ? (Number.isFinite(Number(cell)) ? Number(cell) : null) : cell;
  if (typeof cell === "boolean") return cell ? 1 : 0;
  if (typeof cell === "object" && !Array.isArray(cell)) {
    const raw = cell as RawRecord;
    if ("sort" in raw) { const s = raw.sort; return s === null || s === undefined || !Number.isFinite(Number(s)) ? null : Number(s); }
  }
  const interval = intervalOf(cell);
  if (interval) return interval.value ?? (interval.lower + interval.upper) / 2;
  return null;
}

export function formatNumber(value: number, digits?: number, signed = false): string {
  const d = digits ?? (Number.isInteger(value) ? 0 : 3);
  const body = value.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return signed && value > 0 ? `+${body}` : body;
}

/** 带前缀的数字，符号放在前缀之前：+$12.00、-$48.00（而不是 $+12.00）。 */
function withPrefix(value: number, digits: number | undefined, signed: boolean, prefix = "", suffix = ""): string {
  const body = formatNumber(Math.abs(value), digits);
  const sign = value < 0 && Number(body.replaceAll(",", "")) !== 0 ? "-" : signed && value > 0 ? "+" : "";
  return `${sign}${prefix}${body}${suffix}`;
}

/** 屏幕显示文本。null / 缺失显示「—」，不显示为 0。 */
export function formatCell(column: TableColumn, cell: unknown): string {
  if (cell === null || cell === undefined || cell === "") return EMPTY;
  if (cell !== null && typeof cell === "object" && !Array.isArray(cell) && "text" in (cell as RawRecord)) return String((cell as RawRecord).text ?? EMPTY);
  if (column.kind === "interval") {
    const interval = intervalOf(cell);
    if (!interval) return typeof cell === "string" ? cell : EMPTY;
    const edge = (v: number) => withPrefix(v, column.digits, column.signed ?? false, column.prefix, column.suffix);
    const range = `[${edge(interval.lower)}, ${edge(interval.upper)}]`;
    return interval.value !== undefined ? `${edge(interval.value)}  ${range}` : range;
  }
  if (column.kind === "number" || column.kind === "percent") {
    const n = typeof cell === "number" ? cell : Number(cell);
    if (!Number.isFinite(n)) return typeof cell === "string" ? cell : EMPTY;
    if (column.kind === "percent") return withPrefix(column.fraction ? n * 100 : n, column.digits ?? 1, column.signed ?? false, column.prefix, `%${column.suffix ?? ""}`);
    return withPrefix(n, column.digits, column.signed ?? false, column.prefix, column.suffix);
  }
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

export type BadgeTone = "good" | "warn" | "bad" | "muted";
export function badgeTone(cell: unknown): BadgeTone {
  const tone = cell !== null && typeof cell === "object" && !Array.isArray(cell) ? String((cell as RawRecord).tone ?? "") : "";
  if (tone === "good" || tone === "warn" || tone === "bad") return tone;
  const label = formatCellText(cell);
  if (/通过|更准|胜过|已排名|是|正常|成功/.test(label)) return "good";
  if (/复审|分不出|不足|提示|跨/.test(label)) return "warn";
  if (/异常|更差|失败|错误/.test(label)) return "bad";
  return "muted";
}
function formatCellText(cell: unknown): string {
  if (cell !== null && typeof cell === "object" && !Array.isArray(cell)) return String((cell as RawRecord).text ?? "");
  return cell === null || cell === undefined ? "" : String(cell);
}

// ───────────────────────── 排序 ─────────────────────────

export function sortRows(columns: TableColumn[], rows: RawRecord[], sort?: SortSpec): RawRecord[] {
  if (!sort) return rows;
  const column = columns.find((c) => c.key === sort.key);
  if (!column) return rows;
  const factor = sort.direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(column, cellValue(row, column)) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      const cmp = typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value : String(a.value).localeCompare(String(b.value), "zh-CN", { numeric: true });
      return cmp === 0 ? a.index - b.index : cmp * factor;
    })
    .map((entry) => entry.row);
}

/** 点表头：同列反向；换列时方向取该列「最优在前」，没声明则数值降序、文本升序。 */
export function nextSort(columns: TableColumn[], current: SortSpec | undefined, key: string): SortSpec {
  if (current?.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  const column = columns.find((c) => c.key === key);
  if (column?.best) return { key, direction: column.best === "low" ? "asc" : "desc" };
  return { key, direction: column && (column.kind === "number" || column.kind === "percent" || column.kind === "interval") ? "desc" : "asc" };
}

/** 点过的列按「最近点击优先」挪到首列之后（旧 Overview 的固定列，app.py:7244）。 */
export function pinColumns(columns: TableColumn[], clicked: string[]): TableColumn[] {
  if (clicked.length === 0 || columns.length < 2) return columns;
  const [anchor, ...rest] = columns;
  const pinned = clicked.map((key) => rest.find((c) => c.key === key)).filter((c): c is TableColumn => !!c);
  const pinnedKeys = new Set(pinned.map((c) => c.key));
  return [anchor, ...pinned, ...rest.filter((c) => !pinnedKeys.has(c.key))];
}
export function pushClicked(clicked: string[], key: string): string[] { return [key, ...clicked.filter((k) => k !== key)]; }

/** 排名号：按当前排序列的顺序，空值不给号（旧 Overview 规则）。 */
export function rankNumbers(columns: TableColumn[], sortedRows: RawRecord[], sort?: SortSpec): Array<number | null> {
  const column = sort ? columns.find((c) => c.key === sort.key) : undefined;
  let rank = 0;
  return sortedRows.map((row) => {
    if (!column) return (rank += 1);
    return sortValue(column, cellValue(row, column)) === null ? null : (rank += 1);
  });
}

export function searchRows(columns: TableColumn[], rows: RawRecord[], query: string): RawRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => columns.some((column) => formatCell(column, cellValue(row, column)).toLowerCase().includes(q)));
}

// ───────────────────────── 筛选 ─────────────────────────

export type FilterSelection = Record<string, string>;

export function defaultSelection(filters: ResultFilter[]): FilterSelection { return Object.fromEntries(filters.map((f) => [f.key, f.defaultValue])); }

/**
 * 一个对象（行 / 柱 / 序列）是否在当前筛选下显示：只看对象自己的 `filters` 对象。
 * 对每个已选的 key，`filters[key]` 缺失表示不受该筛选约束；有值则必须等于所选值（数组表示多个档位都适用）。
 * 不回退去读同名的数据列，避免列名与筛选 key 碰巧相同而误过滤。
 */
export function matchesFilters(item: { filters?: RawRecord } | RawRecord | undefined, selection: FilterSelection): boolean {
  const scoped = item?.filters !== null && typeof item?.filters === "object" && !Array.isArray(item?.filters) ? item.filters as RawRecord : undefined;
  if (!scoped) return true;
  return matchesWhen(scoped, selection);
}

/** 区块的 `when`：直接是 key → 值（或值数组）的映射，要求与结果级筛选的当前选择一致。 */
export function matchesWhen(when: RawRecord | undefined, selection: FilterSelection): boolean {
  if (!when) return true;
  for (const [key, selected] of Object.entries(selection)) {
    const value = when[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) ? !value.map(String).includes(selected) : String(value) !== selected) return false;
  }
  return true;
}

// ───────────────────────── CSV ─────────────────────────

function csvField(value: string): string { return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }

/** 屏幕所见即所得：数字按列精度舍入后输出为数字，区间 / 徽章 / 文本输出屏幕文本。 */
export function toCsv(columns: TableColumn[], rows: RawRecord[]): string {
  const lines = [columns.map((column) => csvField(column.label)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => {
      const cell = cellValue(row, column);
      if ((column.kind === "number" || column.kind === "percent") && typeof cell === "number" && Number.isFinite(cell)) {
        const value = column.kind === "percent" && column.fraction ? cell * 100 : cell;
        return String(column.digits === undefined ? value : Number(value.toFixed(column.digits)));
      }
      const display = formatCell(column, cell);
      return csvField(display === EMPTY ? "" : display);
    }).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ───────────────────────── PnL Gap ─────────────────────────

export interface GapResult { times: number[]; a: number[]; b: number[]; gap: number[]; final: number; max: number; min: number }

/** 同一时刻多个点取最后一个；缺失 y 的点忽略。 */
function lastPerTime(points: SeriesPoint[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const point of points) if (point.y !== null) result.set(point.x, point.y);
  return result;
}

/** 时间并集、前向填充、首事件前记 0，Gap = A − B。两条曲线任何一条没有点则返回 undefined。 */
export function alignPnlSeries(a: SeriesPoint[], b: SeriesPoint[]): GapResult | undefined {
  const left = lastPerTime(a); const right = lastPerTime(b);
  if (left.size === 0 || right.size === 0) return undefined;
  const times = Array.from(new Set([...left.keys(), ...right.keys()])).sort((x, y) => x - y);
  let lastA = 0; let lastB = 0;
  const aValues: number[] = []; const bValues: number[] = []; const gap: number[] = [];
  for (const time of times) {
    lastA = left.get(time) ?? lastA;
    lastB = right.get(time) ?? lastB;
    aValues.push(lastA); bValues.push(lastB); gap.push(lastA - lastB);
  }
  return { times, a: aValues, b: bValues, gap, final: gap[gap.length - 1], max: Math.max(...gap), min: Math.min(...gap) };
}
