import assert from "node:assert/strict";
import test from "node:test";
import { GET as V2_GET, POST as V2_POST } from "../app/api/console/v2/[...path]/route.ts";
import { GET as DOWNLOAD_GET, POST as DOWNLOAD_POST } from "../app/api/console/downloads/[...path]/route.ts";
import {
  decodeFinancialPage, decodeFinancialQuestion, decodeFinancialQuestionDetail, decodeFinancialRun, decodeFinancialSandboxItem, elapsedText,
  financialAssetOptions, financialBatchDownloadFields, financialQuestionApi, financialQuestionNeedsPolling, financialSingleDownloadHref,
  FINANCIAL_ASSETS, FINANCIAL_QUESTION_MAX_BATCH_IDS, runStatusLabel, thresholdText,
} from "../app/lib/financial-questions.ts";

const envNames = ["PREDICTION_INFRA_BASE_URL", "CONSOLE_API_TOKEN", "SANDBOX_DOWNLOAD_TOKEN"];
const configured: Record<string, string> = { PREDICTION_INFRA_BASE_URL: "http://infra.test", CONSOLE_API_TOKEN: "console-read-secret-0000000000000", SANDBOX_DOWNLOAD_TOKEN: "download-secret-00000000000000000" };
const params = (path: string[]) => ({ params: Promise.resolve({ path }) });
type Call = { url: string; init?: RequestInit };

async function withUpstream(upstream: () => Promise<Response>, run: (calls: Call[]) => Promise<void>) {
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  for (const name of envNames) process.env[name] = configured[name];
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return upstream(); }) as typeof fetch;
  try { await run(calls); } finally {
    globalThis.fetch = previousFetch;
    for (const name of envNames) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  }
}

