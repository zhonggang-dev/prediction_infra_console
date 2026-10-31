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
    "/system/delivery": ["/delivery"],
    "/system/settings": ["/settings"],
  };
  return aliases[rootHref]?.includes(pathname) ?? false;
}
