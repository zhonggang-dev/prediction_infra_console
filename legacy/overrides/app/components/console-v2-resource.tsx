"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";
import { ConsoleV2ApiError, ConsoleV2ContractError, type ConsoleV2Page, type ConsoleV2Result } from "../lib/console-v2";
import { workspaceHrefWithAppliedQuery } from "../lib/console-workspace";

export type V2Params = Record<string, string | number | undefined>;

export interface V2Column<T> {
  label: string;
  className?: string;
  render: (item: T) => React.ReactNode;
}

export function V2Frame({ eyebrow, title, description, observedAt, onRefresh, loading, children }: { eyebrow: string; title: string; description: string; observedAt?: string; onRefresh?: () => void; loading?: boolean; children: React.ReactNode }) {
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
    if (onSelect && variant === "local") syncQueryUrl(readPanelAppliedQuery(document.getElementById(panelId(href))));
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
    setActive(next);
    setVisited((current) => current.has(next) ? current : new Set([...current, next]));
  }, []);
  return { active, visited, select };
}

export function V2ContextLinks({ links }: { links: Array<{ href: string; label: string; external?: boolean }> }) {
  return <nav className="v2-context-links" aria-label="相关页面">{links.map((link) => <a key={link.href} href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined}>{link.label}<Icon name="arrow" /></a>)}</nav>;
}

type WorkspaceTab = { href: string; label: string; aliases?: readonly string[] };

export function useWorkspaceTabs<T extends string>(tabs: ReadonlyArray<WorkspaceTab & { href: T }>, fallback: T) {
  const [active, setActive] = useState<T>(fallback);
  const [visited, setVisited] = useState<Set<T>>(() => new Set([fallback]));
  const stableTabs = useMemo(() => tabs, [tabs]);
  const markVisited = useCallback((next: T) => setVisited((current) => current.has(next) ? current : new Set([...current, next])), []);
  useEffect(() => {
    const resolvePath = (pathname: string): T => stableTabs.find((tab) => tab.href === pathname || tab.aliases?.includes(pathname))?.href ?? fallback;
    const sync = () => {
      const next = resolvePath(window.location.pathname);
      setActive(next);
      markVisited(next);
    };
    const timer = window.setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    return () => { window.clearTimeout(timer); window.removeEventListener("popstate", sync); };
  }, [stableTabs, fallback, markVisited]);
  const select = (href: T) => {
    const tabAnchorTop = document.getElementById(tabId(href))?.getBoundingClientRect().top;
    if (window.location.pathname !== href) {
      const targetPanel = document.getElementById(panelId(href));
      const targetSearch = readPanelAppliedQuery(targetPanel);
      window.history.pushState({}, "", workspaceHrefWithAppliedQuery(href, window.location.href, targetSearch));
    }
    setActive(href);
    markVisited(href);
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
  if (!visited) return null;
  const selected = active === href;
  return <section id={panelId(href)} className="v2-tab-panel" role="tabpanel" aria-hidden={!selected} hidden={!selected} aria-labelledby={tabId(href)}>{children}</section>;
}

function tabId(value: string) { return `v2-tab-${value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "")}`; }
function panelId(value: string) { return `v2-panel-${value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "")}`; }

function readPanelAppliedQuery(panel: HTMLElement | null) {
  if (!panel) return "";
  const input = Array.from(panel.querySelectorAll<HTMLElement>("[data-v2-search-applied]")).find((candidate) => {
    const ownerPanel = candidate.closest<HTMLElement>("[role=\"tabpanel\"]");
    return ownerPanel === panel || ownerPanel?.hidden === false;
  });
  return input?.getAttribute("data-v2-search-applied")?.trim() ?? "";
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
  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<ConsoleV2Page<T>>();
  const [selected, setSelected] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const serializedParams = useMemo(() => JSON.stringify(params), [params]);

  useEffect(() => {
    let cancelled = false;
    // The request is scheduled so the effect subscribes to the async result
    // without forcing a synchronous render during effect flush.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(undefined);
      const nextParams = { ...params, offset, q: query || undefined };
      void load(nextParams).then((response) => {
        if (cancelled) return;
        setResult(response.data);
        setSelected(undefined);
      }).catch((requestError: unknown) => {
        if (cancelled) return;
        setResult(undefined);
        setSelected(undefined);
        setError(requestError instanceof Error ? requestError.message : "数据请求失败");
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // The serialized filter object is the dependency boundary for server-side filtering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, serializedParams, offset, query]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setOffset(0);
    const next = draftQuery.trim();
    setQuery(next);
    syncQueryUrl(next);
  };
  const activeItem = selected;
  return <section className="section v2-list-section">
    {description && <p className="section-caption">{description}</p>}
    <section className="panel v2-list-panel">
      <form className="filters v2-filterbar" onSubmit={submitSearch}>
        <input className="input" data-v2-search data-v2-search-applied={query} value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`${title}搜索`} />
        <button className="button primary" type="submit"><Icon name="search" /> 搜索</button>
        {query && <button className="button" type="button" onClick={() => { setDraftQuery(""); setQuery(""); setOffset(0); syncQueryUrl(""); }}>清除搜索</button>}
        {controls}
      </form>
      {children}
      {error && <V2Notice error title="数据不可用" description={error} />}
      {loading && !result && <V2Loading />}
      {!loading && !error && result && activeItem && renderDetail && <div className="v2-detail"><div className="section-head"><h3 className="section-title">详情</h3><button className="button" onClick={() => setSelected(undefined)}>收起</button></div>{renderDetail(activeItem, () => setSelected(undefined))}</div>}
      {!loading && !error && result && result.items.length > 0 && <div className={loading ? "table-scroll is-loading" : "table-scroll"}><table className="v2-table"><thead><tr>{columns.map((column) => <th key={column.label} className={column.className}>{column.label}</th>)}{renderDetail && <th className="v2-action-column" aria-label="操作">操作</th>}</tr></thead><tbody>{result.items.map((item) => <tr key={rowKey(item)} onClick={() => renderDetail && setSelected(item)} className={renderDetail ? "clickable" : undefined}>{columns.map((column) => <td key={column.label} className={column.className}>{column.render(item)}</td>)}{renderDetail && <td className="v2-action-cell"><button type="button" className="button" aria-label={`查看${title}详情`} onClick={(event) => { event.stopPropagation(); setSelected(item); }}>查看详情</button></td>}</tr>)}</tbody></table></div>}
      {!loading && !error && result && result.items.length === 0 && <div className="empty"><strong>{emptyTitle}</strong><p>{emptyDescription}</p></div>}
      {result && <V2Pagination page={result} onPage={setOffset} />}
    </section>
  </section>;
}

export function V2Pagination<T>({ page, onPage }: { page: ConsoleV2Page<T>; onPage: (offset: number) => void }) {
  const start = page.items.length ? page.offset + 1 : 0;
  const end = page.offset + page.items.length;
  return <div className="v2-pagination"><span>第 {start}–{end} 条 · 按页展示，未统计总数</span><div><button className="button" disabled={page.offset === 0} onClick={() => onPage(Math.max(0, page.offset - page.limit))}>上一页</button><button className="button" disabled={!page.hasMore} onClick={() => onPage(page.offset + page.limit)}>下一页</button></div></div>;
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

function syncQueryUrl(query: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
