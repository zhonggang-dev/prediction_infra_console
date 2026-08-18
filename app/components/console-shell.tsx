"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";

const navigation = [
  { href: "/", label: "运行概览", icon: "grid" as const },
  { href: "/markets", label: "已选市场", icon: "markets" as const },
  { href: "/sandboxes", label: "Sandbox", icon: "box" as const },
  { href: "/predictions", label: "预测结果", icon: "trend" as const },
  { href: "/trades", label: "交易记录", icon: "trades" as const },
  { href: "/backtests", label: "回测数据集", icon: "archive" as const },
  { href: "/delivery", label: "消息交付", icon: "send" as const },
  { href: "/settings", label: "系统设置", icon: "settings" as const },
];

/** 控制台外壳：桌面侧栏与移动端抽屉共用同一份导航。 */
export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return <div className="console">
    <aside className={`sidebar ${isOpen ? "open" : ""}`} aria-label="主导航">
      <Link className="brand" href="/" onClick={() => setIsOpen(false)}>
        <span className="brand-mark">PI</span><span><span className="brand-name">Prediction Console</span><span className="brand-sub">Control plane</span></span>
      </Link>
      <p className="nav-label">业务运行</p>
      <nav className="nav">
        {navigation.map((item) => <Link key={item.href} href={item.href} onClick={() => setIsOpen(false)} className={`nav-link ${isActive(item.href) ? "active" : ""}`}><Icon name={item.icon} />{item.label}</Link>)}
      </nav>
      <div className="sidebar-footer"><span className="live-indicator"><i className="dot" />服务状态由后端返回</span><br /><span>所有时间均为 UTC</span></div>
    </aside>
    <button className={`drawer-backdrop ${isOpen ? "open" : ""}`} aria-label="关闭导航" onClick={() => setIsOpen(false)} />
    <div className="content">
      <header className="topbar"><div className="top-actions"><button className="button icon-button mobile-menu" aria-label="打开导航" onClick={() => setIsOpen(true)}><Icon name="menu" /></button><span className="breadcrumb">Prediction Infra / 内部运维</span></div><div className="top-actions"><span className="utc">UTC 数据标准</span><Link className="button" href="/settings">连接设置</Link></div></header>
      <main className="main">{children}</main>
    </div>
  </div>;
}
