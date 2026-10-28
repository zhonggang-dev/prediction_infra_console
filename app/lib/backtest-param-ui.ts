/**
 * 参数「怎么展示」的前端规则：分组、条件显示、选项中文名、标签兜底。
 *
 * infra 登记引擎时只接受固定的参数定义字段（name / type / label / help / default / choices(标量) / min / max …），
 * 条件显示和选项中文名无法随定义下发，所以只能由前端维护。这里**不写任何默认值**：默认值只来自引擎定义。
 * 规则按参数名匹配；引擎里没有这个参数时规则不生效。
 */

import type { ParamDef } from "./backtest-platform.ts";

export interface ParamGroup {
  id: string;
  title: string;
  /** 分组标题下的一次性说明 */
  note?: string;
  match: (name: string) => boolean;
}

interface ItemUi {
  groups: ParamGroup[];
  /** 参数名 → 它只在这些「其它参数取值」下显示（与 `ParamDef.when` 同一语义） */
  when: Record<string, Record<string, string>>;
  /** 参数名判定 → 需要的上下文 */
  requires: Array<{ match: (name: string) => boolean; context: NonNullable<ParamDef["requires"]> }>;
  /** 引擎文案仍是英文时的中文兜底（引擎已是中文则以引擎为准） */
  labels: Record<string, string>;
}

const STEPWISE_PREFIX = "stepwise.";
const POSITION_SIZING_PREFIX = "position_sizing.";
/** 逐时点策略自己的参数不进「撮合记账（pm_sim）」分组：它由策略清单声明的参数生成表单，再写进这个 JSON。 */
export const STRATEGY_PARAMS_NAME = "stepwise.strategy_params";
export const INCLUDE_MARKET_NAME = "include_market";
/** 旧策略用的 pm_sim 版本（逐时点策略固定用它登记时的版本） */
export const PM_SIM_VERSION_NAME = "stepwise.pm_sim_version";

const TRADING: ItemUi = {
  groups: [
    { id: "scope", title: "口径、仓位与资金", match: (name) => !name.startsWith(STEPWISE_PREFIX) && name !== INCLUDE_MARKET_NAME },
    { id: "stepwise", title: "撮合记账（pm_sim）", note: "全部策略（旧策略与逐时点策略）都由研究侧的 pm_sim 撮合记账，规则由它决定（不补齐盘口、先卖后买、卖不掉继续持有、期末按估值不强平），这里只调它开放的几项。", match: (name) => name.startsWith(STEPWISE_PREFIX) && name !== STRATEGY_PARAMS_NAME },
  ],
  when: {
    "position_sizing.shares": { "position_sizing.mode": "fixed_shares" },
    "position_sizing.stake": { "position_sizing.mode": "fixed_stake" },
    "bankroll.amount": { "bankroll.mode": "finite" },
  },
  requires: [
    // 逐时点策略自己的参数只在选中逐时点策略时提交；pm_sim 版本只管旧策略（逐时点策略用登记时的版本）；其余 pm_sim 规则对全部策略生效
    { match: (name) => name === STRATEGY_PARAMS_NAME, context: "stepwise" },
    { match: (name) => name === PM_SIM_VERSION_NAME, context: "legacy" },
    // 逐时点策略（pm_sim）下多少由策略自己决定，平台的仓位模式只对旧策略生效：只选逐时点策略时整组隐藏、不提交
    { match: (name) => name.startsWith(POSITION_SIZING_PREFIX), context: "legacy" },
    { match: (name) => name === INCLUDE_MARKET_NAME, context: "models" },
  ],
  labels: {
    "position_sizing.mode": "仓位模式", "position_sizing.shares": "每笔股数", "position_sizing.stake": "每笔金额（$）",
    "bankroll.mode": "资金模式", "bankroll.amount": "初始资金（$）",
  },
};

const ITEM_UI: Record<string, ItemUi> = { "trading/strategy_comparison": TRADING };

/** 选项中文名（按参数名；值不变，提交仍用原值）。 */
export const CHOICE_LABELS: Record<string, Record<string, string>> = {
  scope: { strict: "严格交集", own: "各模型自有全集" },
  "position_sizing.mode": { native: "策略自带", fixed_shares: "固定股数", fixed_stake: "固定金额" },
  "bankroll.mode": { finite: "有限资金", unlimited: "无限资金" },
  sample_scope: { full: "各模型自身全量", common: "共同样本" },
};

const HAS_CJK = /[一-鿿]/;

/** 套用本地展示规则，返回新的定义数组（不改入参）。没有规则的 board/item 只做选项中文名。 */
export function decorateParamDefs(boardItem: string, defs: ParamDef[]): ParamDef[] {
  const ui = ITEM_UI[boardItem];
  return defs.map((def) => {
    const next: ParamDef = { ...def };
    const choiceLabels = CHOICE_LABELS[def.name];
    if (choiceLabels && def.choices) next.choices = def.choices.map((choice) => ({ ...choice, label: choiceLabels[String(choice.value)] ?? choice.label }));
    if (!ui) return next;
    if (!def.when && ui.when[def.name]) next.when = ui.when[def.name];
    const requirement = ui.requires.find((entry) => entry.match(def.name));
    if (requirement) next.requires = requirement.context;
    const fallback = ui.labels[def.name];
    if (fallback && !HAS_CJK.test(def.label)) next.label = fallback;
    return next;
  });
}

/** 把参数定义按分组拆开；不属于任何分组的参数（如 include_market）单独放在 `rest`，由页面决定放在哪。 */
export function groupParamDefs(boardItem: string, defs: ParamDef[]): { groups: Array<ParamGroup & { defs: ParamDef[] }>; rest: ParamDef[] } {
  const ui = ITEM_UI[boardItem];
  if (!ui) return { groups: [], rest: defs };
  const claimed = new Set<string>();
  const groups = ui.groups.map((group) => {
    const members = defs.filter((def) => !claimed.has(def.name) && group.match(def.name));
    for (const def of members) claimed.add(def.name);
    return { ...group, defs: members };
  });
  return { groups, rest: defs.filter((def) => !claimed.has(def.name)) };
}
