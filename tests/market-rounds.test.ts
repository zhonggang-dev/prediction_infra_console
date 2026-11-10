import assert from "node:assert/strict";
import test from "node:test";
import { consoleV2, ConsoleV2ContractError, type ConsoleV2Generation, type ConsoleV2Overview } from "../app/lib/console-v2.ts";
import { domainLabel, formatRemainingDays, generationLabel, membershipText, retireReasonText, predictionGenerations, remainingDays, roundProgress, roundRows, roundState, ROUND_GRACE_MS, tierText, trackedRuleState, todayRoundGeneration, roundPredictionHref, type RoundRow } from "../app/lib/market-rounds.ts";
import { GET } from "../app/api/console/v2/[...path]/route.ts";

async function withFetch(body: unknown, run: (calls: string[]) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => { calls.push(String(input)); return new Response(JSON.stringify(body)); }) as typeof fetch;
  try { await run(calls); } finally { globalThis.fetch = previousFetch; }
}

const roundGeneration = (id: number, domain: string, round: number, members: number, enabled: number, businessDate = "2026-11-10") => ({
  generation_id: id, market_source: "POLYMARKET", source_selection_run_id: id + 60, status: "PUBLISHED", is_current: true,
  observed_at: "2026-11-09T18:10:35Z", published_at: "2026-11-09T18:12:00Z", member_count: members, prediction_enabled_count: enabled,
  domain, business_date: businessDate, round_index: round, class_counts: { core: members - 2, borrowed: 1, tracked: 1 },
  round_summary: {
    capacity: 1200, ordinary_capacity: 1199, admitted: 3, exits: { market_ended: 2, near_settlement: 1 },
    tiers: [{ tier: "short", weight: 40, target: 480, core: 120, lent: 300, received: 0 }], lending: [{ lender: "short", receiver: "ultra_long", count: 300 }],
    capacity_conflicts: [{ rule_id: "W04", event_id: "35", missing: 2 }], prediction_gates: { ENABLED: enabled, OUTSIDE_TOP: 3 }, current_tier_counts: { short: 120 },
  },
});

test("overview decodes every current generation, class counts, round summaries and today's schedule", async () => {
  const body = { data: {
    observed_at: "2026-11-10T06:00:00Z", market_totals: { member_count: 10, prediction_enabled_count: 2, complete: true },
    sources: [
      { market_source: "POLYMARKET", current_generation: roundGeneration(574, "Sports", 8, 6, 0, "2026-11-09"), current_generations: [roundGeneration(574, "Sports", 8, 6, 0, "2026-11-09"), roundGeneration(578, "Politics", 2, 4, 2)], current_member_count: 10, current_prediction_enabled_count: 2, current_class_counts: { core: 6, borrowed: 2, tracked: 2 }, prediction_coverage: null },
      { market_source: "KALSHI", current_generation: null, current_generations: [], current_member_count: 0, current_prediction_enabled_count: 0, current_class_counts: { core: 0, borrowed: 0, tracked: 0 }, prediction_coverage: null },
    ],
    round_schedule: { timezone: "Asia/Shanghai", business_date: "2026-11-10", rounds: [
      { round_index: 2, domain: "Politics", slot_at: "2026-11-09T18:10:00Z", predict: true, sources: [{ market_source: "POLYMARKET", generation_id: 578, status: "PUBLISHED", observed_at: "2026-11-09T18:10:35Z" }, { market_source: "KALSHI", generation_id: null, status: null, observed_at: null }] },
      { round_index: 8, domain: "Sports", slot_at: "2026-11-10T06:10:00Z", predict: false, sources: [{ market_source: "POLYMARKET", generation_id: null, status: null, observed_at: null }] },
    ] },
  } };
  await withFetch(body, async () => {
    const { data } = await consoleV2.infra.overview();
    const pm = data.sources[0];
    assert.equal(pm.currentMemberCount, 10);
    assert.deepEqual(pm.currentClassCounts, { core: 6, borrowed: 2, tracked: 2 });
    assert.deepEqual(pm.currentGenerations.map((generation) => generation.generationId), ["574", "578"]);
    const politics = pm.currentGenerations[1];
    assert.equal(politics.domain, "Politics");
    assert.equal(politics.roundIndex, 2);
    assert.deepEqual(politics.classCounts, { core: 2, borrowed: 1, tracked: 1 });
    assert.equal(politics.roundSummary?.capacity, 1200);
    assert.equal(politics.roundSummary?.lending[0].count, 300);
    assert.equal(politics.roundSummary?.capacityConflicts[0].ruleId, "W04");
    assert.equal(politics.roundSummary?.exits?.near_settlement, 1);
    assert.equal(data.roundSchedule?.rounds[0].sources[0].generationId, "578");
    assert.equal(data.roundSchedule?.rounds[0].sources[1].generationId, undefined);
  });
  const broken = structuredClone(body);
  broken.data.sources[0].current_class_counts = { core: -1, borrowed: 0, tracked: 0 };
  await withFetch(broken, async () => { await assert.rejects(consoleV2.infra.overview(), ConsoleV2ContractError); });
  const legacy = structuredClone(body) as { data: Record<string, unknown> };
  delete legacy.data.round_schedule;
  await withFetch(legacy, async () => { assert.equal((await consoleV2.infra.overview()).data.roundSchedule, undefined); });
});

