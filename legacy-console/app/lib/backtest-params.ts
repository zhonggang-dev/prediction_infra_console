/**
 * 引擎参数定义 → 表单状态、校验与请求参数。默认值只有目录里那一份来源，前端不写死。
 * 参数名里的点表示嵌套：`position_sizing.mode` → `{position_sizing: {mode}}`。
 */

import type { ParamDef } from "./backtest-platform.ts";

export type ParamValues = Record<string, string | boolean>;

/**
 * 表单所处的上下文，决定带 `requires` 的参数是否显示（例如逐时点专用参数只在选中了逐时点策略时出现）。
 * 隐藏的参数不校验、不提交：infra 会按引擎定义补默认值，所以提交的配置与「显示并保持默认值」等价。
 */
export type ParamContext = Partial<Record<NonNullable<ParamDef["requires"]>, boolean>>;

export function initialParamValues(defs: ParamDef[]): ParamValues {
  const values: ParamValues = {};
  for (const def of defs) values[def.name] = stateFromValue(def, def.defaultValue);
  return values;
}

function stateFromValue(def: ParamDef, value: unknown): string | boolean {
  if (def.type === "bool") return value === true;
  if (value === null || value === undefined) return "";
  if (def.type === "list") return Array.isArray(value) ? value.join(", ") : String(value);
  return String(value);
}

export function isVisible(def: ParamDef, values: ParamValues, context: ParamContext = {}): boolean {
  if (def.requires && context[def.requires] !== true) return false;
  if (!def.when) return true;
  return Object.entries(def.when).every(([name, expected]) => Array.isArray(expected) ? expected.map(String).includes(String(values[name])) : String(values[name]) === String(expected));
}

/** 支持中文逗号、顿号与空白分隔。 */
export function parseNumberList(input: string): number[] {
  return input.split(/[,，、\s]+/).map((part) => part.trim()).filter(Boolean).map(Number);
}

/** 文本列表只按逗号 / 顿号分隔（元素里允许空格）。 */
export function parseTextList(input: string): string[] {
  return input.split(/[,，、]+/).map((part) => part.trim()).filter(Boolean);
}

function inRange(def: ParamDef, value: number): string | undefined {
  if (def.min !== undefined && (def.minExclusive ? value <= def.min : value < def.min)) return `必须${def.minExclusive ? "大于" : "不小于"} ${def.min}`;
  if (def.max !== undefined && (def.maxExclusive ? value >= def.max : value > def.max)) return `必须${def.maxExclusive ? "小于" : "不大于"} ${def.max}`;
  return undefined;
}

/** 没有 default 的参数 infra 视为必填；有 default 的留空也不让提交（避免清空后悄悄回落到默认值）。 */
function emptyAllowed(def: ParamDef): boolean {
  if (def.type === "text") return def.defaultValue === "";
  if (def.type === "list") return Array.isArray(def.defaultValue) && def.defaultValue.length === 0 && (def.minItems ?? 0) === 0;
  return false;
}

function choiceMatches(def: ParamDef, input: string): boolean {
  return !!def.choices?.some((choice) => String(choice.value) === input || (Number.isFinite(Number(input)) && input !== "" && typeof choice.value === "number" && choice.value === Number(input)));
}

