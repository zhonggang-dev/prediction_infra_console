import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  UPLOAD_CONTENT_TYPES, UPLOAD_LIMIT_BYTES, apiError, decodeCatalogItem, decodeCreateRuns, decodeEngine, decodeParamDef, decodeResult, decodeRun, decodeSubmission, isActiveRun,
} from "../app/lib/backtest-platform.ts";
import { ConsoleV2ContractError } from "../app/lib/console-v2.ts";
import { runTitle } from "../app/lib/backtest-labels.ts";

const dir = new URL("./fixtures/backtest/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

test("全部运行 fixtures 都能被解码，且每个结果的区块 id 唯一", () => {
  const files = readdirSync(dir).filter((name) => /^run-.*\.json$/.test(name));
  assert.ok(files.length >= 12);
  for (const name of files) {
    const run = decodeRun(fixture(name).data);
    assert.match(run.runId, /^btr-/);
    if (run.result) assert.equal(new Set(run.result.sections.map((s) => s.id)).size, run.result.sections.length, name);
  }
});

test("result.json 样例覆盖七种区块类型与结果级 / 区块级筛选", () => {
  const result = decodeResult(fixture("result-all-sections.json"));
  assert.deepEqual(result.sections.map((s) => s.type), ["metrics", "table", "series", "bars", "matrix", "text", "image"]);
  assert.equal(result.filters[0].key, "ci_level");
  assert.equal(result.filters[0].defaultValue, "95");
  const table = result.sections[1];
  assert.equal(table.type === "table" && table.defaultSort?.key, "brier");
  const series = result.sections[2];
  assert.equal(series.type === "series" && series.series[0].points[2].y, null, "空值保持 null，不变成 0");
  const bars = result.sections[3];
  assert.equal(bars.type === "bars" && bars.referenceLines[0].value, 0.2, "单个 reference_line 被规范成数组");
  const image = result.sections[6];
  assert.deepEqual(image.type === "image" && image.when, { ci_level: "95" });
});

test("所有板块的 mock 结果都带齐 section，并覆盖交互所需的字段", () => {
  const trading = decodeRun(fixture("run-btr-20261019-trade001.json").data).result!;
  const curves = trading.sections.find((s) => s.id === "pnl_curves");
  assert.ok(curves && curves.type === "series" && curves.series.some((l) => l.variant === "realised") && curves.series.some((l) => l.variant === "mtm"));
  const calibration = decodeRun(fixture("run-btr-20261019-calib001.json").data).result!;
  const curve = calibration.sections.find((s) => s.id === "curve");
  assert.ok(curve && curve.type === "series" && curve.mode === "scatter" && curve.references[0].axis === "diagonal");
  assert.ok(curve.type === "series" && curve.series.some((line) => line.points.some((p) => p.lowSample)) && curve.series.every((line) => line.points.every((p) => p.size !== undefined && p.lower !== undefined)));
  const overview = decodeRun(fixture("run-btr-20261019-ovrvw001.json").data).result!;
  const main = overview.sections.find((s) => s.id === "main");
  assert.ok(main && main.type === "table" && main.pinSortedColumns && main.rankColumn);
});

test("结果非法时抛契约错误，未知区块类型降级为 unsupported", () => {
  const good = fixture("result-all-sections.json");
  assert.throws(() => decodeResult({ ...good, schema_version: "backtest.result.v2" }), ConsoleV2ContractError);
  assert.throws(() => decodeResult({ ...good, sections: undefined }), /sections/);
  assert.throws(() => decodeResult({ ...good, sections: [good.sections[0], good.sections[0]] }), /重复/);
  assert.throws(() => decodeResult({ ...good, sections: [{ id: "t", type: "table", columns: [{ key: "a", label: "A" }], rows: [{ a: 1 }], default_sort: "zzz" }] }), /不存在的列/);
  assert.throws(() => decodeResult({ ...good, sections: [{ id: "m", type: "matrix", rows: ["a"], cols: ["a", "b"], values: [[1]] }] }), /列数/);
  assert.throws(() => decodeResult({ ...good, filters: [{ key: "k", options: ["a", "b"], default: "c" }] }), /默认值/);
  assert.throws(() => decodeResult({ ...good, filters: [{ key: "k", options: [] }] }), /没有选项/);
  assert.throws(() => decodeResult({ ...good, sections: [{ id: "s", type: "series", x: "time", series: [{ name: "a", points: [["not-a-date", 1]] }] }] }), /x 无效/);
  const future = decodeResult({ ...good, sections: [{ id: "f", type: "sankey" }] });
  assert.equal(future.sections[0].type, "unsupported");
});

test("运行状态与进度解码；未知状态抛错；终态不再轮询", () => {
  const running = decodeRun(fixture("run-btr-20261019-run00001.json").data);
  assert.equal(running.status, "running");
  assert.deepEqual(running.progress, { done: 2, total: 3 });
  assert.equal(isActiveRun(running), true);
  assert.equal(decodeRun(fixture("run-btr-20261019-lost0001.json").data).lost, true);
  assert.equal(isActiveRun(decodeRun(fixture("run-btr-20261019-trade001.json").data)), false);
  assert.throws(() => decodeRun({ ...fixture("run-btr-20261019-run00001.json").data, status: "paused" }), /状态未知/);
  assert.throws(() => decodeRun({ status: "queued" }), /run_id/);
  const legacy = decodeRun(fixture("run-btr-legacy-factor-v7-01.json").data);
  assert.equal(legacy.origin, "legacy");
  assert.equal(legacy.rerunnable, false);
  assert.equal(legacy.reproduce, undefined);
  const failed = decodeRun(fixture("run-btr-20261019-fail0001.json").data);
  assert.equal(failed.error?.code, "script_failed");
  assert.match(failed.error?.logTail ?? "", /ValueError/);
});

test("复现信息、输入指纹和重跑关联被保留", () => {
  const rerun = decodeRun(fixture("run-btr-20261019-brier002.json").data);
  assert.equal(rerun.parentRunId, "btr-20261019-brier001");
  assert.match(rerun.reproduce?.text ?? "", /pmbt rerun btr-20261019-brier002/);
  assert.equal(rerun.inputFingerprints?.dataGeneration, "dg-1f3a9c20b7d44e10");
  assert.ok(Object.keys(rerun.inputFingerprints?.files ?? {}).length >= 3);
  assert.equal(rerun.hasArtifacts, true);
  // infra 在运行已有产物包时才给 artifacts_url；排队中的运行没有
  assert.equal(decodeRun(fixture("run-btr-20261019-queue001.json").data).hasArtifacts, false);
  assert.equal(decodeRun({ ...fixture("run-btr-20261019-queue001.json").data, artifacts_url: "/api/v1/backtest/runs/x/artifacts" }).hasArtifacts, true);
});

test("创建运行响应解码：复用标记与批次", () => {
  const created = decodeCreateRuns({ data: { batch_id: "btb-1", runs: [{ ...fixture("run-btr-20261019-brier001.json").data, reused: true }] } });
  assert.equal(created.batchId, "btb-1");
  assert.equal(created.runs[0].reused, true);
  assert.throws(() => decodeCreateRuns({ data: { runs: [] } }), /runs/);
});

test("目录条目、引擎参数定义与 market-view 拒收表解码", () => {
  const engine = decodeEngine(decodeCatalogItem(fixture("catalog-engines.json").data.items[0]));
  assert.equal(engine.isDefault, true);
  assert.equal(engine.protocol, "pearson-dmid-v8");
  assert.ok(engine.paramDefinitions["trading/strategy_comparison"].some((d) => d.name === "position_sizing.mode"));
  assert.match(engine.marketViewExclusions["benchmark/resolved_event_brier"], /Brier/);
  assert.equal(engine.signalWindow?.start, "2026-08-06T00:00:00+08:00");
  const tau = engine.paramDefinitions["benchmark/deviation"][0];
  assert.equal(tau.minExclusive, false, "infra 的参数定义没有 min_exclusive");
  assert.equal(tau.precision, 6);
  const horizon = engine.paramDefinitions["benchmark/model_signal"].find((d) => d.name === "horizon_hours")!;
  assert.equal(horizon.type, "integer");
  assert.deepEqual(horizon.choices?.map((c) => c.value), [1, 12, 24, 48, 96, 168]);
  const bucket = engine.paramDefinitions["benchmark/calibration"][0];
  assert.equal(bucket.itemType, "number");
  assert.equal(bucket.minItems, 3);
  assert.throws(() => decodeCatalogItem({ kind: "widget", key: "x" }), /未知 kind/);
  assert.throws(() => decodeCatalogItem({ kind: "model" }), /catalog.key/);
  assert.throws(() => decodeParamDef({ name: "a", type: "matrix" }), /类型未知/);
  assert.throws(() => decodeParamDef({ name: "a", type: "enum" }), /没有选项/);
  assert.equal(decodeParamDef({ name: "a", type: "boolean", default: true }).type, "bool");
});

test("提交状态与逐项错误解码", () => {
  const rejected = decodeSubmission(fixture("submission-bts-20261019-bad00001.json").data);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.errors.length, 2);
  assert.equal(rejected.errors[0].path, "vol_burst");
  assert.equal(decodeSubmission(fixture("submission-bts-20261019-val00001.json").data).status, "validating");
  assert.equal(rejected.id, "bts-20261019-bad00001", "infra 的主键字段是 submission_id");
  assert.equal(rejected.alreadySubmitted, false);
  assert.equal(decodeSubmission({ ...fixture("submission-bts-20261019-ok000001.json").data, already_submitted: true }).alreadySubmitted, true);
  assert.throws(() => decodeSubmission({ id: "bts-1", kind: "prediction", status: "accepted" }), /submission_id/);
  assert.throws(() => decodeSubmission({ submission_id: "x", kind: "video", status: "accepted" }), /提交类型未知/);
});

