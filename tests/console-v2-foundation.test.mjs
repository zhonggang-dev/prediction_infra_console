import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path) => readFile(new URL(path, root), "utf8");

function runPortCheck(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("scripts/check-v2-port.mjs", root))], {
      cwd: rootPath,
      env: { ...process.env, PREDICTION_CONSOLE_V2_BIND_ADDRESS: "127.0.0.1", PREDICTION_CONSOLE_V2_PORT: String(port) },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stderr }));
  });
}

test("新版部署标识与旧版运行入口隔离", async () => {
  const [unit, dockerfile, packageJson, portCheck, dockerignore, gitignore, globals] = await Promise.all([
    read("deploy/prediction-console-v2.service"),
    read("Dockerfile.v2"),
    read("package.json"),
    read("scripts/check-v2-port.mjs"),
    read(".dockerignore"),
    read(".gitignore"),
    read("app/globals.css"),
  ]);

  assert.match(unit, /prediction-console-v2/);
  assert.match(unit, /prediction-console-v2:current/);
  assert.match(unit, /PREDICTION_CONSOLE_V2_BIND_ADDRESS/);
  assert.match(unit, /13001/);
  assert.match(unit, /tmpfs \/app\/.wrangler:/);
  assert.match(unit, /tmpfs \/app\/\.wrangler-v2/);
  assert.match(dockerignore, /\.wrangler-v2/);
  assert.match(dockerignore, /\*\.tsbuildinfo/);
  assert.match(gitignore, /\/\.wrangler-v2\//);
  assert.match(globals, /@media \(max-width: 960px\) \{[\s\S]*?\.sidebar \{[^}]*visibility: hidden;/);
  assert.match(globals, /\.sidebar\.open \{[^}]*visibility: visible;/);
  assert.doesNotMatch(unit, /prediction-console(?::current|\.service)(?!-v2)/);
  assert.doesNotMatch(unit, /13000/);
  assert.match(dockerfile, /EXPOSE 13001/);
  assert.match(dockerfile, /pnpm build:v2/);
  assert.match(dockerfile, /"start:v2"/);
  assert.match(packageJson, /"dev:v2"/);
  assert.match(packageJson, /"start:v2"/);
  assert.match(packageJson, /MINIFLARE_REGISTRY_PATH=\.wrangler-v2\/registry/);
  assert.match(packageJson, /check-v2-port\.mjs/);
  assert.match(portCheck, /ECONNREFUSED/);
  assert.match(portCheck, /process\.exitCode = 1/);
  assert.doesNotMatch(portCheck, /kill\(/);
});

test("新版环境示例只声明独立绑定配置", async () => {
  const env = await read("deploy/service.env.v2.example");
  assert.match(env, /^PREDICTION_CONSOLE_V2_BIND_ADDRESS=127\.0\.0\.1$/m);
  assert.match(env, /^PREDICTION_CONSOLE_V2_PORT=13001$/m);
  assert.doesNotMatch(env, /CONSOLE_API_TOKEN=\S+/);
  assert.doesNotMatch(env, /^PREDICTION_CONSOLE_V2_BIND_ADDRESS=0\.0\.0\.0$/m);
});

test("新版端口预检检查真实监听状态并保留占用进程", async () => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  const occupiedPort = occupied.address().port;

  try {
    const conflict = await runPortCheck(occupiedPort);
    assert.equal(conflict.code, 1);
    assert.match(conflict.stderr, /端口已被占用/);
    assert.equal(occupied.listening, true);
  } finally {
    occupied.close();
    await once(occupied, "close");
  }

  const free = net.createServer();
  await new Promise((resolve, reject) => {
    free.once("error", reject);
    free.listen(0, "127.0.0.1", resolve);
  });
  const freePort = free.address().port;
  free.close();
  await once(free, "close");

  const available = await runPortCheck(freePort);
  assert.equal(available.code, 0);
  assert.equal(available.stderr, "");
});
