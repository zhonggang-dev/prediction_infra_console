"use client";

import { useEffect, useMemo, useState } from "react";
import { consoleV2, type ConsoleV2Generation, type ConsoleV2Overview, type ConsoleV2RunningMarket, type ConsoleV2RunningPool, type ConsoleV2SelectedMarket, type ConsoleV2SelectionRun, type ConsoleV2Settlement, type ConsoleV2TrackedRule } from "../lib/console-v2";
import { domainLabel, formatRemainingDays, labelOf, membershipLabels, membershipText, predictionGateLabels, predictionGateOrder, remainingDays, retireReasonLabels, retireReasonText, roundDomains, roundProgress, roundRows, roundStateLabels, roundStateTone, shortDate, slotClock, sourceLabels, tierLabels, tierOrder, tierRanges, tierText, trackedRuleState, type RoundRow } from "../lib/market-rounds";
import { formatV2Number, formatV2Time, V2ContextLinks, V2Facts, V2Frame, V2ListPage, V2Notice, V2Tabs, V2WorkspacePanel, useV2Filter, useWorkspaceTabs, v2ErrorText, v2Status, v2Unknown } from "./console-v2-resource";

type MarketsView = "running" | "selection" | "data";
const tabs = [{ href: "/markets/running", label: "运行市场", aliases: ["/markets"] }, { href: "/markets/selection", label: "每轮记录" }, { href: "/markets/data", label: "Polymarket 市场结算" }] as const;
export function MarketsV2Page({ view = "running" }: { view?: MarketsView }) {
  const workspace = useWorkspaceTabs(tabs, `/markets/${view}`);
  const config = workspace.active === "/markets/running" ? { title: "运行市场", description: "各平台运行池的成员、退出记录与白名单。" } : workspace.active === "/markets/data" ? { title: "Polymarket 市场结算", description: "官方采集快照与钱包结算入账分别核对。" } : { title: "每轮记录", description: "每天 9 轮，每轮按一个 Domain 选盘并更新该 Domain 的运行池；每行是一轮的选盘与维护结果。" };
  return <V2Frame eyebrow="Markets" {...config}><V2ContextLinks links={[{ href: "/predictions", label: "查看预测" }]} /><V2Tabs tabs={tabs} active={workspace.active} onSelect={(href) => workspace.select(href as typeof workspace.active)} /><V2WorkspacePanel active={workspace.active} href="/markets/running" visited={workspace.visited.has("/markets/running")}><RunningMarketViews /></V2WorkspacePanel><V2WorkspacePanel active={workspace.active} href="/markets/selection" visited={workspace.visited.has("/markets/selection")}><SelectionViews /></V2WorkspacePanel><V2WorkspacePanel active={workspace.active} href="/markets/data" visited={workspace.visited.has("/markets/data")}><SettlementList /></V2WorkspacePanel></V2Frame>;
}

function SourceFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <select className="select" aria-label="市场来源" value={value} onChange={(event) => onChange(event.target.value)}><option value="ALL">全部平台</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option></select>; }
function EligibilityFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <select className="select" aria-label="预测资格" value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部资格</option><option value="true">可预测</option><option value="false">仅资料</option></select>; }
function DomainFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <select className="select" aria-label="Domain" value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部 Domain</option>{roundDomains.map((domain) => <option key={domain} value={domain}>{domainLabel(domain)}</option>)}</select>; }
function MembershipFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <select className="select" aria-label="身份" value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部身份</option>{Object.entries(membershipLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>; }
function TierFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <select className="select" aria-label="期限档" value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部期限档</option>{tierOrder.filter((tier) => tier !== "unknown").map((tier) => <option key={tier} value={tier}>{tierLabels[tier]}（{tierRanges[tier]}）</option>)}</select>; }

const marketScopes = {
  current: { label: "运行池成员", caption: "每天 9 轮选盘，每轮更新一个 Domain。上表是今天各轮的结果，下表是当前成员；点上表一行，下表筛到该平台和 Domain。" },
  retired: { label: "已退出运行池", caption: "已离开运行池的市场及退出原因。" },
  tracked: { label: "白名单", caption: "按规则强制跟踪的市场：不受期限档和 3 天退出限制，市场结束时才退出；规则改动走 PR。" },
} as const;
type MarketScope = keyof typeof marketScopes;

