import type { ConsoleV2RuntimeAccount, ConsoleV2RuntimeSubmission } from "./console-v2.ts";

export type AccountPermissionSummary = {
  currentLabel: string;
  currentReasons: string[];
  historyLabel: string;
};

/**
 * Derive display-only permission facts without changing the execution gate.
 * Current controls and the last persisted cycle gate are intentionally kept
 * separate: the latter is historical evidence, never current authorization.
 */
export function deriveAccountPermission(account: ConsoleV2RuntimeAccount, submission?: ConsoleV2RuntimeSubmission): AccountPermissionSummary {
  const blockers: string[] = [];
  let unknown = !submission;
  const accountId = account.executionAccountId;

  if (account.accountPaused === true) blockers.push("账户已暂停");
  else if (account.accountPaused === null) unknown = true;
  if (account.configuredBinding === false) blockers.push("当前绑定未配置");
  else if (account.configuredBinding === null) unknown = true;
  if (account.databaseBindingEnabled === false) blockers.push("数据库绑定未启用");
  else if (account.databaseBindingEnabled === null) unknown = true;
  if (account.riskPolicyEnabled === false) blockers.push("风控策略未启用");
  else if (account.riskPolicyEnabled === null) unknown = true;

  const inputState = classifyState(account.strategyInputState);
  if (inputState === "disabled") blockers.push("策略输入不可用");
  else if (inputState === "unknown") unknown = true;
  const orderState = classifyState(account.orderSubmissionState);
  if (orderState === "disabled") blockers.push("账户下单状态关闭");
  else if (orderState === "unknown") unknown = true;

  if (submission) {
    if (submission.orderSubmissionEnabled === false) blockers.push("全局下单已关闭");
    else if (submission.orderSubmissionEnabled === null) unknown = true;
    if (submission.entrySubmissionDisabled === true) blockers.push("全局入场已关闭");
    else if (submission.entrySubmissionDisabled === null) unknown = true;
    if (submission.submissionDisabledAccounts.includes(accountId)) blockers.push("该账户下单已关闭");
    if (submission.entryDisabledAccounts.includes(accountId)) blockers.push("该账户入场已关闭");
    if (submission.strategyDisabledAccounts.includes(accountId)) blockers.push("该账户策略已关闭");
  }

  const currentLabel = blockers.length ? "当前不可入场" : unknown ? "当前状态未知" : "当前入场开关已开启";
  const currentReasons = blockers.length ? unique(blockers) : unknown ? ["当前开关或依赖事实未完整返回"] : ["已返回的账户开关均开启，本轮许可见最近周期"];
  return { currentLabel, currentReasons, historyLabel: historyLabel(account.entryGateState) };
}

function historyLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "sell_only") return "最近周期：仅允许退出";
  if (normalized === "enabled") return "最近周期：曾允许入场";
  return "最近周期：未知";
}

function classifyState(value: string): "enabled" | "disabled" | "unknown" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "enabled") return "enabled";
  if (normalized === "disabled") return "disabled";
  return "unknown";
}

function unique(values: string[]) { return [...new Set(values)]; }
