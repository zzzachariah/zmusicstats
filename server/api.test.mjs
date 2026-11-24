import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApiServer } from "./index.mjs";
import {
  ApiError,
  appleDeveloperTokenUsable,
  configuredNeteaseDuration,
  createAdapters,
  monthPeriod,
  parseAppleRecentTracks,
  parseNeteaseRanks,
  validateBaseUrl,
} from "./adapters.mjs";

const origin = "http://localhost:5173";
const tinyPng = "data:image/png;base64,aGVsbG8=";

async function withServer(t, overrides = {}, config = {}) {
  const adapter = {
    configured: { netease: true, qq: false },
    createQr: async () => ({ key: "private-upstream-key", qrImage: tinyPng }),
    checkQr: async () => ({
      state: "connected",
      credential: { kind: "gateway", secret: "sensitive-music-cookie" },
      account: { nickname: "测试用户" },
    }),
    report: async (provider, credential, month) => ({
      platform: {
        id: provider,
        period: monthPeriod(month),
        listenSeconds: null,
        durationKind: "unknown",
        coverageComplete: false,
        tracks: [],
        rankingPeriod: monthPeriod(month),
        countKind: "plays",
        countDefinition: null,
        rankCoverage: "top",
      },
      issues: [],
    }),
    ...overrides,
  };
  const server = createApiServer(
    { origins: [origin], secureCookies: false, ...config },
    { adapters: adapter },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const initial = await fetch(`${base}/api/connections`);
  const cookie = initial.headers.get("set-cookie").split(";")[0];
  const call = (path, init = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { Origin: origin, Cookie: cookie, ...init.headers },
    });
  return { call, base, initial, cookie };
}

async function connect(call) {
  const qr = await (
    await call("/api/auth/netease/qr", { method: "POST" })
  ).json();
  const result = await (await call(`/api/auth/netease/qr/${qr.id}`)).json();
  assert.equal(result.state, "connected");
  return qr;
}

test("calendar periods are Shanghai dates and invalid months fail", () => {
  assert.deepEqual(monthPeriod("2024-02"), {
    start: "2024-02-01",
    end: "2024-02-29",
    timeZone: "Asia/Shanghai",
  });
  assert.throws(() => monthPeriod("2026-13"), { code: "INVALID_MONTH" });
  assert.throws(() => monthPeriod("../../secret"), { code: "INVALID_MONTH" });
});

test("unknown time fields stay missing until an explicit unit and path are supplied", () => {
  const source = { data: { listenTime: 99, total: 120000 } };
  assert.equal(configuredNeteaseDuration(source, null, null), null);
  assert.equal(
    configuredNeteaseDuration(source, "data.total", "milliseconds"),
    120,
  );
  assert.equal(
    configuredNeteaseDuration(source, "data.total", "unknown"),
    null,
  );
  assert.equal(
    configuredNeteaseDuration(source, "constructor", "seconds"),
    null,
  );
  assert.equal(
    configuredNeteaseDuration({ data: { total: 0 } }, "data.total", "seconds"),
    0,
  );
});

test("rank parser preserves missing play counts and never substitutes ranking score", () => {
  const tracks = parseNeteaseRanks({
    data: {
      songItems: [
        {
          songId: 123,
          songName: "测试曲目",
          artists: [{ name: "歌手" }],
          score: 100,
        },
      ],
    },
  });
  assert.equal(tracks[0].count, null);
  assert.deepEqual(tracks[0].genres, []);
  assert.throws(() => parseNeteaseRanks({ data: {} }), {
    code: "REPORT_SCHEMA_CHANGED",
  });
});

test("remote gateways require TLS and cannot embed credentials", () => {
  assert.throws(() => validateBaseUrl("http://music.example.test"));
  assert.throws(() =>
    validateBaseUrl("https://user:secret@music.example.test"),
  );
  assert.equal(
    validateBaseUrl("http://127.0.0.1:3001/"),
    "http://127.0.0.1:3001",
  );
});

test("unconfigured platforms return a real unavailable state, not a fake QR", async (t) => {
  const { call } = await withServer(t);
  const res = await call("/api/auth/qq/qr", { method: "POST" });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "GATEWAY_NOT_CONFIGURED");
});

