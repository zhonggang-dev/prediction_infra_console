"use client";

import { useMemo, useState } from "react";
import { consoleV2, type ConsoleV2Prediction, type ConsoleV2PredictionTask } from "../lib/console-v2";
import { formatV2Time, V2Facts, V2Frame, V2ListPage, V2Tabs, V2WorkspacePanel, useWorkspaceTabs, v2Status, v2Unknown } from "./console-v2-resource";

export function PredictionsV2Page({ tasks = false }: { tasks?: boolean }) {
  const tabs = [{ href: "/predictions", label: "结果" }, { href: "/predictions/tasks", label: "Direct 任务" }] as const;
  const workspace = useWorkspaceTabs(tabs, tasks ? "/predictions/tasks" : "/predictions");
  const config = workspace.active === "/predictions/tasks"
    ? { eyebrow: "Prediction / Direct", title: "Direct 任务", description: "来自持久化 Direct manifest 的期望任务；PENDING 表示该任务尚未完成，不外推所有 Ready 模型覆盖。" }
    : { eyebrow: "Prediction / Results", title: "预测结果", description: "真实结果按 Direct / Sandbox、来源、模型和执行模式检索；未出现在结果列表不等于任务失败。" };
  return <V2Frame eyebrow={config.eyebrow} title={config.title} description={config.description}>
    <V2Tabs tabs={tabs} active={workspace.active} onSelect={(href) => workspace.select(href as typeof workspace.active)} />
    <V2WorkspacePanel active={workspace.active} href="/predictions" visited={workspace.visited.has("/predictions")}><PredictionResults /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/predictions/tasks" visited={workspace.visited.has("/predictions/tasks")}><PredictionTasks /></V2WorkspacePanel>
  </V2Frame>;
}

function PredictionResults() {
  const [source, setSource] = useState("");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = useMemo(() => ({ source: source || undefined, model: model || undefined, mode: mode || undefined, from: from ? `${from}T00:00:00Z` : undefined, to: to ? `${to}T00:00:00Z` : undefined }), [source, model, mode, from, to]);
  const controls = <><select className="select" aria-label="市场来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部市场来源</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option></select><input className="input" aria-label="模型" placeholder="模型名或 ID" value={model} onChange={(event) => setModel(event.target.value)} /><select className="select" aria-label="执行模式" value={mode} onChange={(event) => setMode(event.target.value)}><option value="">全部执行模式</option><option value="LIVE">LIVE</option><option value="HISTORICAL">HISTORICAL</option><option value="TRAINING">TRAINING</option><option value="BACKTEST">BACKTEST</option></select><input className="input" aria-label="开始日期" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /><input className="input" aria-label="结束日期" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></>;
  return <V2ListPage<ConsoleV2Prediction> title="预测结果" load={consoleV2.infra.predictions} params={params} controls={controls} rowKey={(item) => item.predictionId} searchPlaceholder="搜索 prediction、job、market、condition 或问题" columns={[
    { label: "模型 / 版本", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.modelName)}</strong><small>{v2Unknown(item.predictorVersion)}</small></div> },
    { label: "来源 / 执行模式", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.sandboxId ? "Sandbox" : "Direct")}</strong><small>{v2Unknown(item.executionMode)}</small></div> },
    { label: "市场 / 条件", render: (item) => <div className="v2-cell-copy mono"><span>{item.marketId}</span><small>{item.conditionId}</small></div> },
    { label: "概率", render: (item) => `${v2Unknown(item.outcome0Name, "Outcome 0")} ${probability(item.outcome0Probability)} · ${v2Unknown(item.outcome1Name, "Outcome 1")} ${probability(item.outcome1Probability)}` },
    { label: "prediction_as_of", render: (item) => formatV2Time(item.predictionAsOf) },
    { label: "完成 / 接收", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.completedAt)}</span><small>{formatV2Time(item.receivedAt)}</small></div> },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "预测 ID", value: item.predictionId, mono: true }, { label: "来源任务", value: v2Unknown(item.sourceJobId), mono: true }, { label: "Sandbox ID", value: v2Unknown(item.sandboxId), mono: true }, { label: "选盘批次", value: v2Unknown(item.selectionRunId), mono: true }, { label: "入选市场", value: v2Unknown(item.selectedMarketId), mono: true }, { label: "问题", value: item.question }, { label: "预测时间", value: formatV2Time(item.predictionAsOf) }, { label: "接收时间", value: formatV2Time(item.receivedAt) }]} />} />;
}

function PredictionTasks() {
  const [source, setSource] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const params = useMemo(() => ({ source: source || undefined, model: model || undefined, status: status || undefined }), [source, model, status]);
  const controls = <><select className="select" aria-label="任务来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option><option value="polymarket">Polymarket</option><option value="kalshi">Kalshi</option></select><input className="input" aria-label="预测模型 ID" placeholder="预测模型 ID" value={model} onChange={(event) => setModel(event.target.value)} /><select className="select" aria-label="任务状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="PENDING">PENDING</option><option value="COMPLETED">COMPLETED</option></select></>;
  return <V2ListPage<ConsoleV2PredictionTask> title="Direct 任务" load={consoleV2.infra.predictionTasks} params={params} controls={controls} rowKey={(item) => item.predictionId} searchPlaceholder="搜索 prediction、model、market、condition 或 job" columns={[
    { label: "任务 / 模型", className: "primary", render: (item) => <div className="v2-cell-copy"><strong className="mono">{item.predictionId}</strong><small>{item.predictionModelId}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "来源 / 批次", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.marketSource)}</span><small className="mono">{item.selectionRunId}</small></div> },
    { label: "市场 / 条件", render: (item) => <div className="v2-cell-copy mono"><span>{item.marketId}</span><small>{item.conditionId}</small></div> },
    { label: "可用时间", render: (item) => formatV2Time(item.taskAvailableAt) },
    { label: "完成 / 接收", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.completedAt)}</span><small>{formatV2Time(item.receivedAt)}</small></div> },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "预测 ID", value: item.predictionId, mono: true }, { label: "预测模型 ID", value: item.predictionModelId, mono: true }, { label: "来源任务", value: v2Unknown(item.sourceJobId), mono: true }, { label: "入选市场", value: item.selectedMarketId, mono: true }, { label: "预测时间", value: formatV2Time(item.predictionAsOf) }, { label: "任务可用时间", value: formatV2Time(item.taskAvailableAt) }]} /><p className="v2-inline-note">此列表来自 Direct 任务清单；它不声明覆盖所有就绪模型，也不从结果缺失推断失败。</p></>} />;
}

function probability(value: number | null) { return value === null || value === undefined ? "未知" : `${(value * 100).toFixed(2)}%`; }
