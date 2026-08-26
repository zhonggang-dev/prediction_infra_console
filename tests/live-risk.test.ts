import assert from "node:assert/strict";
import test from "node:test";

import { LiveRiskContractError, normalizeLiveRisk } from "../app/lib/live-risk.ts";

/** 新版契约应保留后端返回的只读运营目标和真实占用率。 */
test("新版风险契约保留运营目标语义", () => {
  const risk = normalizeLiveRisk({
    id: "exposure", name: "总敞口", current: 318.15171674, warningThreshold: 67.36, hardLimit: 84.2,
    usagePercentage: 377.852395178147, hardLimitEnforced: false, thresholdType: "target", unit: "$", state: "danger",
  });
  assert.equal(risk.thresholdType, "target");
  assert.equal(risk.hardLimitEnforced, false);
  assert.equal(risk.usagePercentage, 377.852395178147);
  assert.equal(risk.state, "danger");
});

/** 旧版契约应把 limit 降级为只读目标并修正超过目标时的状态。 */
test("旧版风险契约兼容为只读运营目标", () => {
  const risk = normalizeLiveRisk({ id: "exposure", name: "总敞口", current: 114.25, limit: 84.2, unit: "$", state: "warning" });
  assert.equal(risk.warningThreshold, 67.36);
  assert.equal(risk.hardLimit, 84.2);
  assert.equal(risk.hardLimitEnforced, false);
  assert.equal(risk.thresholdType, "target");
  assert.equal(risk.state, "danger");
  assert.ok(risk.usagePercentage && risk.usagePercentage > 100);
});

/** 零目标不应产生无穷占用率，但应显示未达目标。 */
test("旧版零目标避免除零", () => {
  const risk = normalizeLiveRisk({ id: "stale", current: 6, limit: 0, unit: "count", state: "warning" });
  assert.equal(risk.usagePercentage, undefined);
  assert.equal(risk.state, "danger");
});

/** 部分新版字段不得静默回退到旧协议。 */
test("不完整的新版风险契约安全失败", () => {
  assert.throws(
    () => normalizeLiveRisk({ id: "exposure", current: 10, limit: 20, hardLimit: 20 }),
    (error) => error instanceof LiveRiskContractError && /warningThreshold/.test(error.message),
  );
});

/** 硬上限声明和强制执行标记必须一致。 */
test("矛盾的执行语义安全失败", () => {
  assert.throws(
    () => normalizeLiveRisk({ current: 10, warningThreshold: 16, hardLimit: 20, usagePercentage: 50, hardLimitEnforced: false, thresholdType: "hard_limit" }),
    (error) => error instanceof LiveRiskContractError && /矛盾/.test(error.message),
  );
});

/** 零目标不得携带无意义的占用率。 */
test("新版零目标占用率安全失败", () => {
  assert.throws(
    () => normalizeLiveRisk({ current: 0, warningThreshold: 0, hardLimit: 0, usagePercentage: 0, hardLimitEnforced: false, thresholdType: "target" }),
    (error) => error instanceof LiveRiskContractError && /零目标占用率/.test(error.message),
  );
});