test("上传常量：与 BFF 一致的 1 GiB 上限，三类提交的 Content-Type", () => {
  assert.equal(UPLOAD_LIMIT_BYTES, 1024 ** 3);
  assert.equal(UPLOAD_CONTENT_TYPES.prediction.contentType, "application/vnd.apache.parquet");
  assert.equal(UPLOAD_CONTENT_TYPES.strategy.contentType, "application/gzip");
});

test("运行标题使用中文板块与项目名", () => {
  assert.equal(runTitle("benchmark", "calibration"), "Benchmark · 概率校准");
  assert.equal(runTitle("x", "y"), "x · y");
});

test("infra 错误体：逐项错误带字段名，超出展示数量时给出总数", () => {
  const plain = apiError({ code: "TOO_MANY_ACTIVE_RUNS", message: "未完成的运行已达上限", request_id: "r" }, 429);
  assert.equal(plain.status, 429);
  assert.equal(plain.code, "TOO_MANY_ACTIVE_RUNS");
  assert.equal(plain.message, "未完成的运行已达上限");
  const invalid = apiError({ code: "INVALID_BACKTEST_RUN", message: "the run request is invalid", data: { errors: [{ field: "runs[0].window", message: "start must be before end_exclusive" }, { field: "runs[0].params.x_days", message: "must be at least 3" }], total_errors: 2 } }, 400);
  assert.match(invalid.message, /^发起参数不符合要求：runs\[0\]\.window：start must be before end_exclusive；runs\[0\]\.params\.x_days：must be at least 3$/);
  assert.equal(apiError({ code: "RUN_NOT_RERUNNABLE", message: "the run has not finished" }, 409).message, "该运行不能重跑：the run has not finished");
  assert.equal(apiError({ code: "TOO_MANY_ACTIVE_RUNS", message: "未完成的运行已达上限，请等待当前运行结束或停止后再试" }, 429).message, "未完成的运行已达上限，请等待当前运行结束或停止后再试", "中文原文不改写");
  assert.ok(!invalid.message.includes("共"));
  const many = apiError({ message: "bad", data: { errors: Array.from({ length: 8 }, (_, i) => ({ field: `f${i}`, message: "m" })), total_errors: 8 } }, 400);
  assert.match(many.message, /（共 8 项）$/);
  assert.equal(apiError("garbage", 502).message, "回测平台接口请求失败");
});

test("目录列表响应外壳与 infra 一致：{code, message, data:{items, limit, offset, has_more, observed_at}, request_id}", () => {
  const wire = { code: "BACKTEST_CATALOG_FOUND", message: "目录已返回", request_id: "r1", data: { items: [{ kind: "engine", key: "pm-engine", version: "pm-engine-1", origin: "platform", status: "available", metadata: { param_definitions: {} }, created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" }], limit: 50, offset: 0, has_more: false, observed_at: "2026-10-19T00:00:01Z" } };
  const items = (wire.data.items as unknown[]).map(decodeCatalogItem);
  assert.equal(items[0].version, "pm-engine-1");
  assert.equal(decodeEngine(items[0]).isDefault, false, "目录元数据没有 is_default 时不是默认引擎（由页面按发布时间选最新）");
});
