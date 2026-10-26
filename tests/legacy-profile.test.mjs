import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const staging = path.join(root, ".legacy-console");
const manifestPath = path.join(root, "legacy", "manifest.json");
const inventoryPath = path.join(root, "legacy", "production-inventory.json");
const productionCommit = "d6e2e20adbe8884f285989025a7cd832fe337d7e";
const overlayPaths = [
  "app/api/console/[...path]/route.ts", "app/components/live-trading-page.tsx",
  "app/components/wallet-pnl-chart.tsx", "app/globals.css", "app/lib/console-api.ts",
  "app/lib/types.ts", "app/lib/wallet-pnl.ts", "package.json", "pnpm-lock.yaml",
  "tests/rendered-html.test.mjs", "tests/wallet-pnl.test.ts", "tsconfig.json", "worker/index.ts",
];

function withProfileFixture(run) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-profile-test-"));
  try {
    fs.cpSync(path.join(root, "legacy"), path.join(fixture, "legacy"), { recursive: true });
    fs.mkdirSync(path.join(fixture, "scripts"));
    fs.copyFileSync(path.join(root, "scripts", "legacy-profile.mjs"), path.join(fixture, "scripts", "legacy-profile.mjs"));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const [relativePath, entry] of Object.entries(manifest.files)) {
      if (entry.source !== "root") continue;
      fs.mkdirSync(path.dirname(path.join(fixture, relativePath)), { recursive: true });
      fs.copyFileSync(path.join(root, relativePath), path.join(fixture, relativePath));
    }
    run(fixture, manifest);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test("legacy profile assembles the reviewed source surface without links or secrets", () => {
  const result = spawnSync(process.execPath, ["scripts/legacy-profile.mjs", "prepare"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.baseCommit, productionCommit);
  assert.equal(manifest.productionBaseCommit, productionCommit);
  assert.equal(manifest.sourceCommit, "59f0eb8fa83b237c52f54d705cf54e66ce47566d");
  assert.deepEqual(manifest.overlay.paths, overlayPaths);
  assert.equal(manifest.overlay.baseCommit, "2c1aaebe39a14c59f36bc868a5af2d630f0d821a");
  assert.equal(manifest.overlay.sourceCommit, manifest.sourceCommit);
  assert.ok(Object.keys(manifest.files).length >= 155);
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
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  assert.equal(inventory.sourceCommit, productionCommit);
  assert.equal(Object.keys(inventory.files).length, 148);
  for (const [relativePath, expectedBlob] of Object.entries(inventory.files)) {
    assert.ok(manifest.files[relativePath], `production path omitted: ${relativePath}`);
    if (overlayPaths.includes(relativePath)) continue;
    const bytes = fs.readFileSync(path.join(staging, relativePath));
    const blob = crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(blob, expectedBlob, `production path changed: ${relativePath}`);
  }
  for (const route of ["app/dataset-rotation/page.tsx", "app/backtest-platform/page.tsx", "app/backtest-platform/runs/[runId]/page.tsx"]) assert.ok(manifest.files[route], route);
  for (const suite of ["answer-audit", "dataset-rotation", "redis-monitor", "backtest-form", "backtest-selection", "wallet-pnl"]) assert.ok(manifest.files[`tests/${suite}.test.ts`], suite);
});

test("legacy assembly rejects omission of a deployed route", () => {
  withProfileFixture((fixture, manifest) => {
    delete manifest.files["app/dataset-rotation/page.tsx"];
    fs.writeFileSync(path.join(fixture, "legacy", "manifest.json"), JSON.stringify(manifest));
    const result = spawnSync(process.execPath, ["scripts/legacy-profile.mjs", "prepare"], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /production file missing from manifest: app\/dataset-rotation\/page\.tsx/);
  });
});

test("legacy assembly rejects changed deployed code even with a refreshed manifest hash", () => {
  withProfileFixture((fixture, manifest) => {
    const relativePath = "app/components/console-shell.tsx";
    const entry = manifest.files[relativePath];
    const file = path.join(fixture, entry.source === "override" ? "legacy/overrides" : "", relativePath);
    fs.appendFileSync(file, "\n// changed after production inventory capture\n");
    entry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    fs.writeFileSync(path.join(fixture, "legacy", "manifest.json"), JSON.stringify(manifest));
    const result = spawnSync(process.execPath, ["scripts/legacy-profile.mjs", "prepare"], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /production baseline changed outside overlay: app\/components\/console-shell\.tsx/);
  });
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
