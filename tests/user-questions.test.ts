import assert from "node:assert/strict";
import test from "node:test";
import { DELETE, GET as UPLOAD_GET, POST as UPLOAD_POST } from "../app/api/console/user-questions/[...path]/route.ts";
import { GET as V2_GET, POST as V2_POST } from "../app/api/console/v2/[...path]/route.ts";
import { GET as DOWNLOAD_GET, POST as DOWNLOAD_POST } from "../app/api/console/downloads/[...path]/route.ts";
import {
  batchDownloadFields, decodeLatestSandboxIds, decodeUserQuestion, decodeUserQuestionHistoryItem, decodeUserQuestionPage, decodeUserQuestionUpload,
  decodeUserQuestionUploadCreated, questionNeedsPolling, singleDownloadHref, uploadContentType, uploadErrorReason, uploadFilenameHeaderValue, uploadHasActiveBuilds,
  USER_QUESTION_MAX_BATCH_IDS, USER_QUESTION_UPLOAD_LIMIT_BYTES, USER_QUESTION_WRITE_MARKER_HEADER, USER_QUESTION_WRITE_MARKER_VALUE,
} from "../app/lib/user-questions.ts";

const envNames = ["PREDICTION_INFRA_BASE_URL", "USER_QUESTION_CONSOLE_TOKEN", "CONSOLE_API_TOKEN", "SANDBOX_DOWNLOAD_TOKEN"];
const params = (path: string[]) => ({ params: Promise.resolve({ path }) });
const configured = { PREDICTION_INFRA_BASE_URL: "http://infra.test", USER_QUESTION_CONSOLE_TOKEN: "uq-console-secret-000000000000000", CONSOLE_API_TOKEN: "console-read-secret-0000000000000", SANDBOX_DOWNLOAD_TOKEN: "download-secret-00000000000000000" };
const W = { [USER_QUESTION_WRITE_MARKER_HEADER]: USER_QUESTION_WRITE_MARKER_VALUE };
type Call = { url: string; init?: RequestInit & { duplex?: string } };

async function withUpstream(values: Record<string, string | undefined>, upstream: typeof fetch | undefined, run: (calls: Call[]) => Promise<void>) {
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  for (const name of envNames) { if (values[name] === undefined) delete process.env[name]; else process.env[name] = values[name]; }
  const calls: Call[] = [];
  if (upstream) globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return upstream(input, init); }) as typeof fetch;
  try { await run(calls); } finally {
    globalThis.fetch = previousFetch;
    for (const name of envNames) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  }
}

const UPLOAD_URL = "http://console.test/api/console/user-questions/uploads";
const upload = (headers: Record<string, string>, body?: BodyInit | null) => new Request(UPLOAD_URL, { method: "POST", headers: { ...W, ...headers }, body, duplex: "half" } as RequestInit);
const created = () => Response.json({ code: "USER_QUESTION_UPLOAD_CREATED", message: "ok", data: { upload_id: 12, original_filename: "问题.csv", file_format: "CSV", question_count: 2, blank_rows_skipped: 1, sha256: "a".repeat(64), size_bytes: 30, created_at: "2026-11-09T08:00:00Z" } }, { status: 201, headers: { "set-cookie": "leak=1", "x-request-id": "r1" } });

// ───────────────────────── 上传 BFF ─────────────────────────

