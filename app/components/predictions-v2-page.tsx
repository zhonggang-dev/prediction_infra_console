"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { consoleV2, type ConsoleV2Overview, type ConsoleV2Prediction, type ConsoleV2PredictionCoverageModel, type ConsoleV2PredictionTask } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2ContextLinks, V2Facts, V2Frame, V2ListPage, V2Notice, V2Tabs, V2WorkspacePanel, useV2Filter, useWorkspaceTabs, v2Status, v2Unknown } from "./console-v2-resource";

export function PredictionsV2Page({ tasks = false }: { tasks?: boolean }) {
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState<ConsoleV2Overview>();
  const [overviewError, setOverviewError] = useState<string>();
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [scope, setScope] = useV2Filter("scope", "current");
  const [model, setModel] = useV2Filter("model");
  const [generationId, setGenerationId] = useV2Filter("generation_id");
  const [predictionAsOf, setPredictionAsOf] = useV2Filter("prediction_as_of");
  const workspace = useWorkspaceTabs([{ href: "/predictions", label: "结果" }, { href: "/predictions/tasks", label: "任务核对" }] as const, tasks ? "/predictions/tasks" : "/predictions");
  const historicalIdentity = Boolean(searchParams.get("selection_run_id") || searchParams.get("selected_market_id") || searchParams.get("generation_id"));
  const effectiveScope = scope === "current" && historicalIdentity ? "history" : scope;

  useEffect(() => {
    let cancelled = false;
    void consoleV2.infra.overview().then((result) => { if (!cancelled) setOverview(result.data); }).catch((cause: unknown) => { if (!cancelled) setOverviewError(cause instanceof Error ? cause.message : "当前发布轮次不可用"); }).finally(() => { if (!cancelled) setOverviewLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const current = overview?.currentGeneration;
  const coverage = overview?.predictionCoverage;
  const currentScopeReady = effectiveScope === "history" || Boolean(current && coverage);
  const activeGenerationId = effectiveScope === "current" ? current?.generationId : generationId || undefined;
  const activePredictionAsOf = effectiveScope === "current" ? coverage?.predictionAsOf ?? "" : predictionAsOf;
  const config = workspace.active === "/predictions/tasks"
    ? { eyebrow: "Prediction / Tasks", title: "预测任务核对", description: "在同一范围内对照任务与结果；等待中的任务仍保持等待状态。" }
    : { eyebrow: "Prediction / Results", title: "预测结果", description: "默认查看当前发布轮次；可切换历史范围，分别查看预测时间和结果接收时间。" };
  return <V2Frame eyebrow={config.eyebrow} title={config.title} description={config.description}>
    <V2ContextLinks links={[{ href: "/markets/running", label: "回到当前市场" }, { href: "/questions", label: "查看题目定义" }]} />
    <section className="prediction-scope-bar"><div><strong>数据范围</strong><small>{effectiveScope === "current" ? current ? `当前发布轮次 ${current.generationId}` : "当前轮次读取中" : generationId ? `历史发布轮次 ${generationId}` : "全历史"}</small></div><label><span>范围</span><select className="select" aria-label="预测范围" value={effectiveScope} onChange={(event) => setScope(event.target.value)}><option value="current">当前发布轮次</option><option value="history">全历史</option></select></label><label><span>模型</span><select className="select" aria-label="预测模型" value={model} onChange={(event) => setModel(event.target.value)}><option value="">全部模型</option>{(coverage?.models ?? []).map((item) => <option key={item.predictionModelId} value={item.predictionModelId}>{item.predictionModelId}</option>)}</select></label><label><span>发布轮次 ID</span><input className="input" aria-label="发布轮次 ID" inputMode="numeric" value={generationId} onChange={(event) => setGenerationId(event.target.value.trim())} placeholder={effectiveScope === "current" ? "当前自动带入" : "可选"} /></label><label><span>预测时间截面</span><input className="input" aria-label="预测时间截面" value={activePredictionAsOf} onChange={(event) => setPredictionAsOf(event.target.value.trim())} placeholder="精确时间（可选）" readOnly={effectiveScope === "current"} /></label></section>
    {overviewLoading && <div className="prediction-scope-loading">正在读取当前发布轮次与覆盖摘要…</div>}
    {overviewError && <V2Notice error title="当前发布轮次不可用" description={overviewError} />}
    {!overviewLoading && effectiveScope === "current" && !coverage && <V2Notice error title="当前轮次覆盖未提供" description="没有 current generation coverage 时不回退到全历史结果；可显式切换到全历史查看历史记录。" />}
    {!overviewLoading && effectiveScope === "current" && coverage && <PredictionCoverageSummary coverage={coverage} current={current} />}
    {!overviewLoading && effectiveScope === "history" && <p className="prediction-coverage-note">历史范围使用你选择的轮次与筛选；当前轮次统计不会套用到历史记录。</p>}
    <V2Tabs tabs={workspaceTabs} active={workspace.active} onSelect={(href) => workspace.select(href as typeof workspace.active)} />
    {currentScopeReady ? <><V2WorkspacePanel active={workspace.active} href="/predictions" visited={workspace.visited.has("/predictions")}><PredictionResults model={model} generationId={activeGenerationId} predictionAsOf={activePredictionAsOf} /></V2WorkspacePanel><V2WorkspacePanel active={workspace.active} href="/predictions/tasks" visited={workspace.visited.has("/predictions/tasks")}><PredictionTasks model={model} generationId={activeGenerationId} predictionAsOf={activePredictionAsOf} /></V2WorkspacePanel></> : <div className="prediction-scope-blocked"><strong>等待范围确定</strong><p>当前 scope 还没有可用的后端范围，页面不会请求全历史数据冒充当前轮次。</p></div>}
  </V2Frame>;
}

const workspaceTabs = [{ href: "/predictions", label: "结果" }, { href: "/predictions/tasks", label: "任务核对" }] as const;

function PredictionCoverageSummary({ coverage, current }: { coverage: NonNullable<ConsoleV2Overview["predictionCoverage"]>; current?: ConsoleV2Overview["currentGeneration"] }) {
  return <section className="prediction-coverage-summary"><div className="section-head"><div><h2 className="section-title">当前发布轮次覆盖</h2><p className="section-caption">{current ? `轮次 ${current.generationId} · 统计时间 ${formatV2Time(coverage.generationObservedAt)}` : "历史范围摘要"}</p></div><span className="prediction-asof">预测截面 {formatV2Time(coverage.predictionAsOf)}</span></div><V2Facts values={[{ label: "可用市场数", value: formatV2Number(coverage.eligibleMarketCount, 0) }, { label: "预期任务", value: formatV2Number(coverage.expectedTaskCount, 0) }, { label: "已完成", value: formatV2Number(coverage.completedTaskCount, 0) }, { label: "待完成", value: formatV2Number(coverage.pendingTaskCount, 0) }]} />{coverage.models?.length ? <div className="prediction-model-coverage">{coverage.models.map((item) => <ModelCoverage key={item.predictionModelId} model={item} />)}</div> : <p className="prediction-coverage-note">暂未提供模型分项统计。</p>}</section>;
}

function ModelCoverage({ model }: { model: ConsoleV2PredictionCoverageModel }) {
  return <div><strong>{model.predictionModelId}</strong><span>{formatV2Number(model.completedTaskCount, 0)} / {formatV2Number(model.expectedTaskCount, 0)} 已完成</span><small>待完成 {formatV2Number(model.pendingTaskCount, 0)}</small></div>;
}

function PredictionResults({ model, generationId, predictionAsOf }: { model: string; generationId?: string; predictionAsOf: string }) {
  const [source, setSource] = useV2Filter("source");
  const [mode, setMode] = useV2Filter("mode");
  const [selectionRunId, setSelectionRunId] = useV2Filter("selection_run_id");
  const [selectedMarketId, setSelectedMarketId] = useV2Filter("selected_market_id");
  const params = useMemo(() => ({ model: model || undefined, generation_id: generationId, prediction_as_of: predictionAsOf || undefined, source: source || undefined, mode: mode || undefined, selection_run_id: selectionRunId || undefined, selected_market_id: selectedMarketId || undefined }), [model, generationId, predictionAsOf, source, mode, selectionRunId, selectedMarketId]);
  const controls = <><select className="select" aria-label="市场来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部市场来源</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option><option value="GENERATED">Generated</option></select><select className="select" aria-label="执行模式" value={mode} onChange={(event) => setMode(event.target.value)}><option value="">全部执行模式</option><option value="LIVE">LIVE</option><option value="HISTORICAL">HISTORICAL</option><option value="TRAINING">TRAINING</option><option value="BACKTEST">BACKTEST</option></select><input className="input" aria-label="选盘批次 ID" inputMode="numeric" placeholder="选盘批次 ID" value={selectionRunId} onChange={(event) => setSelectionRunId(event.target.value.trim())} /><input className="input" aria-label="Selected market ID" inputMode="numeric" placeholder="Selected market ID" value={selectedMarketId} onChange={(event) => setSelectedMarketId(event.target.value.trim())} /></>;
  return <V2ListPage<ConsoleV2Prediction> title="预测结果" load={consoleV2.infra.predictions} params={params} controls={controls} rowKey={(item) => item.predictionId} searchPlaceholder="搜索 prediction、market、condition 或问题" columns={[
    { label: "模型 / 来源", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.modelName)}</strong><small>{item.sourceKind} · {v2Unknown(item.predictorVersion)}</small></div> },
    { label: "问题 / 市场身份", className: "wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small className="mono">{item.marketId} · {item.conditionId}</small></div> },
    { label: "概率", render: (item) => `${v2Unknown(item.outcome0Name, "Outcome 0")} ${probability(item.outcome0Probability)} · ${v2Unknown(item.outcome1Name, "Outcome 1")} ${probability(item.outcome1Probability)}` },
    { label: "as-of / 接收", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.predictionAsOf)}</span><small>{formatV2Time(item.receivedAt)}</small></div> },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "预测 ID", value: item.predictionId, mono: true }, { label: "发布轮次", value: v2Unknown(item.generationId), mono: true }, { label: "来源", value: item.sourceKind }, { label: "来源任务", value: v2Unknown(item.sourceJobId), mono: true }, { label: "问题", value: item.question }, { label: "prediction_as_of", value: formatV2Time(item.predictionAsOf) }, { label: "received_at", value: formatV2Time(item.receivedAt) }]} />} />;
}

