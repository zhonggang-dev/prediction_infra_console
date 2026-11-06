"use client";

import { useState } from "react";
import { validateWalletPnlRange, walletPnlLocalHour, walletPnlHourCandidates, formatWalletPnlOffset, type WalletPnlSelection, type WalletPnlCustomRange } from "../lib/wallet-pnl";

export interface OfficialPnlTimeSelection { period: WalletPnlSelection; customRange?: WalletPnlCustomRange }
const PERIODS: { key: WalletPnlSelection; label: string }[] = [
  { key: "1D", label: "1天" }, { key: "1W", label: "1周" }, { key: "1M", label: "1个月" },
  { key: "1Y", label: "1年" }, { key: "YTD", label: "年初至今" }, { key: "ALL", label: "全部" },
];

export function OfficialPnlTimeControls({ selection, onChange }: { selection: OfficialPnlTimeSelection; onChange: (selection: OfficialPnlTimeSelection) => void }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rangeError, setRangeError] = useState<string>();
  const [today, setToday] = useState("");
  const [startInstant, setStartInstant] = useState("");
  const [endInstant, setEndInstant] = useState("");
  const startCandidates = walletPnlHourCandidates(startDate), endCandidates = walletPnlHourCandidates(endDate);
  const { period, customRange } = selection;
  const applyRange = (event: React.FormEvent) => {
    event.preventDefault();
    const result = validateWalletPnlRange(startDate, endDate, Date.now(), { startMs: startInstant ? Number(startInstant) : undefined, endMs: endInstant ? Number(endInstant) : undefined });
    if (result.error) { setRangeError(result.error); return; }
    onChange({ period: "CUSTOM", customRange: result.range }); setRangeError(undefined);
  };
  return <div className="official-pnl-time-controls">
    <div className="wallet-pnl-periods" role="group" aria-label="官方盈亏周期">{PERIODS.map(item => <button key={item.key} type="button" aria-pressed={period === item.key} className={period === item.key ? "active" : ""} onClick={() => { onChange({ ...selection, period: item.key }); setCustomOpen(false); setRangeError(undefined); }}>{item.label}</button>)}<button type="button" aria-pressed={period === "CUSTOM"} aria-expanded={customOpen} className={period === "CUSTOM" ? "active" : ""} onClick={() => { setCustomOpen(true); setToday(walletPnlLocalHour()); }}>自定义</button></div>
    {customOpen && <form className="wallet-pnl-custom-range" onSubmit={applyRange} aria-label="官方盈亏自定义时间" noValidate>
      <LocalHourInput label="开始" value={startDate} max={today} onChange={value => { setStartDate(value); setStartInstant(""); setRangeError(undefined); }} />
      {startCandidates.length > 1 && <label>开始时区偏移<select className="select" aria-label="开始小时偏移" value={startInstant} onChange={event => setStartInstant(event.target.value)}><option value="">请选择重复小时</option>{startCandidates.map(time => <option value={time} key={time}>{formatWalletPnlOffset(time)}</option>)}</select></label>}
      <LocalHourInput label="结束" value={endDate} max={today} onChange={value => { setEndDate(value); setEndInstant(""); setRangeError(undefined); }} />
      {endCandidates.length > 1 && <label>结束时区偏移<select className="select" aria-label="结束小时偏移" value={endInstant} onChange={event => setEndInstant(event.target.value)}><option value="">请选择重复小时</option>{endCandidates.map(time => <option value={time} key={time}>{formatWalletPnlOffset(time)}</option>)}</select></label>}
      <button className="button primary" type="submit">应用时间</button>
      {rangeError && <p role="alert">{rangeError}</p>}
    </form>}
    {period === "CUSTOM" && customRange && <p className="wallet-pnl-range-note" data-wallet-pnl-range={`${customRange.startDate}/${customRange.endDate}`}>已应用 {customRange.startDate.replace("T", " ")} 至 {customRange.endDate.replace("T", " ")}（{customRange.timeZone}，{customRange.startOffset}{customRange.endOffset !== customRange.startOffset ? ` → ${customRange.endOffset}` : ""}）。</p>}
  </div>;
}

export function LocalHourInput({ label, value, max, onChange, ariaPrefix = "官方盈亏" }: { label: string; value: string; max: string; onChange: (value: string) => void; ariaPrefix?: string }) {
  const date = value.split("T")[0];
  const hour = value ? value.slice(11, 13) : "00";
  const maxDate = max.split("T")[0];
  const maxHour = max.slice(11, 13);
  return <fieldset className="wallet-pnl-hour-input"><legend>{label}时间</legend><div>
    <input className="input" type="date" aria-label={`${ariaPrefix}${label}日期`} value={date} max={maxDate || undefined} onChange={event => onChange(event.target.value ? `${event.target.value}T${hour}:00` : "")} />
    <select className="select" aria-label={`${ariaPrefix}${label}小时`} value={hour} disabled={!date} onChange={event => onChange(`${date}T${event.target.value}:00`)}>{Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map(item => <option key={item} value={item} disabled={Boolean(maxDate && date === maxDate && item > maxHour)}>{item}时</option>)}</select>
  </div></fieldset>;
}