test("上传 BFF：流式转发文件，服务端注入令牌，转发文件名头，令牌不回到浏览器", async () => {
  let received = "";
  await withUpstream(configured, async (_input, init) => { received = await new Response(init?.body).text(); return created(); }, async (calls) => {
    const body = "question\nWill it rain?\n\nWill it snow?\n";
    const filename = encodeURIComponent("问题.csv");
    const response = await UPLOAD_POST(upload({ "content-type": "text/csv; charset=utf-8", "content-length": String(new TextEncoder().encode(body).byteLength), "x-upload-filename": filename }, body), params(["uploads"]));
    assert.equal(response.status, 201);
    assert.equal(received, body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://infra.test/api/v1/console/user-question-uploads");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.duplex, "half");
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${configured.USER_QUESTION_CONSOLE_TOKEN}`);
    assert.equal(headers.get("content-type"), "text/csv");
    assert.equal(headers.get("x-upload-filename"), filename);
    assert.equal(headers.get("x-requested-with"), null, "标记头只用于 BFF，不转发");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-request-id"), "r1");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const text = await response.text();
    assert.ok(!text.includes("uq-console-secret"));
    assert.equal(JSON.parse(text).data.upload_id, 12);
  });
  await withUpstream(configured, async (_input, init) => { await new Response(init?.body).arrayBuffer(); return created(); }, async (calls) => {
    const response = await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "9" }, '["a","b"]'), params(["uploads"]));
    assert.equal(response.status, 201);
    assert.equal(new Headers(calls[0].init?.headers).get("x-upload-filename"), null, "没有文件名头时不伪造");
  });
});

test("上传 BFF：跨站 403、缺长度 411、超限 413、类型 415，被拒请求不到上游", async () => {
  await withUpstream(configured, async () => created(), async (calls) => {
    const noMarker = await UPLOAD_POST(new Request(UPLOAD_URL, { method: "POST", headers: { "content-type": "application/json", "content-length": "2" }, body: "[]" }), params(["uploads"]));
    assert.equal(noMarker.status, 403);
    assert.equal((await noMarker.json()).code, "CROSS_SITE_REQUEST_REJECTED");
    assert.equal((await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "2", "sec-fetch-site": "cross-site" }, "[]"), params(["uploads"]))).status, 403);
    assert.equal((await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "2", "sec-fetch-site": "same-site" }, "[]"), params(["uploads"]))).status, 403, "同站不同源也不放行");

    const streamed = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([91, 93])); controller.close(); } });
    const noLength = await UPLOAD_POST(upload({ "content-type": "application/json" }, streamed), params(["uploads"]));
    assert.equal(noLength.status, 411);
    assert.equal((await noLength.json()).code, "LENGTH_REQUIRED");

    const over = await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": String(USER_QUESTION_UPLOAD_LIMIT_BYTES + 1) }, "[]"), params(["uploads"]));
    assert.equal(over.status, 413);
    assert.equal((await over.json()).code, "UPLOAD_TOO_LARGE");

    for (const type of ["text/plain", "application/octet-stream", "text/csv; charset=gbk", "multipart/form-data; boundary=x"]) {
      const response = await UPLOAD_POST(upload({ "content-type": type, "content-length": "2" }, "[]"), params(["uploads"]));
      assert.equal(response.status, 415, type);
      assert.equal((await response.json()).code, "UNSUPPORTED_MEDIA_TYPE");
    }
    const badName = await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "2", "x-upload-filename": "%E4%ZZ" }, "[]"), params(["uploads"]));
    assert.equal(badName.status, 400);
    const longName = await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "2", "x-upload-filename": encodeURIComponent(`${"题".repeat(90)}.json`) }, "[]"), params(["uploads"]));
    assert.equal(longName.status, 400, "解码后超过 255 字节");
    assert.equal((await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "2" }, "[]"), params(["other"]))).status, 404);
    assert.equal((await UPLOAD_POST(new Request(`${UPLOAD_URL}?x=1`, { method: "POST", headers: { ...W, "content-type": "application/json", "content-length": "2" }, body: "[]" }), params(["uploads"]))).status, 400);
    assert.equal((await UPLOAD_GET()).status, 405);
    assert.equal((await DELETE()).status, 405);
    assert.equal(calls.length, 0, "被拒绝的上传不会到达上游");
  });
});

test("上传 BFF：未配置 503，上游鉴权失败转 502，上游业务错误原样返回，超出声明长度时中断", async () => {
  for (const values of [{}, { PREDICTION_INFRA_BASE_URL: "http://infra.test" }]) {
    await withUpstream(values, async () => created(), async (calls) => {
      const response = await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "2" }, "[]"), params(["uploads"]));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "BACKEND_NOT_CONFIGURED");
      assert.equal(calls.length, 0);
    });
  }
  await withUpstream(configured, async () => Response.json({ code: "UNAUTHORIZED", message: "bad token" }, { status: 401, headers: { "www-authenticate": "Bearer" } }), async () => {
    const response = await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "2" }, "[]"), params(["uploads"]));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("www-authenticate"), null);
    assert.equal((await response.json()).code, "UPSTREAM_AUTH_FAILED");
  });
  await withUpstream(configured, async (_input, init) => { await new Response(init?.body).arrayBuffer(); return Response.json({ code: "TOO_MANY_QUESTIONS", message: "too many", request_id: "r2" }, { status: 400 }); }, async () => {
    const response = await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "2" }, "[]"), params(["uploads"]));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "TOO_MANY_QUESTIONS");
  });
  await withUpstream(configured, async () => { throw new TypeError("connect ECONNREFUSED"); }, async () => {
    const response = await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "2" }, "[]"), params(["uploads"]));
    assert.equal(response.status, 502);
    assert.ok(!JSON.stringify(await response.json()).includes("ECONNREFUSED"));
  });
  let received = 0;
  await withUpstream(configured, async (_input, init) => {
    const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; received += value.byteLength; } } catch { return Response.json({ code: "ABORTED" }, { status: 502 }); }
    return created();
  }, async () => {
    const response = await UPLOAD_POST(upload({ "content-type": "application/json", "content-length": "10" }, "x".repeat(100)), params(["uploads"]));
    assert.notEqual(response.status, 201);
    assert.ok(received <= 10, `上游最多收到声明的 10 字节，实际 ${received}`);
  });
});

// ───────────────────────── V2 只读代理 ─────────────────────────

test("V2 代理：用户问题列表与两条带 ID 的子路径只读转发，非法 ID 400", async () => {
  await withUpstream(configured, async () => Response.json({ data: { items: [] } }), async (calls) => {
    const v2 = (path: string[], query = "") => V2_GET(new Request(`http://console.test/api/console/v2/${path.join("/")}${query}`), params(path));
    assert.equal((await v2(["infra", "user-question-uploads"], "?limit=20&offset=0&q=q.csv")).status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/console/v2/user-question-uploads?limit=20&offset=0&q=q.csv");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), `Bearer ${configured.CONSOLE_API_TOKEN}`);
    assert.equal((await v2(["infra", "user-questions"], "?upload_id=12&status=FAILED")).status, 200);
    assert.equal(calls[1].url, "http://infra.test/api/v1/console/v2/user-questions?upload_id=12&status=FAILED");
    assert.equal((await v2(["infra", "user-questions", "345", "sandboxes"], "?limit=100")).status, 200);
    assert.equal(calls[2].url, "http://infra.test/api/v1/console/v2/user-questions/345/sandboxes?limit=100");
    assert.equal((await v2(["infra", "user-question-uploads", "12", "latest-sandbox-ids"])).status, 200);
    assert.equal(calls[3].url, "http://infra.test/api/v1/console/v2/user-question-uploads/12/latest-sandbox-ids");

    for (const id of ["abc", "0", "..", "12.5", "-1", "1:2", "12345678901234567"]) {
      const response = await v2(["infra", "user-questions", id, "sandboxes"]);
      assert.equal(response.status, 400, id);
      assert.equal((await response.json()).code, "INVALID_CONSOLE_V2_ID");
      assert.equal((await v2(["infra", "user-question-uploads", id, "latest-sandbox-ids"])).status, 400, id);
    }
    assert.equal((await v2(["infra", "user-questions", "345", "latest-sandbox-ids"])).status, 404, "子资源和资源名必须配对");
    assert.equal((await v2(["infra", "user-question-uploads", "12", "sandboxes"])).status, 404);
    assert.equal((await v2(["infra", "user-questions", "345"])).status, 404, "没有单题详情接口");
    assert.equal((await v2(["trading", "user-questions"])).status, 404);
    assert.equal((await V2_POST()).status, 405, "V2 仍然只读");
    assert.equal(calls.length, 4);
  });
});

// ───────────────────────── 下载 BFF ─────────────────────────

const ids = (count: number, length = 160) => Array.from({ length: count }, (_, index) => `uq-${index}-`.padEnd(length, "x"));

test("下载 BFF：USER_QUESTION 只许 original，单个与批量一致", async () => {
  await withUpstream(configured, async () => new Response("tar", { status: 200, headers: { "content-type": "application/x-tar" } }), async (calls) => {
    const masked = await DOWNLOAD_GET(new Request("http://console.test/api/console/downloads/sandboxes/uq-1-20261110/archive?variant=masked&asset_kind=USER_QUESTION"), params(["sandboxes", "uq-1-20261110", "archive"]));
    assert.equal(masked.status, 400);
    assert.match((await masked.json()).message, /自定义问题资料只允许下载 original/);
    const batchMasked = await DOWNLOAD_POST(new Request("http://console.test/api/console/downloads/sandboxes/archives:batch", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ sandbox_ids: "uq-1-20261110", variant: "masked", asset_kind: "USER_QUESTION" }) }), params(["sandboxes", "archives:batch"]));
    assert.equal(batchMasked.status, 400);
    assert.equal(calls.length, 0);

    const single = await DOWNLOAD_GET(new Request(`http://console.test${singleDownloadHref("uq-1-20261110")}`), params(["sandboxes", "uq-1-20261110", "archive"]));
    assert.equal(single.status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/sandboxes/uq-1-20261110/archive?variant=original");
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), `Bearer ${configured.SANDBOX_DOWNLOAD_TOKEN}`);
    const qaMasked = await DOWNLOAD_GET(new Request("http://console.test/api/console/downloads/sandboxes/qa-1/archive?variant=masked&asset_kind=GENERATED_QA"), params(["sandboxes", "qa-1", "archive"]));
    assert.equal(qaMasked.status, 400, "原有 QA 限制不变");
    assert.match((await qaMasked.json()).message, /Generated QA 资料只允许下载 original/);
  });
});

