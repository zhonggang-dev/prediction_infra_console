"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";
import { ConsoleV2ApiError, ConsoleV2ContractError, type ConsoleV2Page, type ConsoleV2Result } from "../lib/console-v2";
import { appliedFilterFromUrl, mergeSharedQuery, workspaceHrefWithAppliedQuery } from "../lib/console-workspace";

export type V2Params = Record<string, string | number | undefined>;
/** Keep client URL/page arithmetic aligned with the read-model offset bound. */
export const V2_MAX_OFFSET = Number.MAX_SAFE_INTEGER - 100;
export const WORKSPACE_FILTER_CHANGE_EVENT = "v2-workspace-filter-change";

export interface V2Column<T> {
  label: string;
  className?: string;
  render: (item: T) => React.ReactNode;
}

export function V2Frame({ eyebrow, title, description, observedAt, onRefresh, loading, embedded = false, children }: { eyebrow: string; title: string; description: string; observedAt?: string; onRefresh?: () => void; loading?: boolean; embedded?: boolean; children: React.ReactNode }) {
  if (embedded) return <>{children}</>;
  return <ConsoleShell>
    <header className="page-head v2-page-head">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="description">{description}</p></div>
      <div className="v2-head-actions">{observedAt && <span className="v2-observed">观测于 {formatV2Time(observedAt)}</span>}{onRefresh && <button className="button" onClick={onRefresh} disabled={loading}><Icon name="refresh" /> 刷新</button>}</div>
    </header>
    {children}
  </ConsoleShell>;
}

export function V2Tabs({ tabs, active, onSelect, ariaLabel = "业务视图", variant = "primary" }: { tabs: ReadonlyArray<{ href: string; label: string; count?: string }>; active: string; onSelect?: (href: string) => void; ariaLabel?: string; variant?: "primary" | "local" }) {
  const selectTab = (href: string) => {
    onSelect?.(href);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!onSelect) return;
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % tabs.length : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(tabs[next].href);
    document.getElementById(tabId(tabs[next].href))?.focus();
  };
  return <nav className={`v2-tabs ${variant === "local" ? "v2-tabs-local" : ""}`} aria-label={ariaLabel} role={onSelect ? "tablist" : undefined}>
    {tabs.map((tab, index) => {
      const selected = tab.href === active;
      return onSelect
        ? <button key={tab.href} id={tabId(tab.href)} type="button" role="tab" aria-selected={selected} aria-controls={panelId(tab.href)} tabIndex={selected ? 0 : -1} className={selected ? "active" : ""} onClick={() => selectTab(tab.href)} onKeyDown={(event) => onKeyDown(event, index)}>{tab.label}{tab.count && <small>{tab.count}</small>}</button>
        : <a key={tab.href} href={tab.href} className={selected ? "active" : ""} aria-current={selected ? "page" : undefined}>{tab.label}{tab.count && <small>{tab.count}</small>}</a>;
    })}
  </nav>;
}

export function useVisitedTabs<T extends string>(initial: T) {
  const [active, setActive] = useState<T>(initial);
  const [visited, setVisited] = useState<Set<T>>(() => new Set([initial]));
  const select = useCallback((next: T) => {
    const tabAnchorTop = document.getElementById(tabId(next))?.getBoundingClientRect().top;
    setActive(next);
    setVisited((current) => current.has(next) ? current : new Set([...current, next]));
    window.dispatchEvent(new CustomEvent("v2-workspace-change", { detail: { active: next } }));
    const restoreTabAnchor = () => {
      if (tabAnchorTop === undefined) return;
      const nextTop = document.getElementById(tabId(next))?.getBoundingClientRect().top;
      if (nextTop !== undefined) window.scrollBy({ top: nextTop - tabAnchorTop, behavior: "auto" });
    };
    window.requestAnimationFrame(restoreTabAnchor);
    window.requestAnimationFrame(() => window.requestAnimationFrame(restoreTabAnchor));
  }, []);
  return { active, visited, select };
}

