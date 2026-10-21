"use client";

/* Native anchors intentionally bypass the current vinext client-router export bug. */
/* eslint-disable @next/next/no-html-link-for-pages */

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";

type NavigationItem = {
  href?: string;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  disabledReason?: string;
  external?: boolean;
};

type NavigationGroup = { label: string; items: NavigationItem[] };

const navigationGroups: NavigationGroup[] = [
  {
    label: "概览",
    items: [{ href: "/", label: "运行概览", icon: "grid" as const }],
  },
  {
    label: "业务运行",
    items: [
      { href: "/markets", label: "市场工作区", icon: "markets" as const },
      { href: "/predictions", label: "预测工作区", icon: "trend" as const },
      { href: "/questions", label: "题目库", icon: "questions" as const },
      { href: "/assets", label: "资料数据工作区", icon: "box" as const },
      { href: "/trading", label: "交易工作区", icon: "trades" as const },
      { href: "/backtest-platform", label: "回测平台", icon: "trend" as const },
    ],
  },
  {
    label: "系统运行",
    items: [
      { href: "/system", label: "系统工作区", icon: "settings" as const },
    ],
  },
];

/** 控制台外壳：桌面侧栏与移动端抽屉共用同一份导航。 */
export function ConsoleShell({ children, timezone }: { children: React.ReactNode; timezone?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (!href.startsWith("/")) return false;
    if (href === "/") return pathname === "/";
    if (href === "/assets") return ["/assets", "/datasets", "/backtests", "/dataset-rotation"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    if (href === "/trading") return ["/trading", "/live", "/trades"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    if (href === "/system") return ["/system", "/observability", "/delivery", "/settings"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return <div className="console">
    <aside id="console-sidebar" className={`sidebar ${isOpen ? "open" : ""}`} aria-label="主导航">
      <a className="brand" href="/" onClick={() => setIsOpen(false)}>
        <span className="brand-mark">PI</span><span><span className="brand-name">Prediction Console</span><span className="brand-sub">新版运维控制台</span></span>
      </a>
      <div className="sidebar-nav">
        <nav className="nav" aria-label="新版控制台导航">
          {navigationGroups.map((group) => <div className="nav-group" key={group.label}>
            <p className="nav-label">{group.label}</p>
            {group.items.map((item) => item.href ? <a key={item.href} href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined} onClick={() => setIsOpen(false)} className={`nav-link ${isActive(item.href) ? "active" : ""}`} aria-current={isActive(item.href) ? "page" : undefined}><Icon name={item.icon} /><span className="nav-link-copy">{item.label}</span></a> : <span key={item.label} className="nav-link nav-link-disabled" aria-disabled="true"><Icon name={item.icon} /><span className="nav-link-copy"><span>{item.label}</span><small>{item.disabledReason}</small></span></span>)}
          </div>)}
        </nav>
      </div>
      <div className="sidebar-footer"><span className="live-indicator"><i className="dot" />服务状态由后端返回</span><br /><span className="build-note">新版运维控制台</span><br /><span>{timezone ? `时间标准：${timezone}` : "所有时间均为 UTC"}</span></div>
    </aside>
    <button className={`drawer-backdrop ${isOpen ? "open" : ""}`} aria-label="关闭导航" onClick={() => setIsOpen(false)} />
    <div className="content">
      <header className="topbar"><div className="top-actions"><button className="button icon-button mobile-menu" aria-label="打开导航" aria-controls="console-sidebar" aria-expanded={isOpen} onClick={() => setIsOpen(true)}><Icon name="menu" /></button><span className="breadcrumb">Prediction Infra / 内部运维</span><span className="console-version">新版</span></div><div className="top-actions"><span className="utc">{timezone ? `${timezone} 数据标准` : "UTC 数据标准"}</span><a className="button" href="/system/settings">连接设置</a></div></header>
      <main className="main">{children}</main>
    </div>
  </div>;
}
