"use client";

import { useEffect, useMemo, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { consoleV2, type ConsoleV2Asset, type ConsoleV2BacktestProduct, type ConsoleV2DatasetMember } from "../lib/console-v2";
import { datasetTestDownloadState, ROTATION_VARIANTS, type DatasetRotationCurrentVersion, type DatasetRotationData, type RotationVariant } from "../lib/dataset-rotation";
import { formatV2Bytes, formatV2Number, formatV2Time, V2ContextLinks, V2Facts, V2Frame, V2ListPage, useV2Filter, v2Bool, v2Status, v2Unknown } from "./console-v2-resource";
import { DatasetRotationPage } from "./dataset-rotation-page";

const variantLabels: Record<RotationVariant, string> = { original: "original", mv: "MV", ms: "MS", syn: "Syn" };
const DOWNLOAD_VARIANTS = new Set<string>(ROTATION_VARIANTS);

export function AssetsV2Page({ view = "assets" }: { view?: "assets" | "datasets" | "backtests" }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const config = view === "backtests"
    ? { eyebrow: "Assets / Legacy Export", title: "历史回测导出", description: "这是历史数据交付目录；新回测平台在独立工作区运行，旧导出不会覆盖当前数据集与成员。" }
    : view === "datasets"
      ? { eyebrow: "Dataset / Rotation", title: "数据集轮转", description: "先选择资料类型，再选择该类型的已发布版本和用途；固定测试、累计训练与轮换历史保持同一数据集语义。" }
      : { eyebrow: "Assets / Archive", title: "资料归档", description: "按来源、用途和稳定身份查找归档事实；目录提交、成员就绪和交易资格分别显示。" };
  const contextLinks = view === "backtests"
    ? [{ href: "/backtest-platform", label: "打开回测平台" }, { href: "/datasets", label: "返回数据集轮转" }]
    : view === "assets"
      ? [{ href: "/backtests", label: "历史回测导出" }, { href: "http://172.21.20.221:8501/", label: "打开 PM Backtest", external: true }]
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
  const [purpose, setPurpose] = useV2Filter("purpose");

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
      <div className="section-head"><div><p className="eyebrow">Current published versions</p><h2 className="section-title">当前数据集版本</h2><p className="section-caption">每种资料类型独立维护版本；成员状态和下载状态分别查看。</p></div>{rotationError ? v2Status("error", "读取失败") : v2Status(rotationLoading ? "loading" : "available", rotationLoading ? "读取中" : "已读取")}</div>
      {rotationError && <p className="v2-inline-note">{rotationError}。当前版本无法确认时，暂不生成下载或默认成员范围。</p>}
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

    <section className="section panel panel-pad v2-dataset-selector" aria-label="数据集成员查询上下文">
      <div className="section-head"><div><h2 className="section-title">选择资料类型 → 版本 → 用途</h2><p className="section-caption">先选择资料类型，再选择该类型真实已发布版本和用途。</p></div>{version && selectedVariant && purpose ? v2Status("available", "查询已限定") : v2Status("unknown", "请选择范围")}</div>
      <div className="v2-dataset-selector-grid">
        <label><span>资料类型</span><select className="select" aria-label="资料类型" value={variant} onChange={(event) => { setVariant(event.target.value); setVersion(""); }}><option value="">请选择资料类型</option>{ROTATION_VARIANTS.map((item) => <option key={item} value={item}>{variantLabels[item]}</option>)}</select></label>
        <label><span>该类型已发布版本</span><select className="select" aria-label="该类型已发布版本" value={version} disabled={!selectedVariant} onChange={(event) => setVersion(event.target.value)}><option value="">{selectedVariant ? "请选择版本" : "请先选择资料类型"}</option>{selectedVariant && Array.from(new Set((rotation?.releases ?? []).flatMap((release) => release.variants.some((item) => item.variant === selectedVariant && item.status === "published") ? [release.datasetVersion] : []))).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label><span>成员用途</span><select className="select" aria-label="成员用途" value={purpose} onChange={(event) => setPurpose(event.target.value)}><option value="">请选择用途</option><option value="test">test · 固定窗口</option><option value="train">train · 累计增量</option></select></label>
      </div>
      {version && selectedVariant && <p className="v2-inline-note">当前范围：{version} / {variantLabels[selectedVariant]} · {selectedTrain ? `累计 train ${formatV2Number(selectedTrain.count, 0)} 个` : "该资料类型暂无累计 train 记录"} · 固定 test {selectedCurrent ? `${formatV2Number(selectedCurrent.testCount, 0)} 个` : "当前版本未提供"}。</p>}
    </section>

    {version && selectedVariant && <DatasetDownloadPanel version={version} variant={selectedVariant} current={selectedCurrent} train={selectedTrain} canDownloadTest={canDownloadTest} testDownloadLabel={testDownloadLabel} />}
    <DatasetMembers version={version || undefined} variant={selectedVariant} purpose={purpose || undefined} canDownloadTest={canDownloadTest} testDownloadLabel={testDownloadLabel} />

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
  return <section className="section panel panel-pad v2-version-downloads"><div className="section-head"><div><h2 className="section-title">数据集下载</h2><p className="section-caption">{version} / {variantLabels[variant]} 的数据集文件。固定 test 绑定真实版本；累计 train 按资料类型跨已发布批次合并去重。</p></div>{v2Status(canDownloadTest ? "available" : "unknown", testDownloadLabel)}</div><div className="v2-download-actions"><strong>{version} · {variantLabels[variant]}</strong>{canDownloadTest ? <a className="button" href={`/api/console/downloads/testsets/${encodedVersion}?variant=${encodedVariant}`} target="_blank" rel="noreferrer" download>下载固定 test（{formatV2Number(current?.testCount, 0)}）</a> : <span className="v2-inline-note">该类型版本当前不可生成固定 test 下载。</span>}{train ? <a className="button" href={`/api/console/downloads/trainsets?variant=${encodedVariant}`} target="_blank" rel="noreferrer" download>下载累计 train（{formatV2Number(train.count, 0)}）</a> : <span className="v2-inline-note">该资料类型没有累计 train 记录。</span>}<small>{testDownloadLabel === "下载时校验" ? "历史清单尚未核对，下载时由服务端执行严格文件预检。" : "累计 train 不是单个成员文件；如需查看成员，先选择用途后按需打开。"}</small></div></section>;
}

function AssetCatalog() {
  const [kind, setKind] = useV2Filter("kind");
  const [source, setSource] = useV2Filter("source");
  const [selectedMarketId, setSelectedMarketId] = useV2Filter("selected_market_id");
  const params = useMemo(() => ({ kind: kind || undefined, source: source || undefined, selected_market_id: selectedMarketId || undefined }), [kind, source, selectedMarketId]);
  const controls = <><select className="select" aria-label="资料类型" value={kind} onChange={(event) => setKind(event.target.value)}><option value="">全部资料类型</option><option value="MARKET">MARKET</option><option value="GENERATED_MARKET">GENERATED_MARKET</option><option value="GENERATED_QA">GENERATED_QA</option></select><select className="select" aria-label="资料来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option><option value="GENERATED">Generated Market</option><option value="GENERATED_QA">Generated QA</option></select><input className="input" aria-label="Selected market ID" inputMode="numeric" placeholder="Selected market ID" value={selectedMarketId} onChange={(event) => setSelectedMarketId(event.target.value.trim())} /></>;
  return <><V2ListPage<ConsoleV2Asset> title="资料目录" load={consoleV2.infra.assets} params={params} controls={controls} rowKey={(item) => `${item.assetKind}:${item.sandboxId ?? item.jobId ?? item.generatedQaId ?? item.marketId ?? "unknown"}`} searchPlaceholder="搜索 sandbox、job、market、QA 或问题" columns={[
    { label: "类型 / 来源", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{item.assetKind}</strong><small>{v2Unknown(item.marketSource)}</small></div> },
    { label: "身份", className: "mono", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.sandboxId ?? item.jobId ?? item.generatedQaId)}</span><small>{v2Unknown(item.selectedMarketId ?? item.marketId ?? item.sourceQaId)}</small></div> },
    { label: "问题", className: "wide", render: (item) => v2Unknown(item.question) },
    { label: "资料状态", render: (item) => v2Status(item.committedAt ? "committed" : "pending", item.committedAt ? "已提交目录" : "未提交") },
    { label: "模式 / 交易", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.mode)}</span><small>{assetTradeLabel(item)}</small></div> },
    { label: "大小 / 提交时间", render: (item) => <div className="v2-cell-copy"><span>{formatV2Bytes(item.archiveSizeBytes)}</span><small>{formatV2Time(item.committedAt)}</small></div> },
  ]} renderDetail={(item) => <AssetDetail item={item} />} emptyDescription="没有符合条件的资料目录记录；页面不会按表名推断缺失的 Kalshi 或 QA 来源。" /><AdvancedSandboxDownloadTools /></>;
}

