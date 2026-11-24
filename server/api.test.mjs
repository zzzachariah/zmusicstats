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

async function connect(call, provider = "netease") {
  const qr = await (
    await call(`/api/auth/${provider}/qr`, { method: "POST" })
  ).json();
  const result = await (await call(`/api/auth/${provider}/qr/${qr.id}`)).json();
  assert.equal(result.state, "connected");
  return qr;
}

test("QQ history month discovery requires this browser's QQ connection and is rate limited", async (t) => {
  let reads = 0;
  const directory = { provider: "qq", months: ["2026-10"], source: "qq-listening-report.availableDates", rangeVerified: true, scope: "currently-readable" };
  const { call, base } = await withServer(t, {
    configured: { netease: true, qq: true },
    qqHistoryMonths: async credential => {
      reads++;
      assert.equal(credential.secret, "sensitive-music-cookie");
      return directory;
    },
  });
  assert.equal((await call("/api/history/qq/months")).status, 401);
  await connect(call, "qq");
  assert.equal((await fetch(`${base}/api/history/qq/months`)).status, 401);
  for (let index = 0; index < 10; index++) {
    const response = await call("/api/history/qq/months");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), directory);
  }
  const limited = await call("/api/history/qq/months");
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "RATE_LIMITED");
  assert.equal(reads, 10);
});

test("QQ history directory failures remain explicit errors rather than empty successful imports", async (t) => {
  const { call } = await withServer(t, {
    configured: { netease: true, qq: true },
    qqHistoryMonths: async () => { throw new ApiError(502, "HISTORY_DIRECTORY_UNAVAILABLE", "目录暂不可用。"); },
  });
  await connect(call, "qq");
  const response = await call("/api/history/qq/months");
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: "HISTORY_DIRECTORY_UNAVAILABLE", message: "目录暂不可用。" } });
});

