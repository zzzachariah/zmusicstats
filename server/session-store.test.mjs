import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createEncryptedSessionStore } from "./session-store.mjs";
import { createApiServer, loadConfigFromEnvFile } from "./index.mjs";

const origin = "http://localhost:5173";
const fixtureId = "a".repeat(43);
const fixtureSecret = "fixture-only-private-cookie-never-log";

function paths(t) {
  const dir = mkdtempSync(join(tmpdir(), "zmusicstats-session-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, "sessions.enc") };
}

test("API restart reads updated connector settings and keeps phone origins", t => {
  const { dir } = paths(t);
  const file = join(dir, ".env");
  const inherited = { APPLE_MUSIC_DEVELOPER_TOKEN: "old-fixture", QQ_API_BASE_URL: "http://localhost:3200", APP_ORIGINS: "http://192.0.2.5:5173" };
  writeFileSync(file, "APPLE_MUSIC_DEVELOPER_TOKEN=new-fixture\nQQ_API_BASE_URL=http://localhost:3201\nAPP_ORIGINS=http://localhost:5173\n");
  const config = loadConfigFromEnvFile(file, inherited);
  assert.equal(config.appleDeveloperToken, "new-fixture");
  assert.equal(config.qqBase, "http://localhost:3201");
  assert.deepEqual(config.origins, ["http://localhost:5173", "http://192.0.2.5:5173"]);
  writeFileSync(file, "APPLE_MUSIC_DEVELOPER_TOKEN=\n");
  assert.equal(loadConfigFromEnvFile(file, inherited).appleDeveloperToken, null);
});

test("session files are encrypted, private, and exclude QR/cache/request state", t => {
  const { dir, file } = paths(t);
  const store = createEncryptedSessionStore(file, { now: () => 100 });
  store.save([{ id: fixtureId, expiresAt: 1000, version: 1,
    connections: { netease: { credential: { kind: "gateway", secret: fixtureSecret }, account: { nickname: "fixture-name" }, connectedAt: 10 } },
    qrs: { secret: "pending-qr" }, cache: { tracks: ["private-listening-data"] }, requests: ["request-state"],
  }]);
  const serialized = readFileSync(file, "utf8");
  for (const value of [fixtureSecret, fixtureId, "fixture-name", "pending-qr", "private-listening-data"]) assert.equal(serialized.includes(value), false);
  if (process.platform !== "win32") {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, "session.key")).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  }
  const restored = createEncryptedSessionStore(file, { now: () => 100 }).load();
  assert.equal(restored[0].connections.netease.credential.secret, fixtureSecret);
  assert.equal("qrs" in restored[0], false); assert.equal("cache" in restored[0], false); assert.equal("requests" in restored[0], false);
});

test("expired connections are pruned and tampered data is not silently overwritten", t => {
  const { file } = paths(t); let now = 100;
  const store = createEncryptedSessionStore(file, { now: () => now });
  store.save([{ id: fixtureId, expiresAt: 200, connections: { netease: { credential: { kind: "gateway", secret: fixtureSecret } } } }]);
  now = 300; assert.deepEqual(store.load(), []);
  assert.deepEqual(createEncryptedSessionStore(file, { now: () => 100 }).load(), []);
  const envelope = JSON.parse(readFileSync(file, "utf8")); envelope.data = Buffer.from("tampered").toString("base64");
  const corrupted = JSON.stringify(envelope); writeFileSync(file, corrupted);
  assert.throws(() => store.load(), /existing data was preserved/);
  assert.equal(readFileSync(file, "utf8"), corrupted);
});

async function launch(file, adapter) {
  const server = createApiServer({ origins: [origin], sessionStorePath: file }, { adapters: adapter });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    call: (path, cookie, init = {}) => fetch(`${base}${path}`, { ...init, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...init.headers } }),
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

test("same browser recovers connection after restart; disconnect removes durable credentials", async t => {
  const { file } = paths(t);
  let reports = 0;
  const adapter = {
    configured: { netease: true, qq: false, apple: false },
    createQr: async () => ({ key: "fixture-key", qrImage: "data:image/png;base64,aGVsbG8=" }),
    checkQr: async () => ({ state: "connected", credential: { kind: "gateway", secret: fixtureSecret }, account: null }),
    report: async () => { reports++; return { platform: { id: "netease", tracks: [] }, issues: [] }; },
  };
  let api = await launch(file, adapter);
  try {
    const first = await api.call("/api/connections");
    const cookie = first.headers.get("set-cookie").split(";")[0];
    const qr = await (await api.call("/api/auth/netease/qr", cookie, { method: "POST" })).json();
    assert.equal((await (await api.call(`/api/auth/netease/qr/${qr.id}`, cookie)).json()).state, "connected");
    await api.call("/api/report?month=2026-10", cookie); assert.equal(reports, 1);
    await api.close(); api = await launch(file, adapter);
    const connections = await (await api.call("/api/connections", cookie)).json();
    assert.equal(connections.providers[0].connected, true);
    assert.equal((await api.call(`/api/auth/netease/qr/${qr.id}`, cookie)).status, 404);
    await api.call("/api/report?month=2026-10", cookie); assert.equal(reports, 2, "report cache must not survive restart");
    assert.equal((await api.call("/api/connections/netease", cookie, { method: "DELETE" })).status, 200);
    await api.close(); api = await launch(file, adapter);
    assert.equal((await (await api.call("/api/connections", cookie)).json()).providers[0].connected, false);
    assert.deepEqual(createEncryptedSessionStore(file).load(), []);
  } finally { await api.close(); }
});