test("下载 BFF：批量上限 1000 个 ID、表单 256 KiB，1001 个与重复 ID 返回 400", async () => {
  assert.equal(USER_QUESTION_MAX_BATCH_IDS, 1000);
  await withUpstream(configured, async () => new Response("tar", { status: 200, headers: { "content-type": "application/x-tar" } }), async (calls) => {
    const batch = (fields: Record<string, string>, accept = "application/json") => DOWNLOAD_POST(new Request("http://console.test/api/console/downloads/sandboxes/archives:batch", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept }, body: new URLSearchParams(fields) }), params(["sandboxes", "archives:batch"]));
    const full = ids(1000);
    const fields = batchDownloadFields(full);
    assert.ok(new TextEncoder().encode(new URLSearchParams(fields).toString()).byteLength > 64 * 1024, "1000 个最长 ID 超过旧的 64 KiB");
    const ok = await batch(fields);
    assert.equal(ok.status, 200);
    assert.equal(calls[0].url, "http://infra.test/api/v1/sandboxes/archives:batch?variant=original");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), full);

    const tooMany = await batch({ sandbox_ids: ids(1001, 20).join(","), variant: "original", asset_kind: "USER_QUESTION" });
    assert.equal(tooMany.status, 400);
    assert.match((await tooMany.json()).message, /1 到 1000/);
    const duplicate = await batch({ sandbox_ids: "uq-1-a,uq-1-a", variant: "original", asset_kind: "USER_QUESTION" });
    assert.equal(duplicate.status, 400);
    const nativeTooMany = await batch({ sandbox_ids: ids(1001, 20).join(","), variant: "original" }, "text/html");
    assert.equal(nativeTooMany.status, 400);
    assert.match(nativeTooMany.headers.get("content-type") ?? "", /text\/html/, "原生表单下载失败给可读页面");

    const oversized = "x".repeat(256 * 1024 + 1);
    const tooLarge = await DOWNLOAD_POST(new Request("http://console.test/api/console/downloads/sandboxes/archives:batch", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `sandbox_ids=${oversized}` }), params(["sandboxes", "archives:batch"]));
    assert.equal(tooLarge.status, 400);
    assert.match((await tooLarge.json()).message, /表单过大/);
    assert.equal(calls.length, 1);
  });
  assert.throws(() => batchDownloadFields([]), /没有可下载/);
  assert.throws(() => batchDownloadFields(ids(1001, 20)), /最多下载 1000/);
  assert.throws(() => batchDownloadFields(["a", "a"]), /不能重复/);
});

