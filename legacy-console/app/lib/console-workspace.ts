/**
 * Build the URL for a workspace tab without carrying a draft filter from the
 * currently visible input. The caller supplies the target panel's applied
 * query, which is the only filter that belongs in the URL.
 */
export function workspaceHrefWithAppliedQuery(href: string, currentHref: string, appliedQuery: string) {
  const target = new URL(href, currentHref);
  const query = appliedQuery.trim();
  if (query) target.searchParams.set("q", query);
  else target.searchParams.delete("q");
  return `${target.pathname}${target.search}${target.hash}`;
}
