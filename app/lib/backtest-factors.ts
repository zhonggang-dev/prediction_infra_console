/** 因子库的展示整理（纯函数）：名字去重、表 / 版本、最近变更的来源。 */

import { requesterLabel } from "./backtest-labels.ts";
import { record, text, type CatalogItem } from "./backtest-platform.ts";

export const FACTOR_PAGE_SIZE = 50;
export const NO_GROUP = "未分组";

/** 旧平台登记的因子版本形如 `legacy/…`，没有真正的因子表。 */
export const isLegacyFactor = (item: CatalogItem) => item.origin === "legacy" || item.version.startsWith("legacy/");

export function factorGroup(item: CatalogItem): string { return text(item.metadata.group) ?? NO_GROUP; }

/** 标题与 key 相同（旧因子的名字就是 key）时只显示一次；副行写来源。 */
export function factorNames(item: CatalogItem): { title: string; subtitle: string } {
  const label = text(item.metadata.label);
  const legacy = isLegacyFactor(item) ? "旧平台" : "";
  if (!label || label === item.key) return { title: item.key, subtitle: legacy };
  return { title: label, subtitle: [item.key, legacy].filter(Boolean).join(" · ") };
}

/** 下拉框里因子名后面的版本后缀：旧平台登记的因子没有表和版本（内部记作 `legacy/legacy`），不显示；平台提交的显示「表名/版本」。 */
export const factorVersionSuffix = (item: CatalogItem) => isLegacyFactor(item) ? "" : ` · ${item.version}`;

/** 「表 / 版本」列：旧因子显示「旧平台登记」；平台提交的因子版本是 `<表名>/<数据版本>`。 */
export function factorTableVersion(item: CatalogItem): { primary: string; secondary?: string } {
  if (isLegacyFactor(item)) return { primary: "旧平台登记" };
  const cut = item.version.indexOf("/");
  return cut > 0 ? { primary: `表 ${item.version.slice(0, cut)}`, secondary: `版本 ${item.version.slice(cut + 1)}` } : { primary: item.version || "—" };
}

const IMPORT_ACTORS = new Set(["", "migration", "legacy-import"]);

/** 「最近变更」：没有操作人（或是迁移账号）说明只是登记时的导入，不是人工移入 / 移出。 */
export function factorChange(item: CatalogItem): { actor: string; manual: boolean; at?: string } {
  const by = item.poolChangedBy?.trim() ?? "";
  return IMPORT_ACTORS.has(by) ? { actor: "迁移导入", manual: false, at: item.poolChangedAt } : { actor: requesterLabel(by), manual: true, at: item.poolChangedAt };
}

/** 「去评估」：跳到信号测试并选中这个因子。 */
export const evaluateHref = (item: CatalogItem) => `/backtest-platform/signal?factor=${encodeURIComponent(`${item.key}@${item.version}`)}`;

export function factorGroups(items: CatalogItem[]): string[] {
  return Array.from(new Set(items.map(factorGroup))).sort((a, b) => a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a.localeCompare(b));
}

export const directionOf = (item: CatalogItem): number | undefined => item.metadata.direction === undefined ? undefined : Number(item.metadata.direction);
export const coverageOf = (item: CatalogItem) => { const coverage = record(item.metadata.coverage); const start = text(coverage.start); const end = text(coverage.end); return start && end ? `${start.slice(0, 10)} → ${end.slice(0, 10)}` : "未知"; };
