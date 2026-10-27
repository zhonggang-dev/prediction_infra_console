import assert from "node:assert/strict";
import test from "node:test";

import { readAnswerAudit } from "../app/lib/answer-audit.ts";

test("已解决答案展示证据等级与评分明细", () => {
  const audit = readAnswerAudit({ answer_grade: "B", diagnostics: { gate: "passed", grading: { grade: "B", domains: ["a.example", "b.example"] } } });
  assert.equal(audit.grade, "B");
  assert.equal(audit.gradeLabel, "B · 多个独立来源");
  assert.equal(audit.gate, "已通过");
  assert.deepEqual(audit.grading, { grade: "B", domains: ["a.example", "b.example"] });
});

test("门禁失败展示失败的门禁与具体错误", () => {
  const audit = readAnswerAudit({ status: "UNRESOLVED", reason_code: "evidence_quote_not_grounded", diagnostics: { gate: "quote_grounded", error: "quote is not a substring" } });
  assert.equal(audit.grade, "");
  assert.equal(audit.gate, "引文不在抓取内容中");
  assert.equal(audit.error, "quote is not a substring");
});

test("旧数据没有等级与诊断时不报错、不展示", () => {
  for (const value of [undefined, null, {}, { option_id: "B" }, "x", []]) {
    const audit = readAnswerAudit(value);
    assert.equal(audit.grade, "");
    assert.equal(audit.gate, "");
    assert.equal(audit.error, "");
  }
});

test("未知等级与门禁原样展示，便于后端新增取值时不丢信息", () => {
  const audit = readAnswerAudit({ answer_grade: "D", diagnostics: { gate: "future_gate" } });
  assert.equal(audit.gradeLabel, "D");
  assert.equal(audit.gate, "future_gate");
});

test("键名恰为对象原型属性时仍返回字符串", () => {
  const audit = readAnswerAudit({ answer_grade: "toString", diagnostics: { gate: "constructor" } });
  assert.equal(audit.gradeLabel, "toString");
  assert.equal(audit.gate, "constructor");
});
