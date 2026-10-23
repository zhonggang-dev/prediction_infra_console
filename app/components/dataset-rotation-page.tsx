"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { consoleApi } from "../lib/console-api";
import type {
  DatasetRotationCurrentVersion,
  DatasetRotationData,
  DatasetRotationExecution,
  DatasetRotationRelease,
  DatasetRotationTrainingSet,
  DatasetRotationVariant,
  RotationVariant,
} from "../lib/dataset-rotation";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";

type Detail =
  | { kind: "current" }
  | { kind: "cell"; datasetVersion: string; variant: RotationVariant; purpose: "train" | "test" }
  | { kind: "rules" }
  | { kind: "training" };

const variantLabels: Record<RotationVariant, string> = { mv: "MV", ms: "MS", original: "original", syn: "Syn" };
const variantDescriptions: Record<RotationVariant, string> = { mv: "masked 制品", ms: "逐页清洗", original: "原始归档", syn: "QA 合成题" };

/** 数据集轮转页面只消费后端安全 DTO，不提供演示数据回落。 */
export function DatasetRotationPage({ embedded = false, focusVersion, showCurrentButton = true }: { embedded?: boolean; focusVersion?: string; showCurrentButton?: boolean } = {}) {
  const [data, setData] = useState<DatasetRotationData>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<Detail>();

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const result = await consoleApi.datasetRotation();
      setData(result.data);
      setError(undefined);
    } catch (requestError) {
      setData(undefined);
      setDetail(undefined);
      setError(requestError instanceof Error ? requestError.message : "数据集轮转接口不可用");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initial = window.setTimeout(() => {
      if (!cancelled) void load(true);
    }, 0);
    const timer = window.setInterval(() => {
      if (!cancelled) void load();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const openDetail = (next: Detail) => setDetail((current) => sameDetail(current, next) ? undefined : next);

  const content = <>
    {!embedded && <header className="page-head rotation-page-head">
      <div>
        <p className="eyebrow">Dataset Rotation</p>
        <h1>数据集轮转</h1>
        <p className="description">查看可用版本，跟踪自动轮换。</p>
      </div>
      <div className="rotation-head-actions">
        <button className="button" onClick={() => void load()} disabled={loading || refreshing}><Icon name="refresh" />{refreshing ? "刷新中" : "刷新数据"}</button>
      </div>
    </header>}

    {error && <div className="notice error rotation-error"><div><strong>无法读取数据集轮转</strong><p>{error}</p></div><button className="button" onClick={() => void load()} disabled={refreshing}>重试</button></div>}
    {loading && !data && <RotationSkeleton />}
    {data && <>
      <div className="rotation-rulebar" aria-label="轮换计划摘要">
        <span><strong>{data.enabled ? "自动轮换已开启" : "自动轮换已关闭"}</strong></span>
        <span>{nextRotationText(data)}</span>
        <span>更新时间：{formatDateTime(data.observedAt, data.timezone)}</span>
        {focusVersion && <span>当前选择版本：{focusVersion}</span>}
      </div>

      <section className="section rotation-section" aria-label="发布周期记录">
        <div className="section-head rotation-section-head">
          <div><h2 className="section-title">发布周期记录</h2><p className="section-caption">一行一个版本 · 发布日为该版本首次发布日</p></div>
          {showCurrentButton && <button className={`button ${detail?.kind === "current" ? "primary" : ""}`} onClick={() => openDetail({ kind: "current" })}>各类型当前可用版本</button>}
        </div>
        <ReleaseTable data={data} onCell={(release, variant, purpose) => openDetail({ kind: "cell", datasetVersion: release.datasetVersion, variant: variant.variant, purpose })} />
        <p className="rotation-table-note">单位：Sandbox 个数 · 训练列为本轮增量 · 点击查看版本与下载</p>
        {detail && (detail.kind === "current" || detail.kind === "cell") && <RotationDetail detail={detail} data={data} onClose={() => setDetail(undefined)} />}
      </section>

      <section className="section" aria-label="轮换执行">
        <div className="section-head rotation-section-head">
          <div><h2 className="section-title">轮换执行</h2><p className="section-caption">{executionDescription(data.execution)}</p></div>
          <span className={`rotation-state ${executionTone(data.execution)}`}>{executionStatusText(data.execution?.status)}</span>
        </div>
        <ExecutionPanel execution={data.execution} synCurrent={data.currentVersions.find((current) => current.variant === "syn")} onRules={() => openDetail({ kind: "rules" })} />
        {detail?.kind === "rules" && <RotationDetail detail={detail} data={data} onClose={() => setDetail(undefined)} />}
      </section>

      <div className="rotation-tabs"><button className={`button ${detail?.kind === "training" ? "primary" : ""}`} onClick={() => openDetail({ kind: "training" })}>累计训练集</button></div>
      {detail?.kind === "training" && <RotationDetail detail={detail} data={data} onClose={() => setDetail(undefined)} />}
      <p className="rotation-footer">数据来源：PG / OSS · 页面时间：{data.timezone}</p>
    </>}
  </>;
  return embedded ? <section className="v2-dataset-rotation-embedded-content">{content}</section> : <ConsoleShell timezone={data?.timezone}>{content}</ConsoleShell>;
}

function ReleaseTable({ data, onCell }: { data: DatasetRotationData; onCell: (release: DatasetRotationRelease, variant: DatasetRotationVariant, purpose: "train" | "test") => void }) {
  const releases = useMemo(() => [...data.releases].sort((left, right) => releaseSortValue(right) - releaseSortValue(left)), [data.releases]);
  const firstMarketVersion = useMemo(() => releases.filter((release) => release.kind === "market").sort((left, right) => {
    const windowOrder = Date.parse(left.windowEnd) - Date.parse(right.windowEnd);
    return windowOrder || left.datasetVersion.localeCompare(right.datasetVersion);
  })[0]?.datasetVersion, [releases]);
  return <div className="rotation-table-wrap"><table className="rotation-table">
    <caption className="sr-only">发布日、状态以及 MV、MS、original、Syn 的训练和测试范围与数量</caption>
    <colgroup><col className="rotation-date-col" /><col className="rotation-status-col" /><col span={8} /></colgroup>
    <thead><tr><th rowSpan={2}>发布日</th><th rowSpan={2}>状态</th><th colSpan={2}>MV</th><th colSpan={2}>MS</th><th colSpan={2}>original</th><th colSpan={2}>Syn</th></tr><tr><th>训练集</th><th>测试集</th><th>训练集</th><th>测试集</th><th>训练集</th><th>测试集</th><th>训练集</th><th>测试集</th></tr></thead>
    <tbody>{releases.length ? releases.map((release) => <ReleaseRow key={`${release.datasetVersion}:${release.kind}`} release={release} timezone={data.timezone} isFirstMarket={release.datasetVersion === firstMarketVersion} onCell={onCell} />) : <tr><td colSpan={10}><div className="empty"><strong>暂无发布记录</strong><p>后端尚未返回已发布版本。</p></div></td></tr>}</tbody>
  </table></div>;
}

function ReleaseRow({ release, timezone, isFirstMarket, onCell }: { release: DatasetRotationRelease; timezone: string; isFirstMarket: boolean; onCell: (release: DatasetRotationRelease, variant: DatasetRotationVariant, purpose: "train" | "test") => void }) {
  const byVariant = new Map(release.variants.map((variant) => [variant.variant, variant]));
  return <tr>
    <td><span className="rotation-date">{formatDateOnly(release.publishedAt, timezone)}</span><span className="rotation-batch-label">{release.kind === "syn" ? "Syn 独立批次" : isFirstMarket ? "市场首轮" : "市场批次"}</span></td>
    <td><span className={`rotation-state ${releaseStatusTone(release)}`}>{releaseStatusText(release)}</span></td>
    {ROTATION_ORDER.map((variant) => {
      const value = byVariant.get(variant);
      if (!value) return <MissingVariantCells key={variant} release={release} variant={variant} />;
      if (release.kind === "market" && variant === "syn" && value.status === "empty") {
        return <MissingVariantCells key={variant} release={release} variant={variant} />;
      }
      return <Fragment key={variant}><DatasetCell release={release} variant={value} purpose="train" timezone={timezone} onCell={onCell} /><DatasetCell release={release} variant={value} purpose="test" timezone={timezone} onCell={onCell} /></Fragment>;
    })}
  </tr>;
}

const ROTATION_ORDER: RotationVariant[] = ["mv", "ms", "original", "syn"];

function MissingVariantCells({ release, variant }: { release: DatasetRotationRelease; variant: RotationVariant }) {
  const isMarketSyn = release.kind === "market" && variant === "syn";
  return <td colSpan={2} className="rotation-missing"><span>{isMarketSyn ? "0 训练 / 0 测试" : "不适用"}</span><small>{isMarketSyn ? "本轮没有入选题" : `未创建 ${variantLabels[variant]}`}</small>{isMarketSyn && <small>未发布</small>}</td>;
}

function DatasetCell({ release, variant, purpose, timezone, onCell }: { release: DatasetRotationRelease; variant: DatasetRotationVariant; purpose: "train" | "test"; timezone: string; onCell: (release: DatasetRotationRelease, variant: DatasetRotationVariant, purpose: "train" | "test") => void }) {
  const count = purpose === "train" ? variant.trainCount : variant.testCount;
  const isTrain = purpose === "train";
  const dateStart = isTrain ? variant.trainWindowStart : release.windowStart;
  const dateEnd = isTrain ? variant.trainWindowEnd : release.windowEnd;
  const current = !isTrain && variant.isCurrent && variant.storageStatus === "verified";
  const unavailableCurrent = !isTrain && variant.isCurrent && !current;
  const status = variantStatusText(variant.status);
  const storageWarning = variant.storageStatus === "unavailable" || variant.storageStatus === "mismatch";
  return <td className={`rotation-data-cell ${storageWarning ? "storage-warning" : ""}`}>
    <button className="rotation-cell-button" type="button" onClick={() => onCell(release, variant, purpose)}>
      {count > 0 && dateStart && dateEnd && <><span className="rotation-date">{formatDateOnly(dateStart, timezone)}</span><span className="rotation-date">至 {formatShortDate(dateEnd, timezone)}</span></>}
      {count === 0 && isTrain && <span className="rotation-cell-note">无训练成员</span>}
      {count === 0 && !isTrain && <span className="rotation-cell-note">暂无测试成员</span>}
      <strong className="rotation-count">{integer(count)}</strong>
      {!(isTrain && count === 0) && <span className={current || unavailableCurrent ? "rotation-state" : "rotation-cell-note"}>{current ? "当前可用" : unavailableCurrent ? storageStatusText(variant.storageStatus) : isTrain ? "本轮增量" : status}</span>}
    </button>
  </td>;
}

function RotationDetail({ detail, data, onClose }: { detail: Detail; data: DatasetRotationData; onClose: () => void }) {
  if (detail.kind === "current") return <div className="rotation-detail" aria-live="polite"><DetailHeader title="各类型当前可用版本" onClose={onClose} /><div className="rotation-current-grid">{data.currentVersions.length ? data.currentVersions.map((current) => <CurrentVersion key={current.variant} current={current} timezone={data.timezone} />) : <p className="muted">暂无已发布的当前版本。</p>}</div><p className="rotation-detail-note">各类型分别取窗口结束时间最新的已发布版本；时间均为 {data.timezone}。</p></div>;
  if (detail.kind === "rules") return <div className="rotation-detail" aria-live="polite"><DetailHeader title="轮换规则" onClose={onClose} /><div className="rotation-rule-grid"><Rule title="发布周期" text="每月自动轮换，各类型分别发布；Syn 可以独立发布。" /><Rule title="测试集" text="每轮对应一个固定时间窗口；接入方可使用当前版本或固定版本复现实验。" /><Rule title="训练集" text="各轮训练增量持续累计；下载接口按已发布批次合并去重。" /></div></div>;
  if (detail.kind === "training") return <div className="rotation-detail" aria-live="polite"><DetailHeader title="累计训练集" onClose={onClose} /><div className="rotation-training-detail-grid">{data.trainingSets.map((training) => <TrainingDetail key={training.variant} training={training} />)}</div><p className="rotation-detail-note">训练下载使用现有累计接口，可按时间范围过滤；本页不展示按版本训练下载。</p></div>;
  const release = data.releases.find((item) => item.datasetVersion === detail.datasetVersion);
  const variant = release?.variants.find((item) => item.variant === detail.variant);
  if (!release || !variant) return <div className="rotation-detail" aria-live="polite"><DetailHeader title="发布记录详情" onClose={onClose} /><p className="muted">该版本已不在当前数据快照中，请刷新后重试。</p></div>;
  const { purpose } = detail;
  const version = release.datasetVersion;
  const count = purpose === "train" ? variant.trainCount : variant.testCount;
  const range = purpose === "train" ? [variant.trainWindowStart, variant.trainWindowEnd] : [release.windowStart, release.windowEnd];
  const endpoint = purpose === "train" ? `/api/console/downloads/trainsets?variant=${encodeURIComponent(variant.variant)}` : `/api/console/downloads/testsets/${encodeURIComponent(version)}?variant=${encodeURIComponent(variant.variant)}`;
  return <div className="rotation-detail" aria-live="polite"><DetailHeader title={`${variantLabels[variant.variant]} · ${variantDescriptions[variant.variant]} / ${purpose === "train" ? "训练集" : "测试集"}`} onClose={onClose} /><div className="rotation-facts"><Fact label="批次版本" value={version} /><Fact label="时间范围" value={range[0] && range[1] ? `${formatDateOnly(range[0], data.timezone)} — ${formatDateOnly(range[1], data.timezone)}` : "暂无训练时间范围"} /><Fact label="本轮成员数" value={`${integer(count)} 个`} /><Fact label="发布时间" value={variant.publishedAt ? formatDateTime(variant.publishedAt, data.timezone) : "尚未发布"} /><Fact label="状态" value={variantStatusText(variant.status)} /><Fact label="存储状态" value={storageStatusText(variant.storageStatus)} /></div><div className="rotation-api"><span>下载动作</span><a className="button" href={endpoint} target="_blank" rel="noreferrer" download>{purpose === "train" ? "下载累计 train" : "下载固定 test"}</a><small>{purpose === "train" ? "累计已发布批次，按变体合并去重；时间范围下载在资料页高级工具中。" : "固定版本测试集，使用同源 BFF 并绑定该 variant。"}</small></div></div>;
}

function CurrentVersion({ current, timezone }: { current: DatasetRotationCurrentVersion; timezone: string }) {
  return <div className="rotation-current-item"><span className="rotation-current-label">{variantLabels[current.variant]}</span><strong>{current.datasetVersion}</strong><span>{integer(current.testCount)} 个测试 · {formatDateTime(current.publishedAt, timezone)} 发布</span><span className={`rotation-state ${current.storageStatus === "verified" ? "positive" : "warning"}`}>{storageStatusText(current.storageStatus)}</span></div>;
}

function ExecutionPanel({ execution, synCurrent, onRules }: { execution?: DatasetRotationExecution; synCurrent?: DatasetRotationCurrentVersion; onRules: () => void }) {
  const complete = execution?.status === "published";
  return <div className="rotation-runbox"><div className="rotation-runbox-head"><span className="rotation-run-title">{execution ? `${executionLabel(execution.status)} · ${execution.datasetVersion}` : "暂无在途市场批次"}</span><button className="button" onClick={onRules}>查看轮换规则</button></div><div className="rotation-stage-grid" aria-label={complete ? "轮换处理阶段已完成" : "轮换处理阶段"}>{STAGES.map((stage, index) => <div className={`rotation-stage ${stageState(execution, index)}`} key={stage.title}><strong>{stage.title}</strong><small>{stage.detail}</small></div>)}</div><div className="rotation-runstatus">{ROTATION_ORDER.map((variant) => <span key={variant}>{variantLabels[variant]}：{executionVariantText(execution, variant, synCurrent)}</span>)}</div></div>;
}

const STAGES = [{ title: "接收名单", detail: "训练 / 测试" }, { title: "登记成员", detail: "冻结本轮名单" }, { title: "制品准备", detail: "复用 / MV / MS" }, { title: "发布校验", detail: "清单和归档" }, { title: "发布完成", detail: "更新可用版本" }];

function TrainingDetail({ training }: { training: DatasetRotationTrainingSet }) {
  return <div className="rotation-training-detail"><span>{variantLabels[training.variant]}</span><strong>{integer(training.count)} 个</strong><small>{training.datasetVersions.length ? `批次：${training.datasetVersions.join("、")}` : "暂无已发布批次"}</small>{training.unreadyCount > 0 && <small className="warning">待就绪：{integer(training.unreadyCount)}</small>}</div>;
}

function DetailHeader({ title, onClose }: { title: string; onClose: () => void }) { return <div className="rotation-detail-head"><h3>{title}</h3><button className="button" onClick={onClose}>关闭</button></div>; }
function Rule({ title, text }: { title: string; text: string }) { return <div><strong>{title}</strong><p>{text}</p></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function RotationSkeleton() { return <><div className="rotation-rulebar"><div className="skeleton" /><div className="skeleton" /></div><section className="section"><div className="skeleton rotation-skeleton-table" /></section><section className="section"><div className="skeleton rotation-skeleton-run" /></section></>; }

function sameDetail(left: Detail | undefined, right: Detail): boolean {
  if (!left || left.kind !== right.kind) return false;
  if (left.kind === "current" || left.kind === "rules" || left.kind === "training") return true;
  if (right.kind !== "cell") return false;
  return left.datasetVersion === right.datasetVersion && left.variant === right.variant && left.purpose === right.purpose;
}

function releaseSortValue(release: DatasetRotationRelease): number { return release.publishedAt ? Date.parse(release.publishedAt) : 0; }
function formatDateOnly(value: string | undefined, timezone: string): string { return value ? formatDateParts(value, timezone, true) : "—"; }
function formatShortDate(value: string, timezone: string): string { return formatDateParts(value, timezone, false); }
function formatDateTime(value: string, timezone: string): string { try { return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)).replaceAll("/", "."); } catch { return value; } }
function formatDateParts(value: string, timezone: string, includeYear: boolean): string {
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, year: includeYear ? "numeric" : undefined, month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return includeYear ? `${get("year")}.${get("month")}.${get("day")}` : `${get("month")}.${get("day")}`;
  } catch {
    return includeYear ? value.slice(0, 10).replaceAll("-", ".") : value.slice(5, 10).replace("-", ".");
  }
}
function integer(value: number): string { return new Intl.NumberFormat("zh-CN").format(value); }
function nextRotationText(data: DatasetRotationData): string { return data.nextRotationAt && data.enabled ? `预计下次：${formatDateTime(data.nextRotationAt, data.timezone)}` : data.enabled ? "暂无下次计划" : "轮换已关闭"; }
function releaseStatusText(release: DatasetRotationRelease): string { const failed = release.variants.some((variant) => variant.status === "failed"); const effectiveVariants = release.variants.filter((variant) => !(release.kind === "market" && variant.variant === "syn" && variant.status === "empty")); const complete = effectiveVariants.length > 0 && effectiveVariants.every((variant) => variant.status === "published"); if (release.kind === "syn") return failed ? "Syn 失败" : complete ? "Syn 已发布" : "Syn 准备中"; return failed ? "市场失败" : complete ? "市场已发布" : "市场准备中"; }
function releaseStatusTone(release: DatasetRotationRelease): string { const effectiveVariants = release.variants.filter((variant) => !(release.kind === "market" && variant.variant === "syn" && variant.status === "empty")); return release.variants.some((variant) => variant.status === "failed") ? "negative" : effectiveVariants.length > 0 && effectiveVariants.every((variant) => variant.status === "published") ? "positive" : "warning"; }
function variantStatusText(status: string): string { const labels: Record<string, string> = { published: "已发布", waiting_input: "等待名单", registering: "登记中", preparing: "准备中", publishing: "发布中", failed: "失败", empty: "未发布" }; return labels[status] ?? status; }
function storageStatusText(status: DatasetRotationVariant["storageStatus"]): string { return { verified: "已核对", unavailable: "暂不可用", mismatch: "信息不一致", not_checked: "尚未核对" }[status]; }
function executionDescription(execution?: DatasetRotationExecution): string { return execution ? `${executionLabel(execution.status)}，当前批次 ${execution.datasetVersion}` : "当前没有在途市场批次，等待下一轮。"; }
function executionStatusText(status?: DatasetRotationExecution["status"]): string { return status ? executionLabel(status) : "无在途任务"; }
function executionTone(execution?: DatasetRotationExecution): string { return execution?.status === "failed" ? "negative" : execution && execution.status !== "published" ? "warning" : "positive"; }
function executionLabel(status: DatasetRotationExecution["status"]): string { return { idle: "空闲", waiting_input: "等待名单", registering: "登记成员", preparing: "制品准备中", publishing: "发布校验中", published: "本轮已完成", failed: "本轮失败" }[status]; }
function executionVariantText(execution: DatasetRotationExecution | undefined, variant: RotationVariant, synCurrent?: DatasetRotationCurrentVersion): string {
  if (variant === "syn" && synCurrent) return synCurrent.storageStatus === "verified" ? "独立版本已发布" : "独立版本暂不可用";
  const item = execution?.variants.find((entry) => entry.variant === variant);
  return item ? variantStatusText(item.status) : execution ? "未参与" : "无在途任务";
}
function stageState(execution: DatasetRotationExecution | undefined, index: number): string {
  const status = execution?.status;
  if (!status) return "";
  if (status === "published") return "done";
  if (status === "failed") {
    // A failed version can fail while members are still being prepared. Keep
    // the preparation stage active unless the DTO proves all members reached
    // ready with no pending/failed entries, which is the publish boundary.
    const publishReady = execution.variants.length > 0 && execution.variants.every((variant) => {
      if (variant.status === "failed") {
        return variant.totalCount !== undefined && variant.totalCount > 0 && variant.readyCount === variant.totalCount && !variant.pendingCount && !variant.failedCount;
      }
      if (variant.status === "published") return true;
      if (variant.status !== "publishing") return false;
      return variant.totalCount !== undefined && variant.totalCount > 0 && variant.readyCount === variant.totalCount && !variant.pendingCount && !variant.failedCount;
    });
    const failedAt = publishReady ? 3 : 2;
    return index < failedAt ? "done" : index === failedAt ? "current warning-stage" : "";
  }
  const activeIndex = { idle: 0, waiting_input: 0, registering: 1, preparing: 2, publishing: 3 }[status] ?? 0;
  return index < activeIndex ? "done" : index === activeIndex ? "current" : "";
}

