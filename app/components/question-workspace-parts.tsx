"use client";

import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import type { ConsoleV2Page } from "../lib/console-v2";
import { BATCH_DOWNLOAD_ACTION } from "../lib/user-questions";

/* 自定义问题与金融题两个页面共用的分页、详情抽屉与批量下载部件。 */

export function Pager<T>({ label, result, limit, onLimit, onPage }: { label: string; result: ConsoleV2Page<T>; limit?: number; onLimit?: (limit: number) => void; onPage: (page: number) => void }) {
  const pageSize = result.limit;
  const current = Math.floor(result.offset / pageSize);
  const totalPages = Math.ceil(result.total / pageSize);
  return <div className="question-pagination">
    <span>第 {result.total ? result.offset + 1 : 0}–{Math.min(result.offset + result.items.length, result.total)} 条，共 {result.total} 条 · 第 {result.total ? current + 1 : 0} / {totalPages} 页</span>
    <div className="question-pagination-controls">
      {onLimit && <label className="v2-page-size"><span>每页</span><select className="select" aria-label={`${label}每页条数`} value={limit} onChange={(event) => onLimit(normalizeLimit(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label>}
      <button type="button" className="button" disabled={result.offset === 0} onClick={() => onPage(Math.max(0, current - 1))}>上一页</button>
      <button type="button" className="button" disabled={result.offset + pageSize >= result.total} onClick={() => onPage(current + 1)}>下一页</button>
    </div>
  </div>;
}

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="question-detail-section"><h4>{title}</h4>{children}</section>;
}

export function Fact({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

/** 用隐藏表单 POST 到下载 BFF：浏览器原生下载、流式，不把归档读进页面内存。 */
export function submitBatchDownload(fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = BATCH_DOWNLOAD_ACTION;
  form.target = "_blank";
  form.rel = "noopener";
  form.hidden = true;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  try { form.submit(); } finally { form.remove(); }
}

/** 详情抽屉打开时：焦点移到关闭按钮，Escape 关闭，Tab 在抽屉内循环。 */
export function useDetailDrawer(openKey: unknown, closeRef: RefObject<HTMLButtonElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!openKey) return;
    const timer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = closeRef.current?.closest<HTMLElement>(".question-drawer");
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKeyDown); };
  }, [openKey, closeRef]);
}

export function normalizeLimit(value: string | number | null | undefined) {
  const numeric = Number(value);
  return numeric === 50 || numeric === 100 ? numeric : 20;
}

export function pageFromOffset(value: string | null, limit: number) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? Math.floor(numeric / limit) : 0;
}