function AssetDetail({ item }: { item: ConsoleV2Asset }) {
  const qa = item.assetKind === "GENERATED_QA";
  const values = qa
    ? [{ label: "资料类型", value: item.assetKind }, { label: "资料来源", value: v2Unknown(item.marketSource) }, { label: "Sandbox ID", value: v2Unknown(item.sandboxId), mono: true }, { label: "任务 ID", value: v2Unknown(item.jobId), mono: true }, { label: "题目", value: v2Unknown(item.question) }, { label: "QA ID", value: v2Unknown(item.generatedQaId), mono: true }, { label: "来源题目 ID", value: v2Unknown(item.sourceQaId), mono: true }, { label: "QA 版本", value: formatV2Number(item.qaVersion, 0) }, { label: "资料状态", value: item.committedAt ? "已提交目录" : "未提交" }, { label: "提交时间", value: formatV2Time(item.committedAt) }]
    : [{ label: "资料类型", value: item.assetKind }, { label: "市场来源", value: v2Unknown(item.marketSource) }, { label: "Sandbox ID", value: v2Unknown(item.sandboxId), mono: true }, { label: "任务 ID", value: v2Unknown(item.jobId), mono: true }, { label: "题目", value: v2Unknown(item.question) }, { label: "Selected market ID", value: v2Unknown(item.selectedMarketId), mono: true }, { label: "市场 ID", value: v2Unknown(item.marketId), mono: true }, { label: "条件 ID", value: v2Unknown(item.conditionId), mono: true }, { label: "交易语义", value: assetTradeLabel(item) }, { label: "决策时间", value: formatV2Time(item.decisionAt) }, { label: "信息截止", value: formatV2Time(item.informationCutoffAt) }, { label: "提交时间", value: formatV2Time(item.committedAt) }];
  return <><V2Facts values={values} /><AssetDownloadActions item={item} /><p className="v2-inline-note">{qa ? "Generated QA 只展示题目与 QA 字段，交易语义不适用。" : "Market 资料展示市场身份、问题和交易适用性；数据集成员身份在数据集轮转中单独核对。"}</p></>;
}

