import type { ConsoleV2Account } from "./console-v2";
import { modelWithRunLabel } from "./prediction-run.ts";

export type TradingAccountScope = "active" | "all";
export function tradingAccountScope(value: string): TradingAccountScope { return value === "all" ? "all" : "active"; }
export function accountIsActive(account: ConsoleV2Account) { return account.mode === "ACTIVE" || account.mode === "SELL_ONLY"; }
/** Accounts without a configured mode (e.g. wallet-10) are registered but not driven by any strategy. */
export function accountJoinsStrategy(account: ConsoleV2Account) { return account.mode !== undefined; }
function accountOrderRank(account: ConsoleV2Account) { return !accountJoinsStrategy(account) ? 2 : account.mode === "PAUSED" ? 1 : 0; }
export function orderedTradingAccounts(accounts: readonly ConsoleV2Account[]): ConsoleV2Account[] {
  return accounts.toSorted((a, b) => accountOrderRank(a) - accountOrderRank(b));
}
export function scopedTradingAccounts(accounts: readonly ConsoleV2Account[], scope: TradingAccountScope): ConsoleV2Account[] {
  return orderedTradingAccounts(accounts).filter(account => scope === "all" || accountIsActive(account));
}
/** "v4.1 flash · 第 2 次"; undefined when the account has no bound prediction model. */
export function accountModelLabel(account: ConsoleV2Account): string | undefined {
  return account.predictionModelId ? modelWithRunLabel(account.predictionModelId, account.predictionRun) : undefined;
}
export function accountModeLabel(account: ConsoleV2Account): string {
  return account.mode === "ACTIVE" ? "启用" : account.mode === "SELL_ONLY" ? "仅卖出" : account.mode === "PAUSED" ? "暂停" : "不参与策略";
}
/** Account selector option: platform, ID, bound model with run, and a suffix for non-active modes. */
export function tradingAccountOptionLabel(account: ConsoleV2Account): string {
  const model = accountModelLabel(account);
  const suffix = account.mode === "ACTIVE" ? "" : `（${accountModeLabel(account)}）`;
  return `${account.marketSource === "KALSHI" ? "Kalshi" : "Polymarket"} · ${account.executionAccountId}${model ? ` · ${model}` : ""}${suffix}`;
}