test("running members, retired entries, selection runs, batches and whitelist rules carry round identity", async () => {
  await withFetch({ data: { items: [{ generation_id: 578, running_market_id: 17, source_selection_run_id: 640, source_selected_market_id: 99, market_id: "pm-1", condition_id: "c-1", question: "Q", primary_domain: "Politics", matched_domains: [], volume_24h: 12, domain_rank: 3, domain_volume_rank: 3, prediction_enabled: false, market_observed_at: "2026-11-09T18:10:35Z", end_at: "2027-01-18T05:00:00Z", generation_domain: "Politics", membership_class: "BORROWED", entry_tier: "long", current_tier: "long", borrowed_from_tier: "mid", tracked_rule_id: null, priority_rank: 1024, prediction_gate: "OUTSIDE_WINDOW" }], total: 1, limit: 20, offset: 0, has_more: false, observed_at: "2026-11-10T06:00:00Z" } }, async (calls) => {
    const { data } = await consoleV2.infra.runningMarkets({ domain: "Politics", membership_class: "BORROWED", tier: "long" });
    const item = data.items[0];
    assert.equal(item.membershipClass, "BORROWED");
    assert.equal(item.borrowedFromTier, "mid");
    assert.equal(item.priorityRank, 1024);
    assert.equal(item.predictionGate, "OUTSIDE_WINDOW");
    assert.match(calls[0], /domain=Politics&membership_class=BORROWED&tier=long/);
  });
  await withFetch({ data: { items: [{ selection_run_id: 640, market_source: "KALSHI", status: "PUBLISHED", is_current: true, candidate_count: 1, selected_count: 1, rejected_count: 0, started_at: "2026-11-09T18:13:33Z", completed_at: "2026-11-09T18:10:00Z", published_at: "2026-11-09T18:13:38Z", domain: "Politics", round_index: 2 }], total: 1, limit: 20, offset: 0, has_more: false, observed_at: "2026-11-10T06:00:00Z" } }, async () => {
    const run = (await consoleV2.infra.selectionRuns()).data.items[0];
    assert.equal(run.domain, "Politics");
    assert.equal(run.roundIndex, 2);
  });
  await withFetch({ data: { items: [{ model_id: "v4.1 flash", market_source: "POLYMARKET", prediction_as_of: "2026-11-09T20:10:26Z", result_count: 52, sandbox_count: 52, direct_result_count: 0, sandbox_result_count: 52, unknown_result_count: 0, max_result_id: 9, source_kinds: ["SANDBOX"], generation_ids: [579], generations: [{ generation_id: 579, domain: "Finance", business_date: "2026-11-10", round_index: 3 }], latest_received_at: null }], total: 1, limit: 20, offset: 0, has_more: false, observed_at: "2026-11-10T06:00:00Z" } }, async () => {
    const batch = (await consoleV2.infra.predictionBatches()).data.items[0];
    assert.deepEqual(batch.generations, [{ generationId: "579", domain: "Finance", businessDate: "2026-11-10", roundIndex: 3 }]);
    assert.equal(generationLabel(batch.generations[0]), "11-10 第 3 轮 Finance");
  });
  await withFetch({ data: { items: [{ rule_id: "W20", title: "Instacart 季度交易总额 GTV", market_source: "KALSHI", domain: "Finance", kind: "series", series: "KXCART", event: null, market: null, active_member_count: 0, tracked_event_count: 0, last_seen_at: null, capacity_conflict_missing: 0 }], total: 41, limit: 20, offset: 0, has_more: true, observed_at: "2026-11-10T06:00:00Z" } }, async (calls) => {
    const rule = (await consoleV2.infra.trackedRules({ source: "KALSHI" })).data.items[0];
    assert.equal(rule.ruleId, "W20");
    assert.equal(rule.lastSeenAt, undefined);
    assert.equal(trackedRuleState(rule, new Date("2026-11-10T06:00:00Z")).label, "未找到开放事件");
    assert.match(calls[0], /\/api\/console\/v2\/infra\/tracked-rules\?/);
  });
});

