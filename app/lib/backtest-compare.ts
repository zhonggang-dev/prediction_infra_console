/**
 * 两次运行对比：逐字段列出运行配置与输入指纹的差异，并把同一对象同一指标的数值并排。
 * 纯函数，数据都来自 `GET /runs/{id}` 已返回的字段。
 */

import type { BacktestRun, RawRecord, TableSection } from "./backtest-platform.ts";
import { cellValue, formatCell, sortValue } from "./backtest-table.ts";

/** 每次运行必然不同、不应算作「配置差异」的字段（共用契约第 3 节的复用键排除项）。 */
const VOLATILE_CONFIG_KEYS = new Set(["run_id", "batch_id", "parent_run_id", "requested_by", "created_at"]);

export interface FieldDiff { path: string; a: string; b: string }

export function flatten(value: unknown, prefix = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix, "[]");
    else value.forEach((entry, index) => flatten(entry, `${prefix}[${index}]`, out));
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as RawRecord);
    if (entries.length === 0) out.set(prefix, "{}");
    for (const [key, entry] of entries) {
      if (prefix === "" && VOLATILE_CONFIG_KEYS.has(key)) continue;
      flatten(entry, prefix ? `${prefix}.${key}` : key, out);
    }
  } else out.set(prefix, value === null || value === undefined ? "null" : String(value));
  return out;
}

export function diffFlat(a: Map<string, string>, b: Map<string, string>): FieldDiff[] {
  const paths = Array.from(new Set([...a.keys(), ...b.keys()])).sort();
  return paths.filter((path) => a.get(path) !== b.get(path)).map((path) => ({ path, a: a.get(path) ?? "（无）", b: b.get(path) ?? "（无）" }));
}

export interface RunDiff { config: FieldDiff[]; fingerprints: FieldDiff[]; sameConfigSha: boolean | undefined }

export function diffRuns(a: BacktestRun, b: BacktestRun): RunDiff {
  const fingerprints = (run: BacktestRun) => {
    const map = new Map<string, string>();
    if (run.inputFingerprints?.dataGeneration) map.set("data_generation", run.inputFingerprints.dataGeneration);
    for (const [file, sha] of Object.entries(run.inputFingerprints?.files ?? {})) map.set(file, sha);
    return map;
  };
  return {
    config: diffFlat(flatten(a.config ?? {}), flatten(b.config ?? {})),
    fingerprints: diffFlat(fingerprints(a), fingerprints(b)),
    sameConfigSha: a.configSha256 && b.configSha256 ? a.configSha256 === b.configSha256 : undefined,
  };
}

export interface MetricPair { section: string; sectionTitle: string; object: string; metric: string; a: number | string | null; b: number | string | null; displayA: string; displayB: string; delta: number | null }

/** 以第一列为对象标识，对两边都有的表格区块逐指标并排；只比较数值列（number / percent）。 */
export function compareResults(a: BacktestRun, b: BacktestRun, limit = 400): MetricPair[] {
  const pairs: MetricPair[] = [];
  const tablesB = new Map((b.result?.sections ?? []).filter((s): s is TableSection => s.type === "table").map((s) => [s.id, s]));
  for (const section of a.result?.sections ?? []) {
    if (section.type !== "table") continue;
    const other = tablesB.get(section.id);
    if (!other || section.columns.length === 0) continue;
    const keyColumn = section.columns[0];
    // 带筛选档位的表（例如 90/95/99 三档各一行），行标识要带上档位，否则不同档位的行会互相覆盖
    const filterKeys = Array.from(new Set([...(a.result?.filters ?? []), ...section.filters].map((f) => f.key)));
    const identity = (row: RawRecord) => {
      const scoped = row.filters !== null && typeof row.filters === "object" ? row.filters as RawRecord : {};
      const tags = filterKeys.map((key) => scoped[key]).filter((value) => value !== undefined && value !== null).map(String);
      return `${String(formatCell(keyColumn, cellValue(row, keyColumn)))}${tags.length ? ` · ${tags.join(" / ")}` : ""}`;
    };
    const rowsB = new Map(other.rows.map((row) => [identity(row), row]));
    for (const row of section.rows) {
      const object = identity(row);
      const match = rowsB.get(object);
      if (!match) continue;
      for (const column of section.columns.slice(1)) {
        if (column.kind !== "number" && column.kind !== "percent") continue;
        const otherColumn = other.columns.find((c) => c.key === column.key);
        if (!otherColumn) continue;
        const va = sortValue(column, cellValue(row, column));
        const vb = sortValue(otherColumn, cellValue(match, otherColumn));
        if (va === null && vb === null) continue;
        pairs.push({
          section: section.id, sectionTitle: section.title ?? section.id, object, metric: column.label,
          a: va, b: vb, displayA: formatCell(column, cellValue(row, column)), displayB: formatCell(otherColumn, cellValue(match, otherColumn)),
          delta: typeof va === "number" && typeof vb === "number" ? vb - va : null,
        });
        if (pairs.length >= limit) return pairs;
      }
    }
  }
  return pairs;
}