// ───────────────────────── 解码与工具 ─────────────────────────

const uploadItem = { upload_id: 12, original_filename: "q.csv", file_format: "CSV", question_count: 999, blank_rows_skipped: 2, size_bytes: 81234, created_at: "2026-11-09T08:00:00Z", current_business_date: "2026-11-10", progress: { waiting: 10, building: 5, succeeded: 980, failed: 4 }, latest_sandbox_count: 990 };
const questionItem = { question_id: 345, upload_id: 12, row_number: 7, question_text: "Will ...?", created_at: "2026-11-09T08:00:00Z", display_status: "FAILED", current_build: { build_id: 9001, business_date: "2026-11-10", status: "FAILED", attempt_count: 4, error_code: "COLLECT_FAILED", error_message: "boom", started_at: "2026-11-10T08:30:00Z", finished_at: "2026-11-10T09:00:00Z" }, latest_sandbox: { sandbox_id: "uq-345-20261109", business_date: "2026-11-09", committed_at: "2026-11-09T09:00:00Z", page_count: 160, archive_size_bytes: 1200000 }, sandbox_count: 3 };
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ code: "OK", data: { items, limit: 20, offset: 0, total: items.length, has_more: false, observed_at: "2026-11-10T09:00:00Z", ...extra } });

test("解码：分页 total/limit/offset/observed_at 严格，缺失或类型不对一律报错", () => {
  const decoded = decodeUserQuestionPage(page([uploadItem]), decodeUserQuestionUpload);
  assert.equal(decoded.total, 1);
  assert.equal(decoded.items[0].progress.succeeded, 980);
  assert.equal(decoded.items[0].currentBusinessDate, "2026-11-10");
  assert.equal(uploadHasActiveBuilds(decoded.items[0]), true);
  assert.equal(uploadHasActiveBuilds(decodeUserQuestionUpload({ ...uploadItem, progress: { waiting: 10, building: 0, succeeded: 0, failed: 0 } })), false, "只有等待（本轮可能还没排上）不轮询");
  assert.equal(decodeUserQuestionUpload({ ...uploadItem, current_business_date: null }).currentBusinessDate, null);
  for (const bad of [{ total: undefined }, { total: null }, { total: "1" }, { total: -1 }, { total: 1.5 }, { limit: 0 }, { offset: "0" }, { observed_at: undefined }, { observed_at: "2026-11-10" }, { items: null }]) {
    assert.throws(() => decodeUserQuestionPage(page([uploadItem], bad), decodeUserQuestionUpload), Error, JSON.stringify(bad));
  }
  assert.throws(() => decodeUserQuestionUpload({ ...uploadItem, progress: { ...uploadItem.progress, failed: null } }));
  assert.throws(() => decodeUserQuestionUpload({ ...uploadItem, file_format: "XLSX" }));
});

