/**
 * 运行记录的取数辅助（纯函数，取页函数由调用方传入，便于测试）。
 *
 * infra 的 `GET /runs` 只支持板块等值筛选，没有「排除某板块」。「运行」视图要把提交校验（intake）排除掉时，
 * 这里连续取服务端页、丢掉被排除的行，直到凑满一页或到底；`nextOffset` 是下一页在服务端列表里的起点，
 * 翻页只需要记住每页的起点，页内条数因此始终是满的（不会出现一页只有两三条的稀疏页）。
 */

import type { BacktestPage, BacktestRun } from "./backtest-platform.ts";

export interface VisibleRunsPage { items: BacktestRun[]; startOffset: number; nextOffset: number; hasMore: boolean }

const SERVER_PAGE = 50;
/** 连续取页的上限，避免被排除的行占满整个列表时一次请求取遍全部历史 */
const MAX_SERVER_PAGES = 20;

export async function collectRuns(
  fetchPage: (offset: number, limit: number) => Promise<BacktestPage<BacktestRun>>,
  startOffset: number,
  size: number,
  exclude?: (run: BacktestRun) => boolean,
): Promise<VisibleRunsPage> {
  const items: BacktestRun[] = [];
  let offset = startOffset;
  for (let pages = 0; pages < MAX_SERVER_PAGES; pages += 1) {
    const page = await fetchPage(offset, exclude ? SERVER_PAGE : size);
    for (let index = 0; index < page.items.length; index += 1) {
      const run = page.items[index];
      if (exclude?.(run)) continue;
      if (items.length === size) return { items, startOffset, nextOffset: offset + index, hasMore: true };
      items.push(run);
    }
    offset = page.offset + page.items.length;
    if (!page.hasMore) return { items, startOffset, nextOffset: offset, hasMore: false };
    // 不排除时一页取多少显示多少，取满就是满页；要排除时继续往下看一眼：后面可能全是被排除的行（否则会出现空的「下一页」）
    if (items.length === size && !exclude) return { items, startOffset, nextOffset: offset, hasMore: true };
  }
  return { items, startOffset, nextOffset: offset, hasMore: true };
}

// ───────────────────────── 提交历史 ─────────────────────────

export interface SubmissionHistoryEntry {
  submissionId: string;
  kind: string;
  identity: string;
  runId: string;
  run: BacktestRun;
}

/**
 * infra 没有提交列表接口。每次提交都会产生一个 board=intake 的校验运行，运行配置里带着
 * `submission`（提交编号 / 类型 / 标识）；据此还原历史。同一内容重复提交可能对应多条校验运行，
 * 按提交编号去重，保留最新的一条（入参按新到旧排列）。
 */
export function submissionHistory(runs: BacktestRun[]): SubmissionHistoryEntry[] {
  const seen = new Set<string>();
  const entries: SubmissionHistoryEntry[] = [];
  for (const run of runs) {
    const submission = run.config?.submission;
    if (submission === null || typeof submission !== "object" || Array.isArray(submission)) continue;
    const ref = submission as Record<string, unknown>;
    const submissionId = typeof ref.submission_id === "string" ? ref.submission_id : "";
    if (!submissionId || seen.has(submissionId)) continue;
    seen.add(submissionId);
    const identity = ref.identity !== null && typeof ref.identity === "object" && !Array.isArray(ref.identity) ? Object.values(ref.identity as Record<string, unknown>).map(String).join(" / ") : "";
    entries.push({ submissionId, kind: typeof ref.kind === "string" ? ref.kind : "", identity, runId: run.runId, run });
  }
  return entries;
}
