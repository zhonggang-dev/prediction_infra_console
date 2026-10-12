/**
 * Dataset rotation's browser-safe read model.
 *
 * The API decoder owns the wire contract so page components never cast raw
 * PostgreSQL/OSS shaped objects or silently turn a missing value into a
 * successful release.
 */

export const ROTATION_VARIANTS = ["mv", "ms", "original", "syn"] as const;
export type RotationVariant = (typeof ROTATION_VARIANTS)[number];
export const ROTATION_VERSION_STATUSES = ["waiting_input", "registering", "preparing", "publishing", "published", "empty", "failed"] as const;
export type RotationVersionStatus = (typeof ROTATION_VERSION_STATUSES)[number];
export type RotationReleaseKind = "market" | "syn";
export type RotationStorageStatus = "verified" | "unavailable" | "mismatch" | "not_checked";
export type RotationExecutionStatus = "idle" | "waiting_input" | "registering" | "preparing" | "publishing" | "published" | "failed";

export interface DatasetRotationVariant {
  variant: RotationVariant;
  status: RotationVersionStatus;
  publishedAt?: string;
  trainCount: number;
  testCount: number;
  readyCount: number;
  pendingCount: number;
  failedCount: number;
  trainWindowStart?: string;
  trainWindowEnd?: string;
  trainFirstDecisionAt?: string;
  trainLastDecisionAt?: string;
  isCurrent: boolean;
  storageStatus: RotationStorageStatus;
}

export interface DatasetRotationRelease {
  datasetVersion: string;
  kind: RotationReleaseKind;
  publishedAt?: string;
  windowStart: string;
  windowEnd: string;
  variants: DatasetRotationVariant[];
}

export interface DatasetRotationCurrentVersion {
  variant: RotationVariant;
  datasetVersion: string;
  publishedAt: string;
  windowStart: string;
  windowEnd: string;
  testCount: number;
  storageStatus: RotationStorageStatus;
}

export interface DatasetRotationTrainingSet {
  variant: RotationVariant;
  count: number;
  datasetVersions: string[];
  unreadyCount: number;
}

export interface DatasetRotationExecutionVariant {
  variant: RotationVariant;
  status: RotationVersionStatus;
  totalCount?: number;
  readyCount?: number;
  pendingCount?: number;
  failedCount?: number;
}

export interface DatasetRotationExecution {
  datasetVersion: string;
  status: RotationExecutionStatus;
  variants: DatasetRotationExecutionVariant[];
  readyCount?: number;
  pendingCount?: number;
  failedCount?: number;
}

export interface DatasetRotationData {
  enabled: boolean;
  timezone: string;
  observedAt: string;
  nextRotationAt?: string;
  scheduleSource: string;
  releases: DatasetRotationRelease[];
  currentVersions: DatasetRotationCurrentVersion[];
  trainingSets: DatasetRotationTrainingSet[];
  execution?: DatasetRotationExecution;
}

export class DatasetRotationContractError extends Error {
  constructor(field: string) {
    super(`数据集轮换接口返回了无效的 ${field}`);
    this.name = "DatasetRotationContractError";
  }
}

type RecordValue = Record<string, unknown>;

export function decodeDatasetRotation(value: unknown): DatasetRotationData {
  const root = object(value, "data");
  const observedAt = timestamp(root.observed_at, "observed_at");
  const nextRotationAt = nullableTimestamp(root.next_rotation_at, "next_rotation_at");
  return {
    enabled: boolean(root.enabled, "enabled"),
    timezone: timezoneValue(root.timezone, "timezone"),
    observedAt,
    nextRotationAt,
    scheduleSource: nonEmptyString(root.schedule_source, "schedule_source"),
    releases: array(root.releases, "releases").map((item, index) => decodeRelease(item, `releases[${index}]`)),
    currentVersions: array(root.current_versions, "current_versions").map((item, index) => decodeCurrentVersion(item, `current_versions[${index}]`)),
    trainingSets: array(root.training_sets, "training_sets").map((item, index) => decodeTrainingSet(item, `training_sets[${index}]`)),
    execution: root.execution === null || root.execution === undefined ? undefined : decodeExecution(root.execution, "execution"),
  };
}

function decodeRelease(value: unknown, field: string): DatasetRotationRelease {
  const item = object(value, field);
  const publishedAt = nullableTimestamp(item.published_at, `${field}.published_at`);
  const kind = item.kind;
  if (kind !== "market" && kind !== "syn") throw new DatasetRotationContractError(`${field}.kind`);
  return {
    datasetVersion: nonEmptyString(item.dataset_version, `${field}.dataset_version`),
    kind,
    publishedAt,
    windowStart: timestamp(item.window_start, `${field}.window_start`),
    windowEnd: timestamp(item.window_end, `${field}.window_end`),
    variants: array(item.variants, `${field}.variants`).map((variant, index) => decodeVariant(variant, `${field}.variants[${index}]`)),
  };
}

