"use client";

import { useMemo, useState } from "react";
import { consoleV2, type ConsoleV2Asset, type ConsoleV2BacktestProduct, type ConsoleV2DatasetMember } from "../lib/console-v2";
import { formatV2Bytes, formatV2Number, formatV2Time, V2Facts, V2Frame, V2ListPage, V2Tabs, v2Bool, v2Status, v2Unknown } from "./console-v2-resource";

export function AssetsV2Page({ view = "assets" }: { view?: "assets" | "datasets" | "backtests" }) {
  const config = view === "datasets"
    ? { eyebrow: "Assets / Dataset Members", title: "数据集成员", description: "按版本、资料变体、用途和来源命名空间检索发布成员；训练集和测试集可能是同一版本的不同成员。" }
    : view === "backtests"
      ? { eyebrow: "Assets / Backtest Products", title: "回测数据产品", description: "展示真实发布目录中的产品摘要；外部 Telonex 目录没有协议时会明确显示能力缺失，不提供无效创建表单。" }
      : { eyebrow: "Assets / Catalog", title: "资料目录", description: "统一展示 PM / Kalshi 市场归档、Generated Market 与原生 QA 资料；目录状态不等同交易就绪。" };
  const tabs = [{ href: "/assets", label: "资料目录" }, { href: "/datasets", label: "数据集成员" }, { href: "/dataset-rotation", label: "数据集轮换" }, { href: "/backtests", label: "回测产品" }];
  return <V2Frame eyebrow={config.eyebrow} title={config.title} description={config.description}>
    <V2Tabs tabs={tabs} active={view === "assets" ? "/assets" : view === "datasets" ? "/datasets" : "/backtests"} />
    {view === "assets" && <AssetCatalog />}
    {view === "datasets" && <DatasetMembers />}
    {view === "backtests" && <BacktestProducts />}
  </V2Frame>;
}

function AssetCatalog() {
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("");
  const params = useMemo(() => ({ kind: kind || undefined, source: source || undefined }), [kind, source]);
  const controls = <><select className="select" aria-label="资料类型" value={kind} onChange={(event) => setKind(event.target.value)}><option value="">全部资料类型</option><option value="MARKET">MARKET</option><option value="GENERATED_MARKET">GENERATED_MARKET</option><option value="GENERATED_QA">GENERATED_QA</option></select><select className="select" aria-label="资料来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option><option value="GENERATED">Generated Market</option><option value="GENERATED_QA">Generated QA</option></select></>;
  return <><V2ListPage<ConsoleV2Asset> title="资料目录" load={consoleV2.infra.assets} params={params} controls={controls} rowKey={(item) => `${item.assetKind}:${item.sandboxId ?? item.jobId ?? item.generatedQaId ?? item.marketId ?? "unknown"}`} searchPlaceholder="搜索 sandbox、job、market、QA 或问题" columns={[
    { label: "类型 / 来源", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{item.assetKind}</strong><small>{v2Unknown(item.marketSource)}</small></div> },
    { label: "身份", className: "mono", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.sandboxId ?? item.jobId ?? item.generatedQaId)}</span><small>{v2Unknown(item.marketId ?? item.sourceQaId)}</small></div> },
    { label: "问题", className: "wide", render: (item) => v2Unknown(item.question) },
    { label: "资料状态", render: (item) => v2Status(item.committedAt ? "committed" : "pending", item.committedAt ? "已提交目录" : "未提交") },
    { label: "模式 / 交易", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.mode)}</span><small>{v2Bool(item.tradeEnabled, "可交易", "仅资料")}</small></div> },
    { label: "大小 / 提交时间", render: (item) => <div className="v2-cell-copy"><span>{formatV2Bytes(item.archiveSizeBytes)}</span><small>{formatV2Time(item.committedAt)}</small></div> },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "资料类型", value: item.assetKind }, { label: "市场来源", value: v2Unknown(item.marketSource) }, { label: "Sandbox ID", value: v2Unknown(item.sandboxId), mono: true }, { label: "任务 ID", value: v2Unknown(item.jobId), mono: true }, { label: "市场 ID", value: v2Unknown(item.marketId), mono: true }, { label: "条件 ID", value: v2Unknown(item.conditionId), mono: true }, { label: "Generated QA ID", value: v2Unknown(item.generatedQaId), mono: true }, { label: "QA 版本", value: formatV2Number(item.qaVersion, 0) }, { label: "决策时间", value: formatV2Time(item.decisionAt) }, { label: "信息截止", value: formatV2Time(item.informationCutoffAt) }]} /><AssetDownloadActions item={item} /><p className="v2-inline-note">目录提交只说明资料已进入目录；它不会自动推导预测资格、就绪状态或交易资格。</p></>} emptyDescription="没有符合条件的资料目录记录；页面不会按表名推断缺失的 Kalshi 或 QA 来源。" /><SandboxDownloadTools /></>;
}