function RunningMarketViews() {
  const [storedScope, setScope] = useV2Filter("market_scope", "current");
  const scope: MarketScope = storedScope === "retired" || storedScope === "tracked" ? storedScope : "current";
  useEffect(() => { if (storedScope === "pool") setScope("current"); }, [storedScope, setScope]);
  // Platform and Domain drive the list below only; the round summary always
  // shows both platforms, and clicking one of its rows narrows the list.
  const [source, setSource] = useV2Filter("source", "ALL");
  const [domain, setDomain] = useV2Filter("domain");
  // Filters that only one scope applies; the URL keeps applied filters only.
  // Each key has one hook instance here, so clearing it also updates the list.
  const [generationId, setGenerationId] = useV2Filter("generation_id");
  const [enabled, setEnabled] = useV2Filter("prediction_enabled");
  const [membership, setMembership] = useV2Filter("membership_class");
  const [tier, setTier] = useV2Filter("tier");
  const [trackedRule, setTrackedRule] = useV2Filter("tracked_rule_id");
  const [reason, setReason] = useV2Filter("retired_reason");
  const changeScope = (next: string) => {
    if (next !== "current") for (const clear of [setGenerationId, setEnabled, setMembership, setTier, setTrackedRule]) clear("");
    if (next !== "retired") setReason("");
    setScope(next);
  };
  // A frozen generation belongs to one platform: changing platform, or picking
  // today's lane in the summary, leaves it.
  const changeSource = (next: string) => { setSource(next); setGenerationId(""); };
  return <><div className="market-scope-bar"><label><span>运行范围</span><select className="select" aria-label="运行市场范围" value={scope} onChange={(event) => changeScope(event.target.value)}>{(Object.keys(marketScopes) as MarketScope[]).map((key) => <option key={key} value={key}>{marketScopes[key].label}</option>)}</select></label><p className="market-scope-caption">{marketScopes[scope].caption}</p></div>
    {scope === "current" && <><RoundSummary source={source} domain={domain} onSelect={(nextSource, nextDomain) => { changeSource(nextSource); setDomain(nextDomain); }} onClearDomain={() => setDomain("")} /><RunningMembers source={source} domain={domain} onSource={changeSource} onDomain={setDomain} filters={{ generationId, enabled, setEnabled, membership, setMembership, tier, setTier, trackedRule, setTrackedRule }} /></>}
    {scope === "retired" && <RetiredMarkets source={source} domain={domain} reason={reason} onSource={setSource} onDomain={setDomain} onReason={setReason} />}
    {scope === "tracked" && <TrackedRules source={source} domain={domain} onSource={setSource} onDomain={setDomain} />}
  </>;
}