function AssetDownloadActions({ item }: { item: ConsoleV2Asset }) {
  const [variant, setVariant] = useState("original");
  if (!item.sandboxId) return <p className="v2-inline-note">该目录行没有可下载的稳定 Sandbox ID，无法生成下载请求。</p>;
  const qa = item.assetKind === "GENERATED_QA";
  const href = `/api/console/downloads/sandboxes/${encodeURIComponent(item.sandboxId)}/archive?variant=${encodeURIComponent(variant)}&asset_kind=${encodeURIComponent(item.assetKind)}`;
  return <div className="v2-download-actions"><strong>单个归档下载</strong><label><span>资料变体</span><select className="select" value={variant} onChange={(event) => setVariant(event.target.value)}><option value="original">original</option>{!qa && <option value="masked">masked</option>}</select></label><a className="button" href={href} target="_blank" rel="noreferrer" download>下载归档</a><small>{qa ? "Generated QA 只允许 original，交易字段为不适用。" : "Market / Generated Market 可选择 original 或 masked；下载前仍由 BFF 校验来源权限。"}</small></div>;
}

function assetTradeLabel(item: ConsoleV2Asset) {
  return item.assetKind === "GENERATED_QA" ? "不适用" : v2Bool(item.tradeEnabled, "可交易", "仅资料");
}