const sandbox = { sandbox_id: "fq-12-20261201", committed_at: "2026-12-01T13:42:00Z", page_count: 160, archive_size_bytes: 1200000 };
const build = { build_id: 9001, run_id: 31, status: "FAILED", attempt_count: 4, error_code: "COLLECT_FAILED", error_message: "boom" };
const questionItem = {
  question_id: 12, asset_key: "US_NVDA", asset_name: "英伟达（NVDA）", batch: "OVERSEAS", frequency: "W", period_key: "2026-W49", type_code: "W_UP_050",
  question_text: "英伟达（NVDA）在 2026-12-04 的官方收盘价是否达到或超过 210.00 美元/股？", direction: "GTE", threshold: "210.00", unit: "美元/股", contract_code: null,
  target_date: "2026-12-04", stop_at: "2026-12-04T21:00:00Z", status: "ACTIVE", status_reason: null, created_at: "2026-11-30T13:26:00Z", sandbox_count: 2,
  latest_sandbox: sandbox, current_build: build, resolution: null,
};
const detailItem = {
  ...questionItem,
  reference: { value: "200.00", unit: "美元/股", source: "NASDAQ", source_symbol: "NVDA", contract_code: null, observed_at: "2026-11-27T18:00:00Z", collected_at: "2026-11-30T13:05:00Z" },
  coefficient: "1.05", raw_product: "210.0000",
  resolution_rule: { result_source: "NASDAQ", result_rule: "目标日官方收盘价（未复权）", timezone: "America/New_York", observe_start_at: "2026-12-04T21:00:00Z", observe_end_at: "2026-12-04T21:00:00Z" },
  resolutions: [
    { label: "YES", state: "FINAL", value: "212.340", source: "NASDAQ", observed_at: "2026-12-04T21:00:00Z", collected_at: "2026-12-05T01:00:00Z", created_at: "2026-12-05T01:00:01Z" },
    { label: "YES", state: "PROVISIONAL", value: "212.34", source: "NASDAQ", observed_at: "2026-12-04T21:00:00Z", collected_at: "2026-12-05T00:00:00Z", created_at: "2026-12-05T00:00:01Z" },
  ],
};
const runItem = { run_id: 31, batch: "OVERSEAS", business_date: "2026-12-01", planned_at: "2026-12-01T13:30:00Z", status: "FINISHED", frozen_at: "2026-12-01T13:30:02Z", summary: { expected_assets: 24, created_questions: 120, reused_questions: 168, selected_builds: 288, succeeded_builds: 280, failed_builds: 8, closed_skipped: 0, expired_questions: 12, pending_results: 12, elapsed_seconds: 1834 } };
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ code: "OK", data: { items, limit: 20, offset: 0, total: items.length, has_more: false, observed_at: "2026-12-01T14:00:00Z", ...extra } });
const without = (value: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

// ───────────────────────── BFF ─────────────────────────

test("V2 代理：金融题列表、详情、各轮 Sandbox、轮次摘要只读转发，非法 ID 400", async () => {
  await withUpstream(async () => Response.json({ data: { items: [] } }), async (calls) => {
    const v2 = (path: string[], query = "") => V2_GET(new Request(`http://console.test/api/console/v2/${path.join("/")}${query}`), params(path));
    assert.equal((await v2(["infra", "financial-questions"], "?asset_key=US_NVDA&frequency=W&status=ACTIVE&limit=20")).status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/console/v2/financial-questions?asset_key=US_NVDA&frequency=W&status=ACTIVE&limit=20");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), `Bearer ${configured.CONSOLE_API_TOKEN}`);
    assert.equal((await v2(["infra", "financial-questions", "12"])).status, 200);
    assert.equal(calls[1].url, "http://infra.test/api/v1/console/v2/financial-questions/12");
    assert.equal((await v2(["infra", "financial-questions", "12", "sandboxes"], "?limit=100")).status, 200);
    assert.equal(calls[2].url, "http://infra.test/api/v1/console/v2/financial-questions/12/sandboxes?limit=100");
    assert.equal((await v2(["infra", "financial-question-runs"], "?limit=10&offset=10")).status, 200);
    assert.equal(calls[3].url, "http://infra.test/api/v1/console/v2/financial-question-runs?limit=10&offset=10");

    for (const id of ["abc", "0", "..", "12.5", "-1", "1:2", "12345678901234567"]) {
      for (const path of [["infra", "financial-questions", id], ["infra", "financial-questions", id, "sandboxes"]]) {
        const response = await v2(path);
        assert.equal(response.status, 400, path.join("/"));
        assert.equal((await response.json()).code, "INVALID_CONSOLE_V2_ID");
      }
    }
    assert.equal((await v2(["infra", "financial-questions", "12", "latest-sandbox-ids"])).status, 404);
    assert.equal((await v2(["infra", "financial-question-runs", "31"])).status, 404, "轮次没有单条接口");
    assert.equal((await v2(["infra", "user-questions", "345"])).status, 404, "自定义问题仍没有单题接口");
    assert.equal((await v2(["trading", "financial-questions"])).status, 404);
    assert.equal((await V2_POST()).status, 405);
    assert.equal(calls.length, 4);
  });
});

test("下载 BFF：FINANCIAL_QUESTION 单个与批量只许 original，上限 1000", async () => {
  assert.equal(FINANCIAL_QUESTION_MAX_BATCH_IDS, 1000);
  await withUpstream(async () => new Response("tar", { status: 200, headers: { "content-type": "application/x-tar" } }), async (calls) => {
    const single = (query: string) => DOWNLOAD_GET(new Request(`http://console.test/api/console/downloads/sandboxes/fq-12-20261201/archive${query}`), params(["sandboxes", "fq-12-20261201", "archive"]));
    const batch = (fields: Record<string, string>) => DOWNLOAD_POST(new Request("http://console.test/api/console/downloads/sandboxes/archives:batch", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) }), params(["sandboxes", "archives:batch"]));
    const masked = await single("?variant=masked&asset_kind=FINANCIAL_QUESTION");
    assert.equal(masked.status, 400);
    assert.match((await masked.json()).message, /金融题资料只允许下载 original/);
    assert.equal((await batch({ sandbox_ids: "fq-12-20261201", variant: "masked", asset_kind: "FINANCIAL_QUESTION" })).status, 400);
    assert.equal(calls.length, 0);

    assert.equal((await single(new URL(`http://console.test${financialSingleDownloadHref("fq-12-20261201")}`).search)).status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/sandboxes/fq-12-20261201/archive?variant=original");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), `Bearer ${configured.SANDBOX_DOWNLOAD_TOKEN}`);

    const full = Array.from({ length: 1000 }, (_, index) => `fq-${index}-20261201`);
    assert.equal((await batch(financialBatchDownloadFields(full))).status, 200);
    assert.equal(calls[1].url, "http://infra.test/api/v1/sandboxes/archives:batch?variant=original");
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), full);
    assert.equal((await batch({ sandbox_ids: [...full, "fq-1000-20261201"].join(","), variant: "original", asset_kind: "FINANCIAL_QUESTION" })).status, 400);
    assert.equal((await single("?variant=original&asset_kind=FINANCIAL")).status, 400, "白名单外的来源仍拒绝");
    assert.equal(calls.length, 2);
    assert.throws(() => financialBatchDownloadFields([...full, "fq-1000-20261201"]), /最多下载 1000/);
  });
  assert.throws(() => financialBatchDownloadFields([]), /没有可下载/);
  assert.throws(() => financialBatchDownloadFields(["a", "a"]), /不能重复/);
});