/** 返回 name → 错误文案；没有错误返回空对象。只校验类型、范围、枚举、个数、长度；更细的口径规则由 infra 校验后回显。 */
export function validateParams(defs: ParamDef[], values: ParamValues, context: ParamContext = {}): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const def of defs) {
    if (!isVisible(def, values, context)) continue;
    const raw = values[def.name];
    if (def.type === "bool") continue;
    const input = String(raw ?? "").trim();
    if (input === "") { if (!emptyAllowed(def)) errors[def.name] = def.defaultValue === null || def.defaultValue === undefined ? "为必填项" : "不能为空"; continue; }
    if (def.type === "integer" || def.type === "number") {
      const n = Number(input);
      if (!Number.isFinite(n)) { errors[def.name] = "必须是数字"; continue; }
      if (def.type === "integer" && !Number.isInteger(n)) { errors[def.name] = "必须是整数"; continue; }
      const range = inRange(def, n);
      if (range) errors[def.name] = range;
      else if (def.choices && !choiceMatches(def, input)) errors[def.name] = "不在可选范围内";
    } else if (def.type === "enum") {
      if (!choiceMatches(def, input)) errors[def.name] = "不在可选范围内";
    } else if (def.type === "text") {
      if (def.maxLength !== undefined && input.length > def.maxLength) errors[def.name] = `不能超过 ${def.maxLength} 个字符`;
      else if (def.choices && !choiceMatches(def, input)) errors[def.name] = "不在可选范围内";
    } else if (def.type === "list") {
      if (def.itemType === "text") {
        const items = parseTextList(input);
        if (items.length === 0) { errors[def.name] = "必须是用逗号分隔的内容"; continue; }
        if (def.minItems !== undefined && items.length < def.minItems) errors[def.name] = `至少 ${def.minItems} 项`;
        else if (def.maxItems !== undefined && items.length > def.maxItems) errors[def.name] = `最多 ${def.maxItems} 项`;
        else if (def.choices && items.some((item) => !choiceMatches(def, item))) errors[def.name] = "含有不在可选范围内的值";
        continue;
      }
      const items = parseNumberList(input);
      if (items.length === 0 || items.some((n) => !Number.isFinite(n))) { errors[def.name] = "必须是用逗号分隔的数字"; continue; }
      if (def.itemType === "integer" && items.some((n) => !Number.isInteger(n))) { errors[def.name] = "每个值必须是整数"; continue; }
      const bad = items.map((n) => inRange(def, n)).find(Boolean);
      if (bad) errors[def.name] = `每个值${bad}`;
      else if (def.minItems !== undefined && items.length < def.minItems) errors[def.name] = `至少 ${def.minItems} 项`;
      else if (def.maxItems !== undefined && items.length > def.maxItems) errors[def.name] = `最多 ${def.maxItems} 项`;
      else if (def.choices && items.some((n) => !choiceMatches(def, String(n)))) errors[def.name] = "含有不在可选范围内的值";
      else if (items.some((n, i) => i > 0 && n <= items[i - 1])) errors[def.name] = "必须严格递增";
    }
  }
  return errors;
}

function convert(def: ParamDef, raw: string | boolean | undefined): unknown {
  if (def.type === "bool") return raw === true;
  const input = String(raw ?? "").trim();
  if (input === "") return def.type === "list" && emptyAllowed(def) ? [] : undefined;
  if (def.type === "list") return def.itemType === "text" ? parseTextList(input) : parseNumberList(input);
  if (def.choices && def.type !== "enum") {
    const choice = def.choices.find((c) => String(c.value) === input);
    if (choice) return choice.value;
  }
  if (def.type === "integer") return Math.trunc(Number(input));
  if (def.type === "number") return Number(input);
  if (def.type === "enum") {
    const choice = def.choices?.find((c) => String(c.value) === input);
    return choice ? choice.value : input;
  }
  return input;
}

/** 请求里的 `params`：只含当前可见的参数，点号展开为嵌套对象。 */
export function paramsPayload(defs: ParamDef[], values: ParamValues, context: ParamContext = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    if (!isVisible(def, values, context)) continue;
    const value = convert(def, values[def.name]);
    if (value === undefined) continue;
    const path = def.name.split(".");
    let cursor = out;
    for (const part of path.slice(0, -1)) {
      if (typeof cursor[part] !== "object" || cursor[part] === null) cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[path[path.length - 1]] = value;
  }
  return out;
}

/**
 * 与默认值不同的参数（平名，不展开点号）。用于把一组参数写成「只含改动」的紧凑对象：
 * 没有任何改动时是空对象，对应引擎默认值，配置摘要因此稳定。
 */
export function paramsDiff(defs: ParamDef[], values: ParamValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const value = convert(def, values[def.name]);
    if (value === undefined) continue;
    if (JSON.stringify(value) === JSON.stringify(def.defaultValue)) continue;
    out[def.name] = value;
  }
  return out;
}

/** 键按字母序的 JSON，同一组改动永远得到同一个字符串（配置摘要要稳定）。 */
export function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}