/** Applied resource filters live in the URL so refresh/back-forward can replay them. */
export function useV2Filter(key: string, fallback = "") {
  const searchParams = useSearchParams();
  const panel = useContext(V2PanelContext);
  const panelActive = panel?.active ?? true;
  const read = useCallback((params: URLSearchParams) => normalizeFilterValue(key, params.get(key)?.trim() ?? fallback), [fallback, key]);
  const [value, setValue] = useState(() => panelActive ? read(searchParams) : fallback);
  useEffect(() => {
    const sync = (preserveMissing: boolean) => {
      if (!panelActive) return;
      const next = appliedFilterFromUrl(new URL(window.location.href).searchParams, key, fallback, preserveMissing);
      if (next !== undefined) setValue(next);
    };
    const onPopState = () => sync(false);
    // The target panel's applied metadata is included in the URL before this
    // event. Missing keys therefore mean the filter was cleared; hidden panels
    // still skip the event through panelActive.
    const onWorkspaceUrlChange = () => sync(false);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("v2-workspace-url-change", onWorkspaceUrlChange);
    window.addEventListener(WORKSPACE_FILTER_CHANGE_EVENT, onPopState);
    return () => { window.removeEventListener("popstate", onPopState); window.removeEventListener("v2-workspace-url-change", onWorkspaceUrlChange); window.removeEventListener(WORKSPACE_FILTER_CHANGE_EVENT, onPopState); };
  }, [fallback, key, panelActive, read]);
  const update = useCallback((next: string) => {
    setValue(next);
    syncFilterUrl(key, next);
  }, [key]);
  return [value, update] as const;
}

function normalizeFilterValue(key: string, value: string) {
  return key === "from" || key === "to" ? value.slice(0, 10) : value;
}

export function V2ContextLinks({ links }: { links: Array<{ href: string; label: string; external?: boolean }> }) {
  return <nav className="v2-context-links" aria-label="相关页面">{links.map((link) => <a key={link.href} href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined}>{link.label}<Icon name="arrow" /></a>)}</nav>;
}

type WorkspaceTab = { href: string; label: string; aliases?: readonly string[] };
type WorkspaceTabOptions = { sharedQueryKeys?: readonly string[] };
type V2PanelContextValue = { href: string; active: boolean };
const V2PanelContext = createContext<V2PanelContextValue | null>(null);

export function useWorkspaceTabs<T extends string>(tabs: ReadonlyArray<WorkspaceTab & { href: T }>, fallback: T, options: WorkspaceTabOptions = {}) {
  const [active, setActive] = useState<T>(fallback);
  const [visited, setVisited] = useState<Set<T>>(() => new Set([fallback]));
  // Callers build their tab descriptors inline. Keep the navigation effect tied
  // to the tab semantics instead of a fresh array identity on every filter
  // keystroke; otherwise it can re-read an old URL and erase an unapplied draft.
  const tabSignature = tabs.map((tab) => `${tab.href}\u0000${tab.label}\u0000${tab.aliases?.join("\u0001") ?? ""}`).join("\u0002");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- array identity is intentionally ignored; tabSignature captures its semantics.
  const stableTabs = useMemo(() => tabs, [tabSignature]);
  const markVisited = useCallback((next: T) => setVisited((current) => current.has(next) ? current : new Set([...current, next])), []);
  useEffect(() => {
    const resolvePath = (pathname: string): T => stableTabs.find((tab) => tab.href === pathname || tab.aliases?.includes(pathname))?.href ?? fallback;
    const sync = () => {
      const next = resolvePath(window.location.pathname);
      setActive(next);
      markVisited(next);
      window.requestAnimationFrame(() => window.dispatchEvent(new Event("v2-workspace-url-change")));
    };
    const timer = window.setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    return () => { window.clearTimeout(timer); window.removeEventListener("popstate", sync); };
  }, [stableTabs, fallback, markVisited]);
  const select = (href: T) => {
    const tabAnchorTop = document.getElementById(tabId(href))?.getBoundingClientRect().top;
    if (window.location.pathname !== href) {
      const targetPanel = document.getElementById(panelId(href));
      const targetSearch = mergeSharedQuery(readPanelAppliedQuery(targetPanel), new URL(window.location.href).searchParams, options.sharedQueryKeys ?? []);
      window.history.pushState({}, "", workspaceHrefWithAppliedQuery(href, window.location.href, targetSearch));
    }
    setActive(href);
    markVisited(href);
    // Let React reveal the target panel before URL listeners read its
    // committed controls.  Dispatching synchronously here makes a previously
    // hidden panel ignore the update and can re-use the old panel's filters.
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("v2-workspace-url-change")));
    const restoreTabAnchor = () => {
      if (tabAnchorTop === undefined) return;
      const nextTop = document.getElementById(tabId(href))?.getBoundingClientRect().top;
      if (nextTop !== undefined) window.scrollBy({ top: nextTop - tabAnchorTop, behavior: "auto" });
    };
    window.requestAnimationFrame(restoreTabAnchor);
    window.requestAnimationFrame(() => window.requestAnimationFrame(restoreTabAnchor));
    const main = document.querySelector("main.main");
    if (main && "ResizeObserver" in window) {
      const observer = new ResizeObserver(restoreTabAnchor);
      observer.observe(main);
      window.setTimeout(() => observer.disconnect(), 1500);
    }
  };
  return { active, visited, select };
}


