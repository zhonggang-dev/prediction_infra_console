"use client";

import { useEffect, useState } from "react";
import { consoleApi, ConsoleApiError } from "../lib/console-api";
import type { ApiMode, ConsoleList, ConsolePageName, ConsoleResource, OverviewData } from "../lib/types";
import { BacktestPanel } from "./backtest-panel";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";
import { OverviewPanel } from "./overview-panel";
import { ResourcePanel } from "./resource-panel";
import { SettingsPanel } from "./settings-panel";

type PageConfig = { eyebrow: string; title: string; description: string; resource?: ConsoleResource };

const config: Record<ConsolePageName, PageConfig> = {
  overview: { eyebrow: "Control Plane", title: "运行概览", description: "从选盘、Sandbox 到预测回传与消息投递的运行状态。" },
  markets: { eyebrow: "Selection", title: "已选市场", description: "仅展示已通过选盘并进入算法链路的市场；时间均为 UTC。", resource: "selected-markets" },
  sandboxes: { eyebrow: "Research Assets", title: "Sandbox", description: "Sandbox 提交状态与构建摘要，不展示 OSS 对象路径或原始资料。", resource: "sandboxes" },
  predictions: { eyebrow: "Prediction", title: "预测结果", description: "算法服务回传的预测摘要；已发布只表示平台已投递消息。", resource: "predictions" },
  backtests: { eyebrow: "Dataset Export", title: "回测数据集", description: "基于已有预测、Sandbox 引用与 CLOB 盘口导出可复现数据集。", resource: "backtest-datasets" },
  delivery: { eyebrow: "Redis Streams", title: "消息交付", description: "Outbox 交付记录摘要；不展示消息正文或错误细节。", resource: "outbox-events" },
  settings: { eyebrow: "Connection", title: "系统设置", description: "前端通过同源 BFF 访问后端，令牌始终只存放在服务端。" },
};

/** 路由页面负责加载数据，展示由各业务面板独立处理。 */
export function ConsolePage({ page }: { page: ConsolePageName }) {
  const pageConfig = config[page];
  const [mode, setMode] = useState<ApiMode>("live");
  const [overview, setOverview] = useState<OverviewData>();
  const [list, setList] = useState<ConsoleList>();
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(undefined);
      if (demoEnabled) {
        if (page === "overview") setOverview(consoleApi.demoOverview().data);
        if (pageConfig.resource) setList(consoleApi.demoList(pageConfig.resource, { offset }).data);
        setMode("demo");
        return;
      }
      try {
        if (page === "overview") {
          const result = await consoleApi.overview();
          if (!cancelled) { setOverview(result.data); setMode(result.mode); }
        }
        if (pageConfig.resource) {
          const result = await consoleApi.list(pageConfig.resource, { offset });
          if (!cancelled) { setList(result.data); setMode(result.mode); }
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "请求失败");
          setMode(requestError instanceof ConsoleApiError ? requestError.mode : "unavailable");
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [demoEnabled, offset, page, pageConfig.resource, refreshKey]);

  return <ConsoleShell>
    <header className="page-head">
      <div><p className="eyebrow">{pageConfig.eyebrow}</p><h1>{pageConfig.title}</h1><p className="description">{pageConfig.description}</p></div>
      <button className="button" onClick={() => setRefreshKey((value) => value + 1)}><Icon name="refresh" /> 刷新数据</button>
    </header>
    {mode === "demo" && <Notice title="当前为演示数据" description="演示模式由你手动开启；页面没有读取或写入任何业务数据。" action="返回真实数据" onAction={() => setDemoEnabled(false)} />}
    {error && <Notice error title="无法连接控制台接口" description={error} action={mode === "unavailable" ? "手动查看演示数据" : undefined} onAction={() => setDemoEnabled(true)} />}
    {page === "overview" && <OverviewPanel data={overview} />}
    {pageConfig.resource && page !== "backtests" && <ResourcePanel resource={pageConfig.resource} list={list} onPage={setOffset} />}
    {page === "backtests" && <BacktestPanel list={list} consoleReadable={mode === "live" && !error} onPage={setOffset} />}
    {page === "settings" && <SettingsPanel />}
  </ConsoleShell>;
}

/** 连接提示明确告知当前模式，避免运维人员误将演示数据当作生产数据。 */
function Notice({ title, description, action, onAction, error = false }: { title: string; description: string; action?: string; onAction?: () => void; error?: boolean }) {
  return <div className={`notice ${error ? "error" : ""}`}><div><strong>{title}</strong><p>{description}</p></div>{action && <button className="button" onClick={onAction}>{action}</button>}</div>;
}