test("cross-origin writes are rejected before any gateway call", async (t) => {
  let calls = 0;
  const { call } = await withServer(t, {
    createQr: async () => {
      calls++;
    },
  });
  const res = await call("/api/auth/netease/qr", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(res.status, 403);
  assert.equal(calls, 0);
});

test("QR login is scoped to browser session and never returns music credentials", async (t) => {
  const { call, base, initial } = await withServer(t);
  assert.match(initial.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const qr = await (
    await call("/api/auth/netease/qr", { method: "POST" })
  ).json();
  assert.notEqual(qr.id, "private-upstream-key");
  const alien = await fetch(`${base}/api/auth/netease/qr/${qr.id}`);
  assert.equal(alien.status, 404);
  const linked = await call(`/api/auth/netease/qr/${qr.id}`);
  const payload = await linked.text();
  assert.equal(payload.includes("sensitive-music-cookie"), false);
  assert.equal(payload.includes("credential"), false);
  assert.equal(JSON.parse(payload).state, "connected");
  const connections = await (await call("/api/connections")).json();
  assert.equal(connections.providers[0].connected, true);
});

test("disconnect removes credentials, reports, and pending login keys", async (t) => {
  const { call } = await withServer(t);
  const qr = await connect(call);
  assert.equal(
    (await call("/api/connections/netease", { method: "DELETE" })).status,
    200,
  );
  assert.equal((await call(`/api/auth/netease/qr/${qr.id}`)).status, 404);
  const response = await call("/api/report?month=2026-10");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "NOT_CONNECTED");
});

test("reports cache per session and preserve missing actual duration", async (t) => {
  let requests = 0;
  const { call, base } = await withServer(t, {
    report: async (id, credential, month) => {
      requests++;
      assert.equal(credential.secret, "sensitive-music-cookie");
      return {
        platform: { id, period: monthPeriod(month), listenSeconds: null },
        issues: [],
      };
    },
  });
  await connect(call);
  const first = await (await call("/api/report?month=2026-10")).json();
  assert.equal(first.mode, "live");
  assert.equal(first.input.platforms[0].listenSeconds, null);
  await call("/api/report?month=2026-10");
  assert.equal(requests, 1);
  assert.equal((await fetch(`${base}/api/report?month=2026-10`)).status, 401);
});

test("disconnect while a report is loading cannot cache or return the previous account result", async (t) => {
  let release, started;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const notified = new Promise((resolve) => {
    started = resolve;
  });
  const { call } = await withServer(t, {
    report: async () => {
      started();
      await pending;
      return { platform: { id: "netease" }, issues: [] };
    },
  });
  await connect(call);
  const report = call("/api/report?month=2026-10");
  await notified;
  await call("/api/connections/netease", { method: "DELETE" });
  release();
  assert.equal((await report).status, 409);
});

test("upstream errors do not leak network request details or tokens", async (t) => {
  const { call } = await withServer(t, {
    createQr: async () => {
      throw new Error("private-cookie=very-secret");
    },
  });
  const res = await call("/api/auth/netease/qr", { method: "POST" });
  const body = await res.text();
  assert.equal(res.status, 500);
  assert.equal(body.includes("very-secret"), false);
});

test("NetEase credential is forwarded in a request body, never in its URL", async () => {
  const requests = [];
  const adapters = createAdapters(
    { neteaseBase: "http://localhost:3001" },
    async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          code: 200,
          data: url.pathname.endsWith("/rank") ? { songItems: [] } : {},
        }),
      );
    },
  );
  const result = await adapters.report(
    "netease",
    { secret: "private-credential", kind: "gateway" },
    "2026-10",
  );
  assert.equal(result.platform.listenSeconds, null);
  assert.equal(
    result.issues.some((issue) => issue.code === "DURATION_MAPPING_REQUIRED"),
    true,
  );
  assert.equal(
    requests.every((req) => !req.url.includes("private-credential")),
    true,
  );
  assert.equal(JSON.parse(requests[0].init.body).cookie, "private-credential");
});

test("gateway timeout becomes an actionable stable error code", async () => {
  const adapters = createAdapters(
    { neteaseBase: "http://localhost:3001" },
    async () => {
      throw new DOMException("secret request details", "TimeoutError");
    },
  );
  await assert.rejects(
    adapters.createQr("netease"),
    (error) =>
      error instanceof ApiError &&
      error.code === "UPSTREAM_TIMEOUT" &&
      !error.message.includes("secret"),
  );
});

