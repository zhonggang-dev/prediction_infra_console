/** Minimal local bindings used by the Cloudflare Worker entry point.
 *
 * The production runtime supplies these globals. Keeping the small surface
 * here lets the repository type-check without making the optional Wrangler
 * peer package a runtime dependency of the console bundle.
 */
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

type D1Database = object;
