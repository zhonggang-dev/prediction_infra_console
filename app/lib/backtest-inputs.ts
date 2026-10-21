/**
 * 运行输入版本的展示辅助（纯函数）。
 *
 * 运行的输入记录有两种形态（见 backtest-platform-page-contract.md）：
 * - 旧形态：`data_generation`（整个数据目录的总摘要）+ `files`；
 * - 新形态：`inputs`（输入名 → 版本串，只含本次运行用到的输入）+ `files`，`data_generation` 为空。
 */

import type { InputFingerprints } from "./backtest-platform.ts";

export type FingerprintForm = "inputs" | "generation" | "unknown";

/** 输入名 → 中文名，同时决定展示顺序；不认识的名字排在后面并原样显示。 */
export const INPUT_LABELS: Record<string, string> = {
  settlement: "结算表", anchors: "锚点", orderbook: "盘口", factors: "物化因子",
  hourly_bars: "小时线", tag_slice: "标签切片", domain_slice: "域映射切片",
};
const INPUT_ORDER = Object.keys(INPUT_LABELS);

export const inputLabel = (name: string): string => INPUT_LABELS[name] ?? name;

export function fingerprintForm(fingerprints: InputFingerprints | undefined): FingerprintForm {
  if (!fingerprints) return "unknown";
  if (fingerprints.inputs && Object.keys(fingerprints.inputs).length > 0) return "inputs";
  if (fingerprints.dataGeneration) return "generation";
  return "unknown";
}

/** 新形态的输入版本，按固定顺序（已知输入在前），未知输入按名字排在后面。 */
export function orderedInputs(inputs: Record<string, string> | undefined): Array<{ name: string; label: string; version: string }> {
  const rank = (name: string) => { const index = INPUT_ORDER.indexOf(name); return index < 0 ? INPUT_ORDER.length : index; };
  return Object.entries(inputs ?? {})
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, version]) => ({ name, label: inputLabel(name), version }));
}

/**
 * 版本串的短显示：`sha256:` 前缀去掉，超过 12 位的只留前 12 位。
 * `release:…` / `files:…` 这类带前缀的盘口版本同样按前 12 个字符截断；完整值由调用方放在悬浮提示里。
 */
export function shortVersion(version: string): string {
  const bare = version.startsWith("sha256:") ? version.slice("sha256:".length) : version;
  return bare.length > 12 ? `${bare.slice(0, 12)}…` : bare;
}

/** 输入指纹对比里的行名：`inputs.settlement` → 「输入版本 · 结算表」，`data_generation` → 「数据目录版本」，其余（文件路径）原样。 */
export function fingerprintRowLabel(path: string): string {
  if (path === "data_generation") return "数据目录版本（data_generation）";
  if (path.startsWith("inputs.")) return `输入版本 · ${inputLabel(path.slice("inputs.".length))}`;
  return path;
}