const DOWNLOAD_VARIANTS = new Set(["original", "mv", "ms", "syn"]);

function AssetDownloadActions({ item }: { item: ConsoleV2Asset }) {
  const [variant, setVariant] = useState(item.assetKind === "GENERATED_QA" ? "original" : "original");
  if (!item.sandboxId) return <p className="v2-inline-note">该目录行没有可下载的稳定 Sandbox ID，无法生成下载请求。</p>;
  const qa = item.assetKind === "GENERATED_QA";
  const href = `/api/console/downloads/sandboxes/${encodeURIComponent(item.sandboxId)}/archive?variant=${encodeURIComponent(variant)}&asset_kind=${encodeURIComponent(item.assetKind)}`;
  return <div className="v2-download-actions"><strong>单个归档下载</strong><label><span>资料变体</span><select className="select" value={variant} onChange={(event) => setVariant(event.target.value)}><option value="original">original</option>{!qa && <option value="masked">masked</option>}</select></label><a className="button" href={href} target="_blank" rel="noreferrer" download>下载归档</a><small>{qa ? "Generated QA 只允许 original；点击后直接保存归档。" : "选择 original 或 masked 后点击下载。"}</small></div>;
}

function DatasetDownloadActions({ item }: { item: ConsoleV2DatasetMember }) {
  if (!DOWNLOAD_VARIANTS.has(item.variant)) return <p className="v2-inline-note">该成员资料变体不在下载范围内，暂不生成下载入口。</p>;
  const variant = encodeURIComponent(item.variant);
  const version = encodeURIComponent(item.datasetVersion);
  if (item.purpose === "test") return <div className="v2-download-actions"><strong>固定测试集</strong><a className="button" href={`/api/console/downloads/testsets/${version}?variant=${variant}`} target="_blank" rel="noreferrer" download>下载 test</a><small>按固定版本和资料变体下载。</small></div>;
  if (item.purpose === "train") return <div className="v2-download-actions"><strong>累计训练集</strong><a className="button" href={`/api/console/downloads/trainsets?variant=${variant}`} target="_blank" rel="noreferrer" download>下载累计 train</a><form className="v2-download-range" method="get" action="/api/console/downloads/trainsets" target="_blank"><input type="hidden" name="variant" value={item.variant} /><label><span>T0 起（RFC3339 UTC）</span><input className="input" name="start_time" placeholder="2026-09-01T00:00:00Z" pattern="^\\d{4}-\\d{2}-\\d{2}T.*(Z|[+-]\\d{2}:\\d{2})$" /></label><label><span>T0 止（RFC3339 UTC，不含）</span><input className="input" name="end_time" placeholder="2026-10-01T00:00:00Z" pattern="^\\d{4}-\\d{2}-\\d{2}T.*(Z|[+-]\\d{2}:\\d{2})$" /></label><button className="button" type="submit">按 T0 范围下载</button></form><small>范围使用左闭右开 [start, end)，时间必须带时区；浏览器不会把本地时区代入。</small></div>;
  return <p className="v2-inline-note">成员用途为 {item.purpose}，当前只为 test 与 train 提供固定下载语义。</p>;
}

function SandboxDownloadTools() {
  return <section className="section panel panel-pad v2-download-tools"><div className="section-head"><div><h2 className="section-title">Sandbox 归档下载</h2><p className="section-caption">选择少量归档或输入冻结时间范围后下载。</p></div></div><div className="v2-download-tool-grid"><form className="v2-download-form" method="post" action="/api/console/downloads/sandboxes/archives:batch" target="_blank"><h3>按 ID 批量</h3><label><span>Sandbox IDs（每行或逗号分隔，最多 20 个）</span><textarea className="input" name="sandbox_ids" rows={3} required placeholder="pm-001\npm-002" /></label><label><span>资料变体</span><select className="select" name="variant" defaultValue="original"><option value="original">original</option><option value="masked">masked</option></select></label><button className="button primary" type="submit">下载所选 Sandbox</button></form><form className="v2-download-form" method="post" action="/api/console/downloads/sandboxes/archives:range" target="_blank"><h3>按冻结时间范围</h3><label><span>冻结时间起（RFC3339 UTC）</span><input className="input" name="frozen_at_start" required placeholder="2026-09-01T00:00:00Z" pattern="^\\d{4}-\\d{2}-\\d{2}T.*(Z|[+-]\\d{2}:\\d{2})$" /></label><label><span>冻结时间止（RFC3339 UTC，不含）</span><input className="input" name="frozen_at_end" required placeholder="2026-09-02T00:00:00Z" pattern="^\\d{4}-\\d{2}-\\d{2}T.*(Z|[+-]\\d{2}:\\d{2})$" /></label><label><span>资料变体 / 来源</span><span className="v2-download-inline"><select className="select" name="variant" defaultValue="original"><option value="original">original</option><option value="masked">masked</option></select><select className="select" name="market_source" defaultValue=""><option value="">全部来源</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option></select></span></label><button className="button primary" type="submit">下载范围归档</button></form></div><p className="v2-inline-note">范围结束时间不包含在内；失败后可根据提示重试。</p></section>;
}

