import { predictionBatchParentContext, predictionBatchQueryKeys } from "./prediction-batch-scope.ts";

/**
 * Build the URL for a workspace tab without carrying a draft filter from the
 * currently visible input. The caller supplies the target panel's applied
 * query, which is the only filter that belongs in the URL.
 */
export function workspaceHrefWithAppliedQuery(href: string, currentHref: string, appliedQuery: string) {
  const target = new URL(href, currentHref);
  // A tab's href may contain stale query parameters from a server-rendered
  // link.  The target panel is the source of truth, so remove those before
  // applying its committed state.  This also prevents a filter from the
  // previous panel leaking into the next panel.
  target.search = "";
  const query = appliedQuery.trim();
  if (query.includes("=")) {
    const state = new URLSearchParams(query);
    for (const [key, rawValue] of state.entries()) {
      const value = rawValue.trim();
      if (!value || (key === "limit" && value === "20") || (key === "offset" && value === "0")) continue;
      target.searchParams.set(key, value);
    }
  } else if (query) {
    target.searchParams.set("q", query);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

export function mergeSharedQuery(targetQuery: string, currentQuery: URLSearchParams, sharedKeys: readonly string[]) {
  if (!sharedKeys.length) return targetQuery;
  const merged = new URLSearchParams(targetQuery);
  // A saved result batch belongs to the parent range in which it was picked.
  // Changing that range on the task tab must not restore an older batch over it.
  if (merged.has("batch_prediction_as_of")) {
    const previousContext = merged.get("batch_context") || predictionBatchParentContext(Object.fromEntries(merged));
    const currentContext = predictionBatchParentContext(Object.fromEntries(currentQuery));
    if (previousContext !== currentContext) {
      for (const key of [...predictionBatchQueryKeys, "offset"]) merged.delete(key);
    }
  }
  for (const key of sharedKeys) {
    const value = currentQuery.get(key)?.trim();
    if (value) merged.set(key, value);
    else merged.delete(key);
  }
  return merged.toString();
}

export function appliedFilterFromUrl(params: URLSearchParams, key: string, fallback: string, preserveMissing: boolean) {
  const raw = params.get(key);
  if (raw === null && preserveMissing) return undefined;
  const value = raw?.trim() ?? fallback;
  return key === "from" || key === "to" ? value.slice(0, 10) : value;
}

/** Read a committed list offset during a URL replay before params settle. */
export function appliedListOffset(currentHref: string, limit: number) {
  const raw = new URL(currentHref, "http://console.local").searchParams.get("offset");
  const numeric = Number(raw);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > Number.MAX_SAFE_INTEGER - 100) return 0;
  return Math.floor(numeric / limit) * limit;
}

/** Deep-link aliases must follow the current owning panel, including the default trading view. */
export function workspacePathMatches(rootHref: string, pathname: string): boolean {
  if (rootHref === pathname) return true;
  const aliases: Record<string, string[]> = {
    "/trading/orders": ["/trading"],
    "/trading/ledger": ["/trades"],
    "/markets/running": ["/markets"],
    "/system/observability": ["/system", "/observability"],
    "/system/settings": ["/settings"],
  };
  return aliases[rootHref]?.includes(pathname) ?? false;
}

export function canonicalConsoleQuery(pathname: string, input: URLSearchParams) {
  const query = new URLSearchParams(input);
  let changedScope = false;
  const remove = (key: string) => { if (query.has(key)) { query.delete(key); changedScope = true; } };
  if (pathname === "/trading/orders" || pathname === "/trading") for (const key of ["model_id", "strategy_id", "from", "to"]) remove(key);
  if (pathname === "/trading/positions" && query.get("position_view") !== "redemptions") for (const key of ["model_id", "strategy_id", "from", "to"]) remove(key);
  if (pathname === "/trading/ledger" || pathname === "/trades") for (const key of ["model_id", "strategy_id"]) remove(key);
  if (pathname === "/predictions" || pathname === "/predictions/tasks") {
    for (const key of ["selection_run_id", "selected_market_id", "status", "from", "to", "max_result_id"]) remove(key);
    if (query.has("scope") && !["history", "current"].includes(query.get("scope") ?? "")) remove("scope");
    if (query.has("source") && !["POLYMARKET", "KALSHI"].includes(query.get("source") ?? "")) remove("source");
    if (query.has("source")) query.delete("sources");
    else if (query.has("sources")) {
      const sources = [...new Set((query.get("sources") || "").split(",").filter((source) => ["POLYMARKET", "KALSHI"].includes(source)))];
      if (sources.length === 1) { query.set("source", sources[0]); query.delete("sources"); }
      else if (sources.length === 2) query.set("sources", "POLYMARKET,KALSHI");
      else remove("sources");
    }
    const batchKeys = ["batch_prediction_as_of", "batch_max_result_id", "batch_model", "batch_source"];
    if (batchKeys.some((key) => query.has(key)) && !batchKeys.every((key) => query.get(key))) {
      for (const key of [...batchKeys, "batch_generation_id"]) remove(key);
    }
  }
  if ((pathname === "/markets" || pathname === "/markets/running") && query.get("market_scope") === "pool") { query.set("market_scope", "current"); changedScope = true; }
  if (pathname === "/markets/data" && query.has("source") && query.get("source") !== "POLYMARKET") remove("source");
  if (changedScope) query.delete("offset");
  return query;
}

/** The removed task page has no private result search or saved batch state. */
export function predictionTasksRedirect(input: URLSearchParams) {
  const query = canonicalConsoleQuery("/predictions", input);
  const allowed = new Set(["model", "source", "sources", "scope", "generation_id", "generation_ids", "prediction_as_of"]);
  for (const key of [...query.keys()]) if (!allowed.has(key)) query.delete(key);
  const suffix = query.toString();
  return `/predictions${suffix ? `?${suffix}` : ""}`;
}
