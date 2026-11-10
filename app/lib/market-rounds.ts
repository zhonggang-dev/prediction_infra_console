import type { ConsoleV2Generation, ConsoleV2Overview, ConsoleV2RoundSchedule, ConsoleV2TrackedRule } from "./console-v2.ts";

/** Domains are shown by their English names, as in the selection rules (see market-domain-rounds-contract). */
export const roundDomains = ["World/Geopolitics", "Politics", "Finance", "Culture", "Crypto", "Science/Tech", "Weather", "Sports", "Esports"] as const;

export const membershipLabels: Record<string, string> = { CORE: "正式", BORROWED: "候补", TRACKED: "白名单" };

export const tierLabels: Record<string, string> = {
  near_settlement: "临近结算",
  short: "短期",
  mid: "中期",
  mid_long: "中长期",
  long: "长期",
  ultra_long: "超长期",
  unknown: "无结束时间",
};

export const tierRanges: Record<string, string> = {
  near_settlement: "≤3 天",
  short: "3–14 天",
  mid: "14–30 天",
  mid_long: "30–60 天",
  long: "60–90 天",
  ultra_long: ">90 天",
  unknown: "—",
};

export const tierOrder = ["near_settlement", "short", "mid", "mid_long", "long", "ultra_long", "unknown"];

/** Exit reasons the round flow still produces; the filter offers only these. */
export const retireReasonLabels: Record<string, string> = {
  market_ended: "已结束",
  near_settlement: "剩余≤3 天",
  reclaimed: "候补被回收",
};

/** One-off exits of earlier pool rules (10-28 window rule, legacy cutover); kept in history under one name. */
const legacyRetireReasons = new Set(["admission_rule_changed", "event_cap", "superseded"]);

export function retireReasonText(reason: string | undefined) {
  return reason && legacyRetireReasons.has(reason) ? "旧规则退出（10-28）" : labelOf(retireReasonLabels, reason);
}

export const predictionGateLabels: Record<string, string> = {
  ENABLED: "通过",
  NOT_PREDICTION_DOMAIN: "不预测的 domain",
  OUTSIDE_WINDOW: "不在 3–14 天",
  EVENT_CAP: "同事件已取 3 个",
  OUTSIDE_TOP: "不在前 100 名",
  NO_QUOTE: "无报价",
  MID_OUT_OF_RANGE: "mid 不在 0.1–0.9",
  SPREAD: "价差 > 0.10",
  REL_SPREAD: "相对价差过大",
  MAX_COUNT: "超过数量上限（旧）",
  MID_UNCHANGED: "mid 未变（旧）",
};

export const predictionGateOrder = ["ENABLED", "OUTSIDE_WINDOW", "EVENT_CAP", "OUTSIDE_TOP", "NO_QUOTE", "MID_OUT_OF_RANGE", "SPREAD", "REL_SPREAD", "NOT_PREDICTION_DOMAIN", "MAX_COUNT", "MID_UNCHANGED"];

export const sourceLabels: Record<string, string> = { POLYMARKET: "Polymarket", KALSHI: "Kalshi" };

/** Unknown codes stay visible as-is rather than being hidden. */
export function labelOf(labels: Record<string, string>, value: string | undefined, fallback = "—") {
  if (!value) return fallback;
  return labels[value] ?? value;
}

export function domainLabel(value: string | undefined) { return value || "—"; }

/** 正式 / 候补（借短期名额）/ 白名单 W04. */
export function membershipText(item: { membershipClass?: string; borrowedFromTier?: string; trackedRuleId?: string }) {
  const label = labelOf(membershipLabels, item.membershipClass);
  if (item.membershipClass === "BORROWED" && item.borrowedFromTier) return `${label}（借${labelOf(tierLabels, item.borrowedFromTier)}名额）`;
  if (item.membershipClass === "TRACKED" && item.trackedRuleId) return `${label} ${item.trackedRuleId}`;
  return label;
}

/** 中期，or 中期（入池时中长期） when the member has moved tier since entry. */
export function tierText(currentTier: string | undefined, entryTier?: string) {
  const current = labelOf(tierLabels, currentTier);
  return entryTier && currentTier && entryTier !== currentTier ? `${current}（入池时${labelOf(tierLabels, entryTier)}）` : current;
}

export function remainingDays(endAt: string | undefined, now: Date): number | null {
  if (!endAt) return null;
  const end = Date.parse(endAt);
  if (Number.isNaN(end)) return null;
  return (end - now.getTime()) / 86_400_000;
}

export function formatRemainingDays(days: number | null) {
  if (days === null) return "—";
  if (days < 0) return "已过结束时间";
  if (days < 1) return "不足 1 天";
  return `${Math.floor(days)} 天`;
}

/** Display a business day "2026-11-10" as "11-10". */
export function shortDate(value: string | undefined) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : "—"; }

