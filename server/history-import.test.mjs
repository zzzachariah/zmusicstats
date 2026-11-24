import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEncryptedHistoryStore, createHistoryImporter } from "./history-import.mjs";

const NOW = Date.parse("2026-11-24T08:00:00+08:00");
const now = () => NOW;
const session = (id = "a".repeat(43)) => ({ id, version: 0, expiresAt: NOW + 3_600_000, connections: { netease: { credential: { kind: "gateway", secret: "test-session-cookie" }, connectedAt: NOW - 1000 } } });
const period = month => {
  const [year, index] = month.split("-").map(Number);
  return { start: `${month}-01`, end: `${month}-${new Date(Date.UTC(year, index, 0)).getUTCDate()}`, timeZone: "Asia/Shanghai" };
};
const result = (month, partial = false) => ({
  platform: { id: "netease", period: period(month), rankingPeriod: period(month), listenSeconds: partial ? null : 3600, durationKind: partial ? "unknown" : "actual-total", coverageComplete: !partial,
    tracks: [{ id: `song-${month}`, title: "Real cached title", artist: "Artist", count: 5, genres: [] }], countKind: "plays", countDefinition: "plays", rankCoverage: "top" },
  issues: [{ provider: "netease", code: "GENRE_NOT_AVAILABLE", message: "No tags" }, ...(partial ? [{ provider: "netease", code: "UPSTREAM_TIMEOUT", message: "Duration timed out" }] : [])],
});
const directory = months => ({ months, source: "year-report", rangeVerified: false, years: [2026] });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function completed(importer, user) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = importer.status(user);
    if (!["discovering", "running"].includes(status.state)) return status;
    await tick();
  }
  throw new Error("Import did not complete");
}

test("imports every candidate closed month once, with at most two workers and no current/future requests", async () => {
  let active = 0; let maximum = 0; const reads = [];
  const user = session();
  const importer = createHistoryImporter({ now, concurrency: 100,
    discoverMonths: async () => directory(["2026-10", "2026-09", "2026-08", "2026-11", "2026-12", "2026-10", "invalid"]),
    readMonth: async (_session, month) => { reads.push(month); maximum = Math.max(maximum, ++active); await tick(); active--; return result(month); },
  });
  assert.equal(importer.start(user).state, "discovering");
  const state = await completed(importer, user);
  assert.equal(maximum, 2);
  assert.deepEqual(reads.sort(), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(state.total, 3); assert.equal(state.completed, 3); assert.equal(state.succeeded, 3);
  assert.equal(state.discovery.rangeVerified, false);
  assert.equal(importer.reports(user).length, 3);
  importer.start(user); const repeat = await completed(importer, user);
  assert.equal(repeat.cached, 3); assert.equal(reads.length, 3);
});

test("partial useful data stays available immediately, is marked incomplete, and is retried", async () => {
  const user = session(); let calls = 0;
  const importer = createHistoryImporter({ now, discoverMonths: async () => directory(["2026-10"]), readMonth: async (_s, month) => result(month, ++calls === 1) });
  importer.start(user); let state = await completed(importer, user);
  assert.equal(state.succeeded, 1); assert.equal(state.months[0].full, false);
  assert.equal(importer.getCached(user, "2026-10").platform.listenSeconds, null);
  assert.equal(importer.getCached(user, "2026-10").issues[1].message, "Duration timed out");
  importer.start(user); state = await completed(importer, user);
  assert.equal(calls, 2); assert.equal(state.months[0].full, true);
  assert.equal(importer.getCached(user, "2026-10").platform.listenSeconds, 3600);
});

test("a failed retry preserves previously collected partial data and reports the failure", async () => {
  const user = session();
  const importer = createHistoryImporter({ now, discoverMonths: async () => directory(["2026-10"]), readMonth: async () => { throw Object.assign(new Error("secret=do-not-display"), { code: "UPSTREAM_TIMEOUT" }); } });
  importer.remember(user, "2026-10", result("2026-10", true));
  importer.start(user); const state = await completed(importer, user);
  assert.equal(state.failed, 1); assert.deepEqual(state.availableMonths, ["2026-10"]);
  assert.equal(importer.reports(user)[0].full, false);
  assert.doesNotMatch(JSON.stringify(state), /secret=do-not-display/);
});

test("unknown duration units remain incomplete but do not repeatedly re-read an otherwise successful month", async () => {
  const user = session(); let calls = 0;
  const importer = createHistoryImporter({ now, discoverMonths: async () => directory(["2026-10"]), readMonth: async (_s, month) => {
    calls++; const value = result(month, true);
    value.issues = [{ provider: "netease", code: "DURATION_MAPPING_REQUIRED", message: "Unit is not confirmed" }];
    return value;
  } });
  importer.start(user); await completed(importer, user);
  importer.start(user); const state = await completed(importer, user);
  assert.equal(calls, 1); assert.equal(state.cached, 1); assert.equal(state.months[0].full, false);
  assert.equal(importer.getCached(user, "2026-10").platform.listenSeconds, null);
});

test("empty data and mismatched periods cannot become cached successes", async () => {
  const user = session();
  const importer = createHistoryImporter({ now, discoverMonths: async () => directory(["2026-09", "2026-10"]), readMonth: async (_s, month) => {
    if (month === "2026-09") return result("2026-08");
    const empty = result(month, true); empty.platform.tracks = []; empty.issues = []; return empty;
  } });
  importer.start(user); const state = await completed(importer, user);
  assert.equal(state.failed, 2); assert.equal(state.availableMonths.length, 0);
  assert.deepEqual(state.months.map(item => item.issues[0].code).sort(), ["EMPTY_RESULT", "PERIOD_MISMATCH"]);
});

test("cancelling stops queued work and discards late in-flight results", async () => {
  const user = session(); const releases = []; let count = 0;
  const importer = createHistoryImporter({ now, discoverMonths: async () => directory(["2026-08", "2026-09", "2026-10"]), readMonth: async (_s, month) => { count++; await new Promise(resolve => releases.push(resolve)); return result(month); } });
  importer.start(user); await tick();
  assert.equal(count, 2); assert.equal(importer.cancel(user).state, "cancelled");
  releases.forEach(resolve => resolve()); await tick();
  assert.equal(count, 2); assert.deepEqual(importer.reports(user), []);
  assert.equal(importer.status(user).inFlight.length, 0);
});

test("a changed connection or session version cannot commit an old job", async () => {
  for (const replace of [false, true]) {
    const user = session(); let release;
    const importer = createHistoryImporter({ now, discoverMonths: async () => directory(["2026-10"]), readMonth: async (_s, month) => { await new Promise(resolve => { release = resolve; }); return result(month); } });
    importer.start(user); await tick();
    if (replace) user.connections.netease = { ...user.connections.netease, credential: { kind: "gateway", secret: "different-account" } };
    else user.version++;
    release(); await tick();
    assert.deepEqual(importer.reports(user), []);
    importer.dispose();
  }
});

test("disconnect clear removes durable session data and stops the job; sessions cannot see each other", async () => {
  const user = session(); const other = session("b".repeat(43));
  const importer = createHistoryImporter({ now, discoverMonths: async () => directory([]), readMonth: async () => { throw new Error("unused"); } });
  importer.remember(user, "2026-10", result("2026-10"));
  assert.equal(importer.getCached(other, "2026-10"), null);
  assert.equal(importer.status(other).availableMonths.length, 0);
  importer.clear(user); assert.equal(importer.getCached(user, "2026-10"), null);
});

test("duplicate start shares the current job and expired authorization stops further months", async () => {
  const user = session(); let discoveries = 0; let reads = 0;
  const importer = createHistoryImporter({ now, concurrency: 1, discoverMonths: async () => { discoveries++; await tick(); return directory(["2026-09", "2026-10"]); }, readMonth: async () => { reads++; throw Object.assign(new Error("expired"), { code: "CONNECTION_EXPIRED" }); } });
  importer.start(user); importer.start(user); const state = await completed(importer, user);
  assert.equal(discoveries, 1); assert.equal(reads, 1); assert.equal(state.state, "failed");
  assert.equal(state.error.code, "CONNECTION_EXPIRED");
});

test("the local cache survives restart encrypted with private permissions and rejects tampering", () => {
  const dir = mkdtempSync(join(tmpdir(), "zmusicstats-history-"));
  try {
    const storePath = join(dir, "history.enc"); const keyPath = join(dir, "session.key");
    writeFileSync(keyPath, Buffer.alloc(32, 7), { mode: 0o600 });
    const options = { now, storePath, discoverMonths: async () => directory([]), readMonth: async () => null };
    const user = session(); const first = createHistoryImporter(options);
    first.remember(user, "2026-10", result("2026-10"));
    assert.doesNotMatch(readFileSync(storePath, "utf8"), /Real cached title|test-session-cookie|2026-10/);
    assert.equal(statSync(storePath).mode & 0o777, 0o600);
    const restored = createHistoryImporter(options);
    assert.equal(restored.getCached(user, "2026-10").platform.tracks.length, 1);
    const cached = restored.getCached(user, "2026-10"); cached.platform.tracks.length = 0;
    assert.equal(restored.getCached(user, "2026-10").platform.tracks.length, 1);
    const envelope = JSON.parse(readFileSync(storePath, "utf8")); envelope.tag = Buffer.alloc(16, 0).toString("base64");
    writeFileSync(storePath, JSON.stringify(envelope));
    assert.throws(() => createHistoryImporter(options), /existing data was preserved/);
    assert.equal(JSON.parse(readFileSync(storePath, "utf8")).tag, envelope.tag);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("history encryption never creates a replacement session key", () => {
  const dir = mkdtempSync(join(tmpdir(), "zmusicstats-history-key-"));
  try {
    assert.throws(() => createEncryptedHistoryStore(join(dir, "history.enc")), /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
