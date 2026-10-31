"use client";

import { useEffect, useMemo, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { consoleV2, type ConsoleV2Asset, type ConsoleV2BacktestProduct } from "../lib/console-v2";
import { datasetTestDownloadState, datasetTrainDownloadState, ROTATION_VARIANTS, type DatasetRotationCurrentVersion, type DatasetRotationData, type RotationVariant } from "../lib/dataset-rotation";
import { formatV2Bytes, formatV2Number, formatV2Time, V2ContextLinks, V2Facts, V2Frame, V2ListPage, useV2Filter, v2Status, v2Unknown } from "./console-v2-resource";
import { sandboxArchiveOptions, archiveOptionLabel, type SandboxArchiveOptions } from "../lib/sandbox-downloads";
import { DatasetRotationPage } from "./dataset-rotation-page";

const variantLabels: Record<RotationVariant, string> = { original: "original", mv: "MV", ms: "MS", syn: "Syn" };

export function AssetsV2Page({ view = "assets" }: { view?: "assets" | "datasets" | "backtests" }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const config = view === "backtests"
    ? { eyebrow: "Assets / Legacy Export", title: "历史回测导出", description: "这是历史数据交付目录；新回测平台在独立工作区运行，旧导出不会覆盖当前数据集与成员。" }
    : view === "datasets"
      ? { eyebrow: "Dataset / Rotation", title: "数据集轮转", description: "选择资料类型和版本，查看训练集、测试集及下载。" }
      : { eyebrow: "Assets / Archive", title: "Sandbox", description: "查看资料与下载文件。" };
  const contextLinks = view === "backtests"
    ? [{ href: "/backtest-platform", label: "打开回测平台" }, { href: "/datasets", label: "返回数据集轮转" }]
    : [];

  return <V2Frame eyebrow={config.eyebrow} title={config.title} description={config.description} onRefresh={view === "datasets" ? () => setRefreshKey((value) => value + 1) : undefined}>
    {contextLinks.length > 0 && <V2ContextLinks links={contextLinks} />}
    {view === "backtests" ? <BacktestProducts /> : view === "datasets" ? <DatasetVersionWorkspace refreshKey={refreshKey} /> : <AssetCatalog />}
  </V2Frame>;
}

function DatasetVersionWorkspace({ refreshKey }: { refreshKey: number }) {
  const [rotation, setRotation] = useState<DatasetRotationData>();
  const [rotationError, setRotationError] = useState<string>();
  const [rotationLoading, setRotationLoading] = useState(true);
  const [version, setVersion] = useV2Filter("version");
  const [variant, setVariant] = useV2Filter("variant");

  useEffect(() => {
    let cancelled = false;
    void consoleApi.datasetRotation().then((result) => {
      if (cancelled) return;
      setRotation(result.data);
      setRotationError(undefined);
    }).catch((cause: unknown) => {
      if (cancelled) return;
      setRotation(undefined);
      setRotationError(cause instanceof Error ? cause.message : "当前版本不可用");
    }).finally(() => {
      if (!cancelled) setRotationLoading(false);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const currentByVariant = useMemo(() => new Map((rotation?.currentVersions ?? []).map((item) => [item.variant, item])), [rotation]);
  const trainByVariant = useMemo(() => new Map((rotation?.trainingSets ?? []).map((item) => [item.variant, item])), [rotation]);
  const selectedVariant = isRotationVariant(variant) ? variant : undefined;
  const selectedReleaseVariant = selectedVariant && version ? rotation?.releases.flatMap((release) => release.variants.map((item) => ({ release, item }))).find(({ release, item }) => release.datasetVersion === version && item.variant === selectedVariant && item.status === "published") : undefined;
  const selectedCurrent = selectedVariant && version && currentByVariant.get(selectedVariant)?.datasetVersion === version ? currentByVariant.get(selectedVariant) : selectedReleaseVariant ? { variant: selectedReleaseVariant.item.variant, datasetVersion: selectedReleaseVariant.release.datasetVersion, testCount: selectedReleaseVariant.item.testCount, storageStatus: selectedReleaseVariant.item.storageStatus } : undefined;
  const selectedTrain = selectedVariant ? trainByVariant.get(selectedVariant) : undefined;
  const selectedDownloadState = selectedReleaseVariant
    ? datasetTestDownloadState(selectedReleaseVariant.item.storageStatus, selectedReleaseVariant.item.isCurrent)
    : selectedCurrent
      ? datasetTestDownloadState(selectedCurrent.storageStatus, true)
      : "unavailable";
  const canDownloadTest = selectedDownloadState !== "unavailable";
  const testDownloadLabel = selectedDownloadState === "available" ? "固定 test 可用" : selectedDownloadState === "download_checked" ? "下载时校验" : "该类型版本不可下载";

  return <div className="v2-dataset-workspace">
    <section className="v2-version-context panel" aria-label="当前数据集版本">
      <div className="section-head"><div><p className="eyebrow">Current published versions</p><h2 className="section-title">当前数据集版本</h2><p className="section-caption">每种资料类型独立维护版本。</p></div>{rotationError ? v2Status("error", "读取失败") : v2Status(rotationLoading ? "loading" : "available", rotationLoading ? "读取中" : "已读取")}</div>
      {rotationError && <p className="v2-inline-note">{rotationError}。当前版本无法确认时，暂不提供下载。</p>}
      {!rotationError && !rotationLoading && <>
        <div className="v2-current-version-grid">
          {ROTATION_VARIANTS.map((currentVariant) => <CurrentVersionCard key={currentVariant} variant={currentVariant} current={currentByVariant.get(currentVariant)} train={trainByVariant.get(currentVariant)} selected={selectedVariant === currentVariant && version === currentByVariant.get(currentVariant)?.datasetVersion} onSelect={() => {
            const current = currentByVariant.get(currentVariant);
            if (!current) return;
            setVersion(current.datasetVersion);
            setVariant(currentVariant);
          }} />)}
        </div>
        {rotation?.currentVersions.length === 0 && <p className="v2-inline-note">当前没有已发布的可用版本；轮换历史仍可在下方查看。</p>}
      </>}
    </section>

    <section className="section panel panel-pad v2-dataset-selector" aria-label="选择数据集版本">
      <div className="section-head"><div><h2 className="section-title">选择资料类型 → 版本</h2><p className="section-caption">版本仅展示所选资料类型的已发布记录。</p></div>{version && selectedVariant ? v2Status("available", "已选择") : v2Status("unknown", "请选择范围")}</div>
      <div className="v2-dataset-selector-grid">
        <label><span>资料类型</span><select className="select" aria-label="资料类型" value={variant} onChange={(event) => { setVariant(event.target.value); setVersion(""); }}><option value="">请选择资料类型</option>{ROTATION_VARIANTS.map((item) => <option key={item} value={item}>{variantLabels[item]}</option>)}</select></label>
        <label><span>该类型已发布版本</span><select className="select" aria-label="该类型已发布版本" value={version} disabled={!selectedVariant} onChange={(event) => setVersion(event.target.value)}><option value="">{selectedVariant ? "请选择版本" : "请先选择资料类型"}</option>{selectedVariant && Array.from(new Set((rotation?.releases ?? []).flatMap((release) => release.variants.some((item) => item.variant === selectedVariant && item.status === "published") ? [release.datasetVersion] : []))).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      {version && selectedVariant && <p className="v2-inline-note">当前范围：{version} / {variantLabels[selectedVariant]} · {selectedTrain ? `累计 train ${formatV2Number(selectedTrain.count, 0)} 个` : "该资料类型暂无累计 train 记录"} · 固定 test {selectedCurrent ? `${formatV2Number(selectedCurrent.testCount, 0)} 个` : "当前版本未提供"}。</p>}
    </section>

    {version && selectedVariant && <DatasetDownloadPanel version={version} variant={selectedVariant} current={selectedCurrent} train={selectedTrain} canDownloadTest={canDownloadTest} testDownloadLabel={testDownloadLabel} />}

    <details className="v2-dataset-rotation-embedded" open>
      <summary>轮换执行、发布历史与规则</summary>
      <p className="v2-inline-note">这里展示版本发布、文件核对和执行状态，与上面的当前版本选择保持同一资料范围。</p>
      <DatasetRotationPage embedded focusVersion={version || undefined} showCurrentButton={false} refreshKey={refreshKey} />
    </details>
  </div>;
}

function CurrentVersionCard({ variant, current, train, selected, onSelect }: { variant: RotationVariant; current?: DatasetRotationCurrentVersion; train?: { count: number }; selected: boolean; onSelect: () => void }) {
  if (!current) return <div className="v2-current-version-card unavailable"><span className="v2-current-version-label">{variantLabels[variant]}</span><strong>暂无当前版本</strong><small>当前版本信息中没有可用记录</small><span className="v2-current-version-state">不可选择</span></div>;
  const verified = current.storageStatus === "verified";
  return <div className={`v2-current-version-card ${selected ? "selected" : ""}`}>
    <span className="v2-current-version-label">{variantLabels[variant]}</span><strong>{current.datasetVersion}</strong><small>固定 test：{formatV2Number(current.testCount, 0)} 个 · 累计 train：{formatV2Number(train?.count, 0)} 个</small><small>{current.windowStart} → {current.windowEnd}</small><span className={`v2-current-version-state ${verified ? "verified" : "warning"}`}>{verified ? "清单已核对" : current.storageStatus === "not_checked" ? "尚未核对" : "暂不可下载"}</span><button className="button" type="button" onClick={onSelect}>{selected ? "已选择" : "选择此版本"}</button>
  </div>;
}

function DatasetDownloadPanel({ version, variant, current, train, canDownloadTest, testDownloadLabel }: { version: string; variant: RotationVariant; current?: { testCount: number; datasetVersion: string }; train?: { count: number }; canDownloadTest: boolean; testDownloadLabel: string }) {
  const encodedVariant = encodeURIComponent(variant);
  const encodedVersion = encodeURIComponent(version);
  const trainState = datasetTrainDownloadState(train?.count);
  return <section className="section panel panel-pad v2-version-downloads"><div className="section-head"><div><h2 className="section-title">数据集下载</h2><p className="section-caption">{version} / {variantLabels[variant]} 的数据集文件。固定 test 绑定真实版本；累计 train 按资料类型跨已发布批次合并去重。</p></div>{v2Status(canDownloadTest ? "available" : "unknown", testDownloadLabel)}</div><div className="v2-download-actions"><strong>{version} · {variantLabels[variant]}</strong>{canDownloadTest ? <a className="button" href={`/api/console/downloads/testsets/${encodedVersion}?variant=${encodedVariant}`} target="_blank" rel="noreferrer">下载固定 test（{formatV2Number(current?.testCount, 0)}）</a> : <span className="v2-inline-note">该类型版本当前不可生成固定 test 下载。</span>}{trainState === "available" ? <a className="button" href={`/api/console/downloads/trainsets?variant=${encodedVariant}`} target="_blank" rel="noreferrer">下载累计 train（{formatV2Number(train?.count, 0)}）</a> : trainState === "empty" ? <span className="v2-inline-note">无累计训练数据，当前不生成 train 下载。</span> : <span className="v2-inline-note">累计训练数量未知，当前不生成 train 下载。</span>}<small>{testDownloadLabel === "下载时校验" ? "历史清单尚未核对，下载时由服务端执行严格文件预检。" : "累计 train 按资料类型跨已发布批次合并去重。"}</small></div></section>;
}

const sandboxSources = ["POLYMARKET", "KALSHI", "GENERATED_QA"] as const;
const sourceLabels: Record<string, string> = { POLYMARKET: "Polymarket", KALSHI: "Kalshi", GENERATED_QA: "Generated QA" };

function AssetCatalog() {
  const [source, setSource] = useV2Filter("source");
  const [selectedMarketId, setSelectedMarketId] = useV2Filter("selected_market_id");
  const selectedSource = sandboxSources.includes(source as typeof sandboxSources[number]) ? source : "";
  useEffect(() => {
    const url = new URL(window.location.href);
    const staleSource = url.searchParams.get("source");
    if (!url.searchParams.has("kind") && (!staleSource || sandboxSources.includes(staleSource as typeof sandboxSources[number]))) return;
    url.searchParams.delete("kind");
    if (staleSource && !sandboxSources.includes(staleSource as typeof sandboxSources[number])) url.searchParams.delete("source");
    url.searchParams.delete("offset");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event("v2-workspace-url-change"));
  }, []);
  const params = useMemo(() => ({ source: selectedSource || undefined, sources: selectedSource ? undefined : sandboxSources.join(","), selected_market_id: selectedMarketId || undefined }), [selectedSource, selectedMarketId]);
  const controls = <><select className="select" aria-label="资料来源" value={selectedSource} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option>{sandboxSources.map((value) => <option key={value} value={value}>{sourceLabels[value]}</option>)}</select><input className="input" aria-label="Selected market ID" inputMode="numeric" placeholder="Selected market ID" value={selectedMarketId} onChange={(event) => setSelectedMarketId(event.target.value.trim())} /></>;
  return <V2ListPage<ConsoleV2Asset> title="Sandbox" load={consoleV2.infra.assets} params={params} controls={controls} rowKey={(item) => `${item.assetKind}:${item.sandboxId ?? item.jobId ?? item.generatedQaId ?? item.marketId ?? "unknown"}`} searchPlaceholder="搜索 Sandbox、市场、QA 或问题" columns={[
    { label: "来源", render: (item) => sourceLabels[item.marketSource ?? ""] ?? v2Unknown(item.marketSource) },
    { label: "Sandbox ID", className: "primary mono", render: (item) => v2Unknown(item.sandboxId) },
    { label: "问题", className: "wide", render: (item) => v2Unknown(item.question) },
    { label: "登记状态", render: (item) => v2Status(item.committedAt ? "committed" : "pending", item.committedAt ? "已登记" : "未提交") },
    { label: "大小 / 提交时间", render: (item) => <div className="v2-cell-copy"><span>{formatV2Bytes(item.archiveSizeBytes)}</span><small>{formatV2Time(item.committedAt)}</small></div> },
  ]} renderDetail={(item) => <AssetDetail item={item} />} emptyDescription="没有符合条件的 Sandbox。" />;
}

function AssetDetail({ item }: { item: ConsoleV2Asset }) {
  return <><V2Facts values={[
    { label: "来源", value: sourceLabels[item.marketSource ?? ""] ?? v2Unknown(item.marketSource) },
    { label: "Sandbox ID", value: v2Unknown(item.sandboxId), mono: true },
    { label: "任务 ID", value: v2Unknown(item.jobId), mono: true },
    ...(item.generatedQaId ? [{ label: "QA ID", value: String(item.generatedQaId), mono: true }] : [{ label: "市场 ID", value: v2Unknown(item.marketId), mono: true }]),
    { label: "信息时点", value: formatV2Time(item.informationCutoffAt) },
    { label: "构建时间", value: formatV2Time(item.builtAt) },
  ]} /><AssetDownloadActions key={item.sandboxId ?? "unknown"} item={item} /></>;
}

function AssetDownloadActions({ item }: { item: ConsoleV2Asset }) {
  const [options, setOptions] = useState<SandboxArchiveOptions>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [variant, setVariant] = useState("original");
  useEffect(() => {
    if (!item.sandboxId) return;
    const controller = new AbortController();
    void sandboxArchiveOptions(item.sandboxId, controller.signal).then((result) => { if (!controller.signal.aborted) setOptions(result); }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法核对下载状态");
    });
    return () => controller.abort();
  }, [item.sandboxId, retry]);
  if (!item.sandboxId) return <p className="v2-inline-note">该记录没有 Sandbox ID，无法下载。</p>;
  const qa = item.assetKind === "GENERATED_QA";
  const visible = (options?.variants ?? []).filter((option) => !qa || option.variant === "original");
  const current = visible.find((option) => option.variant === variant);
  const href = `/api/console/downloads/sandboxes/${encodeURIComponent(item.sandboxId)}/archive?variant=${encodeURIComponent(variant)}&asset_kind=${encodeURIComponent(item.assetKind)}`;
  return <section className="v2-download-actions"><strong>下载文件</strong>{error ? <><p className="v2-inline-note">{error}</p><button type="button" className="button" onClick={() => { setError(undefined); setOptions(undefined); setRetry((value) => value + 1); }}>重新核对</button></> : !options ? <p className="v2-inline-note">正在核对可下载文件…</p> : <><label><span>文件版本</span><select className="select" value={variant} onChange={(event) => setVariant(event.target.value)}>{visible.map((option) => <option key={option.variant} value={option.variant}>{option.variant}</option>)}</select></label>{current?.status === "available" ? <a className="button" href={href} target="_blank" rel="noreferrer">下载 {variant}</a> : <span className="v2-inline-note">{current ? archiveOptionLabel(current) : "无法核对此文件版本"}</span>}{visible.filter((option) => option.variant !== variant && option.status !== "available").map((option) => <small key={option.variant}>{archiveOptionLabel(option)}</small>)}</>}</section>;
}

function BacktestProducts() {
  return <><V2ListPage<ConsoleV2BacktestProduct> title="历史回测导出" description="Legacy export 只代表旧交付目录，不代表回测平台的研究实验或可运行数据集。" load={consoleV2.infra.backtestProducts} rowKey={(item) => `${item.productKind}:${item.version}`} searchPlaceholder="搜索产品类型、版本或状态" columns={[
    { label: "产品 / 版本", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{item.productKind}</strong><small>{item.version}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "窗口", render: (item) => `${formatV2Time(item.windowStart)} → ${formatV2Time(item.windowEnd)}` },
    { label: "记录数", render: (item) => formatV2Number(item.count, 0) },
    { label: "发布时间", render: (item) => formatV2Time(item.publishedAt) },
  ]} emptyDescription="暂无真实 legacy 发布目录记录；页面不恢复旧创建表单，也不把训练/测试成员冒充回测 parquet。" /><div className="v2-capability-note"><strong>外部目录能力：</strong> PM Backtest 与回测平台保持独立，输入/实验/结果不在这张历史导出表中合并。</div></>;
}

function isRotationVariant(value: string | undefined): value is RotationVariant {
  return Boolean(value && (ROTATION_VARIANTS as readonly string[]).includes(value));
}
