"use client";

/**
 * Typed client for the V2 read models.  The browser only talks to the same
 * origin BFF; service credentials and upstream URLs remain server-only.
 */

export type ConsoleV2Service = "infra" | "trading";

export interface ConsoleV2Page<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
  observedAt: string;
  summary?: Record<string, unknown>;
}

export interface ConsoleV2Result<T> {
  data: T;
  mode: "live";
}

export class ConsoleV2ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsoleV2ContractError";
  }
}

export class ConsoleV2ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ConsoleV2ApiError";
  }
}

export interface ConsoleV2Generation {
  generationId: string;
  sourceSelectionRunId: string;
  status: string;
  isCurrent: boolean | null;
  observedAt?: string;
  publishedAt?: string;
  memberCount: number | null;
  predictionEnabledCount: number | null;
}

export interface ConsoleV2Overview {
  observedAt: string;
  currentGeneration?: ConsoleV2Generation;
  activePoolCount: number | null;
  lastGeneration?: ConsoleV2Generation;
  poolDiffersFromGeneration: boolean | null;
}

export interface ConsoleV2RunningMarket {
  generationId: string;
  runningMarketId: string;
  sourceSelectionRunId: string;
  sourceSelectedMarketId: string;
  marketId: string;
  conditionId: string;
  question: string;
  primaryDomain?: string;
  matchedDomains: string[];
  volume24h: number | null;
  domainRank: number | null;
  predictionEnabled: boolean | null;
  marketObservedAt?: string;
  endAt?: string;
}

export interface ConsoleV2RunningPool {
  runningMarketId: string;
  marketId: string;
  conditionId: string;
  sourceSelectedMarketId: string;
  sourceSelectionRunId: string;
  isActive: boolean | null;
  retiredAt?: string;
  retiredReason?: string;
  question: string;
  primaryDomain?: string;
  matchedDomains: string[];
  volume24h: number | null;
  marketObservedAt?: string;
  endAt?: string;
}

export interface ConsoleV2SelectionRun {
  selectionRunId: string;
  marketSource?: string;
  selectorType?: string;
  policyName?: string;
  policyVersion?: string;
  status: string;
  isCurrent: boolean | null;
  candidateCount: number | null;
  selectedCount: number | null;
  rejectedCount: number | null;
  startedAt?: string;
  completedAt?: string;
  publishedAt?: string;
}

export interface ConsoleV2SelectedMarket {
  selectedMarketId: string;
  selectionRunId: string;
  marketSource?: string;
  marketId: string;
  conditionId: string;
  question: string;
  primaryDomain?: string;
  rank: number | null;
  endAt?: string;
  volume24h: number | null;
  selectedAt?: string;
}

export interface ConsoleV2Prediction {
  predictionId: string;
  sandboxId?: string;
  sourceJobId?: string;
  marketSource?: string;
  selectionRunId?: string;
  selectedMarketId?: string;
  marketId: string;
  conditionId: string;
  question: string;
  primaryDomain?: string;
  executionMode?: string;
  outcome0Name?: string;
  outcome0Probability: number | null;
  outcome1Name?: string;
  outcome1Probability: number | null;
  modelName?: string;
  predictorVersion?: string;
  predictionAsOf?: string;
  receivedAt?: string;
  completedAt?: string;
}

export type ConsoleV2PredictionTaskStatus = "PENDING" | "COMPLETED" | string;

export interface ConsoleV2PredictionTask {
  predictionId: string;
  sourceJobId?: string;
  predictionModelId: string;
  marketSource?: string;
  selectionRunId: string;
  selectedMarketId: string;
  marketId: string;
  conditionId: string;
  question: string;
  predictionAsOf?: string;
  taskAvailableAt?: string;
  status: ConsoleV2PredictionTaskStatus;
  receivedAt?: string;
  completedAt?: string;
}

export interface ConsoleV2Asset {
  assetKind: string;
  marketSource?: string;
  sandboxId?: string;
  jobId?: string;
  marketId?: string;
  conditionId?: string;
  question?: string;
  generatedQaId?: string;
  sourceQaId?: string;
  qaVersion: number | null;
  mode?: string;
  decisionAt?: string;
  informationCutoffAt?: string;
  builtAt?: string;
  committedAt?: string;
  archiveSizeBytes: number | null;
  tradeEnabled: boolean | null;
}