const fakeDeveloperToken = (expires = Math.floor(Date.now() / 1000) + 3600) =>
  [
    Buffer.from(JSON.stringify({ alg: "ES256", kid: "TESTONLY01" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify({ iss: "TESTTEAM01", exp: expires })).toString(
      "base64url",
    ),
    "test-signature-not-valid-with-apple",
  ].join(".");

test("Apple remains visibly unavailable without usable developer configuration", async (t) => {
  assert.equal(appleDeveloperTokenUsable("not-a-jwt"), false);
  assert.equal(appleDeveloperTokenUsable(fakeDeveloperToken(1)), false);
  const { call } = await withServer(t);
  const providers = (await (await call("/api/connections")).json()).providers;
  const apple = providers.find((item) => item.id === "apple");
  assert.equal(apple.configured, false);
  assert.deepEqual(apple.methods, []);
  const res = await call("/api/auth/apple/config");
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "APPLE_NOT_CONFIGURED");
});

test("Apple developer configuration is returned only after Apple connectivity validation", async () => {
  let requests = 0;
  const token = fakeDeveloperToken();
  const adapters = createAdapters(
    { appleDeveloperToken: token },
    async (url, init) => {
      requests++;
      assert.equal(String(url), "https://api.music.apple.com/v1/test");
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      return new Response("", { status: 200 });
    },
  );
  const config = await adapters.appleConfig();
  assert.equal(config.developerToken, token);
  assert.equal(config.appName, "zmusicstats");
  await adapters.appleConfig();
  assert.equal(requests, 1);
  const rejected = createAdapters(
    { appleDeveloperToken: token },
    async () => new Response("", { status: 401 }),
  );
  await assert.rejects(rejected.appleConfig(), {
    code: "APPLE_CONFIG_INVALID",
  });
});

test("Apple user token is verified before saving and is never returned to the client", async (t) => {
  let verified = false;
  const { call } = await withServer(t, {
    configured: { netease: false, qq: false, apple: true },
    connectApple: async (value) => {
      assert.equal(value, "private-apple-music-user-token");
      verified = true;
      return { credential: { kind: "musickit", secret: value }, account: null };
    },
  });
  const result = await call("/api/auth/apple/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ musicUserToken: "private-apple-music-user-token" }),
  });
  const raw = await result.text();
  assert.equal(verified, true);
  assert.equal(result.status, 200);
  assert.equal(raw.includes("private-apple"), false);
  assert.equal(JSON.parse(raw).state, "connected");
  const connections = await (await call("/api/connections")).json();
  assert.equal(
    connections.providers.find((item) => item.id === "apple").connected,
    true,
  );
  await call("/api/connections/apple", { method: "DELETE" });
  assert.equal((await call("/api/report?month=2026-10")).status, 401);
});

test("Apple API user-token validation and recent tracks keep unbounded history out of month totals", async () => {
  const requests = [];
  const payload = {
    data: [
      { id: "album-1", type: "albums", attributes: { name: "不是歌曲" } },
      {
        id: "song-1",
        type: "songs",
        attributes: {
          name: "近期歌曲",
          artistName: "歌手",
          durationInMillis: 240000,
          genreNames: ["R&B/Soul", "Music"],
        },
      },
    ],
  };
  const adapters = createAdapters(
    { appleDeveloperToken: fakeDeveloperToken() },
    async (url, init) => {
      requests.push({ url: String(url), headers: init.headers });
      return new Response(
        JSON.stringify(
          url.pathname.endsWith("/storefront")
            ? { data: [{ id: "cn", type: "storefronts" }] }
            : payload,
        ),
      );
    },
  );
  const auth = await adapters.connectApple("private-apple-music-user-token");
  const result = await adapters.report("apple", auth.credential, "2026-10");
  assert.equal(result.platform.listenSeconds, null);
  assert.equal(result.platform.rankingPeriod, null);
  assert.equal(result.platform.tracks[0].count, null);
  assert.deepEqual(result.platform.tracks[0].genres, ["R&B/Soul"]);
  assert.equal(result.platform.tracks.length, 1);
  assert.equal(result.platform.coverageComplete, false);
  assert.equal(requests[0].url, "https://api.music.apple.com/v1/me/storefront");
  assert.equal(
    requests[0].headers["Music-User-Token"],
    "private-apple-music-user-token",
  );
  assert.equal(
    requests.every((item) => !item.url.includes("private-apple")),
    true,
  );
  assert.equal(result.issues[0].code, "APPLE_RECENT_NOT_PERIOD");
  assert.equal(parseAppleRecentTracks({ data: [] }).length, 0);
});
