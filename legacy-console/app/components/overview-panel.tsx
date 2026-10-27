import type { OverviewData } from "../lib/types";
import { Icon } from "./icons";
import { Status } from "./status";

const utc = (value?: string) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "暂无记录";

/** 概览页只展示后端聚合指标和由最后事件时间派生的活动摘要。 */
export function OverviewPanel({ data }: { data?: OverviewData }) {
  if (!data) return <Loading />;
  const metrics = [
    ["已选市场", data.selectedMarketTotal, "当前可进入 Sandbox 的市场"],
    ["Sandbox 总数", data.sandboxTotal, "已存档的研究资料包"],
    ["已收到预测", data.predictionTotal, "算法服务已经回传"],
    ["待投递消息", data.outboxPendingTotal, "Outbox 等待发布或重试"],
  ];
  const pipeline = [
    { name: "已选中", count: data.selectedMarketTotal, detail: data.currentSelectionRunID ?? "暂无选盘批次", status: "selected" },
    { name: "Sandbox 已提交", count: data.sandboxTotal, detail: `最近 ${utc(data.lastSandboxAt)}`, status: "committed" },
    { name: "已收到预测", count: data.predictionTotal, detail: `最近 ${utc(data.lastPredictionAt)}`, status: "received" },
    { name: "消息待交付", count: data.outboxPendingTotal, detail: "发布不等于下游已执行", status: data.outboxPendingTotal ? "pending" : "published" },
  ];
  const events = [
    { title: "最近选盘", description: data.currentSelectionRunID ?? "暂无选盘批次", createdAt: data.lastSelectedAt, status: "selected" },
    { title: "最近 Sandbox 提交", description: "资料包清单已完成服务端校验", createdAt: data.lastSandboxAt, status: "committed" },
    { title: "最近预测回传", description: "只表示平台已收到预测，不表示消息下游完成", createdAt: data.lastPredictionAt, status: "received" },
  ];
  return <>
    <section className="metric-grid">{metrics.map(([label, value, detail], index) => <div className="metric" key={String(label)}><div className="metric-label">{label}</div><div className={`metric-value ${index === 3 && Number(value) > 0 ? "warning" : ""}`}>{value}</div><div className="metric-meta">{detail}</div></div>)}</section>
    <section className="section"><div className="section-head"><h2 className="section-title">数据处理链路</h2><a className="link" href="/markets">查看已选市场 <Icon name="arrow" /></a></div><div className="panel pipeline">{pipeline.map((step, index) => <div className="pipeline-step" key={step.name}><span className="pipeline-index">0{index + 1}</span><span className="pipeline-name">{step.name} · {step.count}</span><span className="pipeline-detail"><Status value={step.status} /> {step.detail}</span></div>)}</div></section>
    <section className="section two-col"><div><div className="section-head"><h2 className="section-title">最近活动</h2></div><div className="panel panel-pad"><div className="events">{events.map((event) => <div className="event" key={event.title}><i className={`event-mark ${event.status === "pending" ? "warning" : ""}`} /><div><div className="event-title">{event.title}</div><div className="event-description">{event.description}</div></div><time className="mono muted">{utc(event.createdAt)}</time></div>)}</div></div></div><OperationGuide /></section>
  </>;
}

function OperationGuide() { return <div><div className="section-head"><h2 className="section-title">操作约定</h2></div><div className="panel panel-pad"><div className="events"><Guide title="时间统一 UTC" description="所有筛选、导出及时间戳均以 UTC 保存和显示。" /><Guide title="投递为至少一次" description="消息成功发布不等于下游算法已执行完成。" /><Guide title="数据按引用导出" description="回测数据集只引用已存档的 Sandbox 内容。" /></div></div></div>; }
function Guide({ title, description }: { title: string; description: string }) { return <div className="event"><i className="event-mark" /><div><div className="event-title">{title}</div><div className="event-description">{description}</div></div></div>; }
function Loading() { return <div className="panel panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }
