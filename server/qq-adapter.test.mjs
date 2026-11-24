import test from "node:test";
import assert from "node:assert/strict";
import { createAdapters } from "./adapters.mjs";

const credential = { kind: "gateway", secret: "fixture-stored-session" };
const ranking = {
  code: 200, range: "month", date: "202610",
  items: [{ track: { id: 123, name: "Fixture song", singer: [{ name: "Fixture artist" }], album: { name: "Fixture album" } }, listenCount: 9 }],
};
const duration = { code: 200, range: "month", date: "202610", availableDates: ["202610"], listenSeconds: 3601 };

function setup(overrides = {}) {
  const calls = [];
  const adapters = createAdapters({ qqBase: "http://127.0.0.1:3201", qqChannel: "qqmusic" }, async (url, options) => {
    calls.push({ path: url.pathname, params: Object.fromEntries(url.searchParams), headers: options.headers });
    const response = overrides[url.pathname] ?? {
      "/user/listening-rank": ranking,
      "/user/listening-report": duration,
      "/song/genre": { code: 200, genres: [{ id: 1, name: "R&B" }] },
      "/login/qr/check": { code: 803, cookie: "unrelated=fixture; qqmusic_session=fixture-stored-session; Path=/" },
    }[url.pathname];
    if (response instanceof Error) throw response;
    return response instanceof Response ? response : new Response(JSON.stringify(response));
  });
  return { adapters, calls };
}

test("QQ stored mode uses the opaque cookie token as a header and explicit YYYYMM on both report calls", async () => {
  const { adapters, calls } = setup();
  const login = await adapters.checkQr("qq", "fixture-qr-key");
  assert.deepEqual(login.credential, credential);
  const { platform, issues } = await adapters.report("qq", login.credential, "2026-10");
  assert.equal(platform.listenSeconds, 3601);
  assert.equal(platform.coverageComplete, true);
  assert.equal(platform.tracks[0].count, 9);
  assert.deepEqual(platform.tracks[0].genres, []);
  assert.ok(!calls.some(call => call.path === "/song/genre"));
  const metadata = await adapters.metadata(platform.tracks.map(track => ({ ...track, provider: "qq" })), { qq: { credential } });
  assert.deepEqual(metadata.items[0].genres, ["R&B"]);
  assert.deepEqual(issues, []);
  for (const call of calls.filter(call => call.path.startsWith("/user/"))) {
    assert.deepEqual(call.params, { range: "month", date: "202610" });
    assert.equal(call.headers["X-QQ-Session"], credential.secret);
    assert.ok(!Object.values(call.params).includes(credential.secret));
  }
});

test("an undated or differently dated duration never becomes the selected historical month's hours", async () => {
  for (const date of [undefined, "202611"]) {
    const { adapters } = setup({ "/user/listening-report": { ...duration, date } });
    const { platform, issues } = await adapters.report("qq", credential, "2026-10");
    assert.equal(platform.listenSeconds, null);
    assert.equal(platform.coverageComplete, false);
    assert.equal(platform.tracks.length, 1);
    assert.ok(issues.some(issue => issue.code === "PERIOD_UNCONFIRMED"));
  }
});

test("bad ranking dates or schema do not discard an independently valid duration", async () => {
  for (const payload of [{ ...ranking, date: "202611" }, { ...ranking, items: null }]) {
    const { adapters } = setup({ "/user/listening-rank": payload });
    const { platform, issues } = await adapters.report("qq", credential, "2026-10");
    assert.equal(platform.listenSeconds, 3601);
    assert.equal(platform.rankingPeriod, null);
    assert.deepEqual(platform.tracks, []);
    assert.ok(issues.length > 0);
  }
});

test("QQ missing duration is explicitly unavailable while genuine zero remains zero", async () => {
  const missing = setup({ "/user/listening-report": { ...duration, listenSeconds: undefined } });
  const unavailable = await missing.adapters.report("qq", credential, "2026-10");
  assert.equal(unavailable.platform.listenSeconds, null);
  assert.ok(unavailable.issues.some(issue => issue.code === "DURATION_UNAVAILABLE"));
  const silent = setup({ "/user/listening-report": { ...duration, listenSeconds: 0 }, "/user/listening-rank": { ...ranking, items: [] } });
  const zero = await silent.adapters.report("qq", credential, "2026-10");
  assert.equal(zero.platform.listenSeconds, 0);
  assert.equal(zero.platform.coverageComplete, true);
});

test("QQ zero duration with positive play counts is unavailable, never presented as zero hours", async () => {
  const { adapters } = setup({ "/user/listening-report": { ...duration, listenSeconds: 0 } });
  const { platform, issues } = await adapters.report("qq", credential, "2026-10");
  assert.equal(platform.listenSeconds, null);
  assert.equal(platform.durationKind, "unknown");
  assert.equal(platform.coverageComplete, false);
  assert.ok(issues.some(issue => issue.code === "DURATION_INCONSISTENT"));
});