function DatasetMembers() {
  const [version, setVersion] = useState("");
  const [variant, setVariant] = useState("");
  const [purpose, setPurpose] = useState("");
  const params = useMemo(() => ({ version: version || undefined, variant: variant || undefined, purpose: purpose || undefined }), [version, variant, purpose]);
  const controls = <><input className="input" aria-label="数据集版本" placeholder="版本" value={version} onChange={(event) => setVersion(event.target.value)} /><select className="select" aria-label="资料变体" value={variant} onChange={(event) => setVariant(event.target.value)}><option value="">全部资料变体</option><option value="original">original</option><option value="mv">mv</option><option value="ms">ms</option><option value="syn">syn</option></select><select className="select" aria-label="成员用途" value={purpose} onChange={(event) => setPurpose(event.target.value)}><option value="">全部用途</option><option value="train">train</option><option value="test">test</option></select></>;
  return <V2ListPage<ConsoleV2DatasetMember> title="数据集成员" load={consoleV2.infra.datasetMembers} params={params} controls={controls} rowKey={(item) => item.memberId} searchPlaceholder="搜索版本、目录、来源或成员" columns={[
    { label: "版本 / 资料变体", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{item.datasetVersion}</strong><small>{item.variant}</small></div> },
    { label: "用途", render: (item) => <span className="domain">{item.purpose}</span> },
    { label: "来源命名空间", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.sourceNamespace)}</span><small className="mono">{v2Unknown(item.externalDirectoryId)}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "决策时间", render: (item) => formatV2Time(item.decisionAt) },
    { label: "更新时间", render: (item) => formatV2Time(item.updatedAt) },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "成员 ID", value: item.memberId, mono: true }, { label: "数据集版本", value: item.datasetVersion }, { label: "资料变体", value: item.variant }, { label: "用途", value: item.purpose }, { label: "来源命名空间", value: v2Unknown(item.sourceNamespace) }, { label: "外部目录 ID", value: v2Unknown(item.externalDirectoryId), mono: true }, { label: "来源版本", value: v2Unknown(item.sourceVersion) }, { label: "决策时间", value: formatV2Time(item.decisionAt) }, { label: "SHA256", value: v2Unknown(item.artifactSha256), mono: true }]} /><DatasetDownloadActions item={item} /></>} />;
}

function BacktestProducts() {
  return <><V2ListPage<ConsoleV2BacktestProduct> title="回测数据产品" load={consoleV2.infra.backtestProducts} rowKey={(item) => `${item.productKind}:${item.version}`} searchPlaceholder="搜索产品类型、版本或状态" columns={[
    { label: "产品 / 版本", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{item.productKind}</strong><small>{item.version}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "窗口", render: (item) => `${formatV2Time(item.windowStart)} → ${formatV2Time(item.windowEnd)}` },
    { label: "记录数", render: (item) => formatV2Number(item.count, 0) },
    { label: "发布时间", render: (item) => formatV2Time(item.publishedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "产品类型", value: item.productKind }, { label: "版本", value: item.version, mono: true }, { label: "状态", value: item.status }, { label: "窗口开始", value: formatV2Time(item.windowStart) }, { label: "窗口结束", value: formatV2Time(item.windowEnd) }, { label: "记录数", value: formatV2Number(item.count, 0) }]} />} emptyDescription="暂无真实发布目录记录；页面不恢复旧的创建表单，也不把训练/测试成员冒充回测 parquet。" /><div className="v2-capability-note"><strong>外部目录能力：</strong> Telonex 研究任务当前没有新版目录协议，状态与版本不会在这里伪造。PM Backtest 入口保留在资料与数据导航中。</div></>;
}
