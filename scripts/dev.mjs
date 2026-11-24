import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter(
    (address) => address && !address.internal && address.family === "IPv4",
  )
  .map((address) => address.address);
const origins = new Set([
  ...(
    process.env.APP_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173"
  ).split(","),
  ...addresses.map((address) => `http://${address}:5173`),
]);
const env = { ...process.env, APP_ORIGINS: [...origins].join(",") };
const children = [];
const localGateway = path.join(
  cwd,
  "work/netease-gateway/node_modules/@neteasecloudmusicapienhanced/api/app.js",
);
const gatewayURL = process.env.NETEASE_API_BASE_URL || "";
if (
  existsSync(localGateway) &&
  /^http:\/\/(127\.0\.0\.1|localhost):3101\/?$/.test(gatewayURL)
) {
  const running = await fetch(gatewayURL, { signal: AbortSignal.timeout(1200) })
    .then(() => true)
    .catch(() => false);
  if (!running)
    children.push(
      spawn(process.execPath, ["server/start-netease.mjs"], {
        cwd,
        env,
        stdio: "inherit",
      }),
    );
}
const qqGatewayURL = process.env.QQ_API_BASE_URL || "";
if (existsSync(path.join(cwd, "work/qq-gateway/node_modules/@yakult-green-tea/qq-music-api/package.json")) && /^http:\/\/(127\.0\.0\.1|localhost):3201\/?$/.test(qqGatewayURL)) {
  const running = await fetch(`${qqGatewayURL}/health`, { signal: AbortSignal.timeout(1200) }).then(r => r.ok).catch(() => false);
  if (!running) children.push(spawn(process.execPath, ["server/start-qq.mjs"], { cwd, env, stdio: "inherit" }));
}
children.push(
  spawn(process.execPath, ["--watch", "server/index.mjs"], {
    cwd,
    env,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"],
    { cwd, env, stdio: "inherit" },
  ),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill("SIGTERM"));
  setTimeout(() => process.exit(code), 250);
}
children.forEach((child) => {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
