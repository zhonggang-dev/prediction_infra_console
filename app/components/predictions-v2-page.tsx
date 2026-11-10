"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { consoleV2, type ConsoleV2Overview, type ConsoleV2Prediction, type ConsoleV2PredictionBatchSummary, type ConsoleV2PredictionModel } from "../lib/console-v2";
import { fixedPredictionBatch, matchingPredictionBatch, predictionBatchParentContext, predictionBatchQueryKeys, predictionResultQuery, type FixedPredictionBatch } from "../lib/prediction-batch-scope";
import { currentPredictionRange, predictionGenerationIds } from "../lib/prediction-scope";
import { domainLabel, generationLabel, todayRoundGeneration, roundPredictionHref, roundRows, roundStateLabels, roundStateTone, shortDate, slotClock, sourceLabels, labelOf } from "../lib/market-rounds";
import { formatV2Number, formatV2Time, V2ContextLinks, V2Frame, V2ListPage, V2Notice, useV2Filter, v2Status, v2Unknown } from "./console-v2-resource";

export function PredictionsV2Page() {
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState<ConsoleV2Overview>();
  const [overviewError, setOverviewError] = useState<string>();
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  const [modelCatalogue, setModelCatalogue] = useState<ConsoleV2PredictionModel[]>([]);
  const [modelCatalogueError, setModelCatalogueError] = useState<string>();
  const [modelCatalogueLoading, setModelCatalogueLoading] = useState(true);
  const [scope, setScope] = useV2Filter("scope", "history");
  const [model, setModel] = useV2Filter("model");
  const [source, setSource] = useV2Filter("source");
  const [generationId, setGenerationId] = useV2Filter("generation_id");
  const [generationIds, setGenerationIds] = useV2Filter("generation_ids");
  const [predictionAsOf, setPredictionAsOf] = useV2Filter("prediction_as_of");
  const effectiveScope = scope === "current" ? "current" : "history";
  // Older scalar generation links used the API's default Polymarket scope.
  const activeSource = source === "POLYMARKET" || source === "KALSHI" ? source : generationId && !generationIds ? "POLYMARKET" : "";
  const rangeQuery = typeof window === "undefined" ? searchParams : new URL(window.location.href).searchParams;
  const currentRange = currentPredictionRange(overview, activeSource, generationId, generationIds, { single: rangeQuery.has("generation_id"), multiple: rangeQuery.has("generation_ids") });
  const lookupNeeded = effectiveScope === "current" && !currentRange.error && !currentRange.generationId && !currentRange.generationIds;

  // The current scope always reads overview: for the lookup when no range is
  // frozen yet, and for the domain labels and today's progress otherwise.
  const overviewNeeded = effectiveScope === "current" && !currentRange.error;
  useEffect(() => {
    if (!overviewNeeded) return;
    let cancelled = false;
    void consoleV2.infra.overview().then((result) => { if (!cancelled) { setOverview(result.data); setOverviewError(undefined); } }).catch((cause: unknown) => { if (!cancelled) setOverviewError(cause instanceof Error ? cause.message : "当前维护批次不可用"); });
    return () => { cancelled = true; };
  }, [overviewNeeded, overviewAttempt]);

  useEffect(() => {
    let cancelled = false;
    void consoleV2.infra.predictionModels({ limit: 100 }).then((result) => { if (!cancelled) { setModelCatalogue(result.data.items); setModelCatalogueError(undefined); } }).catch((cause: unknown) => { if (!cancelled) { setModelCatalogue([]); setModelCatalogueError(cause instanceof Error ? cause.message : "模型目录暂时不可用"); } }).finally(() => { if (!cancelled) setModelCatalogueLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const activeGenerationId = effectiveScope === "current" ? currentRange.generationId : generationId || undefined;
  const activeGenerationIds = effectiveScope === "current" ? currentRange.generationIds : generationIds || undefined;
  const currentScopeReady = effectiveScope === "history" || Boolean(activeGenerationId || activeGenerationIds);
  const activePredictionAsOf = effectiveScope === "current" ? "" : predictionAsOf;
  // Persist the frozen current range only after lookup. Never first issue an
  // unscoped history query, or erase a replayed batch while overview is pending.
  useEffect(() => {
    if (effectiveScope !== "current" || !currentScopeReady) return;
    const url = new URL(window.location.href);
    const before = url.search;
    for (const [key, value] of [["generation_id", activeGenerationId], ["generation_ids", activeGenerationIds], ["prediction_as_of", undefined], ["source", activeSource || undefined], ["sources", activeSource ? undefined : "POLYMARKET,KALSHI"]]) {
      if (value) url.searchParams.set(key!, value); else url.searchParams.delete(key!);
    }
    if (url.search !== before) {
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new Event("v2-workspace-url-change"));
    }
  }, [effectiveScope, currentScopeReady, activeGenerationId, activeGenerationIds, activeSource]);

  const clearRange = () => { setOverview(undefined); setOverviewError(undefined); setOverviewAttempt((value) => value + 1); setGenerationId(""); setGenerationIds(""); setPredictionAsOf(""); clearPredictionBatchUrl(); };
  const rangeLabel = [activeGenerationId, activeGenerationIds].filter(Boolean).join(", ");
  const rangeText = effectiveScope === "current" ? currentRangeText(overview, activeGenerationId || activeGenerationIds || "") : undefined;
  return <V2Frame eyebrow="Prediction / Results" title="预测结果" description="按模型、平台和维护范围查看已有预测结果与批次下载。">
    <V2ContextLinks links={[{ href: "/markets/running", label: "回到当前市场" }]} />
    <section className="prediction-scope-bar"><div><strong>结果范围</strong><small>{effectiveScope === "current" ? rangeLabel ? rangeText ?? `当前维护批次 ${rangeLabel}` : lookupNeeded ? "正在读取当前生效预测范围" : "当前生效预测范围尚未确定" : rangeLabel ? `维护批次 ${rangeLabel}` : "全部已有结果"}</small></div><label><span>范围</span><select className="select" aria-label="预测范围" value={effectiveScope} onChange={(event) => { setScope(event.target.value); clearRange(); }}><option value="history">全部已有结果</option><option value="current">当前生效预测范围</option></select></label><label><span>模型</span><select className="select" aria-label="预测模型" value={model} onChange={(event) => { setModel(event.target.value); clearPredictionBatchUrl(); }}><option value="">全部模型</option>{modelCatalogueLoading && <option disabled>读取模型目录…</option>}{!modelCatalogueLoading && !modelCatalogueError && !modelCatalogue.length && <option disabled>暂无模型目录</option>}{[true, false].map((currentDispatch) => <optgroup key={String(currentDispatch)} label={currentDispatch ? "当前派发" : "历史记录"}>{modelCatalogue.filter((item) => Boolean(item.currentDispatchChannels.length) === currentDispatch).map((item) => <option key={item.modelId} value={item.modelId}>{item.modelId}{currentDispatch ? ` · ${item.currentDispatchChannels.map((channel) => channel === "DIRECT" ? "Direct" : "Sandbox").join(" / ")}` : ""}</option>)}</optgroup>)}{model && !modelCatalogue.some((item) => item.modelId === model) && <option value={model}>{model}</option>}</select></label><label><span>平台</span><select className="select" aria-label="预测平台" value={activeSource} onChange={(event) => { setSource(event.target.value); clearRange(); }}><option value="">全部平台</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option></select></label></section>
    {rangeLabel && effectiveScope === "history" && <section className="panel panel-pad selection-context"><strong>{activeSource || "Polymarket / Kalshi"} 维护批次 {rangeLabel}</strong>{predictionAsOf && <span>信息时点 {formatV2Time(predictionAsOf)}</span>}<button className="button" type="button" onClick={clearRange}>清除维护批次</button><a className="button" href="/markets/selection?record_view=maintenance">返回维护记录</a></section>}
    <p className="v2-inline-note">当前派发来自服务配置，不表示工作进程在线；历史模型保留原始标识。</p>
    {modelCatalogueError && <V2Notice error title="模型目录不可用" description={modelCatalogueError} />}
    {!currentScopeReady && <section className="prediction-scope-blocked">{currentRange.error ? <><V2Notice error title="维护范围无效" description={currentRange.error} /><button type="button" className="button" onClick={clearRange}>重新读取当前维护范围</button></> : overviewError ? <><V2Notice error title="当前维护批次不可用" description={overviewError} /><button type="button" className="button" onClick={() => setOverviewAttempt((value) => value + 1)}>重试</button></> : overview ? <V2Notice title="当前维护范围未提供" description={`${currentRange.missingSources.join(" / ")} 暂无当前维护批次，可切换平台或查看全部已有结果。`} /> : <p>正在读取各平台当前维护批次…</p>}</section>}
    {effectiveScope === "current" && overview && <TodayPredictionProgress overview={overview} source={activeSource} model={model} />}
    <PredictionResults enabled={currentScopeReady} scope={effectiveScope} source={activeSource} model={model} generationId={activeGenerationId} generationIds={activeGenerationIds} predictionAsOf={activePredictionAsOf} />
  </V2Frame>;
}

function PredictionResults({ enabled, scope, source, model, generationId, generationIds, predictionAsOf }: { enabled: boolean; scope: string; source: string; model: string; generationId?: string; generationIds?: string; predictionAsOf: string }) {
  const [batchAsOf, setBatchAsOf] = useV2Filter("batch_prediction_as_of");
  const [batchMaxResultId, setBatchMaxResultId] = useV2Filter("batch_max_result_id");
  const [batchGenerationId, setBatchGenerationId] = useV2Filter("batch_generation_id");
  const [batchModel, setBatchModel] = useV2Filter("batch_model");
  const [batchSource, setBatchSource] = useV2Filter("batch_source");
  const parentContext = predictionBatchParentContext({ scope, model, ...sourceParams(source), generation_id: generationId, generation_ids: generationIds, prediction_as_of: predictionAsOf });
  const [batchContext, setBatchContext] = useV2Filter("batch_context");
  const [batches, setBatches] = useState<ConsoleV2PredictionBatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchError, setBatchError] = useState<string>();
  const params = { scope, model: model || undefined, generation_id: generationId, generation_ids: generationIds, prediction_as_of: predictionAsOf || undefined, ...sourceParams(source), batch_prediction_as_of: batchAsOf || undefined, batch_max_result_id: batchMaxResultId || undefined, batch_generation_id: batchGenerationId || undefined, batch_model: batchModel || undefined, batch_source: batchSource || undefined, batch_context: batchAsOf ? batchContext || undefined : undefined };
  const fixedBatch = fixedPredictionBatch(params);
  const selectedBatch = matchingPredictionBatch(batches, fixedBatch);
  const batchQuery = predictionResultQuery(params);
  // Batch directory accepts a fixed watermark and generation, but no as-of.
  delete batchQuery.prediction_as_of;
  const batchQueryKey = JSON.stringify(batchQuery);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBatchesLoading(true);
      setBatchError(undefined);
      setBatches([]);
      void consoleV2.infra.predictionBatches({ ...JSON.parse(batchQueryKey), limit: 100 }).then((result) => {
        if (!cancelled) { setBatches(result.data.items); setBatchError(undefined); }
      }).catch(() => {
        if (!cancelled) { setBatches([]); setBatchError("预测结果批次目录暂时不可用。"); }
      }).finally(() => { if (!cancelled) setBatchesLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [batchQueryKey, enabled]);
  const selectBatch = (index: string) => {
    if (index === "fixed") return;
    const item = index === "" ? undefined : batches[Number(index)];
    setBatchContext(item ? parentContext : "");
    setBatchModel(item?.modelId || "");
    setBatchSource(item?.marketSource || "");
    setBatchAsOf(item?.predictionAsOf || "");
    setBatchMaxResultId(item?.maxResultId || "");
    setBatchGenerationId(item?.generationIds.length === 1 ? item.generationIds[0] : "");
  };
  const selectedIndex = selectedBatch ? String(batches.indexOf(selectedBatch)) : fixedBatch ? "fixed" : "";

  return <>{enabled && <PredictionBatchPicker fixedBatch={fixedBatch} batches={batches} loading={batchesLoading} error={batchError} selectedIndex={selectedIndex} generationId={batchGenerationId} onSelect={selectBatch} onGenerationChange={setBatchGenerationId} />}
  <V2ListPage<ConsoleV2Prediction> title="预测结果" enabled={enabled} load={loadPredictionResults} params={params} discardedFilters={["selection_run_id", "selected_market_id", "status"]} rowKey={(item) => item.predictionId} searchPlaceholder="搜索 prediction、market、condition 或问题" columns={[
    { label: "模型 / 来源", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.modelName)}</strong><small>{item.marketSource}</small></div> },
    { label: "问题 / 市场身份", className: "wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small className="mono">{item.marketId} · {item.conditionId}</small></div> },
    { label: "轮次 Domain", render: (item) => domainLabel(item.roundDomain) },
    { label: "概率", render: (item) => `${v2Unknown(item.outcome0Name, "Outcome 0")} ${probability(item.outcome0Probability)} · ${v2Unknown(item.outcome1Name, "Outcome 1")} ${probability(item.outcome1Probability)}` },
    { label: "信息时点 / 接收时间", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.predictionAsOf)}</span><small>{formatV2Time(item.receivedAt)}</small></div> },
  ]} emptyDescription={scope === "current" ? "本轮尚未收到所选模型的预测结果；可切换模型或查看全部已有结果。" : "当前范围没有匹配的预测结果。"} />
  </>;
}