test("QQ history discovery cannot finish into a disconnected or replaced account", async (t) => {
  let release, notify;
  const started = new Promise(resolve => { notify = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const { call } = await withServer(t, {
    configured: { netease: true, qq: true },
    qqHistoryMonths: async () => { notify(); return pending; },
  });
  await connect(call, "qq");
  const request = call("/api/history/qq/months");
  await started;
  assert.equal((await call("/api/connections/qq", { method: "DELETE" })).status, 200);
  release({ provider: "qq", months: ["2026-10"] });
  const response = await request;
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CONNECTION_CHANGED");
});

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

test("QQ mobile authorization shares the QR session, conservative expiry and original polling key", async t => {
  const deadline = Date.now() + 90_000;
  const { call, base } = await withServer(t, {
    configured: { netease: true, qq: true },
    createQr: async () => ({ key: "original-qr-key", qrImage: tinyPng, expiresAt: deadline,
      mobileAuth: { status: "available", kind: "app-authorization", url: "https://music.qq.com/unilink/download.html?scheme=synthetic", verification: "device-test-required" } }),
    checkQr: async (provider, key) => {
      assert.equal(provider, "qq"); assert.equal(key, "original-qr-key");
      return { state: "waiting" };
    },
  });
  const response = await call("/api/auth/qq/qr", { method: "POST" });
  const qr = await response.json();
  assert.equal(qr.expiresAt, deadline);
  assert.equal(qr.mobileAuth.expiresAt, deadline);
  assert.equal(qr.mobileAuth.verification, "device-test-required");
  assert.equal(JSON.stringify(qr).includes("original-qr-key"), false);
  assert.equal((await fetch(`${base}/api/auth/qq/qr/${qr.id}`)).status, 404);
  assert.equal((await (await call(`/api/auth/qq/qr/${qr.id}`)).json()).state, "waiting");
  await call("/api/connections/qq", { method: "DELETE" });
  assert.equal((await call(`/api/auth/qq/qr/${qr.id}`)).status, 404);
});

test("expired QQ launch links expose the same expired deadline and cannot poll as waiting", async t => {
  const deadline = Date.now() - 1000;
  let checks = 0;
  const { call } = await withServer(t, {
    configured: { netease: true, qq: true },
    createQr: async () => ({ key: "expired-fixture", qrImage: tinyPng, expiresAt: deadline,
      mobileAuth: { status: "unavailable", kind: "app-authorization", code: "MOBILE_AUTH_TIMEOUT", verification: "device-test-required" } }),
    checkQr: async () => { checks++; return { state: "waiting" }; },
  });
  const response = await call("/api/auth/qq/qr", { method: "POST" });
  assert.equal(response.status, 200, "mobile parsing failures do not reject a QR response");
  const qr = await response.json();
  assert.equal(qr.expiresAt, deadline);
  assert.equal(qr.mobileAuth.expiresAt, deadline);
  assert.equal((await (await call(`/api/auth/qq/qr/${qr.id}`)).json()).state, "expired");
  assert.equal(checks, 0);
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

test("a failed report is retried immediately and a year of months fits the rate limit", async t => {
  let requests = 0;
  const { call } = await withServer(t, {
    report: async (id, credential, month) => {
      requests++;
      return { platform: { id, period: monthPeriod(month), tracks: [] },
        issues: requests === 1 ? [{ provider: id, code: "UPSTREAM_TIMEOUT", message: "timeout" }] : [] };
    },
  });
  await connect(call);
  await call("/api/report?month=2026-01");
  await call("/api/report?month=2026-01");
  assert.equal(requests, 2, "partial upstream failures must not become cached empty results");
  for (let month = 2; month <= 12; month++) {
    assert.equal((await call(`/api/report?month=2026-${String(month).padStart(2, "0")}`)).status, 200);
  }
});

test("history API imports discovered months, exposes reports progressively, and clears them on disconnect", async t => {
  let durationCalls = 0;
  const { call } = await withServer(t, {
    history: async () => ({ months: ["2026-09", "2026-10"], source: "timedetail", rangeVerified: false, years: [2026] }),
    report: async (id, credential, month) => ({ platform: { id, period: monthPeriod(month), rankingPeriod: monthPeriod(month),
      tracks: [{ id: "fixture", title: "Fixture", artist: "Fixture", count: 2, genres: [] }], listenSeconds: null,
      durationKind: "unknown", coverageComplete: false, countKind: "plays", countDefinition: null, rankCoverage: "top" },
      issues: [{provider: id, code: "DURATION_MAPPING_REQUIRED", message: "duration unknown"}] }),
    neteaseDuration: async () => { durationCalls++; return {listenSeconds: 3600, durationKind: "actual-total", coverageComplete: true}; },
  });
  assert.equal((await call("/api/history/netease", {method: "POST"})).status, 401);
  await connect(call);
  assert.equal((await call("/api/history/netease", {method: "POST"})).status, 200);
  let job;
  for (let attempt = 0; attempt < 30; attempt++) {
    job = (await (await call("/api/history/netease")).json()).job;
    if (job.state === "complete") break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(job.state, "complete"); assert.equal(job.succeeded, 2);
  const raw = await (await call("/api/history/netease/reports")).text();
  assert.equal(raw.includes("sensitive-music-cookie"), false);
  const result = JSON.parse(raw);
  assert.deepEqual(result.months, ["2026-09", "2026-10"]);
  assert.equal(result.inputs.length, 2); assert.equal(result.issues.length, 2);
  assert.equal((await call("/api/history/netease", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({refreshDuration: true})})).status, 200);
  for (let attempt = 0; attempt < 30; attempt++) {
    job = (await (await call("/api/history/netease")).json()).job;
    if (job.state === "complete") break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(durationCalls, 2);
  const refreshed = await (await call("/api/history/netease/reports")).json();
  assert.equal(refreshed.inputs.every(input => input.platforms[0].listenSeconds === 3600), true);
  assert.equal(refreshed.inputs.every(input => input.platforms[0].tracks[0].id === "fixture"), true);
  assert.equal(refreshed.issues.length, 0);
  await call("/api/connections/netease", {method: "DELETE"});
  assert.deepEqual((await (await call("/api/history/netease/reports")).json()).inputs, []);
});

test("metadata endpoint caps work and strips unrecognized browser fields", async t => {
  let seen;
  const {call} = await withServer(t, {metadata: async tracks => {seen = tracks; return {items: []};}});
  const track = {provider: "netease", id: "123", title: "Fixture", artist: "Fixture", arbitrary: "untrusted"};
  const send = tracks => call("/api/metadata", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({tracks})});
  assert.equal((await send(Array(21).fill(track))).status, 400);
  assert.equal((await send([track])).status, 200);
  assert.equal("arbitrary" in seen[0], false);
});

test("trusted saved months bypass upstream reads and both report APIs apply the latest local metadata", async t => {
  let requests = 0;
  let genre = "Pop";
  const {call} = await withServer(t, {
    history: async () => ({months: ["2026-10", "2026-09"], source: "timedetail", rangeVerified: false, years: [2026]}),
    report: async (id, _credential, month) => {
      requests++;
      return {platform: {id, period: monthPeriod(month), rankingPeriod: monthPeriod(month),
        tracks: [{id: "fixture", title: "Fixture", artist: "Fixture", count: 23, genres: []}],
        listenSeconds: month === "2026-10" ? 3600 : null, durationKind: month === "2026-10" ? "actual-total" : "unknown",
        coverageComplete: month === "2026-10", countKind: "plays", countDefinition: null, rankCoverage: "top"},
        issues: month === "2026-10" ? [] : [{provider: id, code: "DURATION_MAPPING_REQUIRED", message: "unknown duration"}]};
    },
    cachedMetadata: (_provider, tracks) => tracks.map(track => ({...track, artworkUrl: "https://p1.music.126.net/fixture.jpg", durationSeconds: 240, genres: [genre]})),
  });
  await connect(call);
  await call("/api/history/netease", {method: "POST"});
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await (await call("/api/history/netease")).json()).job.state === "complete") break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const importedRequests = requests;
  const first = await (await call("/api/report?month=2026-10")).json();
  assert.equal(requests, importedRequests, "trusted history must never refetch the month");
  assert.equal(first.input.platforms[0].listenSeconds, 3600);
  assert.equal(first.input.platforms[0].tracks[0].durationSeconds, 240);
  assert.equal(first.input.platforms[0].tracks[0].count, 23);
  genre = "Rock";
  const repeat = await (await call("/api/report?month=2026-10")).json();
  assert.deepEqual(repeat.input.platforms[0].tracks[0].genres, ["Rock"], "metadata is refreshed locally even on a response cache hit");
  const saved = await (await call("/api/history/netease/reports")).json();
  assert.equal(saved.inputs.every(input => input.platforms[0].tracks[0].artworkUrl === "https://p1.music.126.net/fixture.jpg"), true);
  assert.equal(saved.inputs.every(input => input.platforms[0].tracks[0].genres[0] === "Rock"), true);
  assert.equal(requests, importedRequests, "reading archives and cached metadata does not hit music services");
  await call("/api/report?month=2026-09");
  assert.equal(requests, importedRequests + 1, "an incomplete saved report remains eligible for a real retry");
});

test("profile enrichment returns only display fields and is deduplicated", async t => {
  let profiles = 0;
  const { call } = await withServer(t, {
    account: async () => {
      profiles++;
      return { nickname: "真实平台昵称", avatarUrl: "http://p1.music.126.net/avatar.jpg", userId: "private-account-id", cookie: "private-profile-cookie" };
    },
  });
  await connect(call);
  const response = await (await call("/api/connections")).text();
  const provider = JSON.parse(response).providers[0];
  assert.equal(provider.connected, true);
  assert.deepEqual(provider.account, { nickname: "真实平台昵称", avatarUrl: "https://p1.music.126.net/avatar.jpg" });
  assert.equal(response.includes("private-"), false);
  await call("/api/connections");
  assert.equal(profiles, 1);
});

test("profile lookup failure cannot block confirmed QR login or clear the connection", async t => {
  let profiles = 0;
  const { call } = await withServer(t, {
    account: async () => { profiles++; throw new ApiError(504, "UPSTREAM_TIMEOUT", "timeout"); },
  });
  await connect(call);
  assert.equal(profiles, 0, "profile is not part of the critical login path");
  const response = await call("/api/connections");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).providers[0].connected, true);
});