function DatasetMembers({ version, variant, purpose, canDownloadTest, testDownloadLabel }: { version?: string; variant?: string; purpose?: string; canDownloadTest: boolean; testDownloadLabel: string }) {
  const [sourceNamespace, setSourceNamespace] = useV2Filter("source_namespace");
  const [externalDirectoryId, setExternalDirectoryId] = useV2Filter("external_directory_id");
  const [status, setStatus] = useV2Filter("member_status");
  const selectedVariant = isRotationVariant(variant) ? variant : undefined;
  const params = useMemo(() => ({ version: version || undefined, variant: selectedVariant || undefined, purpose: purpose || undefined, source_namespace: sourceNamespace || undefined, external_directory_id: externalDirectoryId || undefined, status: status || undefined }), [version, selectedVariant, purpose, sourceNamespace, externalDirectoryId, status]);
  const controls = <><span className="v2-filter-context">{version} / {selectedVariant ? variantLabels[selectedVariant] : "—"} / {purpose || "—"}</span><select className="select" aria-label="成员状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部成员状态</option><option value="READY">READY · 制品已绑定</option><option value="PENDING">PENDING · 等待处理</option><option value="FAILED">FAILED · 处理失败</option></select><input className="input" aria-label="来源命名空间" placeholder="来源命名空间" value={sourceNamespace} onChange={(event) => setSourceNamespace(event.target.value)} /><input className="input" aria-label="外部目录 ID" placeholder="外部目录 ID" value={externalDirectoryId} onChange={(event) => setExternalDirectoryId(event.target.value)} /></>;
  if (!version || !selectedVariant || !purpose) return <section className="section panel panel-pad v2-members-placeholder"><h2 className="section-title">数据集成员</h2><p className="section-caption">选择已发布版本、资料类型和用途后，这里才查询对应成员；不会默认混合全部版本。</p></section>;
  return <V2ListPage<ConsoleV2DatasetMember> title="数据集成员" description={`${version} / ${variantLabels[selectedVariant]} / ${purpose} · 成员状态与版本发布状态分开显示。`} load={consoleV2.infra.datasetMembers} params={params} controls={controls} rowKey={(item) => item.memberId} searchPlaceholder="搜索成员、来源目录或清洗记录" columns={[
    { label: "成员 / 版本", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{item.memberId}</strong><small>{item.datasetVersion} · {isRotationVariant(item.variant) ? variantLabels[item.variant] : item.variant}</small></div> },
    { label: "用途", render: (item) => <span className="domain">{item.purpose}</span> },
    { label: "来源命名空间", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.sourceNamespace)}</span><small className="mono">{v2Unknown(item.externalDirectoryId)}</small></div> },
    { label: "成员状态", render: (item) => v2Status(item.status, memberStatusLabel(item.status)) },
    { label: "决策时间", render: (item) => formatV2Time(item.decisionAt) },
    { label: "更新时间", render: (item) => formatV2Time(item.updatedAt) },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "成员 ID", value: item.memberId, mono: true }, { label: "数据集版本", value: item.datasetVersion }, { label: "资料变体", value: isRotationVariant(item.variant) ? variantLabels[item.variant] : item.variant }, { label: "用途", value: item.purpose }, { label: "成员状态", value: memberStatusLabel(item.status) }, { label: "来源命名空间", value: v2Unknown(item.sourceNamespace) }, { label: "外部目录 ID", value: v2Unknown(item.externalDirectoryId), mono: true }, { label: "来源版本", value: v2Unknown(item.sourceVersion) }, { label: "清洗记录", value: v2Unknown(item.cleaningRecordId), mono: true }, { label: "决策时间", value: formatV2Time(item.decisionAt) }, { label: "SHA256", value: v2Unknown(item.artifactSha256), mono: true }]} /><DatasetDownloadActions item={item} canDownloadTest={canDownloadTest} testDownloadLabel={testDownloadLabel} /></>} />;
}