function PredictionBatchPicker({ fixedBatch, batches, loading, error, selectedIndex, generationId, onSelect, onGenerationChange }: { fixedBatch?: FixedPredictionBatch; batches: ConsoleV2PredictionBatchSummary[]; loading: boolean; error?: string; selectedIndex: string; generationId: string; onSelect: (value: string) => void; onGenerationChange: (value: string) => void }) {
  const selected = selectedIndex === "" || selectedIndex === "fixed" ? undefined : batches[Number(selectedIndex)];
  const canDownload = Boolean(fixedBatch && ["POLYMARKET", "KALSHI"].includes(fixedBatch.marketSource) && (!selected || Boolean(selected.sandboxResultCount && selected.sandboxResultCount > 0 && selected.sourceKinds.includes("SANDBOX"))));
  return <section className="prediction-batch-picker panel panel-pad" aria-label="预测结果批次"><div className="section-head"><div><h2 className="section-title">预测结果批次</h2><p className="section-caption">按模型、平台和信息时点选择结果；可下载所选批次的完整 masked Sandbox。</p></div><span className="prediction-batch-status">{loading ? "读取中" : error ? "读取失败" : "选择已有批次"}</span></div>{error && <p className="v2-inline-note error">{error}</p>}<div className="prediction-batch-controls"><label><span>选择批次</span><select className="select" aria-label="预测结果批次" value={selectedIndex} onChange={(event) => onSelect(event.target.value)}><option value="">全部结果</option>{fixedBatch && !selected && <option value="fixed">{fixedBatch.modelId} · {fixedBatch.marketSource} · {formatV2Time(fixedBatch.predictionAsOf)} · 已固定范围</option>}{batches.map((batch, index) => <option key={`${batch.modelId}:${batch.marketSource}:${batch.predictionAsOf}:${batch.maxResultId}`} value={index}>{batchLabel(batch)}</option>)}</select></label>{selected && selected.generationIds.length > 1 && <label><span>维护批次</span><select className="select" aria-label="预测结果维护批次" value={generationId} onChange={(event) => onGenerationChange(event.target.value)}><option value="">全部关联批次</option>{selected.generationIds.map((id) => { const ref = selected.generations.find((item) => item.generationId === id); return <option key={id} value={id}>{ref ? generationLabel(ref) : id}</option>; })}</select></label>}{fixedBatch && <div className="prediction-batch-summary"><span>{fixedBatch.modelId} · {fixedBatch.marketSource}</span><span>{formatV2Time(fixedBatch.predictionAsOf)}</span>{selected && !fixedBatch.generationId ? <><span>结果 {formatV2Number(selected.resultCount, 0)}</span><span>Sandbox {formatV2Number(selected.sandboxCount, 0)}</span></> : <small>范围已固定，结果总数见下方列表；目录更新不会扩大已选范围。</small>}</div>}{canDownload && fixedBatch && <form method="post" action="/api/console/downloads/prediction-batches/archive" target="_blank" className="prediction-batch-download"><input type="hidden" name="model_id" value={fixedBatch.modelId} /><input type="hidden" name="market_source" value={fixedBatch.marketSource} /><input type="hidden" name="prediction_as_of" value={fixedBatch.predictionAsOf} /><input type="hidden" name="max_result_id" value={fixedBatch.maxResultId} /><input type="hidden" name="source_kind" value="SANDBOX" /><input type="hidden" name="variant" value="masked" />{fixedBatch.generationId && <input type="hidden" name="generation_id" value={fixedBatch.generationId}/>}<button className="button primary" type="submit">下载本批 masked Sandbox</button></form>}</div></section>;
}