// ───────────────────────── 解码 ─────────────────────────

test("解码：分页 total/limit/offset/observed_at 严格", () => {
  const decoded = decodeFinancialPage(page([questionItem]), decodeFinancialQuestion);
  assert.equal(decoded.total, 1);
  assert.equal(decoded.items[0].assetName, "英伟达（NVDA）");
  for (const bad of [{ total: undefined }, { total: null }, { total: "1" }, { total: -1 }, { total: 1.5 }, { limit: 0 }, { offset: "0" }, { observed_at: undefined }, { observed_at: "2026-12-01" }, { items: null }]) {
    assert.throws(() => decodeFinancialPage(page([questionItem], bad), decodeFinancialQuestion), /金融题接口缺少有效/, JSON.stringify(bad));
  }
});

test("解码：题目枚举与必需字段严格，数值只接受十进制字符串并原样保留", () => {
  const question = decodeFinancialQuestion(questionItem);
  assert.equal(question.threshold, "210.00", "末尾的 0 不丢");
  assert.equal(thresholdText(question), "≥ 210.00");
  assert.equal(thresholdText({ direction: "LTE", threshold: "67890.123456789012345678" }), "≤ 67890.123456789012345678");
  assert.equal(question.currentBuild?.runId, 31);
  assert.equal(question.latestSandbox?.sandboxId, "fq-12-20261201");
  assert.equal(question.resolution, undefined);
  assert.equal(question.contractCode, undefined);
  const bare = decodeFinancialQuestion({ ...questionItem, frequency: "D", contract_code: "GCG7", latest_sandbox: null, current_build: null, status: "RESOLVED", resolution: { label: "NO", state: "PROVISIONAL", value: "4020.10", resolved_at: "2026-12-04T22:00:00Z" } });
  assert.equal(bare.latestSandbox, undefined);
  assert.equal(bare.contractCode, "GCG7");
  assert.deepEqual(bare.resolution, { label: "NO", state: "PROVISIONAL", value: "4020.10", resolvedAt: "2026-12-04T22:00:00Z" });
  for (const bad of [
    { threshold: 210 }, { threshold: "210,00" }, { threshold: "2.1e2" }, { threshold: "" }, { threshold: null }, { batch: "US" }, { frequency: "Y" }, { direction: ">=" },
    { status: "active" }, { status: null }, { target_date: "2026/12/04" }, { stop_at: "2026-12-04" }, { sandbox_count: "2" }, { question_text: " " }, { status_reason: 5 },
    { latest_sandbox: { ...sandbox, sandbox_id: "../x" } }, { latest_sandbox: [] }, { current_build: { ...build, status: "DONE" } }, { current_build: without(build, "run_id") },
    { resolution: { label: "VOID", state: "FINAL", value: "1", resolved_at: "2026-12-04T22:00:00Z" } }, { resolution: { label: "YES", state: "DRAFT", value: "1", resolved_at: "2026-12-04T22:00:00Z" } },
    { resolution: { label: "YES", state: "FINAL", value: 1, resolved_at: "2026-12-04T22:00:00Z" } },
  ]) assert.throws(() => decodeFinancialQuestion({ ...questionItem, ...bad }), /金融题接口缺少有效/, JSON.stringify(bad));
  for (const key of ["question_id", "asset_key", "asset_name", "period_key", "type_code", "unit", "created_at"]) assert.throws(() => decodeFinancialQuestion(without(questionItem, key)), new RegExp(key));
  // 中台只把空串置 null；构建服务回报的 error_message 可以是纯空白，不能因此让整页列表解码失败
  const blank = decodeFinancialQuestion({ ...questionItem, status_reason: "  ", current_build: { ...build, error_message: " \n" } });
  assert.equal(blank.statusReason, undefined);
  assert.equal(blank.currentBuild?.errorMessage, undefined);
  assert.equal(blank.currentBuild?.errorCode, "COLLECT_FAILED");
  assert.throws(() => decodeFinancialQuestion({ ...questionItem, current_build: { ...build, error_message: 5 } }), /current_build\.error_message/);
});

