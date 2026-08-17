"use client";

import { useEffect, useState } from "react";
import { consoleApi } from "../lib/console-api";
import type { BacktestCreateParams, ConsoleList, ConsoleRow } from "../lib/types";
import { Status } from "./status";

const toUtcInput = (date: Date) => date.toISOString().slice(0, 16);
const formatUtc = (value?: string) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "—";

/** 回测表单生成固定数据集契约，并始终转为 UTC 再提交。 */
export function BacktestPanel({ list, consoleReadable, onPage }: { list?: ConsoleList; consoleReadable: boolean; onPage: (offset: number) => void }) {
  const now = new Date();
  const [from, setFrom] = useState(toUtcInput(new Date(now.getTime() - 7 * 24 * 60 * 60_000)));
  const [to, setTo] = useState(toUtcInput(now));
  const [cutoff, setCutoff] = useState(toUtcInput(now));
  const [seriesID, setSeriesID] = useState<number>();
  const [series, setSeries] = useState<ConsoleRow[]>();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>();
  const [canCreateBacktest, setCanCreateBacktest] = useState<boolean>();

  useEffect(() => {
    void loadSeries({ setSeries, setSeriesID });
  }, []);

  useEffect(() => {
    void consoleApi.capabilities().then((result) => setCanCreateBacktest(result.data.backtest_create)).catch(() => setCanCreateBacktest(false));
  }, []);

  const timeError = validateTimes({ from, to, cutoff });
  const canCreate = consoleReadable && canCreateBacktest === true && !!series?.length && seriesID !== undefined && !timeError;
  const submit = async () => {
    if (!canCreate || seriesID === undefined) return;
    setSubmitting(true);
    setResult(undefined);
    try {
      const created = await consoleApi.createBacktest(buildParams({ from, to, cutoff, seriesID }));
      setResult(`已创建数据集任务：${String(created.data.dataset_id ?? "已受理")}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return <>
    <section className="two-col">
      <div className="panel panel-pad">
        <h2 className="section-title">创建回测数据集</h2>
        <p className="description">范围仅包含已有预测引用的 Sandbox、订单簿与结算信息。</p>
        <div className="form">
          <div className="form-grid">
            <TimeField id="prediction-from" label="预测开始时间（UTC）" value={from} onChange={setFrom} />
            <TimeField id="prediction-to" label="预测结束时间（UTC）" value={to} onChange={setTo} />
            <TimeField id="data-cutoff" label="数据截止时间（UTC）" value={cutoff} onChange={setCutoff} />
            <div className="field">
              <label htmlFor="series">订单簿序列</label>
              <select id="series" className="select" value={seriesID ?? ""} disabled={!series?.length} onChange={(event) => setSeriesID(Number(event.target.value))}>
                <option value="" disabled>选择订单簿序列</option>
                {series?.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </div>
          </div>
          <div className="form-footer"><button className="button primary" disabled={!canCreate || submitting} onClick={() => void submit()}>{submitting ? "正在创建…" : "创建数据集任务"}</button></div>
          {canCreateBacktest === false && <p className="muted">未配置 BACKTEST_DATASET_TOKEN，创建功能已禁用。</p>}
          {consoleReadable && series?.length === 0 && <p className="muted">没有可用的订单簿序列，创建功能已禁用。</p>}
          {timeError && <p className="muted">{timeError}</p>}
          {result && <p className="muted">{result}</p>}
        </div>
      </div>
      <ExportBoundary />
    </section>
    <section className="section">
      <div className="section-head"><h2 className="section-title">数据集任务</h2></div>
      <div className="panel">{!list ? <Loading /> : list.items.length ? <><DatasetTable rows={list.items} /><Pagination list={list} onPage={onPage} /></> : <Empty title="还没有数据集任务" description="创建后将在这里显示状态与下载入口。" />}</div>
    </section>
  </>;
}

async function loadSeries(params: { setSeries: (series: ConsoleRow[]) => void; setSeriesID: (id: number) => void }) {
  try {
    const result = await consoleApi.list("orderbook-series");
    params.setSeries(result.data.items);
    if (result.data.items[0]) params.setSeriesID(Number(result.data.items[0].id));
  } catch {
    params.setSeries([]);
  }
}

function buildParams({ from, to, cutoff, seriesID }: { from: string; to: string; cutoff: string; seriesID: number }): BacktestCreateParams {
  return {
    prediction_from: parseUtcInput(from).toISOString(),
    prediction_to: parseUtcInput(to).toISOString(),
    data_cutoff_at: parseUtcInput(cutoff).toISOString(),
    filters: { execution_modes: [], model_names: [], domains: [], condition_ids: [] },
    orderbook: { series_id: seriesID, lookback_minutes: 60, horizon_hours: 24 },
    sandbox_scope: "REFERENCED_BY_PREDICTIONS",
    sandbox_content: "REFERENCE",
    include_settlements: true,
  };
}

/** datetime-local 没有时区；这里约定其文本本身就是 UTC，避免浏览器本地时区偏移。 */
function parseUtcInput(value: string) { return new Date(`${value.length === 16 ? `${value}:00` : value}Z`); }

function validateTimes({ from, to, cutoff }: { from: string; to: string; cutoff: string }) {
  const fromAt = parseUtcInput(from).getTime();
  const toAt = parseUtcInput(to).getTime();
  const cutoffAt = parseUtcInput(cutoff).getTime();
  if ([fromAt, toAt, cutoffAt].some(Number.isNaN)) return "请填写有效的 UTC 时间。";
  if (fromAt >= toAt) return "预测开始时间必须早于预测结束时间。";
  if (toAt > cutoffAt) return "数据截止时间必须不早于预测结束时间。";
  if (cutoffAt > Date.now()) return "数据截止时间不能晚于当前 UTC 时间。";
  return undefined;
}

function TimeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} className="input" type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function ExportBoundary() {
  return <div className="panel panel-pad"><h2 className="section-title">导出边界</h2><div className="events"><BoundaryItem title="预测时间" description="按 UTC 选择预测记录，截止时间控制可用数据。" /><BoundaryItem title="Sandbox 内容" description="仅输出引用关系，不复制敏感对象路径和原始内容。" /></div></div>;
}

function BoundaryItem({ title, description }: { title: string; description: string }) {
  return <div className="event"><i className="event-mark" /><div><div className="event-title">{title}</div><div className="event-description">{description}</div></div></div>;
}

function DatasetTable({ rows }: { rows: ConsoleRow[] }) {
  return <div className="table-scroll"><table><thead><tr><th>任务标识</th><th>范围</th><th>状态</th><th>请求时间</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="mono">{row.id}</td><td className="muted">{row.secondary}</td><td><Status value={row.status} /></td><td className="mono muted">{formatUtc(row.timestamp)}</td></tr>)}</tbody></table></div>;
}

function Pagination({ list, onPage }: { list: ConsoleList; onPage: (offset: number) => void }) {
  const next = list.offset + list.limit;
  return <div className="filters"><span className="muted">共 {list.total} 条 · {list.offset + 1}–{Math.min(list.offset + list.items.length, list.total)}</span><button className="button" disabled={list.offset === 0} onClick={() => onPage(Math.max(0, list.offset - list.limit))}>上一页</button><button className="button" disabled={next >= list.total} onClick={() => onPage(next)}>下一页</button></div>;
}

function Loading() { return <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }
function Empty({ title, description }: { title: string; description: string }) { return <div className="empty"><strong>{title}</strong><p>{description}</p></div>; }
