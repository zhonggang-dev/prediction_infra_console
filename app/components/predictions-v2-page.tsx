"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { consoleV2, type ConsoleV2Overview, type ConsoleV2Prediction, type ConsoleV2PredictionBatchSummary, type ConsoleV2PredictionCoverageModel, type ConsoleV2PredictionModel, type ConsoleV2PredictionTask } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2ContextLinks, V2Facts, V2Frame, V2ListPage, V2Notice, V2Tabs, V2WorkspacePanel, useV2Filter, useWorkspaceTabs, v2Status, v2Unknown } from "./console-v2-resource";

export function PredictionsV2Page({ tasks = false }: { tasks?: boolean }) {
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState<ConsoleV2Overview>();
  const [overviewError, setOverviewError] = useState<string>();
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [modelCatalogue, setModelCatalogue] = useState<ConsoleV2PredictionModel[]>([]);
  const [modelCatalogueError, setModelCatalogueError] = useState<string>();
  const [modelCatalogueLoading, setModelCatalogueLoading] = useState(true);
  const [scope, setScope] = useV2Filter("scope", "history");
  const [model, setModel] = useV2Filter("model");
  const [generationId, setGenerationId] = useV2Filter("generation_id");
  const [predictionAsOf] = useV2Filter("prediction_as_of");
  const workspace = useWorkspaceTabs([{ href: "/predictions", label: "结果" }, { href: "/predictions/tasks", label: "任务核对" }] as const, tasks ? "/predictions/tasks" : "/predictions", { sharedQueryKeys: ["scope", "model", "generation_id", "prediction_as_of"] });
  const historicalIdentity = Boolean(searchParams.get("selection_run_id") || searchParams.get("selected_market_id") || searchParams.get("generation_id"));
  const effectiveScope = searchParams.get("scope") === "current" ? "current" : scope === "current" && historicalIdentity ? "history" : scope;

  useEffect(() => {
    let cancelled = false;
    void consoleV2.infra.overview().then((result) => { if (!cancelled) setOverview(result.data); }).catch((cause: unknown) => { if (!cancelled) setOverviewError(cause instanceof Error ? cause.message : "当前发布轮次不可用"); }).finally(() => { if (!cancelled) setOverviewLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void consoleV2.infra.predictionModels({ limit: 100 }).then((result) => { if (!cancelled) { setModelCatalogue(result.data.items); setModelCatalogueError(undefined); } }).catch((cause: unknown) => { if (!cancelled) { setModelCatalogue([]); setModelCatalogueError(cause instanceof Error ? cause.message : "模型目录暂时不可用"); } }).finally(() => { if (!cancelled) setModelCatalogueLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const current = overview?.currentGeneration;
  const coverage = overview?.predictionCoverage;
  const currentScopeReady = effectiveScope === "history" || Boolean(current && coverage);
  const activeGenerationId = effectiveScope === "current" ? current?.generationId : generationId || undefined;
  const activePredictionAsOf = effectiveScope === "current" ? coverage?.predictionAsOf ?? "" : predictionAsOf;
  const config = workspace.active === "/predictions/tasks"
    ? { eyebrow: "Prediction / Tasks", title: "预测任务核对", description: "在同一范围内对照任务与结果；等待中的任务仍保持等待状态。" }
    : { eyebrow: "Prediction / Results", title: "预测结果", description: "默认查看已有结果；当前维护批次的任务进度单独核对。" };
  return <V2Frame eyebrow={config.eyebrow} title={config.title} description={config.description}>
    <V2ContextLinks links={[{ href: "/markets/running", label: "回到当前市场" }]} />
    <section className="prediction-scope-bar"><div><strong>结果范围</strong><small>{effectiveScope === "current" ? current ? `当前维护批次 ${current.generationId}` : "当前批次读取中" : generationId ? `结果批次 ${generationId}` : "全部已有结果"}</small></div><label><span>范围</span><select className="select" aria-label="预测范围" value={effectiveScope} onChange={(event) => setScope(event.target.value)}><option value="history">全部已有结果</option><option value="current">当前维护批次</option></select></label><label><span>模型</span><select className="select" aria-label="预测模型" value={model} onChange={(event) => setModel(event.target.value)}><option value="">全部模型</option>{modelCatalogueLoading && <option disabled>读取模型目录…</option>}{!modelCatalogueLoading && !modelCatalogueError && !modelCatalogue.length && <option disabled>暂无模型目录</option>}{modelCatalogue.map((item) => <option key={item.modelId} value={item.modelId}>{item.modelId === "v4.1 flash" ? "DeepSeek · v4.1 flash" : item.modelId}</option>)}{model && !modelCatalogue.some((item) => item.modelId === model) && <option value={model}>{model}</option>}</select></label><label><span>结果批次</span><input className="input" aria-label="结果批次 ID" inputMode="numeric" value={generationId} onChange={(event) => setGenerationId(event.target.value.trim())} placeholder="可选" /></label><span className="prediction-scope-hint">结果时间按信息时点和接收时间分别展示</span></section>
    {modelCatalogueError && <V2Notice error title="模型目录不可用" description={modelCatalogueError} />}
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
  return <section className="prediction-coverage-summary"><div className="section-head"><div><h2 className="section-title">当前发布轮次覆盖</h2><p className="section-caption">{current ? `轮次 ${current.generationId} · 统计时间 ${formatV2Time(coverage.generationObservedAt)}` : "历史范围摘要"}</p></div><span className="prediction-asof">信息时点 {formatV2Time(coverage.predictionAsOf)}</span></div><V2Facts values={[{ label: "可用市场数", value: formatV2Number(coverage.eligibleMarketCount, 0) }, { label: "预期任务", value: formatV2Number(coverage.expectedTaskCount, 0) }, { label: "已完成", value: formatV2Number(coverage.completedTaskCount, 0) }, { label: "待完成", value: formatV2Number(coverage.pendingTaskCount, 0) }]} />{coverage.models?.length ? <div className="prediction-model-coverage">{coverage.models.map((item) => <ModelCoverage key={item.predictionModelId} model={item} />)}</div> : <p className="prediction-coverage-note">暂未提供模型分项统计。</p>}</section>;
}

function ModelCoverage({ model }: { model: ConsoleV2PredictionCoverageModel }) {
  return <div><strong>{model.predictionModelId}</strong><span>{formatV2Number(model.completedTaskCount, 0)} / {formatV2Number(model.expectedTaskCount, 0)} 已完成</span><small>待完成 {formatV2Number(model.pendingTaskCount, 0)}</small></div>;
}

function PredictionResults({ model, generationId, predictionAsOf }: { model: string; generationId?: string; predictionAsOf: string }) {
  const [source, setSource] = useV2Filter("source");
  const [selectionRunId, setSelectionRunId] = useV2Filter("selection_run_id");
  const [selectedMarketId, setSelectedMarketId] = useV2Filter("selected_market_id");
  const [batchAsOf, setBatchAsOf] = useV2Filter("batch_prediction_as_of");
  const [batchMaxResultId, setBatchMaxResultId] = useV2Filter("batch_max_result_id");
  const [batchGenerationId, setBatchGenerationId] = useV2Filter("batch_generation_id");
  const [batches, setBatches] = useState<ConsoleV2PredictionBatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchError, setBatchError] = useState<string>();
  const previousModel = useRef(model);
  const previousGeneration = useRef(generationId);
  const clearBatchScope = useCallback(() => {
    setBatchAsOf("");
    setBatchMaxResultId("");
    setBatchGenerationId("");
  }, [setBatchAsOf, setBatchMaxResultId, setBatchGenerationId]);
  useEffect(() => {
    if (previousModel.current !== model) {
      clearBatchScope();
      previousModel.current = model;
    }
  }, [clearBatchScope, model]);
  useEffect(() => {
    if (previousGeneration.current !== generationId) {
      clearBatchScope();
      previousGeneration.current = generationId;
    }
  }, [clearBatchScope, generationId]);
  useEffect(() => {
    let cancelled = false;
    if (source === "GENERATED") {
      return () => { cancelled = true; };
    }
    void consoleV2.infra.predictionBatches({ model: model || undefined, source: source || undefined, generation_id: generationId, limit: 100 }).then((result) => {
      if (!cancelled) { setBatches(result.data.items); setBatchError(undefined); setBatchesLoading(false); }
    }).catch(() => {
      if (!cancelled) { setBatches([]); setBatchError("预测结果批次目录暂时不可用。"); setBatchesLoading(false); }
    }).finally(() => {
      if (!cancelled) setBatchesLoading(false);
    });
    return () => { cancelled = true; };
  }, [model, source, generationId]);
  const selectedBatch = batches.find((item) => item.predictionAsOf === batchAsOf && item.maxResultId === batchMaxResultId && (!source || item.marketSource === source));
  const effectiveModel = selectedBatch?.modelId || model;
  const effectiveSource = selectedBatch?.marketSource || source;
  const effectiveAsOf = selectedBatch?.predictionAsOf || batchAsOf || predictionAsOf;
  const effectiveGenerationId = selectedBatch?.generationIds.length === 1 ? selectedBatch.generationIds[0] : batchGenerationId || generationId;
  const effectiveMaxResultId = selectedBatch?.maxResultId || batchMaxResultId;
  const params = { model: effectiveModel || undefined, generation_id: effectiveGenerationId, prediction_as_of: effectiveAsOf || undefined, max_result_id: effectiveMaxResultId || undefined, source: effectiveSource || undefined, selection_run_id: selectionRunId || undefined, selected_market_id: selectedMarketId || undefined };
  const controls = <><select className="select" aria-label="市场来源" value={source} onChange={(event) => { clearBatchScope(); setSource(event.target.value); }}><option value="">全部市场来源</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option><option value="GENERATED">Generated</option></select><input className="input" aria-label="选盘批次 ID" inputMode="numeric" placeholder="选盘批次 ID" value={selectionRunId} onChange={(event) => setSelectionRunId(event.target.value.trim())} /><input className="input" aria-label="Selected market ID" inputMode="numeric" placeholder="Selected market ID" value={selectedMarketId} onChange={(event) => setSelectedMarketId(event.target.value.trim())} /></>;
  const selectBatch = (index: string) => {
    const item = index === "" ? undefined : batches[Number(index)];
    setBatchAsOf(item?.predictionAsOf || "");
    setBatchMaxResultId(item?.maxResultId || "");
    setBatchGenerationId(item?.generationIds.length === 1 ? item.generationIds[0] : "");
  };
  const selectedIndex = selectedBatch ? String(batches.indexOf(selectedBatch)) : "";
  const visibleBatches = source === "GENERATED" ? [] : batches;
  const visibleBatchError = source === "GENERATED" ? "Generated 来源暂不提供 masked Sandbox 批次下载。" : batchError;
  const visibleBatchLoading = source === "GENERATED" ? false : batchesLoading;
  return <><PredictionBatchPicker batches={visibleBatches} loading={visibleBatchLoading} error={visibleBatchError} selectedIndex={selectedIndex} generationId={batchGenerationId} onSelect={selectBatch} onGenerationChange={setBatchGenerationId} />
  <V2ListPage<ConsoleV2Prediction> title="预测结果" load={consoleV2.infra.predictions} params={params} controls={controls} rowKey={(item) => item.predictionId} searchPlaceholder="搜索 prediction、market、condition 或问题" columns={[
    { label: "模型 / 来源", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.modelName)}</strong><small>{item.sourceKind} · {v2Unknown(item.predictorVersion)}</small></div> },
    { label: "问题 / 市场身份", className: "wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small className="mono">{item.marketId} · {item.conditionId}</small></div> },
    { label: "概率", render: (item) => `${v2Unknown(item.outcome0Name, "Outcome 0")} ${probability(item.outcome0Probability)} · ${v2Unknown(item.outcome1Name, "Outcome 1")} ${probability(item.outcome1Probability)}` },
    { label: "信息时点 / 接收时间", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.predictionAsOf)}</span><small>{formatV2Time(item.receivedAt)}</small></div> },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "预测 ID", value: item.predictionId, mono: true }, { label: "模型", value: v2Unknown(item.modelName) }, { label: "模型版本", value: v2Unknown(item.predictorVersion) }, { label: "发布轮次", value: v2Unknown(item.generationId), mono: true }, { label: "来源", value: item.sourceKind }, { label: "Sandbox ID", value: v2Unknown(item.sandboxId), mono: true }, { label: "来源任务", value: v2Unknown(item.sourceJobId), mono: true }, { label: "问题", value: item.question }, { label: v2Unknown(item.outcome0Name, "Outcome 0"), value: probability(item.outcome0Probability) }, { label: v2Unknown(item.outcome1Name, "Outcome 1"), value: probability(item.outcome1Probability) }, { label: "信息时点", value: formatV2Time(item.predictionAsOf) }, { label: "结果接收时间", value: formatV2Time(item.receivedAt) }]} />} />
  </>;
}

