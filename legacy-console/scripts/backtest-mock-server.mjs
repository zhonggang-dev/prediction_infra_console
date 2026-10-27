// 回测平台前端的本地 mock 上游（模拟 prediction-infra 的 /api/v1/backtest/*），只用于开发与浏览器验收。
//
//   node scripts/backtest-mock-server.mjs            # 监听 127.0.0.1:18992
//   PREDICTION_INFRA_BASE_URL=http://127.0.0.1:18992 BACKTEST_PLATFORM_CONSOLE_TOKEN=mock-token pnpm start:v2
//
// 数据来自 tests/fixtures/backtest（由 build-fixtures.mjs 生成，结构与契约一致）。新发起的运行会按时间推进：
// 排队 3 秒 → 运行 10 秒（带进度与日志）→ 成功并返回同板块的示例结果；上传的提交 6 秒后通过。
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dir = fileURLToPath(new URL("../tests/fixtures/backtest/", import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));
const PORT = Number(process.env.MOCK_PORT ?? 18992);
const TOKEN = process.env.MOCK_TOKEN ?? "mock-token";

const catalog = ["models", "strategies", "datasets", "engines", "factors"].flatMap((name) => load(`catalog-${name}.json`).data.items);
const fixtureRuns = Object.fromEntries(readdirSync(dir).filter((f) => /^run-.*\.json$/.test(f)).map((f) => [load(f).data.run_id, load(f).data]));
const submissions = Object.fromEntries(readdirSync(dir).filter((f) => /^submission-.*\.json$/.test(f)).map((f) => [load(f).data.submission_id, load(f).data]));
const dynamic = new Map();
const dynamicSubmissions = new Map();
const templates = { "trading/strategy_comparison": "btr-20261019-trade001", "benchmark/overview": "btr-20261019-ovrvw001", "benchmark/resolved_event_brier": "btr-20261019-brier001", "benchmark/calibration": "btr-20261019-calib001", "signal/factor": "btr-20261019-sig00001", "signal/factor_batch": "btr-20261019-batch001", "signal/model": "btr-20261019-sig00001", "signal/correlation": "btr-20261019-corr0001" };
const placeholder = readFileSync(join(dir, "placeholder.png"));
const rid = () => `btr-20261019-${Math.random().toString(36).slice(2, 10).padEnd(8, "x")}`;
const stamp = () => new Date().toISOString();

const send = (res, status, body, headers = {}) => { const text = JSON.stringify(body); res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(text); };
const fail = (res, status, code, message) => send(res, status, { code, message, request_id: "mock" });
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });
const page = (items, offset, limit) => ({ data: { items: items.slice(offset, offset + limit), limit, offset, has_more: offset + limit < items.length, observed_at: stamp() } });

