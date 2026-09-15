import assert from "node:assert/strict";
import test from "node:test";

import { formatTopicPath } from "../app/lib/topic-paths.ts";

test("二级 taxonomy 路径显示为一级 / 二级", () => {
  assert.equal(formatTopicPath("economy.inflation_and_prices"), "economy / inflation_and_prices");
  assert.equal(formatTopicPath("sports.football"), "sports / football");
});

test("没有二级分隔符时保留原值", () => {
  assert.equal(formatTopicPath("economy"), "economy");
});
