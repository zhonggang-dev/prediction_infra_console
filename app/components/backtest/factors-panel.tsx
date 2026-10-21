"use client";

import { useEffect, useMemo, useState } from "react";
import { backtestApi, text, type CatalogItem } from "../../lib/backtest-platform";
import { FACTOR_PAGE_SIZE, coverageOf, directionOf, evaluateHref, factorChange, factorGroup, factorGroups, factorNames, factorTableVersion } from "../../lib/backtest-factors";
import { V2Loading, V2Notice, formatV2Time, v2ErrorText } from "../console-v2-resource";

type View = "all" | "pool" | "experiment";
type Pending = { item: CatalogItem; target: "pool" | "experiment" };

/** 因子库：实验空间与因子池是同一份目录登记的两种状态；移入 / 移出记录版本、操作人与时间，初筛通过不会自动入池。 */
export function FactorsPanel() {
  const [items, setItems] = useState<CatalogItem[]>();
  const [error, setError] = useState<string>();
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setError(undefined);
      void backtestApi.catalogAll("factor").then((next) => { if (!cancelled) setItems(next); })
        .catch((cause: unknown) => { if (!cancelled) { setItems(undefined); setError(v2ErrorText(cause)); } });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [tick]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((item) => (view === "all" || (view === "pool" ? item.poolState === "pool" : item.poolState !== "pool")) && (!group || factorGroup(item) === group) && (!q || `${item.key} ${item.version} ${text(item.metadata.label) ?? ""}`.toLowerCase().includes(q)));
  }, [items, view, query, group]);
  const groups = useMemo(() => factorGroups(items ?? []), [items]);
  const pages = Math.max(1, Math.ceil(visible.length / FACTOR_PAGE_SIZE));
  const current = Math.min(pageIndex, pages - 1);
  const shown = visible.slice(current * FACTOR_PAGE_SIZE, (current + 1) * FACTOR_PAGE_SIZE);
  // 筛选条件变了回到第一页
  const refilter = (apply: () => void) => { apply(); setPageIndex(0); };
  const poolCount = (items ?? []).filter((item) => item.poolState === "pool").length;

  const confirm = async () => {
    if (!pending) return;
    setBusy(true); setActionError(undefined);
    try {
      await backtestApi.setFactorPool(pending.item.key, { version: pending.item.version, state: pending.target });
      setPending(undefined); setTick((v) => v + 1);
    } catch (cause) { setActionError(v2ErrorText(cause)); } finally { setBusy(false); }
  };

  return <section className="section v2-list-section">
    <p className="section-caption">因子池与实验空间是同一份登记的两种状态。同一因子在池中最多一个版本；移入会把该因子的其它在池版本移回实验空间。操作会记录版本、操作人和时间。</p>
    <section className="panel v2-list-panel">
      <div className="filters v2-filterbar">
        <div className="v2-local-tabs" role="radiogroup" aria-label="因子范围">{([["all", "全部"], ["pool", `因子池（${poolCount}）`], ["experiment", "实验空间"]] as const).map(([key, label]) => <button type="button" role="radio" aria-checked={view === key} key={key} className={view === key ? "active" : ""} onClick={() => refilter(() => setView(key))}>{label}</button>)}</div>
        <input className="input" aria-label="搜索因子" placeholder="搜索因子、表名或版本" value={query} onChange={(event) => refilter(() => setQuery(event.target.value))} />
        {groups.length > 1 && <select className="select" aria-label="因子分组" value={group} onChange={(event) => refilter(() => setGroup(event.target.value))}><option value="">全部分组</option>{groups.map((name) => <option key={name} value={name}>{name}</option>)}</select>}
        <button type="button" className="button" onClick={() => setTick((v) => v + 1)}>刷新</button>
      </div>
      {error && <V2Notice error title="因子目录不可用" description={error} />}
      {actionError && <V2Notice error title="操作失败" description={actionError} />}
      {!items && !error && <V2Loading />}
      {pending && <div className="bt-confirm" role="alertdialog" aria-label="确认移动因子">
        <p><strong>{pending.target === "pool" ? "移入因子池" : "移出因子池"}</strong>：{pending.item.key}（版本 {pending.item.version}）。{pending.target === "pool" ? "该因子其它在池版本会同时移回实验空间。" : "它会回到实验空间，历史评估结果保留。"}操作人和时间将被记录。</p>
        <div className="bt-form-row"><button type="button" className="button primary" disabled={busy} onClick={confirm}>{busy ? "正在提交…" : "确认"}</button><button type="button" className="button" disabled={busy} onClick={() => setPending(undefined)}>取消</button></div>
      </div>}
      {items && visible.length === 0 && <div className="empty"><strong>没有匹配的因子</strong><p>因子通过「提交」页的因子表上传；校验通过后默认进入实验空间。</p></div>}
      {items && visible.length > 0 && <div className="table-scroll"><table className="v2-table">
        <thead><tr><th>因子</th><th>表 / 版本</th><th>状态</th><th>方向</th><th>覆盖</th><th>最近变更</th><th>评估</th><th className="v2-action-column">操作</th></tr></thead>
        <tbody>{shown.map((item) => {
          const names = factorNames(item);
          const version = factorTableVersion(item);
          const change = factorChange(item);
          const direction = directionOf(item);
          const inPool = item.poolState === "pool";
          return <tr key={`${item.key}@${item.version}`}>
            <td className="primary"><div className="v2-cell-copy"><strong>{names.title}</strong>{names.subtitle && <small className="mono">{names.subtitle}</small>}</div></td>
            <td className="mono"><div className="v2-cell-copy"><span>{version.primary}</span>{version.secondary && <small>{version.secondary}</small>}</div></td>
            <td><span className={`status ${inPool ? "ready" : "default"}`}>{inPool ? "因子池" : "实验空间"}</span></td>
            <td>{direction === undefined ? "—" : direction < 0 ? "−1（反转）" : "+1"}</td>
            <td>{coverageOf(item)}</td>
            <td><div className="v2-cell-copy"><span>{change.actor}</span><small>{formatV2Time(change.at)}</small></div></td>
            <td><a href={evaluateHref(item)}>去评估</a></td>
            <td className="v2-action-cell"><button type="button" className="button" disabled={busy} onClick={() => setPending({ item, target: inPool ? "experiment" : "pool" })}>{inPool ? "移出因子池" : "移入因子池"}</button></td>
          </tr>;
        })}</tbody>
      </table></div>}
      {items && visible.length > FACTOR_PAGE_SIZE && <div className="v2-pagination"><span>第 {current * FACTOR_PAGE_SIZE + 1}–{current * FACTOR_PAGE_SIZE + shown.length} 条，共 {visible.length} 条 · 第 {current + 1}/{pages} 页</span><div><button type="button" className="button" disabled={current === 0} onClick={() => setPageIndex(current - 1)}>上一页</button><button type="button" className="button" disabled={current >= pages - 1} onClick={() => setPageIndex(current + 1)}>下一页</button></div></div>}
    </section>
  </section>;
}