/** 动态运行按创建时间推进状态。 */
function materialise(entry) {
  const age = (Date.now() - entry.createdMs) / 1000;
  const base = { ...entry.run };
  if (entry.cancelled) return { ...base, status: "cancelled", finished_at: stamp() };
  if (entry.mode === "fail" ) return age < 3 ? { ...base, status: "queued" } : { ...base, status: "failed", started_at: base.created_at, finished_at: stamp(), error: { code: "script_failed", message: "mock：脚本以退出码 1 结束", log_tail: "Traceback...\nValueError: mock failure" } };
  if (age < 3) return { ...base, status: "queued" };
  if (age < 13) {
    const done = Math.min(3, Math.floor((age - 3) / 3.4));
    return { ...base, status: "running", started_at: base.created_at, heartbeat_at: stamp(), cancel_requested: entry.cancelRequested === true, stage: "run", stage_label: `运行脚本 ${done + 1}/4`, progress: { done, total: 4 }, log_tail: Array.from({ length: done + 1 }, (_, i) => `[${stamp().slice(11, 19)}] step ${i + 1} ok`).join("\n") };
  }
  const template = fixtureRuns[templates[`${base.board}/${base.item}`] ?? "btr-20261019-brier001"];
  return { ...base, status: "succeeded", started_at: base.created_at, finished_at: stamp(), heartbeat_at: stamp(), result: { ...template.result, board: base.board, item: base.item }, reproduce: { text: template.reproduce.text.replaceAll(template.run_id, base.run_id), fields: {} }, input_fingerprints: template.input_fingerprints, artifacts_url: `/api/v1/backtest/runs/${base.run_id}/artifacts` };
}
const summaryOf = ({ result, reproduce, input_fingerprints, ...rest }) => { void result; void reproduce; void input_fingerprints; return rest; };
const allRuns = () => [...Array.from(dynamic.values()).map(materialise), ...Object.values(fixtureRuns)].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
const submissionState = (entry) => (Date.now() - entry.createdMs > 6000 ? { ...entry.value, status: entry.reject ? "rejected" : "accepted", decided_at: stamp(), errors: entry.reject ? [{ path: "available_at", code: "tz_missing", message: "available_at 必须带时区（mock 拒收示例）" }] : [] } : entry.value);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://mock");
  const path = url.pathname.replace(/^\/api\/v1\/backtest\/?/, "").split("/").filter(Boolean);
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { fail(res, 401, "UNAUTHORIZED", "mock：令牌不正确"); return; }
  if (!url.pathname.startsWith("/api/v1/backtest")) { fail(res, 404, "NOT_FOUND", "mock"); return; }
  const q = url.searchParams;
  const limit = Number(q.get("limit") ?? 50); const offset = Number(q.get("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) { fail(res, 400, "INVALID_PAGINATION", "limit 必须在 1 到 100 之间"); return; }
  const operator = req.headers["x-backtest-operator"] ?? "console";
  try {
    if (req.method === "GET" && path[0] === "catalog") {
      const known = new Set(["kind", "dataset", "tag", "q", "status", "pool_state", "covers_start", "covers_end", "limit", "offset"]);
      for (const name of q.keys()) if (!known.has(name)) { fail(res, 400, "INVALID_FILTER", `不支持的筛选条件 ${name}`); return; }
      const kind = q.get("kind"); const needle = (q.get("q") ?? "").toLowerCase(); const status = q.get("status") || "available";
      send(res, 200, page(catalog.filter((i) => (!kind || i.kind === kind) && (status === "all" || (i.status ?? "available") === status) && (!q.get("pool_state") || i.pool_state === q.get("pool_state")) && (!q.get("tag") || (i.metadata?.tags ?? []).includes(q.get("tag"))) && (!q.get("dataset") || i.metadata?.default_dataset === q.get("dataset") || q.get("dataset") in (i.metadata?.coverage ?? {})) && (!needle || i.key.toLowerCase().includes(needle))), offset, limit)); return;
    }
    if (req.method === "GET" && path[0] === "runs" && path.length === 1) {
      const items = allRuns().filter((r) => (!q.get("board") || r.board === q.get("board")) && (!q.get("status") || r.status === q.get("status")) && (!q.get("batch_id") || r.batch_id === q.get("batch_id")) && (!q.get("requested_by") || r.requested_by === q.get("requested_by"))).map(summaryOf);
      send(res, 200, page(items, offset, limit)); return;
    }
    if (req.method === "GET" && path[0] === "runs" && path.length === 2) {
      const found = dynamic.has(path[1]) ? materialise(dynamic.get(path[1])) : fixtureRuns[path[1]];
      if (found) send(res, 200, { data: found }); else fail(res, 404, "RUN_NOT_FOUND", `运行 ${path[1]} 不存在`);
      return;
    }
    if (req.method === "GET" && path[0] === "runs" && path[2] === "artifacts") {
      if ((q.get("path") ?? "").endsWith(".png")) { res.writeHead(200, { "content-type": "image/png", "content-length": placeholder.length }); res.end(placeholder); return; }
      const body = Buffer.alloc(2048, 1);
      res.writeHead(200, { "content-type": "application/x-tar", "content-disposition": `attachment; filename="${path[1]}-artifacts.tar"`, "content-length": body.length }); res.end(body); return;
    }
    if (req.method === "POST" && path[0] === "runs" && path.length === 1) {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const batch = `btb-20261019-${Math.random().toString(36).slice(2, 10)}`;
      if (body.rerun_of && (body.runs ?? []).length) { fail(res, 400, "INVALID_BACKTEST_RUN", "a rerun takes no run list"); return; }
      if (body.rerun_of && !["succeeded", "failed", "cancelled"].includes((dynamic.has(body.rerun_of) ? materialise(dynamic.get(body.rerun_of)) : fixtureRuns[body.rerun_of])?.status)) { fail(res, 409, "RUN_NOT_RERUNNABLE", "the run has not finished"); return; }
      const requests = body.rerun_of ? [{ ...(dynamic.get(body.rerun_of)?.run ?? fixtureRuns[body.rerun_of] ?? {}), rerun: true }] : body.runs ?? [];
      if (requests.length === 0) { fail(res, 400, "RUNS_REQUIRED", "runs 不能为空"); return; }
      const out = [];
      for (const request of requests) {
        const template = fixtureRuns[templates[`${request.board}/${request.item}`] ?? ""];
        if (!body.force && !body.rerun_of && template && request.board === "benchmark" && request.item === "resolved_event_brier") { out.push({ ...summaryOf(template), reused: true }); continue; }
        const id = rid();
        const run = { run_id: id, batch_id: batch, parent_run_id: body.rerun_of ?? null, origin: "platform", board: request.board, item: request.item, status: "queued", lost: false, attempt: 1, cancel_requested: false, config: { run_id: id, ...request }, config_sha256: id.padEnd(64, "0"), rerunnable: true, requested_by: `console:${operator}`, created_at: stamp() };
        dynamic.set(id, { run, createdMs: Date.now(), mode: request.params?.x_days === 14 ? "fail" : "ok" });
        out.push(run);
      }
      send(res, out.every((r) => r.reused) ? 200 : 201, { data: { batch_id: batch, runs: out } }); return;
    }
    if (req.method === "POST" && path[0] === "runs" && path[2] === "cancel") {
      const entry = dynamic.get(path[1]);
      if (entry) { entry.cancelled = true; send(res, 200, { data: materialise(entry) }); } else if (fixtureRuns[path[1]]) send(res, 200, { data: fixtureRuns[path[1]] }); else fail(res, 404, "RUN_NOT_FOUND", "不存在");
      return;
    }
    if (req.method === "GET" && path[0] === "submissions" && path.length === 2) {
      const entry = dynamicSubmissions.get(path[1]);
      const found = entry ? submissionState(entry) : submissions[path[1]];
      if (found) send(res, 200, { data: found }); else fail(res, 404, "SUBMISSION_NOT_FOUND", `提交 ${path[1]} 不存在`);
      return;
    }
    if (req.method === "POST" && ["predictions", "factor-tables", "strategies"].includes(path[0])) {
      const bytes = (await readBody(req)).length;
      const kind = path[0] === "predictions" ? "prediction" : path[0] === "factor-tables" ? "factor_table" : "strategy";
      const identity = kind === "prediction" ? { model_id: path[1], train_version: path[3], prediction_version: path[4] } : kind === "factor_table" ? { table: path[1], version: path[3] } : { id: path[1], version: path[3] };
      const id = `bts-20261019-${Math.random().toString(36).slice(2, 10)}`;
      const value = { submission_id: id, kind, identity, identity_key: Object.values(identity).join("/"), status: "validating", sha256: "d".repeat(64), bytes, content_type: req.headers["content-type"], errors: [], submitted_by: `console:${operator}`, created_at: stamp() };
      dynamicSubmissions.set(id, { value, createdMs: Date.now(), reject: String(path[1]).includes("bad") });
      send(res, 201, { data: value }); return;
    }
    if (req.method === "PUT" && path[0] === "factors" && path[2] === "pool") {
      const body = JSON.parse((await readBody(req)).toString());
      for (const item of catalog) {
        if (item.kind !== "factor") continue;
        if (item.key === path[1] && item.version === body.version) { item.pool_state = body.state; item.pool_changed_by = operator; item.pool_changed_at = stamp(); }
        else if (item.key === path[1] && body.state === "pool" && item.pool_state === "pool") item.pool_state = "experiment";
      }
      send(res, 200, { data: { factor_id: path[1], ...body } }); return;
    }
    fail(res, 404, "NOT_FOUND", `mock 未实现 ${req.method} ${url.pathname}`);
  } catch (error) { fail(res, 500, "MOCK_ERROR", String(error)); }
}).listen(PORT, "127.0.0.1", () => console.log(`backtest mock upstream on http://127.0.0.1:${PORT} (token: ${TOKEN})`));
