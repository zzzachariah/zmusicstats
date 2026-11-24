import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { createAdapters } from "./adapters.mjs";

// Exercise the installed gateway's actual middleware, rather than a reimplementation.
// No real music endpoint, account, or credential is used in these regression tests.
const packageJson = new URL("../work/netease-gateway/package.json", import.meta.url);
const installed = existsSync(new URL("../work/netease-gateway/node_modules/@neteasecloudmusicapienhanced/api/util/apicache.js", import.meta.url));
const requireGateway = createRequire(packageJson);

async function fixtureGateway(t, register) {
  const express = requireGateway("express");
  const cache = requireGateway("@neteasecloudmusicapienhanced/api/util/apicache.js").newInstance();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cookies = {}; next(); });
  app.use(cache.middleware("2 minutes", (_req, res) => res.statusCode === 200));
  register(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    // The upstream implementation requires per-key clearing to cancel every timer.
    for (const key of [...cache.getIndex().all]) cache.clear(key);
    server.closeAllConnections(); server.close();
  });
  return createAdapters({ neteaseBase: `http://127.0.0.1:${server.address().port}` });
}

test("NetEase confirmation bypasses the gateway's cached waiting response", { skip: !installed }, async t => {
  let code = 801;
  const adapters = await fixtureGateway(t, app => {
    app.post("/login/qr/check", (_req, res) => res.json({ code, cookie: code === 803 ? "MUSIC_U=fixture-session" : "" }));
  });
  assert.equal((await adapters.checkQr("netease", "fixture-key")).state, "waiting");
  code = 803;
  assert.equal((await adapters.checkQr("netease", "fixture-key")).state, "connected");
});

test("NetEase POST reports do not reuse another account's gateway cache", { skip: !installed }, async t => {
  const adapters = await fixtureGateway(t, app => {
    app.post("/listen/data/song/play/rank", (req, res) => res.json({ code: 200, data: { songItems: [{ songId: req.body.cookie === "fixture-A" ? 101 : 202, songName: "Fixture track", artists: [], playCount: 1 }] } }));
    app.post("/listen/data/report", (_req, res) => res.json({ code: 200, data: {} }));
  });
  const a = await adapters.report("netease", { kind: "gateway", secret: "fixture-A" }, "2026-10");
  const b = await adapters.report("netease", { kind: "gateway", secret: "fixture-B" }, "2026-10");
  assert.equal(a.platform.tracks[0].id, "101");
  assert.equal(b.platform.tracks[0].id, "202");
});
