import test from "node:test";
import assert from "node:assert/strict";
import { buildTrackHistory, withTrackHistory } from "./track-history.ts";
import type { PlatformId, PlatformInput, RankedTrack, ReportInput, TrackInput } from "./report.ts";

const song = (id: string, extra: Partial<TrackInput> = {}): TrackInput => ({ id, title: "Same title", artist: "Artist", count: 12, genres: [], ...extra });
function monthly(month: string, id: PlatformId, tracks: TrackInput[], override: Partial<PlatformInput> = {}): ReportInput {
  const end = new Date(`${month}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const period = {start: `${month}-01`, end: end.toISOString().slice(0, 10), timeZone: "Asia/Shanghai"};
  return { mode: "live", period, platforms: [{id, period, tracks, rankingPeriod: period, listenSeconds: null,
    durationKind: "unknown", coverageComplete: false, countKind: "plays", countDefinition: null, rankCoverage: "top", ...override}] };
}
const ranked = (id: string, platform: PlatformId, extra: Partial<RankedTrack> = {}): RankedTrack => ({ ...song(id),
  rank: 3, platforms: [platform], sourceCounts: {[platform]: 12}, countIsPartial: false, coverIndex: 2, ...extra });

test("appearance bounds follow monthly observations across years, independent of ordering and duplicates", () => {
  const latest = monthly("2026-10", "netease", [song("a", {count: null}), song("a")]);
  const inputs = [latest, monthly("2024-12", "netease", [song("a", {count: 0, firstSeenMonth: "2000-01"})]),
    monthly("2025-02", "netease", [song("a"), song("b")]), structuredClone(latest)];
  const before = structuredClone(inputs);
  const history = buildTrackHistory(inputs);
  assert.equal(history.size, 2);
  assert.deepEqual(history.get("netease:a"), {firstSeenMonth: "2024-12", lastSeenMonth: "2026-10"});
  assert.deepEqual(history.get("netease:b"), {firstSeenMonth: "2025-02", lastSeenMonth: "2025-02"});
  assert.deepEqual(buildTrackHistory([...inputs].reverse()), history);
  assert.deepEqual(inputs, before);
});

test("the same source ID on different platforms remains separate, and titles never establish history", () => {
  const history = buildTrackHistory([monthly("2021-06", "netease", [song("123")]), monthly("2026-08", "qq", [song("123")])]);
  const [netease, qq, sameTitle] = withTrackHistory([ranked("123", "netease"), ranked("123", "qq"), ranked("other-id", "netease")], history);
  assert.equal(netease.firstSeenMonth, "2021-06");
  assert.equal(qq.firstSeenMonth, "2026-08");
  assert.equal(sameTitle.firstSeenMonth, undefined);
});

test("undated, mismatched, incomplete-calendar and multi-month inputs cannot fabricate monthly appearance", () => {
  const mismatch = monthly("2026-10", "netease", [song("mismatch")]);
  mismatch.platforms[0].rankingPeriod = {...mismatch.period, timeZone: "UTC"};
  const oldMonth = monthly("2026-10", "qq", [song("old-month")]);
  oldMonth.platforms[0].rankingPeriod = monthly("2026-09", "qq", []).period;
  const incomplete = monthly("2026-10", "netease", [song("incomplete")]); incomplete.period = {...incomplete.period, start: "2026-10-02"}; incomplete.platforms[0].rankingPeriod = incomplete.period;
  const multi = monthly("2026-10", "netease", [song("multi")]); multi.period = {...multi.period, start: "2026-09-01"}; multi.platforms[0].rankingPeriod = multi.period;
  const invalid = monthly("2026-10", "netease", [song("invalid")]); invalid.period = {...invalid.period, end: "2026-10-32"}; invalid.platforms[0].rankingPeriod = invalid.period;
  const apple = monthly("2026-10", "apple", [song("recent")], {rankingPeriod: null});
  assert.equal(buildTrackHistory([mismatch, oldMonth, incomplete, multi, invalid, apple]).size, 0);
  assert.equal(buildTrackHistory([monthly("2024-02", "apple", [song("dated")])]).get("apple:dated")?.firstSeenMonth, "2024-02");
});

test("repeated or later partial snapshots do not erase an already observed monthly appearance", () => {
  const seen = monthly("2026-01", "netease", [song("seen")]);
  const partial = monthly("2026-01", "netease", []);
  assert.deepEqual(buildTrackHistory([seen, partial, seen]).get("netease:seen"), {firstSeenMonth: "2026-01", lastSeenMonth: "2026-01"});
});

test("decorating namespaced and overlap rows preserves independent source counts and other metadata", () => {
  const history = buildTrackHistory([monthly("2021-06", "netease", [song("n")]), monthly("2026-10", "qq", [song("q")])]);
  const shared = ranked("overlap:netease:n|qq:q", "netease", {platforms: ["netease", "qq"], count: null,
    sourceCounts: {netease: 400, qq: 30}, durationSeconds: 250, artworkUrl: "https://p1.music.126.net/cover.jpg", genres: ["Pop"], countIsPartial: true});
  const input = [ranked("netease:n", "netease"), shared, ranked("recording:unknown-source", "netease", {canonicalId: "unknown-source"})];
  const before = structuredClone(input);
  const output = withTrackHistory(input, history);
  assert.equal(output[0].firstSeenMonth, "2021-06");
  assert.equal(output[1].firstSeenMonth, "2021-06");
  assert.equal(output[1].lastSeenMonth, "2026-10");
  const {firstSeenMonth: _first, lastSeenMonth: _last, ...unchanged} = output[1];
  assert.deepEqual(unchanged, shared);
  assert.equal(output[2].firstSeenMonth, undefined);
  assert.notEqual(output[0], input[0]);
  assert.deepEqual(input, before);
});

test("observed history overrides stale appearance fields without changing playback data", () => {
  const history = buildTrackHistory([monthly("2025-05", "netease", [song("a")])]);
  const track = ranked("a", "netease", {firstSeenMonth: "2000-01", lastSeenMonth: "2099-12", listenSeconds: 500});
  const [decorated] = withTrackHistory([track], history);
  assert.equal(decorated.firstSeenMonth, "2025-05");
  assert.equal(decorated.lastSeenMonth, "2025-05");
  assert.equal(decorated.listenSeconds, 500);
  assert.deepEqual(withTrackHistory([], history), []);
});