test("an in-flight profile does not resurrect an account after disconnect", async t => {
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const notified = new Promise(resolve => { started = resolve; });
  const { call } = await withServer(t, {
    account: async () => { started(); await pending; return { nickname: "previous-account" }; },
  });
  await connect(call);
  const loading = call("/api/connections");
  await notified;
  await call("/api/connections/netease", { method: "DELETE" });
  release();
  const response = await (await loading).json();
  assert.equal(response.providers[0].connected, false);
  assert.equal(response.providers[0].account, null);
});

test("NetEase and QQ profile parsing uses documented safe nickname fields", async () => {
  const seen = [];
  const adapters = createAdapters({ neteaseBase: "http://localhost:3001", qqBase: "http://localhost:3201" }, async (url, init) => {
    seen.push({ path: url.pathname, headers: init.headers });
    return new Response(JSON.stringify(url.pathname === "/user/account"
      ? { code: 200, profile: { nickname: "网易测试", avatarUrl: "javascript:alert(1)", userId: 42 } }
      : { code: 200, data: { profile: { nick: "QQ测试", avatarUrl: "https://y.gtimg.cn/avatar.jpg", musicid: 42 } } }));
  });
  const credential = { kind: "gateway", secret: "fixture-credential" };
  assert.deepEqual(await adapters.account("netease", credential), { nickname: "网易测试" });
  assert.deepEqual(await adapters.account("qq", credential), { nickname: "QQ测试", avatarUrl: "https://y.gtimg.cn/avatar.jpg" });
  assert.equal(seen[0].headers["x-apicache-bypass"], "1");
  assert.equal(seen[1].headers["X-QQ-Session"], "fixture-credential");
  assert.deepEqual(await adapters.account("apple", { kind: "musickit" }), { nickname: "Apple Music 账号" });
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
