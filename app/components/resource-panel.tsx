"use client";

import { useMemo, useState } from "react";
import type { ConsoleList, ConsoleResource, ConsoleRow } from "../lib/types";
import { Status } from "./status";

const utc = (value?: string) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "—";
const headings: Record<ConsoleResource, string[]> = {
  "selected-markets": ["问题", "领域", "市场标识", "状态", "选中时间"],
  sandboxes: ["Sandbox", "关联市场", "状态", "提交时间"],
  predictions: ["模型", "市场标识", "状态", "接收时间"],
  "backtest-datasets": ["数据集", "范围", "状态", "请求时间"],
  "outbox-events": ["事件类型", "关联记录", "交付状态", "创建时间"],
};

/** 资源面板只按明确白名单字段筛选和渲染。 */
export function ResourcePanel({ resource, list, onPage }: { resource: ConsoleResource; list?: ConsoleList; onPage: (offset: number) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ConsoleRow>();
  const filteredRows = useMemo(() => filterRows(list?.items ?? [], query), [list?.items, query]);
  if (!list) return <Loading />;
  return <section className="panel">
    <div className="filters"><input className="input" placeholder="筛选当前页：标识、标题或状态" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {selected && <Detail row={selected} close={() => setSelected(undefined)} />}
    {filteredRows.length ? <><Table headers={headings[resource]}>{filteredRows.map((row) => <ResourceTableRow key={row.id} resource={resource} row={row} onSelect={setSelected} />)}</Table><Pagination list={list} onPage={onPage} /></> : <Empty title="没有匹配的数据" description="可以修改筛选条件，或等待下一次业务任务执行。" />}
  </section>;
}

function filterRows(rows: ConsoleRow[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => [row.id, row.title, row.secondary, row.status, ...(row.domains ?? []), ...row.values.map((value) => value.value)].join(" ").toLowerCase().includes(needle));
}

function ResourceTableRow({ resource, row, onSelect }: { resource: ConsoleResource; row: ConsoleRow; onSelect: (row: ConsoleRow) => void }) {
  const primary = resource === "selected-markets" ? <><td className="primary-cell">{row.title}</td><td>{row.domains?.map((domain) => <span className="domain" key={domain}>{domain}</span>)}</td></> : <td className={resource === "predictions" ? "primary-cell" : "mono"}>{row.title}</td>;
  return <tr onClick={() => onSelect(row)}>{primary}<td className="mono muted">{row.secondary}</td><td><Status value={row.status} /></td><td className="mono muted">{utc(row.timestamp)}</td></tr>;
}

function Detail({ row, close }: { row: ConsoleRow; close: () => void }) {
  return <div className="detail"><div className="section-head"><h3 className="section-title">记录摘要</h3><button className="button" onClick={close}>收起</button></div><div className="detail-grid"><DetailValue label="记录标识" value={row.id} /><DetailValue label="关联标识" value={row.secondary} /><DetailValue label="时间（UTC）" value={utc(row.timestamp)} />{row.values.map((value) => <DetailValue key={value.label} label={value.label} value={value.value} />)}</div></div>;
}
function DetailValue({ label, value }: { label: string; value: string }) { return <div><div className="detail-key">{label}</div><div className="detail-value">{value}</div></div>; }
function Pagination({ list, onPage }: { list: ConsoleList; onPage: (offset: number) => void }) { const previous = Math.max(0, list.offset - list.limit); const next = list.offset + list.limit; return <div className="filters"><span className="muted">共 {list.total} 条 · {list.offset + 1}–{Math.min(list.offset + list.items.length, list.total)}</span><button className="button" disabled={list.offset === 0} onClick={() => onPage(previous)}>上一页</button><button className="button" disabled={next >= list.total} onClick={() => onPage(next)}>下一页</button></div>; }
function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) { return <div className="table-scroll"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Loading() { return <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }
function Empty({ title, description }: { title: string; description: string }) { return <div className="empty"><strong>{title}</strong><p>{description}</p></div>; }
