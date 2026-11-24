import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, "work/netease-gateway");
const packagePath = resolve(
  directory,
  "node_modules/@neteasecloudmusicapienhanced/api/package.json",
);
if (!existsSync(packagePath)) {
  console.error("网易云本地服务尚未安装，请运行 node server/setup-netease.mjs");
  process.exit(1);
}
const port = Number(process.env.NETEASE_LOCAL_PORT || "3101");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("网易云本地服务端口无效。");
  process.exit(1);
}
// Preserve the package's existing cache location across a launcher upgrade. An isolated cache
// can be requested explicitly for a cold-cache test; never discard working anonymous state.
const cacheDirectory = process.env.NETEASE_CACHE_DIR
  ? resolve(process.env.NETEASE_CACHE_DIR)
  : null;
if (cacheDirectory) mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
const entry = resolve(root, "server/netease-worker.mjs");
// Keep the gateway loopback-only. Suppress third-party logs, which may contain login material.
const child = spawn(process.execPath, [entry], {
  cwd: directory,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    ...(cacheDirectory
      ? { TMPDIR: cacheDirectory, TMP: cacheDirectory, TEMP: cacheDirectory }
      : {}),
  },
  stdio: ["ignore", "ignore", "ignore", "ipc"],
});
console.log(`网易云本地服务启动中：http://127.0.0.1:${port}`);
child.on("message", (message) => {
  if (message?.type === "ready")
    console.log(`网易云本地服务已就绪：http://127.0.0.1:${port}`);
  if (message?.type === "startup-error")
    console.error("网易云本地服务启动失败，请检查本地端口是否已占用。");
});
child.once("error", () => {
  console.error("网易云本地服务启动失败。");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  if (code) console.error("网易云本地服务已停止。");
  process.exitCode = code ?? 0;
});
process.once("SIGINT", () => child.kill("SIGTERM"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
process.once("exit", () => child.kill("SIGTERM"));