function DatasetDownloadActions({ item, canDownloadTest, testDownloadLabel }: { item: ConsoleV2DatasetMember; canDownloadTest: boolean; testDownloadLabel: string }) {
  if (!DOWNLOAD_VARIANTS.has(item.variant)) return <p className="v2-inline-note">该成员资料变体不在下载范围内，暂不生成下载入口。</p>;
  if (item.purpose === "test") return canDownloadTest ? <div className="v2-download-actions"><strong>固定测试集</strong><a className="button" href={`/api/console/downloads/testsets/${encodeURIComponent(item.datasetVersion)}?variant=${encodeURIComponent(item.variant)}`} target="_blank" rel="noreferrer" download>下载 test</a><small>{testDownloadLabel === "下载时校验" ? "历史清单尚未核对，下载时由服务端执行严格文件预检。" : "下载绑定真实 published 版本与 variant，服务端执行文件预检。"}</small></div> : <p className="v2-inline-note">该成员不属于可下载的 published 版本。</p>;
  if (item.purpose === "train") return <p className="v2-inline-note">累计 train 是按资料类型的页面级集合，请使用上方版本级下载；此处只展示成员来源与制品事实。</p>;
  return <p className="v2-inline-note">成员用途为 {item.purpose}，当前只为 test 与 train 提供下载语义。</p>;
}

function AdvancedSandboxDownloadTools() {
  return <details className="section panel panel-pad v2-download-tools"><summary>高级归档工具（批量 ID / 冻结时间范围）</summary><p className="v2-inline-note">这些动作用于审计或复现，不参与当前版本选择。系统会按来源和资料类型再次校验；Generated QA 只允许 original，不作为交易资料。</p><div className="v2-download-tool-grid"><form className="v2-download-form" method="post" action="/api/console/downloads/sandboxes/archives:batch" target="_blank"><h3>按 ID 批量</h3><label><span>Sandbox IDs（每行或逗号分隔，最多 20 个）</span><textarea className="input" name="sandbox_ids" rows={3} required placeholder="pm-001\npm-002" /></label><label><span>归档来源</span><select className="select" name="asset_kind" defaultValue="MARKET"><option value="MARKET">MARKET / GENERATED_MARKET</option><option value="GENERATED_QA">GENERATED_QA（仅 original）</option></select></label><label><span>资料类型</span><select className="select" name="variant" defaultValue="original"><option value="original">original</option><option value="masked">masked（QA 不支持）</option></select></label><button className="button primary" type="submit">下载所选 Sandbox</button></form><form className="v2-download-form" method="post" action="/api/console/downloads/sandboxes/archives:range" target="_blank"><h3>按冻结时间范围（市场归档）</h3><label><span>冻结时间起（RFC3339 UTC）</span><input className="input" name="frozen_at_start" required placeholder="2026-09-01T00:00:00Z" pattern="^\\d{4}-\\d{2}-\\d{2}T.*(Z|[+-]\\d{2}:\\d{2})$" /></label><label><span>冻结时间止（RFC3339 UTC，不含）</span><input className="input" name="frozen_at_end" required placeholder="2026-09-02T00:00:00Z" pattern="^\\d{4}-\\d{2}-\\d{2}T.*(Z|[+-]\\d{2}:\\d{2})$" /></label><label><span>资料类型 / 来源</span><span className="v2-download-inline"><select className="select" name="variant" defaultValue="original"><option value="original">original</option><option value="masked">masked</option></select><select className="select" name="market_source" defaultValue=""><option value="">全部来源</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option></select></span></label><button className="button primary" type="submit">下载范围归档</button></form></div><p className="v2-inline-note">范围结束时间不包含在内；失败后根据系统提示重试。范围接口只支持 Market 来源，不用于 Generated QA。</p></details>;
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

function memberStatusLabel(status: string) {
  return { READY: "READY · 制品已绑定", PENDING: "PENDING · 等待处理", FAILED: "FAILED · 处理失败", ready: "READY · 制品已绑定", pending: "PENDING · 等待处理", failed: "FAILED · 处理失败" }[status] ?? status;
}
