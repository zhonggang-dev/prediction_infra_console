"use client";

import { V2ContextLinks, V2Frame, V2Tabs, V2WorkspacePanel, useWorkspaceTabs } from "../console-v2-resource";
import { CatalogProvider } from "./catalog-context";
import { BenchmarkForm } from "./benchmark-form";
import { FactorsPanel } from "./factors-panel";
import { RunsPanel } from "./runs-panel";
import { SignalForm } from "./signal-form";
import { SubmissionsPanel } from "./submissions-panel";
import { TradingForm } from "./trading-form";

const tabs = [
  { href: "/backtest-platform/trading", label: "交易回测", aliases: ["/backtest-platform"] },
  { href: "/backtest-platform/benchmark", label: "模型评测" },
  { href: "/backtest-platform/signal", label: "信号测试" },
  { href: "/backtest-platform/factors", label: "因子库" },
  { href: "/backtest-platform/submissions", label: "提交" },
  { href: "/backtest-platform/runs", label: "运行记录" },
] as const;

export type BacktestView = typeof tabs[number]["href"];

const HEADS: Record<BacktestView, { eyebrow: string; title: string; description: string }> = {
  "/backtest-platform/trading": { eyebrow: "Backtest Platform / Trading PnL", title: "交易回测", description: "选择策略、Domain、仓位、资金、模型与窗口，在服务器上用原回测脚本运行，页面只显示进度与结果。" },
  "/backtest-platform/benchmark": { eyebrow: "Backtest Platform / Benchmark", title: "模型评测", description: "固定口径评测：总览宽表与 6 个单项（信号、交易、Brier、固定 TTE、校准、偏离）。" },
  "/backtest-platform/signal": { eyebrow: "Backtest Platform / Signal Test", title: "信号测试", description: "模型、单因子、批量因子表、因子池相关性：同一份卷子，六周期分桶与分 Domain 诊断。" },
  "/backtest-platform/factors": { eyebrow: "Backtest Platform / Factors", title: "因子库", description: "实验空间与因子池：版本、状态、移入移出记录。初筛通过不会自动入池。" },
  "/backtest-platform/submissions": { eyebrow: "Backtest Platform / Submissions", title: "提交", description: "预测表、因子表与策略的提交、校验状态与逐项错误。" },
  "/backtest-platform/runs": { eyebrow: "Backtest Platform / Runs", title: "运行记录", description: "所有运行的进度、日志、停止、重跑与两次运行对比；运行配置与复现信息长期保留。" },
};

/** 回测平台工作区：受控 Tab，首次访问才挂载，已访问保留表单与列表状态。 */
export function BacktestWorkspace({ view = "/backtest-platform/trading", legacyUrl }: { view?: BacktestView; /** 旧 PM Backtest 外链；未配置（undefined）时不显示 */ legacyUrl?: string }) {
  const workspace = useWorkspaceTabs(tabs, view);
  const head = HEADS[workspace.active as BacktestView];
  return <V2Frame eyebrow={head.eyebrow} title={head.title} description={head.description}>
    <V2Tabs tabs={tabs} active={workspace.active} onSelect={(href) => workspace.select(href as typeof workspace.active)} ariaLabel="回测平台视图" />
    {legacyUrl && <V2ContextLinks links={[{ href: legacyUrl, label: "打开旧平台 PM Backtest（过渡期保留）", external: true }]} />}
    <CatalogProvider>
      <V2WorkspacePanel active={workspace.active} href="/backtest-platform/trading" visited={workspace.visited.has("/backtest-platform/trading")}><TradingForm /></V2WorkspacePanel>
      <V2WorkspacePanel active={workspace.active} href="/backtest-platform/benchmark" visited={workspace.visited.has("/backtest-platform/benchmark")}><BenchmarkForm /></V2WorkspacePanel>
      <V2WorkspacePanel active={workspace.active} href="/backtest-platform/signal" visited={workspace.visited.has("/backtest-platform/signal")}><SignalForm /></V2WorkspacePanel>
      <V2WorkspacePanel active={workspace.active} href="/backtest-platform/factors" visited={workspace.visited.has("/backtest-platform/factors")}><FactorsPanel /></V2WorkspacePanel>
      <V2WorkspacePanel active={workspace.active} href="/backtest-platform/submissions" visited={workspace.visited.has("/backtest-platform/submissions")}><SubmissionsPanel /></V2WorkspacePanel>
      <V2WorkspacePanel active={workspace.active} href="/backtest-platform/runs" visited={workspace.visited.has("/backtest-platform/runs")}><RunsPanel /></V2WorkspacePanel>
    </CatalogProvider>
  </V2Frame>;
}
