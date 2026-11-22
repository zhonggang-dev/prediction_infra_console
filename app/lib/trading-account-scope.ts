import type { ConsoleV2Account } from "./console-v2";

export type TradingAccountScope = "active" | "all";
export function tradingAccountScope(value: string): TradingAccountScope { return value === "all" ? "all" : "active"; }
export function accountIsActive(account: ConsoleV2Account) { return account.mode === "ACTIVE" || account.mode === "SELL_ONLY"; }
/** Accounts without a configured mode (e.g. wallet-10) are registered but not driven by any strategy. */
export function accountJoinsStrategy(account: ConsoleV2Account) { return account.mode !== undefined; }

/**
 * 主力账户：每个策略的主账户，其余同策略账户都是对照组。后端没有这个字段，按运营约定写死；
 * 顺序也决定策略分组的先后（含主力的策略在前）和组内主力的先后。
 */
export const PRIMARY_ACCOUNT_IDS = ["main", "kalshi:main", "wallet-7"] as const;
const PRIMARY_RANK = new Map<string, number>(PRIMARY_ACCOUNT_IDS.map((id, index) => [id, index]));
export function accountIsPrimary(account: ConsoleV2Account) { return PRIMARY_RANK.has(account.executionAccountId); }

export interface TradingAccountGroup { key: string; label: string; accounts: ConsoleV2Account[] }
const NO_STRATEGY_KEY = "";
function strategyKey(account: ConsoleV2Account) { return account.strategyId ?? NO_STRATEGY_KEY; }

/**
 * 按策略分组：含主力账户的策略在前（按主力顺序），其余按策略名；组内主力在前、暂停在后，
 * 其余保持目录顺序。不参与策略的账户（无运行模式）整体隐藏，「全部账户」里也不出现。
 */
export function groupTradingAccounts(accounts: readonly ConsoleV2Account[]): TradingAccountGroup[] {
  const visible = accounts.map((account, index) => ({ account, index })).filter(({ account }) => accountJoinsStrategy(account));
  const groups = new Map<string, { account: ConsoleV2Account; index: number }[]>();
  for (const entry of visible) {
    const key = strategyKey(entry.account);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const memberRank = ({ account }: { account: ConsoleV2Account }) => PRIMARY_RANK.get(account.executionAccountId) ?? PRIMARY_ACCOUNT_IDS.length;
  const groupRank = (members: { account: ConsoleV2Account }[]) => Math.min(...members.map(memberRank));
  return [...groups.entries()]
    .toSorted(([aKey, a], [bKey, b]) => groupRank(a) - groupRank(b) || Number(aKey === NO_STRATEGY_KEY) - Number(bKey === NO_STRATEGY_KEY) || aKey.localeCompare(bKey))
    .map(([key, members]) => ({
      key,
      label: key === NO_STRATEGY_KEY ? "未配置策略" : key,
      accounts: members
        .toSorted((a, b) => Number(a.account.mode === "PAUSED") - Number(b.account.mode === "PAUSED") || memberRank(a) - memberRank(b) || a.index - b.index)
        .map(({ account }) => account),
    }));
}
export function orderedTradingAccounts(accounts: readonly ConsoleV2Account[]): ConsoleV2Account[] {
  return groupTradingAccounts(accounts).flatMap(group => group.accounts);
}
export function scopedTradingAccounts(accounts: readonly ConsoleV2Account[], scope: TradingAccountScope): ConsoleV2Account[] {
  return orderedTradingAccounts(accounts).filter(account => scope === "all" || accountIsActive(account));
}
/** 账户绑定的预测模型名；不再附「第 N 次」。未绑定时为 undefined。 */
export function accountModelLabel(account: ConsoleV2Account): string | undefined {
  return account.predictionModelId;
}
export function accountRoleLabel(account: ConsoleV2Account): string {
  return accountIsPrimary(account) ? "主力" : "对照组";
}
export function accountModeLabel(account: ConsoleV2Account): string {
  return account.mode === "ACTIVE" ? "启用" : account.mode === "SELL_ONLY" ? "仅卖出" : account.mode === "PAUSED" ? "暂停" : "不参与策略";
}
/** 下拉选项：平台 · 账户 · 模型，对照组账户再跟「对照组」，非启用模式加括号后缀。 */
export function tradingAccountOptionLabel(account: ConsoleV2Account): string {
  const model = accountModelLabel(account);
  const role = accountIsPrimary(account) ? "" : " · 对照组";
  const suffix = account.mode === "ACTIVE" ? "" : `（${accountModeLabel(account)}）`;
  return `${account.marketSource === "KALSHI" ? "Kalshi" : "Polymarket"} · ${account.executionAccountId}${model ? ` · ${model}` : ""}${role}${suffix}`;
}
