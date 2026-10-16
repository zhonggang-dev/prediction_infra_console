/**
 * Browser-safe Redis monitoring read model.
 *
 * The Console API owns the wire contract here so the dashboard never casts
 * Redis DTOs or turns unavailable values into a healthy zero.
 */

export type RedisMonitorStatus = "ok" | "degraded" | "stale" | "disabled" | "unavailable";
export type RedisMonitorLevel = "normal" | "warning" | "critical" | "unknown";
export type RedisMonitorCategoryKind = "stream" | "cache";
export type RedisMonitorCleanupStatus = "not_enabled" | "ok" | "degraded" | "unknown";

export interface RedisMonitorInstance {
  usedMemoryBytes: number;
  usedMemoryDatasetBytes: number;
  usedMemoryRssBytes: number;
  maxMemoryBytes: number;
  usagePercent: number;
  maxMemoryConfigured: boolean;
  level: RedisMonitorLevel;
  evictionPolicy?: string;
}

export interface RedisMonitorCategory {
  name: string;
  kind: RedisMonitorCategoryKind;
  keyCount: number;
  estimatedBytes: number;
}

export interface RedisMonitorGroup {
  name: string;
  consumers: number;
  lag?: number;
  pending?: number;
}

export interface RedisMonitorStream {
  key: string;
  category: string;
  length: number;
  estimatedBytes: number;
  groups: RedisMonitorGroup[];
  error?: string;
}

export interface RedisMonitorKeys {
  totalKeys: number;
  scannedKeys: number;
  scanComplete: boolean;
  categories: RedisMonitorCategory[];
}

export interface RedisMonitorCleanup {
  status: RedisMonitorCleanupStatus;
  retentionDays: number;
  message?: string;
}

export interface RedisMonitorData {
  status: RedisMonitorStatus;
  sampledAt?: string;
  stale: boolean;
  instance: RedisMonitorInstance;
  keys: RedisMonitorKeys;
  streams: RedisMonitorStream[];
  cleanup: RedisMonitorCleanup;
  errors: string[];
}

export class RedisMonitorContractError extends Error {
  constructor(field: string) {
    super(`Redis 监控接口返回了无效的 ${field}`);
    this.name = "RedisMonitorContractError";
  }
}

type RecordValue = Record<string, unknown>;

const REDIS_STATUSES: RedisMonitorStatus[] = ["ok", "degraded", "stale", "disabled", "unavailable"];
const REDIS_LEVELS: RedisMonitorLevel[] = ["normal", "warning", "critical", "unknown"];
const CATEGORY_KINDS: RedisMonitorCategoryKind[] = ["stream", "cache"];
const CLEANUP_STATUSES: RedisMonitorCleanupStatus[] = ["not_enabled", "ok", "degraded", "unknown"];

export function decodeRedisMonitor(value: unknown): RedisMonitorData {
  const root = object(value, "data");
  return {
    status: enumValue(root.status, REDIS_STATUSES, "status"),
    sampledAt: nullableTimestamp(root.sampled_at, "sampled_at"),
    stale: boolean(root.stale, "stale"),
    instance: decodeInstance(root.instance, "instance"),
    keys: decodeKeys(root.keys, "keys"),
    streams: array(root.streams, "streams").map((item, index) => decodeStream(item, `streams[${index}]`)),
    cleanup: decodeCleanup(root.cleanup, "cleanup"),
    errors: array(root.errors ?? [], "errors").map((item, index) => nonEmptyString(item, `errors[${index}]`)),
  };
}

function decodeInstance(value: unknown, field: string): RedisMonitorInstance {
  const item = object(value, field);
  return {
    usedMemoryBytes: bytes(item.used_memory_bytes, `${field}.used_memory_bytes`),
    usedMemoryDatasetBytes: bytes(item.used_memory_dataset_bytes, `${field}.used_memory_dataset_bytes`),
    usedMemoryRssBytes: bytes(item.used_memory_rss_bytes, `${field}.used_memory_rss_bytes`),
    maxMemoryBytes: bytes(item.max_memory_bytes, `${field}.max_memory_bytes`),
    usagePercent: finiteNumber(item.usage_percent, `${field}.usage_percent`, 0),
    maxMemoryConfigured: boolean(item.max_memory_configured, `${field}.max_memory_configured`),
    level: enumValue(item.level, REDIS_LEVELS, `${field}.level`),
    evictionPolicy: nullableString(item.eviction_policy, `${field}.eviction_policy`),
  };
}

function decodeKeys(value: unknown, field: string): RedisMonitorKeys {
  const item = object(value, field);
  return {
    totalKeys: count(item.total_keys, `${field}.total_keys`),
    scannedKeys: count(item.scanned_keys, `${field}.scanned_keys`),
    scanComplete: boolean(item.scan_complete, `${field}.scan_complete`),
    categories: array(item.categories, `${field}.categories`).map((entry, index) => decodeCategory(entry, `${field}.categories[${index}]`)),
  };
}

function decodeCategory(value: unknown, field: string): RedisMonitorCategory {
  const item = object(value, field);
  return {
    name: nonEmptyString(item.name, `${field}.name`),
    kind: enumValue(item.kind, CATEGORY_KINDS, `${field}.kind`),
    keyCount: count(item.key_count, `${field}.key_count`),
    estimatedBytes: bytes(item.estimated_bytes, `${field}.estimated_bytes`),
  };
}

function decodeStream(value: unknown, field: string): RedisMonitorStream {
  const item = object(value, field);
  return {
    key: nonEmptyString(item.key, `${field}.key`),
    category: nonEmptyString(item.category, `${field}.category`),
    length: count(item.length, `${field}.length`),
    estimatedBytes: bytes(item.estimated_bytes, `${field}.estimated_bytes`),
    groups: array(item.groups, `${field}.groups`).map((entry, index) => decodeGroup(entry, `${field}.groups[${index}]`)),
    error: nullableString(item.error, `${field}.error`),
  };
}

function decodeGroup(value: unknown, field: string): RedisMonitorGroup {
  const item = object(value, field);
  return {
    name: nonEmptyString(item.name, `${field}.name`),
    consumers: count(item.consumers, `${field}.consumers`),
    lag: nullableCount(item.lag, `${field}.lag`),
    pending: nullableCount(item.pending, `${field}.pending`),
  };
}

function decodeCleanup(value: unknown, field: string): RedisMonitorCleanup {
  const item = object(value, field);
  return {
    status: enumValue(item.status, CLEANUP_STATUSES, `${field}.status`),
    retentionDays: count(item.retention_days, `${field}.retention_days`),
    message: nullableString(item.message, `${field}.message`),
  };
}

function object(value: unknown, field: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new RedisMonitorContractError(field);
  return value as RecordValue;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new RedisMonitorContractError(field);
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new RedisMonitorContractError(field);
  return value.trim();
}

function nullableString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return nonEmptyString(value, field);
}

function nullableTimestamp(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new RedisMonitorContractError(field);
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new RedisMonitorContractError(field);
  return value;
}

function finiteNumber(value: unknown, field: string, minimum?: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || (minimum !== undefined && parsed < minimum)) throw new RedisMonitorContractError(field);
  return parsed;
}

function bytes(value: unknown, field: string): number {
  return finiteNumber(value, field, 0);
}

function count(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field, 0);
  if (!Number.isSafeInteger(parsed)) throw new RedisMonitorContractError(field);
  return parsed;
}

function nullableCount(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return count(value, field);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new RedisMonitorContractError(field);
  return value as T;
}
