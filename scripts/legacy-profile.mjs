import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "legacy", "manifest.json");
const productionInventoryPath = path.join(root, "legacy", "production-inventory.json");
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

function gitBlobSha1(filePath) {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
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
  const commit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
  if (manifest.schemaVersion !== 2 || !commit(manifest.sourceCommit) || !commit(manifest.productionBaseCommit) || manifest.baseCommit !== manifest.productionBaseCommit || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) fail("manifest schema is invalid");
  if (!manifest.overlay || !commit(manifest.overlay.baseCommit) || manifest.overlay.sourceCommit !== manifest.sourceCommit || !Array.isArray(manifest.overlay.paths) || !manifest.overlay.paths.length) fail("overlay provenance is invalid");
  const paths = manifest.overlay.paths.map(safeRelative);
  if (new Set(paths).size !== paths.length || paths.some((relativePath) => !manifest.files[relativePath])) fail("overlay paths are invalid");
  return manifest;
}

function readProductionInventory(manifest) {
  assertNoSymlink(productionInventoryPath, "production inventory");
  assertRegularFile(productionInventoryPath, "production inventory");
  const inventory = JSON.parse(fs.readFileSync(productionInventoryPath, "utf8"));
  if (inventory.schemaVersion !== 1 || inventory.sourceCommit !== manifest.productionBaseCommit || !/^sha256:[0-9a-f]{64}$/.test(inventory.imageSha256) || !inventory.files || typeof inventory.files !== "object" || Array.isArray(inventory.files) || !Object.keys(inventory.files).length) fail("production inventory is invalid");
  for (const [relativePath, blob] of Object.entries(inventory.files)) {
    safeRelative(relativePath);
    if (typeof blob !== "string" || !/^[0-9a-f]{40}$/.test(blob)) fail(`invalid production blob ${relativePath}`);
    if (!manifest.files[relativePath]) fail(`production file missing from manifest: ${relativePath}`);
  }
  return inventory;
}

function sourcePath(relativePath, source) {
  const safe = safeRelative(relativePath);
  if (source === "root") return path.join(root, safe);
  if (source === "override") return path.join(root, "legacy", "overrides", safe);
  fail(`unknown source ${String(source)} for ${safe}`);
}

function validateAndCopy(manifest, destination) {
  const inventory = readProductionInventory(manifest);
  const overlay = new Set(manifest.overlay.paths);
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
    if (inventory.files[safe] && !overlay.has(safe) && gitBlobSha1(input) !== inventory.files[safe]) fail(`production baseline changed outside overlay: ${safe}`);
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
  process.stdout.write(`legacy profile prepared production ${manifest.productionBaseCommit} + overlay ${manifest.sourceCommit} at ${path.relative(root, stagingPath)} (${Object.keys(manifest.files).length} files)\n`);
}

function check() {
  const manifest = readManifest();
  if (!fs.existsSync(stagingPath)) prepare();
  fs.rmSync(path.join(stagingPath, "node_modules"), { recursive: true, force: true });
  validateAndCopy(manifest, stagingPath);
  process.stdout.write(`legacy profile verified ${Object.keys(manifest.files).length} files\n`);
}

function test() {
  // Run the complete preserved suite, including dataset rotation, Redis,
  // question audits, and backtest forms/BFF, rather than a PnL-only subset.
  const files = fs.readdirSync(path.join(stagingPath, "tests"))
    .filter((name) => /\.test\.(?:ts|mjs)$/.test(name)).sort().map((name) => `tests/${name}`);
  if (!files.length) fail("assembled profile contains no tests");
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...files], { cwd: stagingPath, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const command = process.argv[2] ?? "prepare";
if (command === "prepare") prepare();
else if (command === "check") check();
else if (command === "test") test();
else fail(`unknown command ${command}; use prepare, check, or test`);