function decodeVariant(value: unknown, field: string): DatasetRotationVariant {
  const item = object(value, field);
  return {
    variant: variant(item.variant, `${field}.variant`),
    status: versionStatus(item.status, `${field}.status`),
    publishedAt: nullableTimestamp(item.published_at, `${field}.published_at`),
    trainCount: count(item.train_count, `${field}.train_count`),
    testCount: count(item.test_count, `${field}.test_count`),
    readyCount: count(item.ready_count, `${field}.ready_count`),
    pendingCount: count(item.pending_count, `${field}.pending_count`),
    failedCount: count(item.failed_count, `${field}.failed_count`),
    trainWindowStart: nullableTimestamp(item.train_window_start, `${field}.train_window_start`),
    trainWindowEnd: nullableTimestamp(item.train_window_end, `${field}.train_window_end`),
    trainFirstDecisionAt: nullableTimestamp(item.train_first_decision_at, `${field}.train_first_decision_at`),
    trainLastDecisionAt: nullableTimestamp(item.train_last_decision_at, `${field}.train_last_decision_at`),
    isCurrent: boolean(item.is_current, `${field}.is_current`),
    storageStatus: storageStatus(item.storage_status, `${field}.storage_status`),
  };
}

function decodeCurrentVersion(value: unknown, field: string): DatasetRotationCurrentVersion {
  const item = object(value, field);
  const publishedAt = timestamp(item.published_at, `${field}.published_at`);
  return {
    variant: variant(item.variant, `${field}.variant`),
    datasetVersion: nonEmptyString(item.dataset_version, `${field}.dataset_version`),
    publishedAt,
    windowStart: timestamp(item.window_start, `${field}.window_start`),
    windowEnd: timestamp(item.window_end, `${field}.window_end`),
    testCount: count(item.test_count, `${field}.test_count`),
    storageStatus: storageStatus(item.storage_status, `${field}.storage_status`),
  };
}

function decodeTrainingSet(value: unknown, field: string): DatasetRotationTrainingSet {
  const item = object(value, field);
  const versions = array(item.dataset_versions, `${field}.dataset_versions`).map((version, index) => nonEmptyString(version, `${field}.dataset_versions[${index}]`));
  return {
    variant: variant(item.variant, `${field}.variant`),
    count: count(item.count, `${field}.count`),
    datasetVersions: versions,
    unreadyCount: count(item.unready_count, `${field}.unready_count`),
  };
}

function decodeExecution(value: unknown, field: string): DatasetRotationExecution {
  const item = object(value, field);
  const status = item.status;
  if (typeof status !== "string" || !["idle", "waiting_input", "registering", "preparing", "publishing", "published", "failed"].includes(status)) {
    throw new DatasetRotationContractError(`${field}.status`);
  }
  return {
    datasetVersion: nonEmptyString(item.dataset_version, `${field}.dataset_version`),
    status: status as RotationExecutionStatus,
    variants: array(item.variants, `${field}.variants`).map((variantItem, index) => decodeExecutionVariant(variantItem, `${field}.variants[${index}]`)),
    readyCount: nullableCount(item.ready_count, `${field}.ready_count`),
    pendingCount: nullableCount(item.pending_count, `${field}.pending_count`),
    failedCount: nullableCount(item.failed_count, `${field}.failed_count`),
  };
}

function decodeExecutionVariant(value: unknown, field: string): DatasetRotationExecutionVariant {
  const item = object(value, field);
  return {
    variant: variant(item.variant, `${field}.variant`),
    status: versionStatus(item.status, `${field}.status`),
    totalCount: nullableCount(item.total_count, `${field}.total_count`),
    readyCount: nullableCount(item.ready_count, `${field}.ready_count`),
    pendingCount: nullableCount(item.pending_count, `${field}.pending_count`),
    failedCount: nullableCount(item.failed_count, `${field}.failed_count`),
  };
}

function object(value: unknown, field: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DatasetRotationContractError(field);
  return value as RecordValue;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new DatasetRotationContractError(field);
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new DatasetRotationContractError(field);
  return value.trim();
}

function timestamp(value: unknown, field: string): string {
  const parsed = nullableTimestamp(value, field);
  if (!parsed) throw new DatasetRotationContractError(field);
  return parsed;
}

function timezoneValue(value: unknown, field: string): string {
  const timezone = nonEmptyString(value, field);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new DatasetRotationContractError(field);
  }
  return timezone;
}

function nullableTimestamp(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new DatasetRotationContractError(field);
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new DatasetRotationContractError(field);
  return value;
}

function count(value: unknown, field: string): number {
  const parsed = nullableCount(value, field);
  if (parsed === undefined) throw new DatasetRotationContractError(field);
  return parsed;
}

function nullableCount(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new DatasetRotationContractError(field);
  return parsed;
}

function variant(value: unknown, field: string): RotationVariant {
  if (typeof value !== "string" || !ROTATION_VARIANTS.includes(value as RotationVariant)) throw new DatasetRotationContractError(field);
  return value as RotationVariant;
}

function versionStatus(value: unknown, field: string): RotationVersionStatus {
  if (typeof value !== "string" || !ROTATION_VERSION_STATUSES.includes(value as RotationVersionStatus)) throw new DatasetRotationContractError(field);
  return value as RotationVersionStatus;
}

function storageStatus(value: unknown, field: string): RotationStorageStatus {
  if (value !== "verified" && value !== "unavailable" && value !== "mismatch" && value !== "not_checked") throw new DatasetRotationContractError(field);
  return value;
}
