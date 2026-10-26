import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const staging = path.join(root, ".legacy-console");
const manifestPath = path.join(root, "legacy", "manifest.json");

test("legacy profile assembles the reviewed source surface without links or secrets", () => {
  const result = spawnSync(process.execPath, ["scripts/legacy-profile.mjs", "prepare"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(manifest.baseCommit, /^[0-9a-f]{7,40}$/);
  assert.equal(manifest.sourceCommit, "59f0eb8fa83b237c52f54d705cf54e66ce47566d");
  assert.ok(Object.keys(manifest.files).length >= 60);
  assert.equal(manifest.files["app/components/live-trading-page.tsx"].source, "override");
  assert.equal(manifest.files["app/components/wallet-pnl-chart.tsx"].source, "override");
  assert.equal(manifest.files["app/components/console-page.tsx"].source, "root");
  assert.ok(!fs.existsSync(path.join(staging, "node_modules")));
  assert.ok(!fs.existsSync(path.join(staging, ".env.local")));
  for (const relativePath of Object.keys(manifest.files)) {
    const output = path.join(staging, relativePath);
    const stat = fs.lstatSync(output);
    assert.equal(stat.isSymbolicLink(), false, relativePath);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex"), manifest.files[relativePath].sha256, relativePath);
  }
});

test("legacy profile check rejects an output symlink", () => {
  const result = spawnSync(process.execPath, ["scripts/legacy-profile.mjs", "prepare"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(staging, "app", "components", "console-page.tsx");
  fs.unlinkSync(output);
  fs.symlinkSync("/tmp", output);
  const check = spawnSync(process.execPath, ["scripts/legacy-profile.mjs", "check"], { cwd: root, encoding: "utf8" });
  assert.notEqual(check.status, 0);
  assert.match(check.stderr, /symbolic link/);
  assert.equal(spawnSync(process.execPath, ["scripts/legacy-profile.mjs", "prepare"], { cwd: root }).status, 0);
});