export interface ConsoleV2DatasetMember {
  memberId: string;
  datasetVersion: string;
  variant: string;
  purpose: string;
  sourceNamespace?: string;
  externalDirectoryId?: string;
  decisionAt?: string;
  sourceVersion?: string;
  status: string;
  cleaningRecordId?: string;
  artifactSha256?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConsoleV2MarketData {
  seriesId: string;
  sampleAt?: string;
  status: string;
  targetCount: number | null;
  snapshotCount: number | null;
  okCount: number | null;
  emptyCount: number | null;
  missingCount: number | null;
  errorCount: number | null;
  requestCount: number | null;
  startedAt?: string;
  completedAt?: string;
}

export interface ConsoleV2Settlement {
  marketSource?: string;
  marketId: string;
  conditionId: string;
  status: string;
  resolvedOutcome?: string;
  settlementYes: number | null;
  settlementNo: number | null;
  closedAt?: string;
  resolvedAt?: string;
  sourceAt?: string;
  availableAt?: string;
}

export interface ConsoleV2PageJob {
  jobId: string;
  source?: string;
  variant?: string;
  status: string;
  attempts: number | null;
  discoveredCount: number | null;
  importedCount: number | null;
  errorCount: number | null;
  updatedAt?: string;
  completedAt?: string;
}

export interface ConsoleV2BacktestProduct {
  productKind: string;
  version: string;
  status: string;
  windowStart?: string;
  windowEnd?: string;
  publishedAt?: string;
  count: number | null;
}

export interface ConsoleV2OutboxEvent {
  outboxEventId: string;
  aggregateType?: string;
  aggregateId?: string;
  eventType: string;
  attemptCount: number | null;
  createdAt?: string;
  lastAttemptAt?: string;
  publishedAt?: string;
  hasLastError: boolean | null;
  deliveryStatus: string;
}

export interface ConsoleV2ServiceMetric {
  service: string;
  observedAt?: string;
  uptimeSeconds: number | null;
  runtime: { goroutines: number | null; goVersion?: string };
  memory: { heapAllocBytes: number | null; heapInuseBytes: number | null; sysBytes: number | null };
  availability: Record<string, string>;
}

export interface ConsoleV2Runtime {
  observedAt: string;
  runner: ConsoleV2RuntimeRunner;
  bindings: ConsoleV2Binding[];
  submission: Record<string, unknown>;
}

export interface ConsoleV2RuntimeRunner {
  enabled: boolean | null;
  running: boolean | null;
  loopStarted: boolean | null;
  inFlight: boolean | null;
  state?: string;
  intervalSeconds: number | null;
  loopStoppedAt?: string;
  nextBoundary?: string;
  nextDueAt?: string;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastSucceededAt?: string;
  hasLastError: boolean | null;
  lastErrorCode?: string;
  skippedBoundaries: number | null;
}

export interface ConsoleV2Binding {
  predictionModelId?: string;
  modelId?: string;
  strategyId?: string;
  executionAccountId?: string;
  sourceMode?: string;
}

export interface ConsoleV2DecisionCycle {
  cycleId: string;
  decisionAt?: string;
  modelId?: string;
  predictionModelId?: string;
  strategyId?: string;
  executionAccountId?: string;
  inputId?: string;
  predictionSnapshotId?: string;
  orderbookSnapshotSetId?: string;
  inputCreatedAt?: string;
  outputRecordedAt?: string;
  predictionCount: number | null;
  positionLotCount: number | null;
  intentCount: number | null;
  deliveryPendingCount: number | null;
  deliveryFailedCount: number | null;
  status: string;
}

export interface ConsoleV2Order {
  orderId: string;
  clientOrderId?: string;
  venueOrderId?: string;
  status: string;
  side?: string;
  price?: number | null;
  shares?: number | null;
  filledShares?: number | null;
  averageFillPrice?: number | null;
  executionAccountId?: string;
  modelId?: string;
  strategyId?: string;
  marketSource?: string;
  source?: string;
  marketId?: string;
  conditionId?: string;
  tokenId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConsoleV2PositionLot {
  lotId: string;
  modelId?: string;
  strategyId?: string;
  executionAccountId?: string;
  marketId?: string;
  conditionId?: string;
  tokenId?: string;
  status: string;
  openingOrderId?: string;
  openingFillKey?: string;
  originalShares: number | null;
  remainingShares: number | null;
  originalCost: number | null;
  remainingCost: number | null;
  averageEntryPrice: number | null;
  openedAt?: string;
  closedAt?: string;
}

export interface ConsoleV2ReconciliationRun {
  runId: string;
  executionAccountId?: string;
  trigger?: string;
  focusOrderId?: string;
  status: string;
  result?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ConsoleV2ReconciliationIssue {
  issueId: string;
  runId?: string;
  executionAccountId?: string;
  issueType?: string;
  resolution?: string;
  severity?: string;
  status: string;
  reasonCode?: string;
  entityType?: string;
  entityId?: string;
  localValue?: string;
  remoteValue?: string;
  source?: string;
  observedAt?: string;
  resolvedAt?: string;
}

export interface ConsoleV2Redemption {
  redemptionId: string;
  conditionId?: string;
  marketId?: string;
  executionAccountId?: string;
  status: string;
  transactionHash?: string;
  payoutBaseUnits?: number | null;
  receiptBlockNumber?: number | null;
  confirmations: number | null;
  createdAt?: string;
  updatedAt?: string;
  confirmedAt?: string;
  appliedAt?: string;
}

export interface ConsoleV2OrderTrace {
  order: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  fills: Array<Record<string, unknown>>;
  positionLots: Array<Record<string, unknown>>;
  reconciliationIssues: Array<Record<string, unknown>>;
}

type RawRecord = Record<string, unknown>;
type PageParams = Record<string, string | number | undefined>;

async function requestV2<T>(service: ConsoleV2Service, path: string, params: PageParams = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/console/v2/${service}/${path}${suffix}`, { cache: "no-store" });
  } catch {
    throw new ConsoleV2ApiError("新版控制台网络不可用，请检查服务连接。", 0, "UPSTREAM_UNAVAILABLE");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = asRecord(payload);
    const nested = asRecord(error.error);
    const details = asRecord(error.details);
    const directError = typeof error.error === "string" ? error.error : undefined;
    throw new ConsoleV2ApiError(
      text(error.message) ?? directError ?? text(nested.message) ?? text(details.message) ?? "新版控制台接口请求失败",
      response.status,
      text(error.code) ?? text(nested.code) ?? text(details.code),
    );
  }
  return payload as T;
}

function pageFrom<T>(payload: unknown, decode: (value: RawRecord) => T): ConsoleV2Page<T> {
  const root = asRecord(payload);
  const data = asRecord(root.data ?? payload);
  const observedAt = requiredTime(data.observed_at, "observed_at");
  const items = arrayRecords(data.items).map(decode);
  const limit = finiteInteger(data.limit, 20);
  const offset = finiteInteger(data.offset, 0);
  const summary = asRecordOrUndefined(data.summary);
  return { items, limit, offset, hasMore: data.has_more === true, observedAt, summary };
}

function objectFrom<T>(payload: unknown, decode: (value: RawRecord) => T): T {
  const root = asRecord(payload);
  return decode(asRecord(root.data ?? payload));
}

function page<T>(service: ConsoleV2Service, resource: string, params: PageParams, decode: (value: RawRecord) => T): Promise<ConsoleV2Result<ConsoleV2Page<T>>> {
  return requestV2<unknown>(service, resource, { limit: 20, ...params }).then((payload) => ({ data: pageFrom(payload, decode), mode: "live" as const }));
}

function object<T>(service: ConsoleV2Service, resource: string, params: PageParams, decode: (value: RawRecord) => T): Promise<ConsoleV2Result<T>> {
  return requestV2<unknown>(service, resource, params).then((payload) => ({ data: objectFrom(payload, decode), mode: "live" as const }));
}

export const consoleV2 = {
  infra: {
    overview: () => object("infra", "overview", {}, decodeOverview),
    runningMarkets: (params: PageParams = {}) => page("infra", "running-markets", params, decodeRunningMarket),
    runningPool: (params: PageParams = {}) => page("infra", "running-pool", params, decodeRunningPool),
    runningGenerations: (params: PageParams = {}) => page("infra", "running-generations", params, decodeGeneration),
    selectionRuns: (params: PageParams = {}) => page("infra", "selection-runs", params, decodeSelectionRun),
    selectedMarkets: (params: PageParams = {}) => page("infra", "selected-markets", params, decodeSelectedMarket),
    predictions: (params: PageParams = {}) => page("infra", "predictions", params, decodePrediction),
    predictionTasks: (params: PageParams = {}) => page("infra", "prediction-tasks", params, decodePredictionTask),
    assets: (params: PageParams = {}) => page("infra", "assets", params, decodeAsset),
    datasetMembers: (params: PageParams = {}) => page("infra", "dataset-members", params, decodeDatasetMember),
    marketData: (params: PageParams = {}) => page("infra", "market-data", params, decodeMarketData),
    settlements: (params: PageParams = {}) => page("infra", "market-settlements", params, decodeSettlement),
    pageJobs: (params: PageParams = {}) => page("infra", "page-jobs", params, decodePageJob),
    backtestProducts: (params: PageParams = {}) => page("infra", "backtest-products", params, decodeBacktestProduct),
    outboxEvents: (params: PageParams = {}) => page("infra", "outbox-events", params, decodeOutboxEvent),
    serviceMetrics: () => object("infra", "service-metrics", {}, decodeServiceMetric),
  },
  trading: {
    runtime: () => object("trading", "runtime", {}, decodeRuntime),
    decisionCycles: (params: PageParams = {}) => page("trading", "decision-cycles", params, decodeDecisionCycle),
    decisionCycle: (id: string) => object("trading", `decision-cycles/${encodeURIComponent(id)}`, {}, decodeRecord),
    orders: (params: PageParams = {}) => page("trading", "orders", params, decodeOrder),
    orderTrace: (id: string) => object("trading", `orders/${encodeURIComponent(id)}/trace`, {}, decodeOrderTrace),
    positionLots: (params: PageParams = {}) => page("trading", "position-lots", params, decodePositionLot),
    reconciliationRuns: (params: PageParams = {}) => page("trading", "reconciliation-runs", params, decodeReconciliationRun),
    reconciliationIssues: (params: PageParams = {}) => page("trading", "reconciliation-issues", params, decodeReconciliationIssue),
    redemptions: (params: PageParams = {}) => page("trading", "redemptions", params, decodeRedemption),
    serviceMetrics: () => object("trading", "service-metrics", {}, decodeServiceMetric),
  },
};

function decodeOverview(value: RawRecord): ConsoleV2Overview {
  return {
    observedAt: requiredTime(value.observed_at, "overview.observed_at"),
    currentGeneration: value.current_generation ? decodeGeneration(asRecord(value.current_generation)) : undefined,
    activePoolCount: nullableNumber(value.active_pool_count),
    lastGeneration: value.last_generation ? decodeGeneration(asRecord(value.last_generation)) : undefined,
    poolDiffersFromGeneration: nullableBoolean(value.pool_differs_from_generation),
  };
}

function decodeGeneration(value: RawRecord): ConsoleV2Generation {
  return {
    generationId: requiredId(value.generation_id, "generation_id"),
    sourceSelectionRunId: requiredId(value.source_selection_run_id, "source_selection_run_id"),
    status: requiredText(value.status, "generation.status"),
    isCurrent: nullableBoolean(value.is_current),
    observedAt: optionalTime(value.observed_at),
    publishedAt: optionalTime(value.published_at),
    memberCount: nullableNumber(value.member_count),
    predictionEnabledCount: nullableNumber(value.prediction_enabled_count),
  };
}

function decodeRunningMarket(value: RawRecord): ConsoleV2RunningMarket {
  return {
    generationId: requiredId(value.generation_id, "running_market.generation_id"),
    runningMarketId: requiredId(value.running_market_id, "running_market.running_market_id"),
    sourceSelectionRunId: requiredId(value.source_selection_run_id, "running_market.source_selection_run_id"),
    sourceSelectedMarketId: requiredId(value.source_selected_market_id, "running_market.source_selected_market_id"),
    marketId: requiredText(value.market_id, "running_market.market_id"),
    conditionId: requiredText(value.condition_id, "running_market.condition_id"),
    question: requiredText(value.question, "running_market.question"),
    primaryDomain: optionalText(value.primary_domain), matchedDomains: textArray(value.matched_domains),
    volume24h: nullableNumber(value.volume_24h), domainRank: nullableNumber(value.domain_rank), predictionEnabled: nullableBoolean(value.prediction_enabled),
    marketObservedAt: optionalTime(value.market_observed_at), endAt: optionalTime(value.end_at),
  };
}

function decodeRunningPool(value: RawRecord): ConsoleV2RunningPool {
  return {
    runningMarketId: requiredId(value.running_market_id, "running_pool.running_market_id"), marketId: requiredText(value.market_id, "running_pool.market_id"), conditionId: requiredText(value.condition_id, "running_pool.condition_id"),
    sourceSelectedMarketId: requiredId(value.source_selected_market_id, "running_pool.source_selected_market_id"), sourceSelectionRunId: requiredId(value.source_selection_run_id, "running_pool.source_selection_run_id"),
    isActive: nullableBoolean(value.is_active), retiredAt: optionalTime(value.retired_at), retiredReason: optionalText(value.retired_reason), question: requiredText(value.question, "running_pool.question"), primaryDomain: optionalText(value.primary_domain), matchedDomains: textArray(value.matched_domains), volume24h: nullableNumber(value.volume_24h), marketObservedAt: optionalTime(value.market_observed_at), endAt: optionalTime(value.end_at),
  };
}

function decodeSelectionRun(value: RawRecord): ConsoleV2SelectionRun {
  return {
    selectionRunId: requiredId(value.selection_run_id, "selection_run_id"), marketSource: optionalText(value.market_source), selectorType: optionalText(value.selector_type), policyName: optionalText(value.policy_name), policyVersion: optionalText(value.policy_version), status: requiredText(value.status, "selection_run.status"), isCurrent: nullableBoolean(value.is_current), candidateCount: nullableNumber(value.candidate_count), selectedCount: nullableNumber(value.selected_count), rejectedCount: nullableNumber(value.rejected_count), startedAt: optionalTime(value.started_at), completedAt: optionalTime(value.completed_at), publishedAt: optionalTime(value.published_at),
  };
}

function decodeSelectedMarket(value: RawRecord): ConsoleV2SelectedMarket {
  return { selectedMarketId: requiredId(value.selected_market_id, "selected_market_id"), selectionRunId: requiredId(value.selection_run_id, "selected_market.selection_run_id"), marketSource: optionalText(value.market_source), marketId: requiredText(value.market_id, "selected_market.market_id"), conditionId: requiredText(value.condition_id, "selected_market.condition_id"), question: requiredText(value.question, "selected_market.question"), primaryDomain: optionalText(value.primary_domain), rank: nullableNumber(value.rank), endAt: optionalTime(value.end_at), volume24h: nullableNumber(value.volume_24h), selectedAt: optionalTime(value.selected_at) };
}

function decodePrediction(value: RawRecord): ConsoleV2Prediction {
  return { predictionId: requiredText(value.prediction_id, "prediction_id"), sandboxId: optionalText(value.sandbox_id), sourceJobId: optionalText(value.source_job_id), marketSource: optionalText(value.market_source), selectionRunId: optionalId(value.selection_run_id), selectedMarketId: optionalId(value.selected_market_id), marketId: requiredText(value.market_id, "prediction.market_id"), conditionId: requiredText(value.condition_id, "prediction.condition_id"), question: requiredText(value.question, "prediction.question"), primaryDomain: optionalText(value.primary_domain), executionMode: optionalText(value.execution_mode), outcome0Name: optionalText(value.outcome_0_name), outcome0Probability: nullableNumber(value.outcome_0_probability), outcome1Name: optionalText(value.outcome_1_name), outcome1Probability: nullableNumber(value.outcome_1_probability), modelName: optionalText(value.model_name), predictorVersion: optionalText(value.predictor_version), predictionAsOf: optionalTime(value.prediction_as_of), receivedAt: optionalTime(value.received_at), completedAt: optionalTime(value.completed_at) };
}

function decodePredictionTask(value: RawRecord): ConsoleV2PredictionTask {
  return { predictionId: requiredText(value.prediction_id, "prediction_task.prediction_id"), sourceJobId: optionalText(value.source_job_id), predictionModelId: requiredText(value.prediction_model_id, "prediction_task.prediction_model_id"), marketSource: optionalText(value.market_source), selectionRunId: requiredId(value.selection_run_id, "prediction_task.selection_run_id"), selectedMarketId: requiredId(value.selected_market_id, "prediction_task.selected_market_id"), marketId: requiredText(value.market_id, "prediction_task.market_id"), conditionId: requiredText(value.condition_id, "prediction_task.condition_id"), question: requiredText(value.question, "prediction_task.question"), predictionAsOf: optionalTime(value.prediction_as_of), taskAvailableAt: optionalTime(value.task_available_at), status: requiredText(value.status, "prediction_task.status"), receivedAt: optionalTime(value.received_at), completedAt: optionalTime(value.completed_at) };
}

function decodeAsset(value: RawRecord): ConsoleV2Asset {
  return { assetKind: requiredText(value.asset_kind, "asset.asset_kind"), marketSource: optionalText(value.market_source), sandboxId: optionalText(value.sandbox_id), jobId: optionalText(value.job_id), marketId: optionalText(value.market_id), conditionId: optionalText(value.condition_id), question: optionalText(value.question), generatedQaId: optionalId(value.generated_qa_id), sourceQaId: optionalText(value.source_qa_id), qaVersion: nullableNumber(value.qa_version), mode: optionalText(value.mode), decisionAt: optionalTime(value.decision_at), informationCutoffAt: optionalTime(value.information_cutoff_at), builtAt: optionalTime(value.built_at), committedAt: optionalTime(value.committed_at), archiveSizeBytes: nullableNumber(value.archive_size_bytes), tradeEnabled: nullableBoolean(value.trade_enabled) };
}

function decodeDatasetMember(value: RawRecord): ConsoleV2DatasetMember {
  return { memberId: requiredId(value.member_id, "dataset_member.member_id"), datasetVersion: requiredText(value.dataset_version, "dataset_member.dataset_version"), variant: requiredText(value.variant, "dataset_member.variant"), purpose: requiredText(value.purpose, "dataset_member.purpose"), sourceNamespace: optionalText(value.source_namespace), externalDirectoryId: optionalText(value.external_directory_id), decisionAt: optionalTime(value.decision_at), sourceVersion: optionalText(value.source_version), status: requiredText(value.status, "dataset_member.status"), cleaningRecordId: optionalId(value.cleaning_record_id), artifactSha256: optionalText(value.artifact_sha256), createdAt: optionalTime(value.created_at), updatedAt: optionalTime(value.updated_at) };
}

function decodeMarketData(value: RawRecord): ConsoleV2MarketData {
  return { seriesId: requiredId(value.series_id, "market_data.series_id"), sampleAt: optionalTime(value.sample_at), status: requiredText(value.status, "market_data.status"), targetCount: nullableNumber(value.target_count), snapshotCount: nullableNumber(value.snapshot_count), okCount: nullableNumber(value.ok_count), emptyCount: nullableNumber(value.empty_count), missingCount: nullableNumber(value.missing_count), errorCount: nullableNumber(value.error_count), requestCount: nullableNumber(value.request_count), startedAt: optionalTime(value.started_at), completedAt: optionalTime(value.completed_at) };
}

function decodeSettlement(value: RawRecord): ConsoleV2Settlement {
  return { marketSource: optionalText(value.market_source), marketId: requiredText(value.market_id, "settlement.market_id"), conditionId: requiredText(value.condition_id, "settlement.condition_id"), status: requiredText(value.status, "settlement.status"), resolvedOutcome: optionalText(value.resolved_outcome), settlementYes: nullableNumber(value.settlement_yes), settlementNo: nullableNumber(value.settlement_no), closedAt: optionalTime(value.closed_at), resolvedAt: optionalTime(value.resolved_at), sourceAt: optionalTime(value.source_at), availableAt: optionalTime(value.available_at) };
}

function decodePageJob(value: RawRecord): ConsoleV2PageJob {
  return { jobId: requiredText(value.job_id, "page_job.job_id"), source: optionalText(value.source), variant: optionalText(value.variant), status: requiredText(value.status, "page_job.status"), attempts: nullableNumber(value.attempts), discoveredCount: nullableNumber(value.discovered_count), importedCount: nullableNumber(value.imported_count), errorCount: nullableNumber(value.error_count), updatedAt: optionalTime(value.updated_at), completedAt: optionalTime(value.completed_at) };
}

function decodeBacktestProduct(value: RawRecord): ConsoleV2BacktestProduct {
  return { productKind: requiredText(value.product_kind, "backtest_product.product_kind"), version: requiredText(value.version, "backtest_product.version"), status: requiredText(value.status, "backtest_product.status"), windowStart: optionalTime(value.window_start), windowEnd: optionalTime(value.window_end), publishedAt: optionalTime(value.published_at), count: nullableNumber(value.count) };
}

function decodeOutboxEvent(value: RawRecord): ConsoleV2OutboxEvent {
  return { outboxEventId: requiredText(value.outbox_event_id, "outbox_event.outbox_event_id"), aggregateType: optionalText(value.aggregate_type), aggregateId: optionalText(value.aggregate_id), eventType: requiredText(value.event_type, "outbox_event.event_type"), attemptCount: nullableNumber(value.attempt_count), createdAt: optionalTime(value.created_at), lastAttemptAt: optionalTime(value.last_attempt_at), publishedAt: optionalTime(value.published_at), hasLastError: nullableBoolean(value.has_last_error), deliveryStatus: requiredText(value.delivery_status, "outbox_event.delivery_status") };
}

function decodeServiceMetric(value: RawRecord): ConsoleV2ServiceMetric {
  const runtime = asRecord(value.runtime); const memory = asRecord(value.memory);
  const service = requiredText(value.service, "service_metrics.service").replaceAll("_", "-");
  return { service, observedAt: optionalTime(value.observed_at), uptimeSeconds: nullableNumber(value.uptime_seconds), runtime: { goroutines: nullableNumber(runtime.goroutines), goVersion: optionalText(runtime.go_version) }, memory: { heapAllocBytes: nullableNumber(memory.heap_alloc_bytes), heapInuseBytes: nullableNumber(memory.heap_inuse_bytes), sysBytes: nullableNumber(memory.sys_bytes ?? memory.heap_sys_bytes) }, availability: asStringRecord(value.availability) };
}

function decodeRuntime(value: RawRecord): ConsoleV2Runtime {
  return { observedAt: requiredTime(value.observed_at, "runtime.observed_at"), runner: decodeRuntimeRunner(asRecord(value.runner)), bindings: arrayRecords(value.bindings).map(decodeBinding), submission: asRecord(value.submission) };
}

function decodeRuntimeRunner(value: RawRecord): ConsoleV2RuntimeRunner {
  return {
    enabled: nullableBoolean(value.enabled), running: nullableBoolean(value.running), loopStarted: nullableBoolean(value.loop_started), inFlight: nullableBoolean(value.in_flight), state: optionalText(value.state), intervalSeconds: nullableNumber(value.interval_seconds),
    loopStoppedAt: optionalTime(value.loop_stopped_at), nextBoundary: optionalTime(value.next_boundary), nextDueAt: optionalTime(value.next_due_at), lastStartedAt: optionalTime(value.last_started_at), lastCompletedAt: optionalTime(value.last_completed_at), lastSucceededAt: optionalTime(value.last_succeeded_at), hasLastError: nullableBoolean(value.has_last_error), lastErrorCode: optionalText(value.last_error_code), skippedBoundaries: nullableNumber(value.skipped_boundaries),
  };
}

function decodeBinding(value: RawRecord): ConsoleV2Binding {
  return { predictionModelId: optionalText(value.prediction_model_id), modelId: optionalText(value.model_id), strategyId: optionalText(value.strategy_id), executionAccountId: optionalText(value.execution_account_id), sourceMode: optionalText(value.source_mode) };
}

function decodeDecisionCycle(value: RawRecord): ConsoleV2DecisionCycle {
  return { cycleId: requiredText(value.cycle_id, "decision_cycle.cycle_id"), decisionAt: optionalTime(value.decision_at), modelId: optionalText(value.model_id), predictionModelId: optionalText(value.prediction_model_id), strategyId: optionalText(value.strategy_id), executionAccountId: optionalText(value.execution_account_id), inputId: optionalText(value.input_id), predictionSnapshotId: optionalText(value.prediction_snapshot_id), orderbookSnapshotSetId: optionalText(value.orderbook_snapshot_set_id), inputCreatedAt: optionalTime(value.input_created_at), outputRecordedAt: optionalTime(value.output_recorded_at), predictionCount: nullableNumber(value.prediction_count), positionLotCount: nullableNumber(value.position_lot_count), intentCount: nullableNumber(value.intent_count), deliveryPendingCount: nullableNumber(value.delivery_pending_count), deliveryFailedCount: nullableNumber(value.delivery_failed_count), status: requiredText(value.status, "decision_cycle.status") };
}

function decodeOrder(value: RawRecord): ConsoleV2Order {
  return { orderId: requiredText(value.order_id, "order.order_id"), clientOrderId: optionalText(value.client_order_id), venueOrderId: optionalText(value.venue_order_id), status: requiredText(value.status, "order.status"), side: optionalText(value.side), price: nullableNumber(value.price), shares: nullableNumber(value.shares), filledShares: nullableNumber(value.filled_shares), averageFillPrice: nullableNumber(value.average_fill_price), executionAccountId: optionalText(value.execution_account_id), modelId: optionalText(value.model_id), strategyId: optionalText(value.strategy_id), marketSource: optionalText(value.market_source), source: optionalText(value.venue ?? value.source), marketId: optionalText(value.market_id), conditionId: optionalText(value.condition_id), tokenId: optionalText(value.token_id), createdAt: optionalTime(value.created_at), updatedAt: optionalTime(value.updated_at) };
}

function decodePositionLot(value: RawRecord): ConsoleV2PositionLot {
  return { lotId: requiredText(value.lot_id, "position_lot.lot_id"), modelId: optionalText(value.model_id), strategyId: optionalText(value.strategy_id), executionAccountId: optionalText(value.execution_account_id), marketId: optionalText(value.market_id), conditionId: optionalText(value.condition_id), tokenId: optionalText(value.token_id), status: requiredText(value.status, "position_lot.status"), openingOrderId: optionalText(value.opening_order_id), openingFillKey: optionalText(value.opening_fill_key), originalShares: nullableNumber(value.original_shares), remainingShares: nullableNumber(value.remaining_shares), originalCost: nullableNumber(value.original_cost), remainingCost: nullableNumber(value.remaining_cost), averageEntryPrice: nullableNumber(value.average_entry_price), openedAt: optionalTime(value.opened_at), closedAt: optionalTime(value.closed_at) };
}

function decodeReconciliationRun(value: RawRecord): ConsoleV2ReconciliationRun {
  return { runId: requiredText(value.run_id, "reconciliation_run.run_id"), executionAccountId: optionalText(value.execution_account_id), trigger: optionalText(value.trigger), focusOrderId: optionalText(value.focus_order_id), status: requiredText(value.status, "reconciliation_run.status"), result: optionalText(value.result), startedAt: optionalTime(value.started_at), completedAt: optionalTime(value.completed_at) };
}

function decodeReconciliationIssue(value: RawRecord): ConsoleV2ReconciliationIssue {
  return { issueId: requiredText(value.issue_id, "reconciliation_issue.issue_id"), runId: optionalText(value.run_id), executionAccountId: optionalText(value.execution_account_id), issueType: optionalText(value.issue_type), resolution: optionalText(value.resolution), severity: optionalText(value.severity), status: requiredText(value.status, "reconciliation_issue.status"), reasonCode: optionalText(value.reason_code), entityType: optionalText(value.entity_type), entityId: optionalText(value.entity_id), localValue: optionalText(value.local_value), remoteValue: optionalText(value.remote_value), source: optionalText(value.source), observedAt: optionalTime(value.observed_at), resolvedAt: optionalTime(value.resolved_at) };
}

function decodeRedemption(value: RawRecord): ConsoleV2Redemption {
  return { redemptionId: requiredText(value.redemption_id, "redemption.redemption_id"), conditionId: optionalText(value.condition_id), marketId: optionalText(value.market_id), executionAccountId: optionalText(value.execution_account_id), status: requiredText(value.status, "redemption.status"), transactionHash: optionalText(value.transaction_hash), payoutBaseUnits: nullableNumber(value.payout_base_units), receiptBlockNumber: nullableNumber(value.receipt_block_number), confirmations: nullableNumber(value.confirmations), createdAt: optionalTime(value.created_at), updatedAt: optionalTime(value.updated_at), confirmedAt: optionalTime(value.confirmed_at), appliedAt: optionalTime(value.applied_at) };
}

function decodeOrderTrace(value: RawRecord): ConsoleV2OrderTrace {
  return { order: asRecord(value.order), events: arrayRecords(value.events), attempts: arrayRecords(value.attempts), fills: arrayRecords(value.fills), positionLots: arrayRecords(value.position_lots), reconciliationIssues: arrayRecords(value.reconciliation_issues) };
}

function decodeRecord(value: RawRecord): Record<string, unknown> { return value; }

function asRecord(value: unknown): RawRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {}; }
function asRecordOrUndefined(value: unknown): RawRecord | undefined { const record = value === undefined || value === null ? undefined : asRecord(value); return record && Object.keys(record).length ? record : undefined; }
function arrayRecords(value: unknown): RawRecord[] { return Array.isArray(value) ? value.map(asRecord) : []; }
function textArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map(String) : []; }
function asStringRecord(value: unknown): Record<string, string> { const record = asRecord(value); return Object.fromEntries(Object.entries(record).filter(([, item]) => typeof item === "string").map(([key, item]) => [key, String(item)])); }
function text(value: unknown): string | undefined { return value === undefined || value === null || value === "" ? undefined : String(value); }
function requiredText(value: unknown, field: string): string { const result = text(value)?.trim(); if (!result) throw new ConsoleV2ContractError(`V2 接口缺少 ${field}`); return result; }
function requiredId(value: unknown, field: string): string { return requiredText(value, field); }
function optionalText(value: unknown): string | undefined { const result = text(value)?.trim(); return result || undefined; }
function optionalId(value: unknown): string | undefined { return optionalText(value); }
function optionalTime(value: unknown): string | undefined { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined; }
function requiredTime(value: unknown, field: string): string { const result = optionalTime(value); if (!result) throw new ConsoleV2ContractError(`V2 接口缺少有效 ${field}`); return result; }
function nullableNumber(value: unknown): number | null { if (value === null || value === undefined || value === "") return null; const result = Number(value); return Number.isFinite(result) ? result : null; }
function finiteInteger(value: unknown, fallback: number): number { const result = Number(value); return Number.isSafeInteger(result) && result >= 0 ? result : fallback; }
function nullableBoolean(value: unknown): boolean | null { return typeof value === "boolean" ? value : value === null || value === undefined ? null : String(value).toLowerCase() === "true" ? true : String(value).toLowerCase() === "false" ? false : null; }
