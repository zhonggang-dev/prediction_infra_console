import assert from "node:assert/strict";
import test from "node:test";

import { formatResolutionRules } from "../app/lib/resolution-rules.ts";

test("稳定标识拆分为中文小标题且正文无损", () => {
  const source = "Authority: Official source. Metric definition: Compute A/B. Units: percent; round once. Mapping to displayed options: A is below zero. Delayed publication: use the first release.";
  const sections = formatResolutionRules(source);
  assert.deepEqual(sections.map((section) => section.title), ["权威来源", "指标定义", "单位与舍入", "选项映射", "延迟发布处理"]);
  assert.deepEqual(sections.map((section) => section.content), ["Official source.", "Compute A/B.", "percent; round once.", "A is below zero.", "use the first release."]);
});

test("未知旧格式完整保留并按句子换行", () => {
  const source = "Use the official report. Read the first published value; ignore later revisions. Resolve using option A.";
  const sections = formatResolutionRules(source);
  assert.equal(sections.map((section) => section.content).join(" "), source);
  assert.ok(sections.length > 1);
});