test("解码：详情含参考快照、判定规则与判定历史，题目必须与请求一致", () => {
  const detail = decodeFinancialQuestionDetail({ data: detailItem }, 12);
  assert.equal(detail.reference.value, "200.00");
  assert.equal(detail.coefficient, "1.05");
  assert.equal(detail.rawProduct, "210.0000");
  assert.equal(detail.resolutionRule.timezone, "America/New_York");
  assert.deepEqual(detail.resolutions.map((row) => [row.state, row.value]), [["FINAL", "212.340"], ["PROVISIONAL", "212.34"]], "保持中台给的倒序");
  assert.throws(() => decodeFinancialQuestionDetail({ data: detailItem }, 13), /不一致/);
  assert.deepEqual(decodeFinancialQuestionDetail({ data: { ...detailItem, resolutions: [] } }, 12).resolutions, []);
  for (const key of ["reference", "resolution_rule", "resolutions", "coefficient", "raw_product"]) assert.throws(() => decodeFinancialQuestionDetail({ data: without(detailItem, key) }, 12), new RegExp(key));
  assert.throws(() => decodeFinancialQuestionDetail({ data: { ...detailItem, coefficient: 1.05 } }, 12), /coefficient/);
  assert.throws(() => decodeFinancialQuestionDetail({ data: { ...detailItem, reference: { ...detailItem.reference, value: 200 } } }, 12), /reference\.value/);
  assert.throws(() => decodeFinancialQuestionDetail({ data: { ...detailItem, resolutions: [{ ...detailItem.resolutions[0], label: "MAYBE" }] } }, 12), /resolutions\[0\]\.label/);
});

test("解码：各轮 Sandbox 只有成功的构建带 sandbox", () => {
  const row = { ...build, status: "SUCCEEDED", error_code: null, error_message: null, round_planned_at: "2026-12-01T13:30:00Z", sandbox };
  assert.equal(decodeFinancialSandboxItem(row).sandbox?.pageCount, 160);
  const skipped = decodeFinancialSandboxItem({ ...row, status: "SKIPPED", attempt_count: 0, error_code: "CLAIM_WINDOW_CLOSED", sandbox: null });
  assert.equal(skipped.errorCode, "CLAIM_WINDOW_CLOSED");
  assert.throws(() => decodeFinancialSandboxItem({ ...row, sandbox: null }), /缺少 sandbox/);
  assert.throws(() => decodeFinancialSandboxItem({ ...row, status: "FAILED" }), /不应有 sandbox/);
  assert.throws(() => decodeFinancialSandboxItem({ ...row, round_planned_at: null }), /round_planned_at/);
});