/** "11-10 第 3 轮 Finance · v4.1 flash · Polymarket · 52 条"; batches without a proven round keep the as-of time. */
function batchLabel(batch: ConsoleV2PredictionBatchSummary) {
  const round = batch.generations.length === 1 && batch.generations[0].domain ? generationLabel(batch.generations[0]) : formatV2Time(batch.predictionAsOf);
  return `${round} · ${batch.modelId} · ${labelOf(sourceLabels, batch.marketSource)} · ${formatV2Number(batch.resultCount, 0)} 条`;
}

/** "Polymarket：World/Geopolitics 11-10 · Politics 11-10；Kalshi：…" for a frozen set of current generations. */
function currentRangeText(overview: ConsoleV2Overview | undefined, ids: string) {
  if (!overview || !ids) return undefined;
  const wanted = new Set(predictionGenerationIds(ids).length ? predictionGenerationIds(ids) : [ids]);
  const parts = overview.sources.map((source) => {
    const generations = source.currentGenerations.filter((generation) => wanted.has(generation.generationId));
    return generations.length ? `${labelOf(sourceLabels, source.marketSource)}：${generations.sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0)).map((generation) => generation.domain ? `${domainLabel(generation.domain)} ${shortDate(generation.businessDate)}` : `维护批次 ${generation.generationId}`).join(" · ")}` : undefined;
  }).filter(Boolean);
  const known = overview.sources.flatMap((source) => source.currentGenerations).filter((generation) => wanted.has(generation.generationId)).length;
  // A replayed range that is no longer current keeps its raw identity.
  return known === wanted.size && parts.length ? parts.join("；") : undefined;
}

