import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "legacy", "manifest.json");
const stagingPath = path.join(root, ".legacy-console");

function fail(message) {
  throw new Error(`legacy profile: ${message}`);
}

function safeRelative(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.split("/").includes("..") || value.includes("\\")) fail(`unsafe path ${String(value)}`);
  return value;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) fail(`${label} is missing or not a regular file`);
}

function assertNoSymlink(filePath, label) {
  let current = path.resolve(root);
  for (const part of path.relative(current, path.resolve(filePath)).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) fail(`${label} contains a symbolic link`);
  }
}

function readManifest() {
  assertRegularFile(manifestPath, "manifest");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || typeof manifest.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) || (manifest.baseCommit !== undefined && (typeof manifest.baseCommit !== "string" || !/^[0-9a-f]{7,40}$/.test(manifest.baseCommit))) || !manifest.files || typeof manifest.files !== "object") fail("manifest schema is invalid");
  return manifest;
}

function sourcePath(relativePath, source) {
  const safe = safeRelative(relativePath);
  if (source === "root") return path.join(root, safe);
  if (source === "override") return path.join(root, "legacy", "overrides", safe);
  fail(`unknown source ${String(source)} for ${safe}`);
}

function validateAndCopy(manifest, destination) {
  const seen = new Set();
  for (const [relativePath, entry] of Object.entries(manifest.files)) {
    const safe = safeRelative(relativePath);
    if (seen.has(safe)) fail(`duplicate path ${safe}`);
    seen.add(safe);
    if (!entry || (entry.source !== "root" && entry.source !== "override") || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) fail(`invalid entry ${safe}`);
    const input = sourcePath(safe, entry.source);
    assertNoSymlink(input, safe);
    assertRegularFile(input, safe);
    const actual = sha256(input);
    if (actual !== entry.sha256) fail(`${safe} hash mismatch: expected ${entry.sha256}, got ${actual}`);
    const output = path.join(destination, safe);
    assertNoSymlink(path.dirname(output), safe);
    if (fs.existsSync(output)) {
      assertNoSymlink(output, safe);
      assertRegularFile(output, safe);
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(input, output);
    if (sha256(output) !== entry.sha256) fail(`${safe} changed while assembling`);
  }
  if (seen.size === 0) fail("manifest contains no files");
}

function prepare() {
  const manifest = readManifest();
  fs.rmSync(stagingPath, { recursive: true, force: true });
  fs.mkdirSync(stagingPath, { recursive: true });
  validateAndCopy(manifest, stagingPath);
  fs.writeFileSync(path.join(stagingPath, "LEGACY_SOURCE_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`legacy profile prepared ${manifest.sourceCommit} at ${path.relative(root, stagingPath)} (${Object.keys(manifest.files).length} files)\n`);
}

function check() {
  const manifest = readManifest();
  if (!fs.existsSync(stagingPath)) prepare();
  fs.rmSync(path.join(stagingPath, "node_modules"), { recursive: true, force: true });
  validateAndCopy(manifest, stagingPath);
  process.stdout.write(`legacy profile verified ${Object.keys(manifest.files).length} files\n`);
}

function test() {
  const files = [
    "tests/live-risk.test.ts", "tests/pnl-metrics.test.ts", "tests/wallet-pnl.test.ts",
    "tests/resolution-rules.test.ts", "tests/topic-paths.test.ts", "tests/rendered-html.test.mjs",
  ];
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...files], { cwd: stagingPath, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const command = process.argv[2] ?? "prepare";
if (command === "prepare") prepare();
else if (command === "check") check();
else if (command === "test") test();
else fail(`unknown command ${command}; use prepare, check, or test`);