test("解码：问题 display_status 枚举严格，current_build / latest_sandbox 可为 null", () => {
  const question = decodeUserQuestion(questionItem);
  assert.equal(question.displayStatus, "FAILED");
  assert.equal(question.currentBuild?.errorCode, "COLLECT_FAILED");
  assert.equal(question.latestSandbox?.sandboxId, "uq-345-20261109");
  const waiting = decodeUserQuestion({ ...questionItem, display_status: "WAITING", current_build: null, latest_sandbox: null, sandbox_count: 0 });
  assert.equal(waiting.currentBuild, undefined);
  assert.equal(waiting.latestSandbox, undefined);
  for (const status of ["SKIPPED", "PENDING", "waiting", "", null]) assert.throws(() => decodeUserQuestion({ ...questionItem, display_status: status }), Error, String(status));
  assert.throws(() => decodeUserQuestion({ ...questionItem, current_build: { ...questionItem.current_build, status: "DONE" } }));
  assert.throws(() => decodeUserQuestion({ ...questionItem, latest_sandbox: { ...questionItem.latest_sandbox, sandbox_id: "../x" } }));
  assert.throws(() => decodeUserQuestion({ ...questionItem, current_build: { ...questionItem.current_build, business_date: "2026/11/10" } }));
});

test("解码：历史版本只有成功的构建带 sandbox，SKIPPED 只出现在历史里", () => {
  const success = decodeUserQuestionHistoryItem({ build_id: 1, business_date: "2026-11-10", status: "SUCCEEDED", attempt_count: 1, error_code: null, error_message: null, started_at: "2026-11-10T08:30:00Z", finished_at: "2026-11-10T08:40:00Z", sandbox: { sandbox_id: "uq-345-20261110", committed_at: "2026-11-10T08:40:00Z", page_count: 160, archive_size_bytes: 1200000 } });
  assert.equal(success.sandbox?.businessDate, "2026-11-10", "sandbox 的业务日取构建行");
  assert.equal(success.errorCode, undefined);
  const skipped = decodeUserQuestionHistoryItem({ build_id: 2, business_date: "2026-11-09", status: "SKIPPED", attempt_count: 0, error_code: "ROUND_ENDED", error_message: null, started_at: null, finished_at: "2026-11-10T08:30:00Z", sandbox: null });
  assert.equal(skipped.status, "SKIPPED");
  assert.throws(() => decodeUserQuestionHistoryItem({ build_id: 1, business_date: "2026-11-10", status: "SUCCEEDED", attempt_count: 1, sandbox: null }));
  assert.throws(() => decodeUserQuestionHistoryItem({ build_id: 1, business_date: "2026-11-10", status: "FAILED", attempt_count: 1, sandbox: { sandbox_id: "x", committed_at: "2026-11-10T08:40:00Z", page_count: 1, archive_size_bytes: 1 } }));
});