test("解码：轮次摘要的数字可空，缺失不当 0", () => {
  const run = decodeFinancialRun(runItem);
  assert.equal(run.summary.selectedBuilds, 288);
  assert.equal(runStatusLabel(run.status), "已完成");
  assert.equal(runStatusLabel("PREPARING"), "准备中");
  assert.equal(runStatusLabel("MISSED"), "已错过");
  assert.equal(runStatusLabel("UNKNOWN_STATE"), "UNKNOWN_STATE", "没有中文名的原样显示");
  const empty = decodeFinancialRun({ ...runItem, frozen_at: null, summary: { expected_assets: null } });
  assert.equal(empty.frozenAt, undefined);
  assert.equal(empty.summary.expectedAssets, null);
  assert.equal(empty.summary.failedBuilds, null);
  assert.equal(empty.summary.reason, undefined);
  assert.equal(decodeFinancialRun({ ...runItem, status: "MISSED", summary: { ...runItem.summary, reason: "ROUND_MISSED" } }).summary.reason, "ROUND_MISSED");
  assert.equal(decodeFinancialRun({ ...runItem, summary: { ...runItem.summary, reason: null } }).summary.reason, undefined);
  for (const bad of [{ summary: null }, { summary: { ...runItem.summary, failed_builds: "8" } }, { summary: { ...runItem.summary, failed_builds: -1 } }, { batch: "HK" }, { business_date: "20261201" }, { status: "" }]) assert.throws(() => decodeFinancialRun({ ...runItem, ...bad }), /金融题接口缺少有效/, JSON.stringify(bad));
  assert.equal(elapsedText(null), "—");
  assert.equal(elapsedText(0), "0 秒");
  assert.equal(elapsedText(1834.4), "30 分 34 秒");
});

// ───────────────────────── 客户端与展示 ─────────────────────────

test("客户端：只带非空筛选，错误信息取中台说明", async () => {
  await withUpstream(async () => Response.json(page([questionItem])), async (calls) => {
    await financialQuestionApi.questions({ assetKey: "US_NVDA", frequency: "", status: "ACTIVE", q: "", limit: 50, offset: 0 });
    assert.equal(calls[0].url, "/api/console/v2/infra/financial-questions?asset_key=US_NVDA&status=ACTIVE&limit=50&offset=0");
  });
  await withUpstream(async () => Response.json({ data: detailItem }), async (calls) => {
    assert.equal((await financialQuestionApi.detail(12)).questionId, 12);
    assert.equal(calls[0].url, "/api/console/v2/infra/financial-questions/12");
  });
  await withUpstream(async () => Response.json({ code: "BACKEND_NOT_CONFIGURED", message: "尚未配置" }, { status: 503 }), async () => {
    await assert.rejects(financialQuestionApi.runs(), /尚未配置/);
  });
});

test("展示：32 个标的、接口多出的标的可筛、只在排队或构建中轮询", () => {
  assert.equal(FINANCIAL_ASSETS.length, 32);
  assert.equal(FINANCIAL_ASSETS.filter((item) => item.batch === "CN").length, 8);
  assert.equal(new Set(FINANCIAL_ASSETS.map((item) => item.key)).size, 32);
  assert.equal(financialAssetOptions([decodeFinancialQuestion(questionItem)], "US_NVDA").length, 32);
  const extra = financialAssetOptions([{ assetKey: "US_NEW", assetName: "新标的", batch: "OVERSEAS" }], "CN_OLD");
  assert.deepEqual(extra.slice(32), [{ key: "US_NEW", name: "新标的", batch: "OVERSEAS" }, { key: "CN_OLD", name: "CN_OLD", batch: "CN" }]);
  for (const [status, expected] of [["PENDING", true], ["RUNNING", true], ["SUCCEEDED", false], ["FAILED", false], ["SKIPPED", false]] as const) {
    assert.equal(financialQuestionNeedsPolling(decodeFinancialQuestion({ ...questionItem, current_build: { ...build, status } })), expected, status);
  }
  assert.equal(financialQuestionNeedsPolling({ currentBuild: undefined }), false);
});
