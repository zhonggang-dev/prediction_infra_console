export function legacyTradingDestination(view: "orders" | "redemptions", search: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  const account = search.execution_account_id;
  if (typeof account === "string" && account.trim()) query.set("execution_account_id", account.trim());
  if (view === "redemptions") query.set("position_view", "redemptions");
  const suffix = query.size ? `?${query}` : "";
  return `/trading/${view === "redemptions" ? "positions" : "orders"}${suffix}`;
}