test("解码：上传结果与整文件 Sandbox 清单", () => {
  const result = decodeUserQuestionUploadCreated({ code: "USER_QUESTION_UPLOAD_CREATED", data: { upload_id: 12, original_filename: "q.csv", file_format: "CSV", question_count: 999, blank_rows_skipped: 2, sha256: "0".repeat(64), size_bytes: 81234, created_at: "2026-11-09T08:00:00Z" } });
  assert.equal(result.uploadId, 12);
  assert.throws(() => decodeUserQuestionUploadCreated({ data: { upload_id: 12, original_filename: "q.csv", file_format: "CSV", question_count: 0, blank_rows_skipped: 0, sha256: "0".repeat(64), size_bytes: 1, created_at: "2026-11-09T08:00:00Z" } }), Error, "成功上传至少 1 题");
  const latest = decodeLatestSandboxIds({ data: { upload_id: 12, sandbox_ids: ["uq-1-20261110", "uq-2-20261110"], observed_at: "2026-11-10T09:00:00Z" } }, 12);
  assert.deepEqual(latest.sandboxIds, ["uq-1-20261110", "uq-2-20261110"]);
  assert.throws(() => decodeLatestSandboxIds({ data: { upload_id: 13, sandbox_ids: [], observed_at: "2026-11-10T09:00:00Z" } }, 12), /不一致/);
  assert.throws(() => decodeLatestSandboxIds({ data: { upload_id: 12, sandbox_ids: ["a", "a"], observed_at: "2026-11-10T09:00:00Z" } }, 12), /重复/);
  assert.throws(() => decodeLatestSandboxIds({ data: { upload_id: 12, sandbox_ids: ids(1001, 10), observed_at: "2026-11-10T09:00:00Z" } }, 12), /超过/);
});