test("a rejected stored credential produces an issue, never synthetic zero stats", async () => {
  const { adapters } = setup({
    "/user/listening-report": new Response(JSON.stringify({ code: 401 }), { status: 401 }),
    "/user/listening-rank": new Response(JSON.stringify({ code: 401 }), { status: 401 }),
  });
  const { platform, issues } = await adapters.report("qq", credential, "2026-10");
  assert.equal(platform.listenSeconds, null);
  assert.deepEqual(platform.tracks, []);
  assert.ok(issues.every(issue => issue.code === "CONNECTION_EXPIRED"));
});

test("official available months skip older requests only for the same credential", async () => {
  const { adapters, calls } = setup();
  await adapters.report("qq", credential, "2026-10");
  const before = calls.length;
  const absent = await adapters.report("qq", credential, "2020-01");
  assert.equal(calls.length, before);
  assert.equal(absent.platform.listenSeconds, null); assert.deepEqual(absent.platform.tracks, []);
  assert.ok(absent.issues.some(issue => issue.code === "PERIOD_UNAVAILABLE"));
  await adapters.report("qq", { kind: "gateway", secret: "different-account" }, "2020-01");
  assert.equal(calls.length, before + 2);
});

test("empty month directories never suppress a later month request", async () => {
  const { adapters, calls } = setup({ "/user/listening-report": { ...duration, availableDates: [] } });
  await adapters.report("qq", credential, "2026-10");
  const before = calls.length;
  await adapters.report("qq", credential, "2020-01");
  assert.equal(calls.length, before + 2);
});

test("QQ history discovers only validated completed months, keeps the real window, and caches per credential", async () => {
  const current = new Date(Date.now() + 8 * 60 * 60_000).toISOString().slice(0, 7).replace("-", "");
  const { adapters, calls } = setup({ "/user/listening-report": {
    code: 200, range: "month", availableDates: ["200002", current, "200001", "209912", "200002"],
  } });
  const directory = await adapters.qqHistoryMonths(credential);
  assert.deepEqual(directory, {
    provider: "qq", months: ["2000-01", "2000-02"], source: "qq-listening-report.availableDates",
    rangeVerified: true, scope: "currently-readable",
  });
  assert.deepEqual(calls[0].params, { range: "month" });
  assert.equal(calls[0].headers["X-QQ-Session"], credential.secret);
  assert.equal(JSON.stringify(directory).includes(credential.secret), false);
  await adapters.qqHistoryMonths(credential);
  assert.equal(calls.length, 1);
  await adapters.qqHistoryMonths({ kind: "gateway", secret: "other-account" });
  assert.equal(calls.length, 2);
});

test("QQ history can reuse an already validated monthly report directory", async () => {
  const { adapters, calls } = setup();
  await adapters.report("qq", credential, "2026-10");
  const before = calls.length;
  assert.deepEqual((await adapters.qqHistoryMonths(credential)).months, ["2026-10"]);
  assert.equal(calls.length, before);
});

test("QQ absent or empty history directory is an error, never a successful empty history", async () => {
  for (const availableDates of [undefined, null, [], "202610"]) {
    const { adapters, calls } = setup({ "/user/listening-report": { ...duration, availableDates } });
    await assert.rejects(adapters.qqHistoryMonths(credential), { code: "HISTORY_DIRECTORY_UNAVAILABLE" });
    await assert.rejects(adapters.qqHistoryMonths(credential), { code: "HISTORY_DIRECTORY_UNAVAILABLE" });
    assert.equal(calls.length, 2, "failed directories must remain retryable");
  }
});

test("QQ malformed or wrongly scoped directory is rejected as a whole, not silently truncated", async () => {
  for (const payload of [
    { ...duration, availableDates: ["202610", "202613"] },
    { ...duration, availableDates: ["202610", 202609] },
    { ...duration, availableDates: ["202610", "2026-09"] },
    { ...duration, range: "week" },
  ]) {
    const { adapters } = setup({ "/user/listening-report": payload });
    await assert.rejects(adapters.qqHistoryMonths(credential), { code: "HISTORY_DIRECTORY_INVALID" });
  }
});

test("QQ a valid directory containing only open/future months yields no ended months", async () => {
  const current = new Date(Date.now() + 8 * 60 * 60_000).toISOString().slice(0, 7).replace("-", "");
  const { adapters } = setup({ "/user/listening-report": { ...duration, availableDates: [current, "209912"] } });
  assert.deepEqual((await adapters.qqHistoryMonths(credential)).months, []);
});

test("QQ directory preserves authentication errors and does not send personal keys to the gateway", async () => {
  const { adapters, calls } = setup({ "/user/listening-report": new Response(JSON.stringify({ code: 401 }), { status: 401 }) });
  await assert.rejects(adapters.qqHistoryMonths(credential), { code: "CONNECTION_EXPIRED" });
  await assert.rejects(adapters.qqHistoryMonths({ kind: "api-key", secret: "fixture-personal-key" }), { code: "HISTORY_DIRECTORY_UNAVAILABLE" });
  assert.equal(calls.length, 1);
});