/** Slot time of a round in the schedule's zone, e.g. "02:10". */
export function slotClock(slotAt: string, timeZone: string) {
  const date = new Date(slotAt);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export type RoundState = "PUBLISHED" | "PENDING" | "FAILED" | "NOT_DUE" | "RUNNING" | "MISSING";

export const roundStateLabels: Record<RoundState, string> = {
  PUBLISHED: "已发布",
  PENDING: "处理中",
  FAILED: "失败",
  NOT_DUE: "未到时间",
  RUNNING: "进行中",
  MISSING: "缺跑",
};

/** CSS status class reusing the shared status palette. */
export const roundStateTone: Record<RoundState, string> = {
  PUBLISHED: "published",
  PENDING: "processing",
  FAILED: "failed",
  NOT_DUE: "default",
  RUNNING: "running",
  MISSING: "error",
};

/** A round with no generation yet is "running" this long after its slot before it counts as missed. */
export const ROUND_GRACE_MS = 30 * 60_000;

export interface RoundRow {
  roundIndex: number;
  domain: string;
  slotAt: string;
  predict: boolean;
  marketSource: string;
  state: RoundState;
  /** Today's generation of the lane, if any (any status). */
  todayGenerationId?: string;
  /** The lane's current published generation, which may be from an earlier day. */
  current?: ConsoleV2Generation;
  /** Business day of the current generation when it is not today's: the pool still uses it. */
  carriedFrom?: string;
}

/**
 * One row per (round, source) of today's timetable: today's generation status,
 * or, when there is none yet, whether the slot is still ahead, in progress or
 * missed. The current generation of the lane is attached so the counts shown
 * are always the ones the pool is using; an older one is reported as carried.
 */
export function roundRows(overview: ConsoleV2Overview | undefined, now: Date): RoundRow[] {
  const schedule = overview?.roundSchedule;
  if (!overview || !schedule) return [];
  const currentByLane = new Map<string, ConsoleV2Generation>();
  for (const source of overview.sources) for (const generation of source.currentGenerations) if (generation.domain) currentByLane.set(`${source.marketSource}\u0000${generation.domain}`, generation);
  const rows: RoundRow[] = [];
  for (const round of schedule.rounds) {
    for (const lane of round.sources) {
      const current = currentByLane.get(`${lane.marketSource}\u0000${round.domain}`);
      const carriedFrom = current?.businessDate && current.businessDate !== schedule.businessDate ? current.businessDate : undefined;
      rows.push({ roundIndex: round.roundIndex, domain: round.domain, slotAt: round.slotAt, predict: round.predict, marketSource: lane.marketSource, state: roundState(lane, round.slotAt, now), todayGenerationId: lane.generationId, current, carriedFrom });
    }
  }
  return rows;
}

export function roundState(lane: ConsoleV2RoundSchedule["rounds"][number]["sources"][number], slotAt: string, now: Date): RoundState {
  if (lane.status === "PUBLISHED") return "PUBLISHED";
  if (lane.status === "PENDING") return "PENDING";
  if (lane.status === "FAILED") return "FAILED";
  const slot = Date.parse(slotAt);
  if (now.getTime() < slot) return "NOT_DUE";
  if (now.getTime() < slot + ROUND_GRACE_MS) return "RUNNING";
  return "MISSING";
}

/** "今日 8/16 轮已发布，下一轮 16:10 Esports" for one source. */
export function roundProgress(rows: RoundRow[], timeZone: string, now: Date) {
  const published = rows.filter((row) => row.state === "PUBLISHED").length;
  const next = rows.filter((row) => Date.parse(row.slotAt) > now.getTime()).sort((a, b) => Date.parse(a.slotAt) - Date.parse(b.slotAt))[0];
  return { published, total: rows.length, next: next ? `${slotClock(next.slotAt, timeZone)} ${domainLabel(next.domain)}` : undefined };
}

function sourceOrder(source: string | undefined) { return source === "POLYMARKET" ? 0 : source === "KALSHI" ? 1 : 2; }

/** Today's prediction lanes: every current generation that has prediction-enabled members. */
export function predictionGenerations(overview: ConsoleV2Overview | undefined, source: string) {
  if (!overview) return [];
  return overview.sources
    .filter((item) => !source || item.marketSource === source)
    .flatMap((item) => item.currentGenerations.filter((generation) => (generation.predictionEnabledCount ?? 0) > 0).map((generation) => ({ ...generation, marketSource: generation.marketSource ?? item.marketSource })))
    .sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0) || sourceOrder(a.marketSource) - sourceOrder(b.marketSource));
}

/** "11-10 第 3 轮 Finance" for a generation reference. */
export function generationLabel(generation: { domain?: string; businessDate?: string; roundIndex: number | null; generationId: string }) {
  if (!generation.domain) return `维护批次 ${generation.generationId}`;
  return `${shortDate(generation.businessDate)} 第 ${generation.roundIndex ?? "?"} 轮 ${domainLabel(generation.domain)}`;
}

/** "正常" / "已命中未入池" / "未找到开放事件" for one whitelist rule. */
export function trackedRuleState(rule: Pick<ConsoleV2TrackedRule, "activeMemberCount" | "lastSeenAt">, now: Date) {
  if (rule.activeMemberCount > 0) return { label: "正常", tone: "published" };
  const seen = rule.lastSeenAt ? Date.parse(rule.lastSeenAt) : NaN;
  if (!Number.isNaN(seen) && now.getTime() - seen < 2 * 86_400_000) return { label: "已命中未入池", tone: "pending" };
  return { label: "未找到开放事件", tone: "error" };
}