test("上传工具：按扩展名定类型，文件名头编码与截断，错误码中文原因", () => {
  assert.equal(uploadContentType("Q.JSON"), "application/json");
  assert.equal(uploadContentType("questions.csv"), "text/csv");
  assert.equal(uploadContentType("questions.xlsx"), undefined);
  assert.equal(uploadFilenameHeaderValue("问题 v1.csv"), encodeURIComponent("问题 v1.csv"));
  assert.equal(uploadFilenameHeaderValue("C:\\fakepath\\q.json"), "q.json");
  const long = uploadFilenameHeaderValue(`${"题".repeat(200)}.csv`) ?? "";
  const decoded = decodeURIComponent(long);
  assert.ok(new TextEncoder().encode(decoded).byteLength <= 255);
  assert.ok(decoded.endsWith(".csv"), "截断时保留扩展名");
  assert.equal(uploadFilenameHeaderValue("   "), undefined);
  assert.match(uploadErrorReason("INVALID_FILE_FORMAT", "line 3"), /无法解析/);
  assert.match(uploadErrorReason("NO_QUESTIONS"), /没有有效问题/);
  assert.match(uploadErrorReason("TOO_MANY_QUESTIONS"), /最多 1000 道题/);
  assert.match(uploadErrorReason("UPLOAD_TOO_LARGE"), /64 MiB/);
  assert.equal(uploadErrorReason("SOMETHING_ELSE", "中台说明"), "中台说明");
  assert.match(uploadErrorReason("INVALID_FILE_FORMAT", "第 3 个对象缺少字符串字段 question"), /无法解析[\s\S]*具体原因：第 3 个对象缺少字符串字段 question/, "文件内容错误附上中台的具体位置");
  assert.doesNotMatch(uploadErrorReason("BACKEND_NOT_CONFIGURED", "PREDICTION_INFRA_BASE_URL missing"), /PREDICTION_INFRA_BASE_URL/, "配置类错误不回显服务端细节");
  assert.match(uploadErrorReason(undefined, undefined, 413), /64 MiB/, "反向代理的 413 HTML 页也给中文原因");
  assert.match(uploadErrorReason(undefined, undefined, 504), /暂时不可用/);
  assert.equal(uploadErrorReason(undefined, undefined, 500), "上传失败，请稍后重试。");
  assert.equal(USER_QUESTION_UPLOAD_LIMIT_BYTES, 64 * 1024 * 1024);
  assert.equal(USER_QUESTION_WRITE_MARKER_VALUE, "user-question-console", "与 BFF 的 WRITE_MARKER 一致");
});

test("轮询：构建中或本轮已排上的等待才轮询，本轮没排上的等待不轮询", () => {
  const base = decodeUserQuestion(questionItem);
  assert.equal(questionNeedsPolling({ ...base, displayStatus: "BUILDING" }), true);
  assert.equal(questionNeedsPolling({ ...base, displayStatus: "WAITING" }), true);
  assert.equal(questionNeedsPolling({ ...base, displayStatus: "WAITING", currentBuild: undefined }), false);
  assert.equal(questionNeedsPolling({ ...base, displayStatus: "FAILED" }), false);
});