/**
 * Today's prediction rounds by platform: prediction members of each round and
 * the result batches already received for it. Direct task coverage is not
 * shown (the prediction page does not audit Direct tasks).
 */
function TodayPredictionProgress({ overview, source, model }: { overview: ConsoleV2Overview; source: string; model: string }) {
  const [batches, setBatches] = useState<ConsoleV2PredictionBatchSummary[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  // More batches than one page: rows without a match are unknown, not empty.
  const [truncated, setTruncated] = useState(false);
  const schedule = overview.roundSchedule;
  const rows = roundRows(overview, new Date()).filter((row) => row.predict && (!source || row.marketSource === source));
  const ids = rows.flatMap((row) => { const generation = todayRoundGeneration(row); return generation ? [generation.generationId] : []; }).join(",");
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      // No prediction lane today: drop any batches of an earlier range.
      if (!ids) { setBatches([]); setTruncated(false); setError(undefined); setLoading(false); return; }
      setLoading(true);
      setBatches([]);
      void consoleV2.infra.predictionBatches({ generation_ids: ids, ...sourceParams(source), model: model || undefined, limit: 100 })
        .then((result) => { if (!cancelled) { setBatches(result.data.items); setTruncated(result.data.hasMore); setError(undefined); } })
        .catch((cause: unknown) => { if (!cancelled) { setBatches([]); setTruncated(false); setError(cause instanceof Error ? cause.message : "今日预测批次暂时不可用"); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [ids, source, model]);
  if (!schedule || !rows.length) return null;
  return <section className="prediction-progress panel panel-pad" aria-label="今日预测进度">
    <div className="section-head"><div><h2 className="section-title">今日预测进度</h2><p className="section-caption">业务日 {schedule.businessDate}（{schedule.timezone}）· 第 1–4 轮当天已发布的预测成员与已收结果；沿用代的历史结果不计入</p></div><span className="prediction-batch-status">{!ids ? "今日尚无已发布预测轮次" : loading ? "读取中" : error ? "读取失败" : `${batches.length} 个批次`}</span></div>
    {error && <p className="v2-inline-note error">{error}</p>}
    {truncated && !error && <p className="v2-inline-note">今日批次超过 100 个，只读取了最新 100 个；未列出的轮次结果未知，可在下方按批次查看。</p>}
    <div className="table-scroll"><table className="v2-table round-table"><thead><tr><th>平台</th><th>轮次</th><th>状态</th><th>预测成员</th><th>已收结果</th><th>操作</th></tr></thead><tbody>
      {rows.map((row) => {
        const generation = todayRoundGeneration(row);
        const href = roundPredictionHref(row, model);
        const received = generation ? batches.filter((batch) => batch.marketSource === row.marketSource && batch.generationIds.includes(generation.generationId)) : [];
        return <tr key={`${row.marketSource}:${row.roundIndex}`}>
          <td>{labelOf(sourceLabels, row.marketSource)}</td>
          <td><div className="v2-cell-copy"><strong>{slotClock(row.slotAt, schedule.timezone)} 第 {row.roundIndex} 轮 {domainLabel(row.domain)}</strong>{row.carriedFrom && <small>成员沿用 {shortDate(row.carriedFrom)}</small>}</div></td>
          <td>{v2Status(roundStateTone[row.state], roundStateLabels[row.state])}</td>
          <td>{formatV2Number(generation?.predictionEnabledCount, 0)}</td>
          <td>{received.length ? <div className="v2-cell-copy">{received.map((batch) => <span key={`${batch.modelId}:${batch.predictionAsOf}`}>{batch.modelId} · {formatV2Number(batch.resultCount, 0)} 条 · {formatV2Time(batch.predictionAsOf)}</span>)}</div> : !generation ? "本轮尚未发布" : loading ? "读取中" : error || truncated ? "未知" : "暂无结果"}</td>
          <td>{href ? <a className="button" href={href}>{generation ? "查看本轮结果" : "查看沿用结果"}</a> : "—"}</td>
        </tr>;
      })}
    </tbody></table></div>
  </section>;
}

function probability(value: number | null) { return value === null || value === undefined ? "未知" : `${(value * 100).toFixed(2)}%`; }
function sourceParams(source: string) { return source ? { source } : { sources: "POLYMARKET,KALSHI" }; }
function clearPredictionBatchUrl() {
  const url = new URL(window.location.href);
  for (const key of [...predictionBatchQueryKeys, "offset"]) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event("v2-workspace-url-change"));
}
function loadPredictionResults(params: Record<string, string | number | undefined>) {
  return consoleV2.infra.predictions(predictionResultQuery(params));
}