function PredictionTasks({ model, generationId, predictionAsOf }: { model: string; generationId?: string; predictionAsOf: string }) {
  const [status, setStatus] = useV2Filter("status");
  const [selectionRunId, setSelectionRunId] = useV2Filter("selection_run_id");
  const [selectedMarketId, setSelectedMarketId] = useV2Filter("selected_market_id");
  const params = useMemo(() => ({ model: model || undefined, generation_id: generationId, prediction_as_of: predictionAsOf || undefined, status: status || undefined, selection_run_id: selectionRunId || undefined, selected_market_id: selectedMarketId || undefined }), [model, generationId, predictionAsOf, status, selectionRunId, selectedMarketId]);
  const controls = <><select className="select" aria-label="任务状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="PENDING">PENDING</option><option value="COMPLETED">COMPLETED</option></select><input className="input" aria-label="选盘批次 ID" inputMode="numeric" placeholder="选盘批次 ID" value={selectionRunId} onChange={(event) => setSelectionRunId(event.target.value.trim())} /><input className="input" aria-label="Selected market ID" inputMode="numeric" placeholder="Selected market ID" value={selectedMarketId} onChange={(event) => setSelectedMarketId(event.target.value.trim())} /></>;
  return <V2ListPage<ConsoleV2PredictionTask> title="预测任务核对" load={consoleV2.infra.predictionTasks} params={params} controls={controls} rowKey={(item) => item.predictionId} searchPlaceholder="搜索 prediction、model、market、condition 或 job" columns={[
    { label: "任务 / 模型", className: "primary", render: (item) => <div className="v2-cell-copy"><strong className="mono">{item.predictionId}</strong><small>{item.predictionModelId}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "问题 / 市场身份", className: "wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small className="mono">{item.marketId} · {item.conditionId}</small></div> },
    { label: "as-of / 可用", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.predictionAsOf)}</span><small>{formatV2Time(item.taskAvailableAt)}</small></div> },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "预测 ID", value: item.predictionId, mono: true }, { label: "发布轮次", value: v2Unknown(item.generationId), mono: true }, { label: "预测模型 ID", value: item.predictionModelId, mono: true }, { label: "状态", value: item.status }, { label: "问题", value: item.question }, { label: "prediction_as_of", value: formatV2Time(item.predictionAsOf) }, { label: "任务可用时间", value: formatV2Time(item.taskAvailableAt) }]} /><p className="v2-inline-note">PENDING 只代表该任务尚未完成，不代表执行失败。</p></>} />;
}

function probability(value: number | null) { return value === null || value === undefined ? "未知" : `${(value * 100).toFixed(2)}%`; }
