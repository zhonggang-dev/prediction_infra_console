/**
 * 逐时点策略在交易回测表单里的辅助逻辑（纯函数）：
 * 参数表单取交集、仓位模式限制、对模型的需求。规则与执行器一致：
 * 执行器对每个逐时点策略只取它自己声明了的参数（stepwise/handler.py），仓位模式不在策略声明里会直接失败。
 */

import { paramsDiff, stableJson, type ParamValues } from "./backtest-params.ts";
import type { ParamDef } from "./backtest-platform.ts";
import type { StrategyInfo } from "./backtest-selection.ts";

export const POSITION_MODE_NAME = "position_sizing.mode";

export interface StrategyParamPlan {
  /** 所有选中的逐时点策略都声明了、且定义完全一致的参数：可以改 */
  shared: ParamDef[];
  /** 只有部分策略声明（或各策略定义不一致）的参数：不可改，并说明原因 */
  locked: Array<{ def: ParamDef; strategies: string[]; reason: string }>;
}

const sameDefinition = (a: ParamDef, b: ParamDef) => JSON.stringify([a.type, a.defaultValue, a.choices?.map((c) => c.value), a.min, a.max]) === JSON.stringify([b.type, b.defaultValue, b.choices?.map((c) => c.value), b.min, b.max]);

export function planStrategyParams(strategies: StrategyInfo[]): StrategyParamPlan {
  const stepwise = strategies.filter((s) => s.stepwise);
  const byName = new Map<string, Array<{ strategy: StrategyInfo; def: ParamDef }>>();
  for (const strategy of stepwise) for (const def of strategy.params) byName.set(def.name, [...(byName.get(def.name) ?? []), { strategy, def }]);
  const shared: ParamDef[] = [];
  const locked: StrategyParamPlan["locked"] = [];
  for (const [, entries] of byName) {
    const first = entries[0].def;
    const declaredByAll = entries.length === stepwise.length;
    if (declaredByAll && entries.every((entry) => sameDefinition(first, entry.def))) shared.push(first);
    else locked.push({
      def: first, strategies: entries.map((entry) => entry.strategy.label),
      reason: declaredByAll ? "各策略对这个参数的定义不一致，只有单独选其中一个策略时才能改" : `只有 ${entries.map((entry) => entry.strategy.label).join("、")} 声明了这个参数，同时选多个策略时不能改`,
    });
  }
  return { shared, locked };
}

/** 写进 `stepwise.strategy_params` 的 JSON：只含与默认值不同的共有参数，键按字母序；没有改动就是 "{}"。 */
export function strategyParamsJson(shared: ParamDef[], values: ParamValues): string {
  return stableJson(paramsDiff(shared, values));
}

/** 选中的逐时点策略共同允许的仓位模式；没有逐时点策略（或都没声明）时不限制（undefined）。 */
export function allowedSizingModes(strategies: StrategyInfo[]): string[] | undefined {
  const declared = strategies.filter((s) => s.stepwise && s.sizingModes && s.sizingModes.length > 0).map((s) => s.sizingModes as string[]);
  if (declared.length === 0) return undefined;
  return declared.reduce((acc, modes) => acc.filter((mode) => modes.includes(mode)));
}

export interface ModelNeed {
  /** 至少有一个策略必须选模型 */
  required: boolean;
  /** 至少有一个策略会读模型（必须或可选） */
  reads: boolean;
  /** 不读模型的策略（选了模型也会被忽略） */
  ignoring: StrategyInfo[];
}

export function modelNeed(strategies: StrategyInfo[]): ModelNeed {
  return {
    required: strategies.some((s) => s.predictions === "required"),
    reads: strategies.some((s) => s.predictions !== "none"),
    ignoring: strategies.filter((s) => s.predictions === "none"),
  };
}