/** Today's rounds of both platforms, from overview; the counts are the lane's current generation. */
function RoundSummary({ source, domain, onSelect, onClearDomain }: { source: string; domain: string; onSelect: (source: string, domain: string) => void; onClearDomain: () => void }) {
  const [overview, setOverview] = useState<ConsoleV2Overview>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [opened, setOpened] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void consoleV2.infra.overview().then((result) => { if (!cancelled) { setOverview(result.data); setError(undefined); } }).catch((cause: unknown) => { if (!cancelled) setError(v2ErrorText(cause)); });
    return () => { cancelled = true; };
  }, [attempt]);
  if (error) return <section className="round-summary panel panel-pad"><V2Notice error title="今日轮次不可用" description={error} /><button type="button" className="button" onClick={() => setAttempt((value) => value + 1)}>重试</button></section>;
  if (!overview) return <section className="round-summary panel panel-pad" aria-busy="true"><div className="skeleton" /><div className="skeleton" /></section>;
  const schedule = overview.roundSchedule;
  if (!schedule) return <section className="round-summary panel panel-pad"><V2Notice title="轮次时间表未提供" description="后端没有返回今天的轮次时间表；下方成员明细仍可按平台和 Domain 筛选。" /></section>;
  const now = new Date();
  const rows = roundRows(overview, now);
  const laneKey = (row: RoundRow) => `${row.marketSource}:${row.domain}`;
  const openedRow = rows.find((row) => laneKey(row) === opened && row.current);
  return <section className="round-summary" aria-label="今日轮次">
    {overview.sources.map((item) => {
      const sourceRows = rows.filter((row) => row.marketSource === item.marketSource);
      const progress = roundProgress(sourceRows, schedule.timezone, now);
      const filtering = Boolean(domain) && (source === "ALL" || source === item.marketSource);
      return <div key={item.marketSource} className="panel round-source">
        <div className="section-head panel-pad"><div><h2 className="section-title">{labelOf(sourceLabels, item.marketSource)} · 今日轮次</h2><p className="section-caption">业务日 {schedule.businessDate} · 已发布 {progress.published}/{progress.total} 轮{progress.next ? ` · 下一轮 ${progress.next}` : ""}</p></div>{filtering && <button type="button" className="button" onClick={onClearDomain}>清除下表 Domain 筛选</button>}</div>
        <div className="table-scroll"><table className="v2-table round-table"><thead><tr><th>轮次</th><th>状态</th><th>成员</th><th>正式</th><th>候补</th><th>白名单</th><th>可预测</th><th>本轮新收</th><th>本轮退出</th><th>名额明细</th></tr></thead><tbody>
          {sourceRows.map((row) => <RoundSummaryRow key={`${row.marketSource}:${row.roundIndex}`} row={row} timezone={schedule.timezone} selected={domain === row.domain && (source === row.marketSource || source === "ALL")} opened={opened === laneKey(row)} onSelect={() => onSelect(row.marketSource, row.domain)} onOpen={() => setOpened(laneKey(row))} />)}
          <tr className="round-total"><td><strong>合计（每个盘只算一次）</strong></td><td /><td>{formatV2Number(item.currentMemberCount, 0)}</td><td>{formatV2Number(item.currentClassCounts?.core, 0)}</td><td>{formatV2Number(item.currentClassCounts?.borrowed, 0)}</td><td>{formatV2Number(item.currentClassCounts?.tracked, 0)}</td><td>{formatV2Number(item.currentPredictionEnabledCount, 0)}</td><td colSpan={3} /></tr>
        </tbody></table></div>
      </div>;
    })}
    {openedRow && <RoundQuotaDrawer row={openedRow} timezone={schedule.timezone} onClose={() => setOpened(undefined)} />}
  </section>;
}

function sumCounts(values?: Record<string, number>) { return values ? Object.values(values).reduce((total, value) => total + value, 0) : null; }

function RoundSummaryRow({ row, timezone, selected, opened, onSelect, onOpen }: { row: RoundRow; timezone: string; selected: boolean; opened: boolean; onSelect: () => void; onOpen: () => void }) {
  const generation = row.current;
  const summary = generation?.roundSummary;
  return <tr className={selected ? "clickable is-selected" : "clickable"} aria-selected={selected} onClick={onSelect}>
      <td><div className="v2-cell-copy"><strong>{slotClock(row.slotAt, timezone)} 第 {row.roundIndex} 轮 {domainLabel(row.domain)}</strong><small>{row.predict ? "预测轮" : "不预测"}{generation ? ` · 维护批次 ${generation.generationId}` : ""}</small></div></td>
      <td><div className="v2-cell-copy">{v2Status(roundStateTone[row.state], roundStateLabels[row.state])}{row.carriedFrom && <small>成员沿用 {shortDate(row.carriedFrom)}</small>}</div></td>
      <td>{formatV2Number(generation?.memberCount, 0)}</td>
      <td>{formatV2Number(generation?.classCounts?.core, 0)}</td>
      <td>{formatV2Number(generation?.classCounts?.borrowed, 0)}</td>
      <td>{formatV2Number(generation?.classCounts?.tracked, 0)}</td>
      <td>{row.predict ? formatV2Number(generation?.predictionEnabledCount, 0) : "—"}</td>
      <td>{formatV2Number(summary?.admitted, 0)}</td>
      <td>{formatV2Number(sumCounts(summary?.exits), 0)}</td>
      <td><button type="button" className="button" aria-haspopup="dialog" aria-expanded={opened} disabled={!generation} onClick={(event) => { event.stopPropagation(); onOpen(); }}>查看</button></td>
    </tr>;
}

