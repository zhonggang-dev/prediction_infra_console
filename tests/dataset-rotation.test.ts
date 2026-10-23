import assert from "node:assert/strict";
import test from "node:test";
import { DatasetRotationContractError, datasetTestDownloadState, decodeDatasetRotation } from "../app/lib/dataset-rotation.ts";

const variant = (name: string, overrides: Record<string, unknown> = {}) => ({
  variant: name,
  status: "published",
  published_at: "2026-10-09T14:51:58Z",
  train_count: 0,
  test_count: 0,
  ready_count: 0,
  pending_count: 0,
  failed_count: 0,
  train_window_start: null,
  train_window_end: null,
  train_first_decision_at: null,
  train_last_decision_at: null,
  is_current: false,
  storage_status: "verified",
  ...overrides,
});

function payload(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    timezone: "Asia/Shanghai",
    observed_at: "2026-10-12T06:05:00Z",
    next_rotation_at: "2026-11-07T16:05:00Z",
    schedule_source: "monthly_plan",
    releases: [{
      dataset_version: "20260908-20261008",
      kind: "market",
      published_at: "2026-10-09T14:51:58Z",
      window_start: "2026-09-08",
      window_end: "2026-10-08",
      variants: [variant("mv", { train_count: 903, test_count: 359, is_current: true, train_window_start: "2026-08-08", train_window_end: "2026-09-08" })],
    }],
    current_versions: [{ variant: "mv", dataset_version: "20260908-20261008", published_at: "2026-10-09T14:51:58Z", window_start: "2026-09-08", window_end: "2026-10-08", test_count: 359, storage_status: "verified" }],
    training_sets: [{ variant: "mv", count: 903, dataset_versions: ["20260908-20261008"], unready_count: 0 }],
    execution: null,
    ...overrides,
  };
}

test("解码器保留独立 Syn 行与 0 训练成员", () => {
  const data = decodeDatasetRotation(payload({
    releases: [{
      dataset_version: "20260911-20261011",
      kind: "syn",
      published_at: "2026-10-11T09:23:34Z",
      window_start: "2026-09-11",
      window_end: "2026-10-11",
      variants: [variant("syn", { train_count: 0, test_count: 154, is_current: true })],
    }],
    current_versions: [{ variant: "syn", dataset_version: "20260911-20261011", published_at: "2026-10-11T09:23:34Z", window_start: "2026-09-11", window_end: "2026-10-11", test_count: 154, storage_status: "verified" }],
    training_sets: [{ variant: "syn", count: 0, dataset_versions: ["20260911-20261011"], unready_count: 0 }],
  }));
  assert.equal(data.releases[0].kind, "syn");
  assert.equal(data.releases[0].variants[0].trainCount, 0);
  assert.equal(data.currentVersions[0].datasetVersion, "20260911-20261011");
});

test("历史已发布但尚未核对的 test 下载交给下载时严格校验", () => {
  assert.equal(datasetTestDownloadState("verified", true), "available");
  assert.equal(datasetTestDownloadState("verified", false), "available");
  assert.equal(datasetTestDownloadState("not_checked", false), "download_checked");
  assert.equal(datasetTestDownloadState("not_checked", true), "unavailable");
  assert.equal(datasetTestDownloadState("mismatch", false), "unavailable");
  assert.equal(datasetTestDownloadState("unavailable", false), "unavailable");
});

test("解码器拒绝缺字段或未知存储状态，避免页面误报已发布", () => {
  assert.throws(() => decodeDatasetRotation(payload({ enabled: "true" })), DatasetRotationContractError);
  assert.throws(() => decodeDatasetRotation(payload({ current_versions: [{ variant: "mv", dataset_version: "v", published_at: "2026-10-09T14:51:58Z", window_start: "2026-09-08", window_end: "2026-10-08", test_count: 1, storage_status: "verified-but-unknown" }] })), DatasetRotationContractError);
  assert.throws(() => decodeDatasetRotation(payload({ releases: [{ ...payload().releases[0], variants: [variant("mv", { status: "future_status" })] }] })), DatasetRotationContractError);
});

test("解码器接受未发布的下次计划为空与执行失败状态", () => {
  const data = decodeDatasetRotation(payload({ enabled: false, next_rotation_at: null, execution: {
    dataset_version: "20260908-20261008",
    status: "failed",
    variants: [{ variant: "ms", status: "failed", ready_count: 0, pending_count: 1, failed_count: 1 }],
    ready_count: 0,
    pending_count: 1,
    failed_count: 1,
  } }));
  assert.equal(data.nextRotationAt, undefined);
  assert.equal(data.execution?.status, "failed");
  assert.equal(data.execution?.variants[0].failedCount, 1);
});

test("解码器读取执行阶段的成员统计并拒绝未知成员状态", () => {
  const data = decodeDatasetRotation(payload({ execution: {
    dataset_version: "20260908-20261008",
    status: "failed",
    variants: [{ variant: "ms", status: "failed", total_count: 3, ready_count: 2, pending_count: 0, failed_count: 1 }],
  } }));
  assert.equal(data.execution?.variants[0].totalCount, 3);
  assert.equal(data.execution?.variants[0].failedCount, 1);
  assert.throws(() => decodeDatasetRotation(payload({ execution: {
    dataset_version: "20260908-20261008",
    status: "preparing",
    variants: [{ variant: "ms", status: "unknown" }],
  } })), DatasetRotationContractError);
});

test("解码器拒绝无效窗口和时区，避免格式化兜底掩盖坏 DTO", () => {
  assert.throws(() => decodeDatasetRotation(payload({ timezone: "Mars/Base" })), DatasetRotationContractError);
  assert.throws(() => decodeDatasetRotation(payload({ releases: [{ ...payload().releases[0], window_end: "not-a-timestamp" }] })), DatasetRotationContractError);
  assert.throws(() => decodeDatasetRotation(payload({ releases: [{
    ...payload().releases[0],
    variants: [variant("mv", { train_window_start: "not-a-timestamp" })],
  }] })), DatasetRotationContractError);
  assert.throws(() => decodeDatasetRotation(payload({ current_versions: [{
    ...payload().current_versions[0],
    window_start: "not-a-timestamp",
  }] })), DatasetRotationContractError);
});
