"use client";

import { useEffect, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { consoleV2, type ConsoleV2ServiceMetric } from "../lib/console-v2";
import { formatV2Bytes, formatV2Number, formatV2Time, V2Frame, V2Notice, v2Status, v2Unknown } from "./console-v2-resource";
import { RedisMonitorPanel } from "./service-metrics-dashboard";

export function ObservabilityV2Page() {
  const [infra, setInfra] = useState<ConsoleV2ServiceMetric>();
  const [trading, setTrading] = useState<ConsoleV2ServiceMetric>();
  const [redis, setRedis] = useState<Awaited<ReturnType<typeof consoleApi.redisMonitor>>["data"]>();
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      // A refresh is a new snapshot. Clear the previous one before awaiting
      // each independent source so a failed request cannot look healthy.
      setInfra(undefined);
      setTrading(undefined);
      setRedis(undefined);
      setErrors([]);
      void Promise.allSettled([consoleV2.infra.serviceMetrics(), consoleV2.trading.serviceMetrics(), consoleApi.redisMonitor()]).then((results) => {
        if (cancelled) return;
        const nextErrors: string[] = [];
        const [infraResult, tradingResult, redisResult] = results;
        if (infraResult.status === "fulfilled") setInfra(infraResult.value.data); else { setInfra(undefined); nextErrors.push(`Prediction Infra：${message(infraResult.reason)}`); }
        if (tradingResult.status === "fulfilled") setTrading(tradingResult.value.data); else { setTrading(undefined); nextErrors.push(`Trading Execution：${message(tradingResult.reason)}`); }
        if (redisResult.status === "fulfilled") setRedis(redisResult.value.data); else { setRedis(undefined); nextErrors.push(`Redis：${message(redisResult.reason)}`); }
        setErrors(nextErrors);
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [refreshKey]);
  const services = [infra, trading].filter((service): service is ConsoleV2ServiceMetric => Boolean(service));
  return <V2Frame eyebrow="System / Observability" title="服务监控" description="这里展示服务端采样的运行指标与 Redis 共享快照；采集成功不等于依赖就绪，未采集指标保持未知。" onRefresh={() => setRefreshKey((value) => value + 1)} loading={loading}>
    {errors.map((error) => <V2Notice key={error} error title="部分监控数据不可用" description={error} />)}
    <section className="v2-summary-grid"><Metric label="可用服务" value={loading ? "读取中" : `${services.length} / 2`} meta={loading ? "等待本轮独立快照" : services.length === 2 ? "两个服务快照已返回" : "部分服务未返回"} /><Metric label="请求量" value="未知" meta="当前没有可靠采集" unknown /><Metric label="CPU" value="未知" meta="当前没有可靠采集" unknown /><Metric label="最新观测" value={formatV2Time(latest(services)?.observedAt)} meta="各服务分别保留时间" /></section>
    <section className="section"><div className="section-head"><div><h2 className="section-title">服务实例</h2><p className="section-caption">采集成功不等于依赖就绪；服务分别保留自己的观测时间和可用范围。</p></div></div><div className="service-card-grid">{services.map((service) => <ServiceCard key={service.service} service={service} />)}{!services.length && !loading && <div className="panel panel-pad"><strong>没有可用服务快照</strong><p className="muted">接口失败或未配置时不回落到自动演示正常。</p></div>}</div></section>
    <section className="section panel panel-pad"><h2 className="section-title">指标口径</h2><div className="v2-detail-list"><li>运行线程数、Go 版本和进程内存只显示服务实际返回值。</li><li>请求量、CPU、容器限额没有可靠采集时保持未知。</li><li>页面轮询和就绪检查不会被写入业务统计。</li></div></section>
    <RedisMonitorPanel data={redis} error={errors.find((error) => error.startsWith("Redis："))?.replace(/^Redis：/, "")} loading={loading && !redis} />
  </V2Frame>;
}

function ServiceCard({ service }: { service: ConsoleV2ServiceMetric }) {
  return <article className="service-card"><header className="service-card-head"><span className="service-avatar">{service.service === "trading-execution" ? "TE" : "PI"}</span><div><h3>{service.service === "trading-execution" ? "Trading Execution" : "Prediction Infra"}</h3><p>{service.service === "trading-execution" ? "订单执行、风控与交易账本" : "选盘、Sandbox 与预测链路"}</p></div>{v2Status("available", "快照可读")}</header><div className="service-vitals"><Vital label="运行线程数" value={formatV2Number(service.runtime.goroutines, 0)} detail={v2Unknown(service.runtime.goVersion)} /><Vital label="堆内存" value={formatV2Bytes(service.memory.heapAllocBytes)} detail="服务实际返回" /><Vital label="运行时长" value={formatV2Number(service.uptimeSeconds, 0)} detail="秒" /></div><div className="service-runtime-row"><div><span>观测时间</span><strong>{formatV2Time(service.observedAt)}</strong></div><div><span>堆内存使用</span><strong>{formatV2Bytes(service.memory.heapInuseBytes)}</strong></div><div><span>系统内存</span><strong>{formatV2Bytes(service.memory.sysBytes)}</strong></div><div><span>可用范围</span><strong>{Object.entries(service.availability).map(([key, value]) => `${key}:${value}`).join(" · ") || "未知"}</strong></div></div></article>;
}

function Vital({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="service-vital"><span>{label}</span><div><strong>{value}</strong></div><p>{detail}</p></div>;
}

function Metric({ label, value, meta, unknown = false }: { label: string; value: string; meta: string; unknown?: boolean }) {
  return <div className={`v2-summary-card ${unknown ? "unknown" : ""}`}><span>{label}</span><strong>{value}</strong><small>{meta}</small></div>;
}

function latest(services: ConsoleV2ServiceMetric[]) { return services.reduce<ConsoleV2ServiceMetric | undefined>((current, item) => !current || String(item.observedAt ?? "") > String(current.observedAt ?? "") ? item : current, undefined); }
function message(value: unknown) { return value instanceof Error ? value.message : "接口不可用"; }