test("the BFF forwards the tracked-rules resource", async () => {
  const previous = { base: process.env.PREDICTION_INFRA_BASE_URL, token: process.env.CONSOLE_API_TOKEN, fetch: globalThis.fetch };
  process.env.PREDICTION_INFRA_BASE_URL = "http://infra.local";
  process.env.CONSOLE_API_TOKEN = "token";
  const calls: string[] = [];
  globalThis.fetch = (async (input) => { calls.push(String(input)); return new Response(JSON.stringify({ data: { items: [] } }), { headers: { "content-type": "application/json" } }); }) as typeof fetch;
  try {
    const response = await GET(new Request("http://console.local/api/console/v2/infra/tracked-rules?source=KALSHI"), { params: Promise.resolve({ path: ["infra", "tracked-rules"] }) });
    assert.equal(response.status, 200);
    assert.match(calls[0], /^http:\/\/infra\.local\/api\/v1\/console\/v2\/tracked-rules\?source=KALSHI$/);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.base === undefined) delete process.env.PREDICTION_INFRA_BASE_URL; else process.env.PREDICTION_INFRA_BASE_URL = previous.base;
    if (previous.token === undefined) delete process.env.CONSOLE_API_TOKEN; else process.env.CONSOLE_API_TOKEN = previous.token;
  }
});

test("round rows tell published, running, missed, not-due and carried lanes apart", () => {
  const generation = (generationId: string, domain: string, businessDate: string) => ({ generationId, domain, businessDate, roundIndex: 1, memberCount: 1, predictionEnabledCount: 1, status: "PUBLISHED", isCurrent: true, sourceSelectionRunId: "1" }) as ConsoleV2Generation;
  const overview = {
    sources: [
      { marketSource: "POLYMARKET", currentGenerations: [generation("578", "Politics", "2026-11-10"), generation("560", "Esports", "2026-11-09")], currentMemberCount: 2, currentPredictionEnabledCount: 2 },
      { marketSource: "KALSHI", currentGenerations: [generation("563", "Politics", "2026-11-09")], currentMemberCount: 1, currentPredictionEnabledCount: 1 },
    ],
    roundSchedule: { timezone: "Asia/Shanghai", businessDate: "2026-11-10", rounds: [
      { roundIndex: 2, domain: "Politics", slotAt: "2026-11-09T18:10:00Z", predict: true, sources: [{ marketSource: "POLYMARKET", generationId: "578", status: "PUBLISHED" }, { marketSource: "KALSHI" }] },
      { roundIndex: 9, domain: "Esports", slotAt: "2026-11-10T08:10:00Z", predict: false, sources: [{ marketSource: "POLYMARKET" }] },
    ] },
  } as unknown as ConsoleV2Overview;
  const now = new Date("2026-11-10T06:20:00Z");
  const rows = roundRows(overview, now);
  assert.deepEqual(rows.map((row) => [row.marketSource, row.domain, row.state, row.carriedFrom]), [
    ["POLYMARKET", "Politics", "PUBLISHED", undefined],
    ["KALSHI", "Politics", "MISSING", "2026-11-09"],
    ["POLYMARKET", "Esports", "NOT_DUE", "2026-11-09"],
  ]);
  const slot = "2026-11-10T08:10:00Z";
  assert.equal(roundState({ marketSource: "POLYMARKET" }, slot, new Date(Date.parse(slot) + ROUND_GRACE_MS - 1)), "RUNNING");
  assert.equal(roundState({ marketSource: "POLYMARKET" }, slot, new Date(Date.parse(slot) + ROUND_GRACE_MS)), "MISSING");
  assert.equal(roundState({ marketSource: "POLYMARKET", status: "FAILED" }, slot, now), "FAILED");
  assert.equal(roundState({ marketSource: "POLYMARKET", status: "PENDING" }, slot, now), "PENDING");
  assert.deepEqual(roundProgress(rows.filter((row) => row.marketSource === "POLYMARKET"), "Asia/Shanghai", now), { published: 1, total: 2, next: "16:10 Esports" });
  assert.deepEqual(predictionGenerations(overview, "").map((item) => item.generationId), ["578", "560", "563"]);
});

