import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(
  new URL("../work/netease-gateway/", import.meta.url),
);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("../work/netease-gateway/package.json", import.meta.url),
  JSON.stringify(
    {
      name: "zmusicstats-local-netease-gateway",
      private: true,
      dependencies: { "@neteasecloudmusicapienhanced/api": "4.41.1" },
    },
    null,
    2,
  ) + "\n",
);
const child = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["install", "--ignore-scripts", "--no-fund", "--no-audit"],
  { cwd: directory, stdio: "inherit" },
);
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
