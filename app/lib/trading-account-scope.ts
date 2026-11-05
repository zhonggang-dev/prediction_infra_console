import type { ConsoleV2Account } from "./console-v2";

export type TradingAccountScope = "active" | "all";
export function tradingAccountScope(value: string): TradingAccountScope { return value === "all" ? "all" : "active"; }
export function accountIsActive(account: ConsoleV2Account) { return account.mode === "ACTIVE" || account.mode === "SELL_ONLY"; }
export function orderedTradingAccounts(accounts: readonly ConsoleV2Account[]): ConsoleV2Account[] {
  return accounts.toSorted((a, b) => Number(a.mode === "PAUSED") - Number(b.mode === "PAUSED"));
}
export function scopedTradingAccounts(accounts: readonly ConsoleV2Account[], scope: TradingAccountScope): ConsoleV2Account[] {
  return orderedTradingAccounts(accounts).filter(account => scope === "all" || accountIsActive(account));
}