test("identity and tier wording follow the round vocabulary", () => {
  assert.equal(membershipText({ membershipClass: "CORE" }), "正式");
  assert.equal(membershipText({ membershipClass: "BORROWED", borrowedFromTier: "short" }), "候补（借短期名额）");
  assert.equal(membershipText({ membershipClass: "TRACKED", trackedRuleId: "W04" }), "白名单 W04");
  assert.equal(membershipText({ membershipClass: "GUEST" }), "GUEST");
  assert.equal(tierText("mid", "mid_long"), "中期（入池时中长期）");
  assert.equal(tierText("near_settlement", "near_settlement"), "临近结算");
  const now = new Date("2026-11-10T00:00:00Z");
  assert.equal(formatRemainingDays(remainingDays("2026-11-18T12:00:00Z", now)), "8 天");
  assert.equal(formatRemainingDays(remainingDays("2026-11-10T06:00:00Z", now)), "不足 1 天");
  assert.equal(formatRemainingDays(remainingDays(undefined, now)), "—");
  assert.equal(trackedRuleState({ activeMemberCount: 9 }, now).label, "正常");
  assert.equal(trackedRuleState({ activeMemberCount: 0, lastSeenAt: "2026-11-09T12:00:00Z" }, now).label, "已命中未入池");
  assert.equal(domainLabel("World/Geopolitics"), "World/Geopolitics");
  assert.equal(domainLabel(undefined), "—");
  assert.equal(retireReasonText("near_settlement"), "剩余≤3 天");
  for (const legacy of ["admission_rule_changed", "event_cap", "superseded"]) assert.equal(retireReasonText(legacy), "旧规则退出（10-28）");
});


test("today's activity excludes carried generations, unfinished rounds and failed reruns", () => {
  const current: ConsoleV2Generation = {
    generationId: "563", sourceSelectionRunId: "623", status: "PUBLISHED", isCurrent: true, memberCount: 793,
    businessDate: "2026-11-09", domain: "Politics", roundIndex: 2, predictionEnabledCount: 20,
    roundSummary: { capacity: 1200, ordinaryCapacity: 1188, admitted: 182, exits: { near_settlement: 6 }, tiers: [], lending: [], capacityConflicts: [] },
  };
  const carried: RoundRow = { marketSource: "KALSHI", domain: "Politics", roundIndex: 2, predict: true, slotAt: "2026-11-09T18:10:00Z", state: "MISSING", current, carriedFrom: "2026-11-09" };
  const published: RoundRow = { ...carried, state: "PUBLISHED", carriedFrom: undefined, todayGenerationId: "580", current: { ...current, generationId: "580", businessDate: "2026-11-10" } };
  const pending = { ...carried, state: "PENDING" as const, todayGenerationId: "581" };
  const failedRerun = { ...published, state: "FAILED" as const, todayGenerationId: "582" };
  const future = { ...carried, state: "NOT_DUE" as const };
  const rows = [carried, published, pending, failedRerun, future];
  assert.deepEqual(rows.flatMap((row) => {
    const generation = todayRoundGeneration(row);
    return generation ? [generation.generationId] : [];
  }), ["580"], "only today's proven published generation may be used for progress requests");
  assert.equal(todayRoundGeneration(carried)?.roundSummary, undefined, "yesterday's 182 admissions / 6 exits do not become today's activity");
  assert.equal(todayRoundGeneration(published)?.predictionEnabledCount, 20);
  assert.equal(todayRoundGeneration({ ...published, todayGenerationId: "599" }), undefined, "a different current generation must not fill a scheduled lane");
});

test("round result links preserve the selected model for current and carried results", () => {
  const row = {
    marketSource: "KALSHI", state: "MISSING", current: { generationId: "563" },
  } as RoundRow;
  const target = new URL(roundPredictionHref(row, "model / + 中文")!, "http://console.local");
  assert.equal(target.pathname, "/predictions");
  assert.equal(target.searchParams.get("model"), "model / + 中文");
  assert.equal(target.searchParams.get("source"), "KALSHI");
  assert.equal(target.searchParams.get("generation_id"), "563");
  assert.equal(target.searchParams.get("scope"), "history");
  assert.equal(new URL(roundPredictionHref(row, "")!, "http://console.local").searchParams.has("model"), false);
  assert.equal(roundPredictionHref({ ...row, current: undefined }, "model"), undefined);
});

test("prediction round Domain is decoded independently from historical classification", async () => {
  const base = { prediction_id: "p-round", market_source: "KALSHI", market_id: "m", condition_id: "c", question: "Q", primary_domain: "Entertainment", sandbox_id: "s" };
  const body = (item: Record<string, unknown>) => ({ data: { items: [item], total: 1, limit: 20, offset: 0, has_more: false, observed_at: "2026-11-10T00:00:00Z" } });
  for (const roundDomain of ["Culture", null, undefined]) {
    await withFetch(body({ ...base, round_domain: roundDomain }), async () => {
      const item = (await consoleV2.infra.predictions()).data.items[0];
      assert.equal(item.roundDomain, roundDomain ?? undefined);
      assert.equal(item.primaryDomain, "Entertainment");
    });
  }
  for (const invalid of [42, false, {}, ""]) {
    await withFetch(body({ ...base, round_domain: invalid }), async () => {
      await assert.rejects(consoleV2.infra.predictions(), (error: unknown) => error instanceof ConsoleV2ContractError && /round_domain/.test(error.message));
    });
  }
});
