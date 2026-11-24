import { createRequire } from "node:module";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const requireGateway = createRequire(
  new URL("../work/netease-gateway/package.json", import.meta.url),
);
let server;

try {
  // The package entry initializes an empty anonymous-token cache synchronously.
  // Its public server API does not wait for external requests when version checking is disabled.
  const api = requireGateway("@neteasecloudmusicapienhanced/api");
  const app = await api.serveNcmApi({
    host: "127.0.0.1",
    port: Number(process.env.PORT || 3101),
    checkVersion: false,
  });
  server = app.server;
  if (!server.listening) await once(server, "listening");
  process.send?.({ type: "ready" });

  // Optional anonymous/key-cache refresh happens after HTTP starts. A slow upstream may affect
  // an individual music request, but it cannot stop the local bridge from accepting requests.
  const generateConfigPath = fileURLToPath(
    new URL(
      "../work/netease-gateway/node_modules/@neteasecloudmusicapienhanced/api/generateConfig.js",
      import.meta.url,
    ),
  );
  void Promise.resolve()
    .then(() => requireGateway(generateConfigPath)())
    .catch(() => {});
} catch {
  process.send?.({ type: "startup-error" });
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50);
}

function stop() {
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
  // Background cache refreshes must not leave this child alive after its launcher exits.
  setTimeout(() => process.exit(0), 1500).unref();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("disconnect", stop);