export function V2WorkspacePanel({ active, href, visited, children }: { active: string; href: string; visited: boolean; children: React.ReactNode }) {
  const parentPanel = useContext(V2PanelContext);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("v2-workspace-change", { detail: { active } }));
  }, [active]);
  if (!visited) return null;
  const selected = active === href;
  return <V2PanelContext.Provider value={{ href, active: (parentPanel?.active ?? true) && selected }}><section id={panelId(href)} className="v2-tab-panel" role="tabpanel" aria-hidden={!selected} hidden={!selected} aria-labelledby={tabId(href)}>{children}</section></V2PanelContext.Provider>;
}

function tabId(value: string) { return `v2-tab-${value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "")}`; }
function panelId(value: string) { return `v2-panel-${value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "")}`; }

function readPanelAppliedQuery(panel: HTMLElement | null) {
  if (!panel) return "";
  const state = Array.from(panel.querySelectorAll<HTMLElement>("[data-v2-list-state]")).find((candidate) => {
    // The target top-level panel itself is hidden until the state update
    // commits.  Only nested inactive panels should be excluded.
    let ancestor = candidate.parentElement;
    while (ancestor && ancestor !== panel) {
      if (ancestor.hidden) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
  if (!state) return "";
  const query = new URLSearchParams();
  const applied = state.getAttribute("data-v2-list-query")?.trim();
  const limit = state.getAttribute("data-v2-list-limit");
  const offset = state.getAttribute("data-v2-list-offset");
  if (applied) query.set("q", applied);
  if (limit && limit !== "20") query.set("limit", limit);
  if (offset && offset !== "0") query.set("offset", offset);
  try {
    const filters = JSON.parse(state.getAttribute("data-v2-list-params") ?? "{}") as Record<string, unknown>;
    for (const [key, value] of Object.entries(filters)) if (typeof value === "string" && value.trim()) query.set(key, value.trim());
  } catch {
    // Invalid DOM metadata should not block normal tab navigation.
  }
  return query.toString();
}

export function V2Notice({ title, description, error = false }: { title: string; description: string; error?: boolean }) {
  return <div className={`notice v2-notice ${error ? "error" : ""}`}><div><strong>{title}</strong><p>{description}</p></div></div>;
}

export function V2ListPage<T>({ title, description, load, columns, rowKey, renderDetail, params = {}, searchPlaceholder = "搜索 ID、标题或状态", controls, emptyTitle = "没有匹配的数据", emptyDescription = "调整筛选条件后再试。", children }: {
  title: string;
  description?: string;
  load: (params: V2Params) => Promise<ConsoleV2Result<ConsoleV2Page<T>>>;
  columns: V2Column<T>[];
  rowKey: (item: T) => string;
  renderDetail?: (item: T, close: () => void) => React.ReactNode;
  params?: V2Params;
  searchPlaceholder?: string;
  controls?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  children?: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q")?.trim() ?? "";
  const initialLimit = normalizePageSize(searchParams.get("limit"));
  const initialOffset = normalizePageOffset(searchParams.get("offset"), initialLimit);
  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(initialLimit);
  const [offset, setOffset] = useState(initialOffset);
  const [result, setResult] = useState<ConsoleV2Page<T>>();
  const [selected, setSelected] = useState<T>();
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailDialogRef = useRef<HTMLDialogElement | null>(null);
  const listStateRef = useRef<HTMLElement | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const serializedParams = useMemo(() => JSON.stringify(params), [params]);
  const previousParamsRef = useRef(serializedParams);

  const closeDetail = useCallback(() => {
    detailDialogRef.current?.close();
    setSelected(undefined);
  }, []);

  useEffect(() => {
    if (previousParamsRef.current === serializedParams) return;
    previousParamsRef.current = serializedParams;
    setOffset(0);
  }, [serializedParams]);

  useEffect(() => {
    const dialog = detailDialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      window.requestAnimationFrame(() => dialog.querySelector<HTMLElement>("[autofocus], .v2-detail-close, button, a, input, select, textarea")?.focus({ preventScroll: true }));
    } else if (!selected && dialog.open) {
      dialog.close();
    }
  }, [selected]);

  useEffect(() => {
    const syncFromUrl = () => {
      let ancestor: HTMLElement | null = listStateRef.current;
      while (ancestor) {
        if (ancestor.hidden) return;
        ancestor = ancestor.parentElement;
      }
      const url = new URL(window.location.href);
      const nextQuery = url.searchParams.get("q")?.trim() ?? "";
      const nextLimit = normalizePageSize(url.searchParams.get("limit"));
      const nextOffset = normalizePageOffset(url.searchParams.get("offset"), nextLimit);
      setDraftQuery(nextQuery);
      setQuery(nextQuery);
      setLimit(nextLimit);
      setOffset(nextOffset);
    };
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener("v2-workspace-url-change", syncFromUrl);
    window.addEventListener(WORKSPACE_FILTER_CHANGE_EVENT, syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener("v2-workspace-url-change", syncFromUrl);
      window.removeEventListener(WORKSPACE_FILTER_CHANGE_EVENT, syncFromUrl);
    };
  }, []);

  useEffect(() => {
    const closeWhenWorkspaceChanges = () => {
      if (!detailDialogRef.current?.open && !selected) return;
      // Do not return focus into a panel that is about to become hidden.
      selectedTriggerRef.current = null;
      detailDialogRef.current?.close();
      setSelected(undefined);
    };
    window.addEventListener("v2-workspace-change", closeWhenWorkspaceChanges);
    return () => window.removeEventListener("v2-workspace-change", closeWhenWorkspaceChanges);
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    // The request is scheduled so the effect subscribes to the async result
    // without forcing a synchronous render during effect flush.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(undefined);
      setSelected(undefined);
      selectedTriggerRef.current = null;
      const nextParams = { ...params, limit, offset, q: query || undefined };
      void load(nextParams).then((response) => {
        if (cancelled) return;
        setResult(response.data);
        if (response.data.total === 0 && offset !== 0) {
          setOffset(0);
          syncListQueryUrl(query, limit, 0);
          return;
        }
        if (response.data.total > 0 && offset >= response.data.total) {
          const lastOffset = Math.min(V2_MAX_OFFSET, Math.floor((response.data.total - 1) / response.data.limit) * response.data.limit);
          if (lastOffset !== offset) {
            setOffset(lastOffset);
            syncListQueryUrl(query, limit, lastOffset);
            return;
          }
        }
      }).catch((requestError: unknown) => {
        if (cancelled) return;
        setSelected(undefined);
        setError(requestError instanceof Error ? requestError.message : "数据请求失败");
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // The serialized filter object is the dependency boundary for server-side filtering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, serializedParams, offset, query, limit]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setOffset(0);
    const next = draftQuery.trim();
    setQuery(next);
    syncListQueryUrl(next, limit, 0);
  };
  const activeItem = selected;
  const detailTitleId = `v2-detail-title-${title.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
  const detailDialogId = `${detailTitleId}-dialog`;
  const openDetail = (item: T, trigger?: HTMLButtonElement | null) => {
    selectedTriggerRef.current = trigger ?? null;
    setSelected(item);
  };
  const handleDialogClose = () => {
    setSelected(undefined);
    const trigger = selectedTriggerRef.current;
    selectedTriggerRef.current = null;
    window.requestAnimationFrame(() => {
      if (trigger && trigger.isConnected && !trigger.closest("[hidden]")) trigger.focus({ preventScroll: true });
      else {
        const fallback = listStateRef.current?.querySelector<HTMLElement>("[data-v2-search], .v2-filterbar button, .v2-filterbar select") ?? listStateRef.current;
        if (fallback && !fallback.closest("[hidden]")) {
          if (!fallback.hasAttribute("tabindex")) fallback.setAttribute("tabindex", "-1");
          fallback.focus({ preventScroll: true });
        }
      }
    });
  };
  return <section ref={listStateRef} className="section v2-list-section" data-v2-list-state data-v2-list-query={query} data-v2-list-limit={limit} data-v2-list-offset={offset} data-v2-list-params={JSON.stringify(params)}>
    {description && <p className="section-caption">{description}</p>}
    <section className="panel v2-list-panel">
      <form className="filters v2-filterbar" onSubmit={submitSearch}>
        <input className="input" data-v2-search data-v2-search-applied={query} value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`${title}搜索`} />
        <button className="button primary" type="submit"><Icon name="search" /> 搜索</button>
        {query && <button className="button" type="button" onClick={() => { setDraftQuery(""); setQuery(""); setOffset(0); syncListQueryUrl("", limit, 0); }}>清除搜索</button>}
        <label className="v2-page-size"><span>每页</span><select className="select" aria-label="每页条数" value={limit} onChange={(event) => { const next = normalizePageSize(event.target.value); setLimit(next); setOffset(0); syncListQueryUrl(query, next, 0); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label>
        {controls}
      </form>
      {children}
      {error && <V2Notice error title="数据不可用" description={error} />}
      {loading && !result && <V2Loading />}
      {loading && result && <div className="v2-list-refreshing" role="status">正在读取新筛选，暂保留上一份结果</div>}
      {result && result.items.length > 0 && <div className={loading ? "table-scroll is-loading" : "table-scroll"}><table className="v2-table" aria-busy={loading || Boolean(error)}><thead><tr>{columns.map((column) => <th key={column.label} className={column.className}>{column.label}</th>)}{renderDetail && <th className="v2-action-column" aria-label="操作">操作</th>}</tr></thead><tbody>{result.items.map((item) => <tr key={rowKey(item)} onClick={() => renderDetail && openDetail(item)} className={renderDetail ? "clickable" : undefined}>{columns.map((column) => <td key={column.label} className={column.className}>{column.render(item)}</td>)}{renderDetail && <td className="v2-action-cell"><button type="button" className="button" aria-label={`查看${title}详情`} aria-expanded={activeItem ? rowKey(activeItem) === rowKey(item) : false} aria-controls={detailDialogId} disabled={loading || Boolean(error)} onClick={(event) => { event.stopPropagation(); openDetail(item, event.currentTarget); }}>查看详情</button></td>}</tr>)}</tbody></table></div>}
      {error && result && <div className="v2-list-stale" role="status">上一份结果已过期；本次读取失败，请重试。列表内容未被当作当前快照。</div>}
      {!loading && !error && result && result.items.length === 0 && <div className="empty"><strong>{emptyTitle}</strong><p>{emptyDescription}</p></div>}
      {result && <V2Pagination page={result} disabled={loading || Boolean(error)} onPage={(nextOffset) => { setOffset(nextOffset); syncListQueryUrl(query, limit, nextOffset); }} />}
    </section>
    {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
    {renderDetail && <dialog id={detailDialogId} ref={detailDialogRef} className="v2-detail-dialog" aria-modal="true" aria-labelledby={detailTitleId} onClick={(event) => { if (event.target === event.currentTarget) closeDetail(); }} onCancel={(event) => { event.preventDefault(); closeDetail(); }} onClose={handleDialogClose}>
      <div className="v2-detail-dialog-inner">
        <div className="section-head"><div><p className="eyebrow">详情</p><h2 id={detailTitleId} className="section-title">{title}</h2></div><button type="button" className="button v2-detail-close" onClick={closeDetail}>关闭</button></div>
        {activeItem && <V2DetailSummary columns={columns} item={activeItem} />}
        {activeItem && renderDetail(activeItem, () => setSelected(undefined))}
      </div>
    </dialog>}
  </section>;
}

function V2DetailSummary<T>({ columns, item }: { columns: Array<V2Column<T>>; item: T }) {
  return <section className="v2-detail-summary" aria-label="列表摘要"><h3>列表摘要</h3><div className="v2-detail-summary-grid">{columns.map((column) => <div className="v2-detail-summary-item" key={column.label}><span>{column.label}</span><div>{column.render(item)}</div></div>)}</div></section>;
}

export function V2Pagination<T>({ page, disabled = false, onPage }: { page: Pick<ConsoleV2Page<T>, "items" | "limit" | "offset" | "hasMore"> & { total?: number; observedAt?: string }; disabled?: boolean; onPage: (offset: number) => void }) {
  const start = page.items.length ? page.offset + 1 : 0;
  const end = page.items.length ? page.offset + page.items.length : 0;
  const total = page.total;
  const totalPages = total === undefined ? undefined : Math.ceil(total / page.limit);
  const currentPage = total === undefined || total === 0 ? 0 : Math.floor(page.offset / page.limit) + 1;
  const summary = total === undefined ? `第 ${start}–${end} 条（总数由回测接口提供时显示）` : `第 ${start}–${end} 条，共 ${total} 条`;
  return <div className="v2-pagination"><div className="v2-pagination-summary"><span>{summary}</span><span>{totalPages === undefined ? "页码总数不可用" : `第 ${currentPage} / ${totalPages} 页`}</span></div><div className="v2-pagination-controls"><label className="v2-page-jump"><span>跳至</span><input className="input" aria-label="跳转页码" inputMode="numeric" min={1} max={totalPages} placeholder="页码" disabled={disabled || totalPages === 0} onKeyDown={(event) => { if (event.key !== "Enter") return; const value = Number(event.currentTarget.value); if (!Number.isSafeInteger(value) || value < 1 || (totalPages !== undefined && value > totalPages)) return; onPage(Math.min(V2_MAX_OFFSET, (value - 1) * page.limit)); event.currentTarget.value = ""; }} /><span>页</span></label><button className="button" disabled={disabled || page.offset === 0} onClick={() => onPage(Math.max(0, page.offset - page.limit))}>上一页</button><button className="button" disabled={disabled || (total === undefined ? !page.hasMore : page.offset + page.limit >= total)} onClick={() => onPage(Math.min(V2_MAX_OFFSET, page.offset + page.limit))}>下一页</button></div></div>;
}

export function V2Loading() {
  return <div className="panel-pad v2-loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
}

export function V2Value({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return <div className="v2-fact"><span>{label}</span><strong className={mono ? "mono" : undefined}>{value ?? "未知"}</strong></div>;
}

export function V2Facts({ values }: { values: Array<{ label: string; value: React.ReactNode; mono?: boolean }> }) {
  return <div className="v2-facts">{values.map((item) => <V2Value key={item.label} {...item} />)}</div>;
}

export function v2Status(value: string | undefined, label?: string) {
  const normalized = (value ?? "unknown").toLowerCase().replaceAll(" ", "_");
  return <span className={`status ${normalized}`}>{label ?? value ?? "未知"}</span>;
}

export function v2Unknown(value: unknown, fallback = "未知") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

export function v2Bool(value: boolean | null | undefined, yes = "是", no = "否") {
  return value === true ? yes : value === false ? no : "未知";
}

export function formatV2Time(value?: string) {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function formatV2Number(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(value) ? "未知" : value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function formatV2Bytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "未知";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function v2ErrorText(error: unknown) {
  if (error instanceof ConsoleV2ApiError || error instanceof ConsoleV2ContractError) return error.message;
  return error instanceof Error ? error.message : "数据请求失败";
}

function syncListQueryUrl(query: string, limit: number, offset: number) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  if (limit === 20) url.searchParams.delete("limit");
  else url.searchParams.set("limit", String(limit));
  if (offset > 0) url.searchParams.set("offset", String(offset));
  else url.searchParams.delete("offset");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function syncFilterUrl(key: string, value: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value.trim()) url.searchParams.set(key, value.trim());
  else url.searchParams.delete(key);
  url.searchParams.delete("offset");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function normalizePageSize(value: string | number | null | undefined) {
  const numeric = Number(value);
  return numeric === 50 || numeric === 100 ? numeric : 20;
}

function normalizePageOffset(value: string | number | null | undefined, limit: number) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > V2_MAX_OFFSET) return 0;
  return Math.floor(numeric / limit) * limit;
}