function PredictionBatchPicker({ batches, loading, error, selectedIndex, generationId, onSelect, onGenerationChange }: { batches: ConsoleV2PredictionBatchSummary[]; loading: boolean; error?: string; selectedIndex: string; generationId: string; onSelect: (value: string) => void; onGenerationChange: (value: string) => void }) {
  const selected = selectedIndex === "" ? undefined : batches[Number(selectedIndex)];
  const canDownload = Boolean(selected && (selected.marketSource === "POLYMARKET" || selected.marketSource === "KALSHI") && selected.sandboxResultCount && selected.sandboxResultCount > 0 && selected.sourceKinds.includes("SANDBOX"));
  return <section className="prediction-batch-picker panel panel-pad" aria-label="预测结果批次"><div className="section-head"><div><h2 className="section-title">预测结果批次</h2><p className="section-caption">按模型、市场来源和信息时点固定一批结果；批次水位保证分页与下载范围一致。</p></div><span className="prediction-batch-status">{loading ? "读取中" : error ? "读取失败" : `${batches.length} 个批次`}</span></div>{error && <p className="v2-inline-note error">{error}</p>}<div className="prediction-batch-controls"><label><span>选择批次</span><select className="select" aria-label="预测结果批次" value={selectedIndex} onChange={(event) => onSelect(event.target.value)}><option value="">全部结果</option>{batches.map((batch, index) => <option key={`${batch.modelId}:${batch.marketSource}:${batch.predictionAsOf}:${batch.maxResultId}`} value={index}>{batch.modelId} · {batch.marketSource} · {formatV2Time(batch.predictionAsOf)} · {formatV2Number(batch.resultCount, 0)} 条</option>)}</select></label>{selected && selected.generationIds.length > 1 && <label><span>维护批次</span><select className="select" aria-label="预测结果维护批次" value={generationId} onChange={(event) => onGenerationChange(event.target.value)}><option value="">全部关联批次</option>{selected.generationIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>}{selected && <div className="prediction-batch-summary"><span>结果 {formatV2Number(selected.resultCount, 0)}</span><span>Sandbox {formatV2Number(selected.sandboxCount, 0)}</span><span>Direct {formatV2Number(selected.directResultCount, 0)}</span><span>未知 {formatV2Number(selected.unknownResultCount, 0)}</span><small>最近接收 {formatV2Time(selected.latestReceivedAt)} · 水位 {selected.maxResultId}</small></div>}{canDownload && selected && <form method="post" action="/api/console/downloads/prediction-batches/archive" target="_blank" className="prediction-batch-download"><input type="hidden" name="model_id" value={selected.modelId} /><input type="hidden" name="market_source" value={selected.marketSource} /><input type="hidden" name="prediction_as_of" value={selected.predictionAsOf} /><input type="hidden" name="max_result_id" value={selected.maxResultId} /><input type="hidden" name="source_kind" value="SANDBOX" /><input type="hidden" name="variant" value="masked" />{selected.generationIds.length === 1 && <input type="hidden" name="generation_id" value={selected.generationIds[0]}/>} {selected.generationIds.length > 1 && generationId && <input type="hidden" name="generation_id" value={generationId}/>}<button className="button primary" type="submit">下载本批 masked Sandbox</button></form>}</div></section>;
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
    { label: "信息时点 / 可用时间", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.predictionAsOf)}</span><small>{formatV2Time(item.taskAvailableAt)}</small></div> },
  ]} emptyDescription="任务列表只展示后端返回的任务状态；没有额外执行证据时不提供重复详情。" />;
}

function probability(value: number | null) { return value === null || value === undefined ? "未知" : `${(value * 100).toFixed(2)}%`; }