/** Side drawer with the quota table, lending flows, exits and prediction gates of one round generation. */
function RoundQuotaDrawer({ row, timezone, onClose }: { row: RoundRow; timezone: string; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const generation = row.current!;
  const summary = generation.roundSummary;
  const tracked = generation.classCounts?.tracked ?? 0;
  const exits = Object.entries(summary?.exits ?? {}).filter(([, count]) => count > 0);
  const gates = predictionGateOrder.filter((gate) => (summary?.predictionGates?.[gate] ?? 0) > 0);
  return <>
    <button type="button" className="question-drawer-backdrop" aria-label="关闭名额明细" onClick={onClose} />
    <aside className="question-drawer round-drawer" role="dialog" aria-modal="true" aria-label="名额明细">
      <div className="round-detail">
        <div className="section-head"><h3 className="section-title">{labelOf(sourceLabels, row.marketSource)} · {slotClock(row.slotAt, timezone)} 第 {row.roundIndex} 轮 {domainLabel(row.domain)}<small>维护批次 {generation.generationId}{row.carriedFrom ? ` · 沿用 ${shortDate(row.carriedFrom)}` : ""}</small></h3><button type="button" className="button" onClick={onClose}>关闭</button></div>
        {!summary ? <p className="v2-inline-note">这一代没有轮次摘要（切换前的老流程）。</p> : <>
          <V2Facts values={[
            { label: "容量", value: summary.capacity === null ? "不设容量" : formatV2Number(summary.capacity, 0) },
            ...(tracked > 0 && summary.ordinaryCapacity !== null ? [{ label: `普通成员名额（扣除白名单 ${formatV2Number(tracked, 0)} 个）`, value: formatV2Number(summary.ordinaryCapacity, 0) }] : []),
            { label: "本轮新收", value: formatV2Number(summary.admitted, 0) },
            { label: "本轮退出", value: formatV2Number(sumCounts(summary.exits), 0) },
          ]} />
          {summary.tiers.length ? <><div className="round-quota-table-wrap"><table className="v2-table round-quota-table"><thead><tr><th>期限档</th><th>剩余天数</th><th>名额</th><th>正式</th><th>借出</th><th>收入候补</th><th>空位</th></tr></thead><tbody>
            {summary.tiers.map((tier) => {
              const empty = tier.target === null || tier.core === null || tier.lent === null ? null : Math.max(0, tier.target - tier.core - tier.lent);
              return <tr key={tier.tier}><td>{labelOf(tierLabels, tier.tier)}</td><td>{labelOf(tierRanges, tier.tier)}</td><td>{formatV2Number(tier.target, 0)}</td><td>{formatV2Number(tier.core, 0)}</td><td>{formatV2Number(tier.lent, 0)}</td><td>{formatV2Number(tier.received, 0)}</td><td>{formatV2Number(empty, 0)}</td></tr>;
            })}
          </tbody></table></div>
          <p className="v2-inline-note">名额 = {tracked > 0 ? "普通成员名额" : "容量"}按 40/30/15/10/5 分到五个档。空位表示这个档的候选盘不够填满。借位只从较短的档借给已经满了、还有候选在排队的较长档，从最短的档开始借；较长档的名额不会借给较短档。</p></> : <p className="v2-inline-note">不分档 · 不设容量</p>}
          <div className="round-detail-lists">
            <div><h4>借位流向</h4>{summary.lending.length ? <ul>{summary.lending.map((lent) => <li key={`${lent.lender}:${lent.receiver}`}>{labelOf(tierLabels, lent.lender)} → {labelOf(tierLabels, lent.receiver)}：{formatV2Number(lent.count, 0)}</li>)}</ul> : <p>无</p>}</div>
            <div><h4>本轮退出</h4>{exits.length ? <ul>{exits.map(([reason, count]) => <li key={reason}>{retireReasonText(reason)}：{formatV2Number(count, 0)}</li>)}</ul> : <p>无</p>}</div>
            {row.predict && <div><h4>预测门禁（每个盘停在第一道没过的门）</h4>{gates.length ? <ul>{gates.map((gate) => <li key={gate}>{labelOf(predictionGateLabels, gate)}：{formatV2Number(summary.predictionGates?.[gate], 0)}</li>)}</ul> : <p>无</p>}</div>}
          </div>
        </>}
      </div>
    </aside>
  </>;
}

type MemberFilters = { generationId: string; enabled: string; setEnabled: (value: string) => void; membership: string; setMembership: (value: string) => void; tier: string; setTier: (value: string) => void; trackedRule: string; setTrackedRule: (value: string) => void };

function RunningMembers({ source, domain, onSource, onDomain, filters }: { source: string; domain: string; onSource: (value: string) => void; onDomain: (value: string) => void; filters: MemberFilters }) {
  const { generationId, enabled, setEnabled, membership, setMembership, tier, setTier, trackedRule, setTrackedRule } = filters;
  const ruleTitles = useTrackedRuleTitles();
  const params = useMemo(() => ({ generation_id: generationId || undefined, source, domain: domain || undefined, membership_class: membership || undefined, tier: tier || undefined, tracked_rule_id: trackedRule || undefined, prediction_enabled: enabled || undefined, market_scope: "current" }), [generationId, source, domain, membership, tier, trackedRule, enabled]);
  const now = new Date();
  return <>{generationId && <section className="panel panel-pad selection-context"><strong>{source === "ALL" ? "指定" : labelOf(sourceLabels, source)} 维护批次 {generationId}</strong><V2ContextLinks links={[{ href: "/markets/running", label: "返回运行池成员" }, { href: "/markets/selection", label: "返回每轮记录" }, { href: `/predictions?generation_id=${encodeURIComponent(generationId)}&${source === "ALL" ? "sources=POLYMARKET,KALSHI" : `source=${source}`}&scope=history`, label: "查看本轮预测" }]} /></section>}
  {trackedRule && <section className="panel panel-pad selection-context"><strong>白名单规则 {trackedRule}{ruleTitles.get(trackedRule) ? ` ${ruleTitles.get(trackedRule)}` : ""} 的成员</strong><button type="button" className="button" onClick={() => setTrackedRule("")}>清除规则筛选</button><V2ContextLinks links={[{ href: "/markets/running?market_scope=tracked", label: "返回白名单" }]} /></section>}
  <V2ListPage<ConsoleV2RunningMarket> title="成员明细" description="域内成交量排名按完整一代计算，筛选不重新编号；排名不等同于预测门禁名次。" load={loadRunningMarkets} params={params} rowKey={(item) => `${item.marketSource}:${item.generationId}:${item.runningMarketId}`} controls={<><SourceFilter value={source} onChange={onSource} /><DomainFilter value={domain} onChange={onDomain} /><MembershipFilter value={membership} onChange={setMembership} /><TierFilter value={tier} onChange={setTier} /><EligibilityFilter value={enabled} onChange={setEnabled} /></>} columns={[
    { label: "问题 / 平台 · 市场", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small>{labelOf(sourceLabels, item.marketSource)} · {item.marketId}</small></div> },
    { label: "Domain", render: (item) => domainLabel(item.generationDomain ?? item.primaryDomain) },
    { label: "身份", className: "member-identity", render: (item) => <div className="v2-cell-copy"><span className={`member-class member-class-${(item.membershipClass ?? "unknown").toLowerCase()}`}>{membershipText(item)}</span>{item.trackedRuleId && ruleTitles.get(item.trackedRuleId) && <small title={ruleTitles.get(item.trackedRuleId)}>{ruleTitles.get(item.trackedRuleId)}</small>}</div> },
    { label: "期限档", render: (item) => tierText(item.currentTier, item.entryTier) },
    { label: "剩余天数", render: (item) => <div className="v2-cell-copy"><span>{formatRemainingDays(remainingDays(item.endAt, now))}</span><small>{formatV2Time(item.endAt)}</small></div> },
    { label: "24h 成交量 · 域内排名", render: (item) => <div className="v2-cell-copy"><span>{formatV2Number(item.volume24h, 2)}</span><small>第 {formatV2Number(item.domainVolumeRank, 0)} 名 · {formatV2Time(item.marketObservedAt)}</small></div> },
    { label: "预测资格", render: (item) => <div className="v2-cell-copy"><span>{item.predictionEnabled === null ? "未提供" : item.predictionEnabled ? "可预测" : "仅资料"}</span>{!item.predictionEnabled && item.predictionGate && item.predictionGate !== "ENABLED" && item.predictionGate !== "NOT_PREDICTION_DOMAIN" && <small>{labelOf(predictionGateLabels, item.predictionGate)}</small>}</div> },
  ]} /></>;
}
/** Rule ID → title of the whitelist; members only carry the rule ID. Missing rules leave the ID alone. */
function useTrackedRuleTitles() {
  const [titles, setTitles] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    void consoleV2.infra.trackedRules({ limit: 100 }).then((result) => { if (!cancelled) setTitles(new Map(result.data.items.map((rule) => [rule.ruleId, rule.title]))); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return titles;
}
const withoutUi = (params: Record<string, string | number | undefined>) => { const result = { ...params }; delete result.market_scope; delete result.record_view; return result; };
const loadRunningMarkets = (params: Record<string, string | number | undefined>) => consoleV2.infra.runningMarkets(withoutUi(params));
const loadRetiredMarkets = (params: Record<string, string | number | undefined>) => consoleV2.infra.runningPool(withoutUi(params));
const loadSelected = (params: Record<string, string | number | undefined>) => consoleV2.infra.selectedMarkets(withoutUi(params));
const loadTrackedRules = (params: Record<string, string | number | undefined>) => consoleV2.infra.trackedRules(withoutUi(params));
function RetiredMarkets({ source, domain, reason, onSource, onDomain, onReason }: { source: string; domain: string; reason: string; onSource: (value: string) => void; onDomain: (value: string) => void; onReason: (value: string) => void }) {
  const params = useMemo(() => ({ status: "RETIRED", source, domain: domain || undefined, retired_reason: reason || undefined, market_scope: "retired" }), [source, domain, reason]);
  return <V2ListPage<ConsoleV2RunningPool> title="已退出运行池" load={loadRetiredMarkets} params={params} rowKey={(item) => `${item.marketSource}:${item.runningMarketId}`} controls={<><SourceFilter value={source} onChange={onSource} /><DomainFilter value={domain} onChange={onDomain} /><select className="select" aria-label="退出原因" value={reason} onChange={(event) => onReason(event.target.value)}><option value="">全部退出原因</option>{Object.entries(retireReasonLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></>} columns={[
    { label: "平台 / 市场", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small>{labelOf(sourceLabels, item.marketSource)} · {item.marketId}</small></div> },
    { label: "Domain", render: (item) => domainLabel(item.primaryDomain) },
    { label: "退出时身份", render: (item) => membershipText(item) },
    { label: "退出时间", render: (item) => formatV2Time(item.retiredAt) },
    { label: "退出原因", render: (item) => retireReasonText(item.retiredReason) },
  ]} />;
}
/** Each round's maintenance generation with the selection run it was built from. */
function RoundRecords() {
  const [status, setStatus] = useV2Filter("status");
  const [source, setSource] = useV2Filter("source", "ALL");
  const params = useMemo(() => ({ status: status || undefined, source }), [status, source]);
  return <V2ListPage<RoundRecord> title="每轮记录" description="每轮先选盘，再用入选盘更新这个 Domain 的运行池（生成一代成员名单）；同一 Domain 当天重跑会多出一行。" load={loadRoundRecords} params={params} rowKey={(item) => `${item.marketSource}:${item.generationId}`} controls={<><SourceFilter value={source} onChange={setSource} /><select className="select" aria-label="维护状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="PENDING">处理中</option><option value="PUBLISHED">已完成</option><option value="FAILED">失败</option></select></>} columns={[
    { label: "业务日 · 轮次", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{item.domain ? `${v2Unknown(item.businessDate, "—")} 第 ${item.roundIndex ?? "?"} 轮 ${domainLabel(item.domain)}` : "老流程（不分 Domain）"}</strong><small>{labelOf(sourceLabels, item.marketSource)} · 维护批次 {item.generationId}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, `${item.status === "PUBLISHED" ? "已完成" : item.status}${item.isCurrent ? " · 当前" : ""}`) },
    { label: "选盘 候选 / 入选 / 拒绝", render: (item) => <div className="v2-cell-copy"><span>{item.selection ? `${formatV2Number(item.selection.candidateCount, 0)} / ${formatV2Number(item.selection.selectedCount, 0)} / ${formatV2Number(item.selection.rejectedCount, 0)}` : "—"}</span><small>选盘批次 {v2Unknown(item.sourceSelectionRunId, "—")}</small></div> },
    { label: "成员", render: (item) => <div className="v2-cell-copy"><span>{formatV2Number(item.memberCount, 0)}</span>{item.classCounts && <small>正式 {formatV2Number(item.classCounts.core, 0)} · 候补 {formatV2Number(item.classCounts.borrowed, 0)} · 白名单 {formatV2Number(item.classCounts.tracked, 0)}</small>}</div> },
    { label: "新收 / 退出", render: (item) => item.roundSummary ? `${formatV2Number(item.roundSummary.admitted, 0)} / ${formatV2Number(sumCounts(item.roundSummary.exits), 0)}` : "—" },
    { label: "可预测", render: (item) => formatV2Number(item.predictionEnabledCount, 0) },
    { label: "发布时间", render: (item) => formatV2Time(item.publishedAt) },
    { label: "查看", className: "v2-action-cell", render: (item) => item.sourceSelectionRunId ? <a className="button" href={`/markets/selection?selection_run_id=${encodeURIComponent(item.sourceSelectionRunId)}`}>入选盘</a> : "—" },
  ]} />;
}
type RoundRecord = ConsoleV2Generation & { selection?: ConsoleV2SelectionRun };
/** Selection runs list newest first, like generations; read pages until every run of this page is found (at most 5). */
async function loadRoundRecords(params: Record<string, string | number | undefined>) {
  const page = await consoleV2.infra.runningGenerations(params);
  const wanted = new Set(page.data.items.map((item) => item.sourceSelectionRunId).filter((id): id is string => Boolean(id)));
  const runs = new Map<string, ConsoleV2SelectionRun>();
  for (let offset = 0, round = 0; wanted.size > 0 && round < 5; round++, offset += 100) {
    const result = await consoleV2.infra.selectionRuns({ limit: 100, offset }).catch(() => undefined);
    if (!result) break;
    for (const run of result.data.items) if (wanted.delete(run.selectionRunId)) runs.set(run.selectionRunId, run);
    if (!result.data.hasMore) break;
  }
  return { ...page, data: { ...page.data, items: page.data.items.map((item): RoundRecord => ({ ...item, selection: item.sourceSelectionRunId ? runs.get(item.sourceSelectionRunId) : undefined })) } };
}
function SelectionViews() {
  const [runId] = useV2Filter("selection_run_id");
  return runId ? <><section className="panel panel-pad selection-context"><strong>选盘批次 {runId}</strong><V2ContextLinks links={[{ href: "/markets/selection", label: "返回每轮记录" }]} /></section><SelectedMarkets runId={runId} /></> : <RoundRecords />;
}
function SelectedMarkets({ runId }: { runId: string }) {
  const params = useMemo(() => ({ selection_run_id: runId, record_view: "selection" }), [runId]);
  return <V2ListPage<ConsoleV2SelectedMarket> title="入选成员" description="业务按领域交易量配额选盘；这里显示完整批次内各平台、领域的成交量排名。" load={loadSelected} params={params} rowKey={(item) => item.selectedMarketId} columns={[
    { label: "平台 / 问题", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small>{item.marketSource}</small></div> }, { label: "交易所市场 / 条件", className: "mono", render: (item) => `${item.marketId} ${item.conditionId}` }, { label: "领域", render: (item) => v2Unknown(item.primaryDomain) }, { label: "域内成交量排名", render: (item) => formatV2Number(item.domainVolumeRank, 0) }, { label: "24h 成交量", render: (item) => formatV2Number(item.volume24h, 4) }, { label: "预计结束", render: (item) => formatV2Time(item.endAt) },
  ]} />;
}
function SettlementList() {
  const params = useMemo(() => ({ source: "POLYMARKET" }), []);
  return <V2ListPage<ConsoleV2Settlement> title="Polymarket 市场结算" description="来自 Infra 保存的 Polymarket / Gamma 官方采集快照；未接入 Kalshi 全市场结算采集。市场结果不等于钱包兑付入账。" load={consoleV2.infra.settlements} params={params} rowKey={(item) => `${item.marketSource}:${item.marketId}:${item.conditionId}`} columns={[
    { label: "交易所市场", className: "primary mono", render: (item) => item.marketId }, { label: "条件", className: "mono", render: (item) => item.conditionId }, { label: "状态", render: (item) => v2Status(item.status, item.status === "OPEN" ? "尚未结算" : item.status) }, { label: "结果", render: (item) => item.resolvedOutcome ?? "—" }, { label: "Yes / No", render: (item) => `${item.settlementYes === null ? "—" : formatV2Number(item.settlementYes, 4)} / ${item.settlementNo === null ? "—" : formatV2Number(item.settlementNo, 4)}` }, { label: "结算时间", render: (item) => item.resolvedAt ? formatV2Time(item.resolvedAt) : "—" },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "数据来源", value: "Polymarket / Gamma 采集快照" }, { label: "关闭时间", value: item.closedAt ? formatV2Time(item.closedAt) : "—" }, { label: "采集时间", value: item.sourceAt ? formatV2Time(item.sourceAt) : "—" }, { label: "可用时间", value: item.availableAt ? formatV2Time(item.availableAt) : "—" }]} />} />;
}
function TrackedRules({ source, domain, onSource, onDomain }: { source: string; domain: string; onSource: (value: string) => void; onDomain: (value: string) => void }) {
  const params = useMemo(() => ({ source: source === "POLYMARKET" || source === "KALSHI" ? source : undefined, domain: domain || undefined, market_scope: "tracked" }), [source, domain]);
  const now = new Date();
  return <V2ListPage<ConsoleV2TrackedRule> title="白名单规则" description="每条规则最多跟 3 个事件、每个事件最多 3 个盘。" load={loadTrackedRules} params={params} rowKey={(item) => item.ruleId} searchPlaceholder="搜索规则号或名称" controls={<><SourceFilter value={source} onChange={onSource} /><DomainFilter value={domain} onChange={onDomain} /></>} columns={[
    { label: "规则", className: "mono", render: (item) => item.ruleId },
    { label: "名称", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.title}</strong><small>{v2Unknown(item.kind, "")}{item.series ? ` · ${item.series}` : ""}</small></div> },
    { label: "平台 / Domain", render: (item) => `${labelOf(sourceLabels, item.marketSource)} · ${domainLabel(item.domain)}` },
    { label: "跟踪事件", render: (item) => formatV2Number(item.trackedEventCount, 0) },
    { label: "在池盘数", render: (item) => formatV2Number(item.activeMemberCount, 0) },
    { label: "状态", render: (item) => { const state = trackedRuleState(item, now); return v2Status(state.tone, state.label); } },
    { label: "最近命中", render: (item) => item.lastSeenAt ? formatV2Time(item.lastSeenAt) : "—" },
    { label: "成员", render: (item) => item.activeMemberCount > 0 ? <a className="button" href={`/markets/running?market_scope=current&source=${encodeURIComponent(item.marketSource)}&tracked_rule_id=${encodeURIComponent(item.ruleId)}`}>查看成员</a> : "—" },
  ]} />;
}
