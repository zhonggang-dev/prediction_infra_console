import assert from "node:assert/strict";
import test from "node:test";
import { RedisMonitorContractError, decodeRedisMonitor } from "../app/lib/redis-monitor.ts";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    sampled_at: "2026-10-13T06:00:00Z",
    stale: false,
    instance: {
      used_memory_bytes: 800,
      used_memory_dataset_bytes: 700,
      used_memory_rss_bytes: 900,
      max_memory_bytes: 1000,
      usage_percent: 80,
      max_memory_configured: true,
      level: "warning",
      eviction_policy: "noeviction",
    },
    keys: {
      total_keys: 3,
      scanned_keys: 3,
      scan_complete: true,
      categories: [{ name: "selection_run_payload", kind: "cache", key_count: 2, estimated_bytes: 400 }],
    },
    streams: [{
      key: "prediction_ready_new",
      category: "sandbox_ready_new",
      length: 10,
      estimated_bytes: 300,
      groups: [{ name: "consumer", consumers: 1, lag: 2, pending: 3 }],
    }],
    cleanup: { status: "not_enabled", retention_days: 7, message: "消息生命周期采样尚未接入" },
    errors: [],
    ...overrides,
  };
}

test("Redis 解码器区分实例容量和 Stream/缓存分类", () => {
  const data = decodeRedisMonitor(payload());
  assert.equal(data.instance.usagePercent, 80);
  assert.equal(data.keys.categories[0].kind, "cache");
  assert.equal(data.streams[0].groups[0].lag, 2);
  assert.equal(data.cleanup.retentionDays, 7);
});

test("maxmemory 未配置时保留未知上限，不把缺失值伪装成正常容量", () => {
  const data = decodeRedisMonitor(payload({
    instance: {
      used_memory_bytes: 800,
      used_memory_dataset_bytes: 700,
      used_memory_rss_bytes: 900,
      max_memory_bytes: 0,
      usage_percent: 0,
      max_memory_configured: false,
      level: "unknown",
    },
  }));
  assert.equal(data.instance.maxMemoryConfigured, false);
  assert.equal(data.instance.level, "unknown");
  assert.equal(data.instance.maxMemoryBytes, 0);
});

test("消费组 lag/pending 可以为空，但错误的类型会拒绝", () => {
  const data = decodeRedisMonitor(payload({ streams: [{
    key: "stream",
    category: "other_stream",
    length: 0,
    estimated_bytes: 0,
    groups: [{ name: "group", consumers: 0, lag: null, pending: null }],
  }] }));
  assert.equal(data.streams[0].groups[0].lag, undefined);
  assert.equal(data.streams[0].groups[0].pending, undefined);
  assert.throws(() => decodeRedisMonitor(payload({ status: "healthy" })), RedisMonitorContractError);
});

