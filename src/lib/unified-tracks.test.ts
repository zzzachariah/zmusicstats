import test from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "./report.ts";
import type { PlatformId, PlatformInput, RankedTrack, TrackInput } from "./report.ts";
import { getDemoReport } from "./demo-data.ts";
import { knownGenreDistribution, stableGenreColor, unifiedTracks } from "./unified-tracks.ts";

const period = { start: "2026-10-01", end: "2026-10-31", timeZone: "Asia/Shanghai" };
const song = (id: string, count: number | null = 1, canonicalId?: string, genres: string[] = []): TrackInput => ({ id, title: id, artist: "Artist", count, canonicalId, genres });

function source(id: PlatformId, tracks: TrackInput[], overrides: Partial<PlatformInput> = {}): PlatformInput {
  return { id, period, rankingPeriod: period, listenSeconds: null, durationKind: "unknown", coverageComplete: false, tracks, countKind: "plays", countDefinition: null, rankCoverage: "top", ...overrides };
}

function report(...platforms: PlatformInput[]) {
  return buildReport({ mode: "live", period, expectedPlatforms: platforms.map((platform) => platform.id), platforms });
}

test("already comparable merged rankings keep their verified counts and ordering", () => {
  const input = getDemoReport();
  const result = unifiedTracks(input);
  assert.equal(input.rankingMode, "combined");
  assert.deepEqual(result.tracks, input.tracks);
  assert.deepEqual(result.notice, input.rankingNotice);
  result.tracks[0].genres.push("Changed");
  assert.ok(!input.tracks[0].genres.includes("Changed"));
});

test("one frequent list orders the displayed source counts from high to low", () => {
  const input = report(source("netease", [song("n1", 2), song("n2", 1)]), source("qq", [song("q1", 2000), song("q2", 1000)]));
  const before = structuredClone(input);
  const result = unifiedTracks(input);
  assert.deepEqual(result.tracks.map((track) => track.id), ["q1", "q2", "n1", "n2"]);
  assert.deepEqual(result.tracks.map((track) => track.rank), [1, 2, 3, 4]);
  assert.deepEqual(result.tracks.map((track) => track.count), [2000, 1000, 2, 1]);
  assert.deepEqual(input, before);
  assert.match(result.notice.zh, /按已获取播放次数排序/);
  assert.match(result.notice.zh, /沿用各自统计口径/);
});

test("verified shared recordings retain source counts without inventing a cross-provider total", () => {
  const input = report(
    source("netease", [song("n1", 9), song("n-shared", 7, "studio-v1", ["Pop"])]),
    source("qq", [song("q1", 30), song("q-shared", 20, "studio-v1", ["Rock"])]),
  );
  input.platforms[0].tracks[1].countIsPartial = true;
  const result = unifiedTracks(input);
  assert.equal(result.tracks.length, 3);
  assert.deepEqual(result.tracks.map((track) => track.count), [30, 9, null]);
  const shared = result.tracks[2];
  assert.equal(shared.canonicalId, "studio-v1");
  assert.deepEqual(shared.platforms, ["netease", "qq"]);
  assert.deepEqual(shared.sourceCounts, { netease: 7, qq: 20 });
  assert.equal(shared.count, null);
  assert.equal(shared.countIsPartial, true);
  assert.deepEqual(shared.genres, ["Pop", "Rock"]);
});

test("matching titles and provider IDs do not establish recording identity", () => {
  const input = report(
    source("netease", [{ ...song("123", 5), title: "Song" }, { ...song("studio", 3, "version-studio"), title: "Song" }]),
    source("qq", [{ ...song("123", 9), title: "Song" }, { ...song("live", 7, "version-live"), title: "Song" }]),
  );
  const result = unifiedTracks(input);
  assert.equal(result.tracks.length, 4);
  assert.ok(result.tracks.every((track) => track.platforms.length === 1));
});

test("unknown counts and recent Apple order never turn into monthly play totals or frequent ranks", () => {
  const input = report(
    source("netease", [song("n1", null)]),
    source("apple", [song("recent", 9999)], { rankingPeriod: null, countKind: "unknown" }),
  );
  const result = unifiedTracks(input);
  assert.deepEqual(result.tracks.map((track) => track.id), ["n1"]);
  assert.equal(result.tracks[0].count, null);
  assert.deepEqual(result.tracks[0].sourceCounts, { netease: null });
  input.platforms[0].rankingMatchesPeriod = false;
  assert.deepEqual(unifiedTracks(input).tracks, []);
});

test("duplicate aliases and repeated platform snapshots cannot inflate count totals", () => {
  const input = report(source("netease", [song("a", 4, "recording-a"), song("b", 3, "recording-b")]), source("qq", [song("q", 100)]));
  input.platforms[0].tracks.push({ ...structuredClone(input.platforms[0].tracks[1]), id: "b-alias", rank: 3 });
  input.platforms.push(structuredClone(input.platforms[0]));
  const result = unifiedTracks(input);
  assert.deepEqual(result.tracks.map((track) => track.id), ["q", "a", "b"]);
});

test("700, 44 and 600 plays sort numerically; unknown counts follow known zero counts", () => {
  const input = report(source("netease", [song("700", 700), song("600", 600), song("unknown", null)]), source("qq", [song("44", 44), song("zero", 0)]));
  assert.deepEqual(unifiedTracks(input).tracks.map((track) => track.count), [700, 600, 44, 0, null]);
});

test("equal source counts use source ranks and stable source order as tie breakers", () => {
  const input = report(source("netease", [song("n1", 8), song("n2", 8)]), source("qq", [song("q1", 8), song("q2", 8)]));
  assert.deepEqual(unifiedTracks(input).tracks.map((track) => track.id), ["n1", "q1", "n2", "q2"]);
});

test("partial monthly samples stay visible and retain their lower-bound markers", () => {
  const input = report(source("netease", [song("sample", 5)]));
  input.platforms[0].rankingCoverage = "partial";
  input.platforms[0].tracks[0].countIsPartial = true;
  const result = unifiedTracks(input);
  assert.equal(result.tracks[0].count, 5);
  assert.equal(result.tracks[0].countIsPartial, true);
  assert.match(result.notice.en, /returned ranking samples/);
});

function ranked(id: string, genres: string[], count: number | null = 11, canonicalId?: string): RankedTrack {
  return { ...song(id, count, canonicalId, genres), rank: 1, platforms: ["netease"], countIsPartial: false, sourceCounts: { netease: count }, coverIndex: 0 };
}

test("known genres use equal unique-song weights and disclose excluded unknown songs", () => {
  const tracks = [ranked("pop", ["Pop", "流行"], 10000), ranked("mix", ["Rock", "Jazz"], 12), ranked("unknown", ["Unknown", "未识别", " "] )];
  const result = knownGenreDistribution(tracks);
  assert.equal(result.known, 2);
  assert.equal(result.total, 3);
  assert.equal(result.excluded, 0);
  assert.equal(result.coverage, 2 / 3);
  assert.equal(result.genres.find((genre) => genre.name === "Pop")!.percentage, 50);
  assert.equal(result.genres.find((genre) => genre.name === "Rock")!.percentage, 25);
  assert.equal(result.genres.find((genre) => genre.name === "Jazz")!.percentage, 25);
  assert.ok(result.genres.every((genre) => genre.name !== "Unknown"));
  assert.match(result.notice.en, /equal song weights/);
});

test("genre shares strictly exclude ten or fewer plays and unknown counts, then normalize known qualifying songs", () => {
  const result = knownGenreDistribution([
    ranked("eleven", ["Rock"], 11), ranked("many", ["Pop"], 500), ranked("unclassified", [], 20),
    ranked("ten", ["Jazz"], 10), ranked("one", ["Folk"], 1), ranked("zero", ["Soul"], 0),
    ranked("unknown", ["Electronic"], null), ranked("invalid", ["Metal"], Number.POSITIVE_INFINITY),
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.known, 2);
  assert.equal(result.excluded, 5);
  assert.equal(result.coverage, 2 / 3);
  assert.deepEqual(result.genres.map(genre => [genre.name, genre.percentage]).sort(), [["Pop", 50], ["Rock", 50]]);
  assert.equal(result.genres.reduce((sum, genre) => sum + genre.percentage, 0), 100);
  assert.match(result.notice.zh, /严格大于 10（不含 10）/);
  assert.match(result.notice.zh, /次数未知不参与/);
  assert.match(result.notice.en, /10 is excluded/);
  assert.match(result.notice.en, /unknown counts are excluded/);
  assert.match(result.notice.en, /2 of 3 qualifying songs/);
});

test("genre threshold follows the deduplicated display count without adding repeated or source counts", () => {
  const low = ranked("first", ["Rock"], 6, "same-recording");
  const duplicate = { ...ranked("alias", ["Jazz"], 7, "same-recording"), platforms: ["qq"] as PlatformId[], sourceCounts: { qq: 100 } };
  const high = ranked("high", ["Pop"], 11);
  const unknown = { ...ranked("shared", ["Soul"], null), platforms: ["netease", "qq"] as PlatformId[], sourceCounts: { netease: 50, qq: 60 } };
  const before = structuredClone([low, duplicate, high, unknown]);
  const result = knownGenreDistribution([low, duplicate, high, unknown]);
  assert.equal(result.total, 1);
  assert.equal(result.known, 1);
  assert.equal(result.excluded, 2, "the duplicate recording is excluded once");
  assert.equal(result.genres[0].name, "Pop");
  assert.equal(result.genres[0].percentage, 100);
  assert.deepEqual([low, duplicate, high, unknown], before);
});

test("no qualifying display counts returns an empty chart and keeps the threshold notice", () => {
  const result = knownGenreDistribution([ranked("ten", ["Pop"], 10), ranked("unknown", ["Rock"], null)]);
  assert.equal(result.total, 0);
  assert.equal(result.known, 0);
  assert.equal(result.excluded, 2);
  assert.equal(result.coverage, 0);
  assert.deepEqual(result.genres, []);
  assert.match(result.notice.en, /equal song weights/);
  assert.match(result.notice.en, /no verified genres/);
});

test("genre coverage counts a verified recording once even when tags arrive through two sources", () => {
  const first = ranked("n", ["Pop"], 200, "shared-recording");
  const second = { ...ranked("q", ["Rock"], 5, "shared-recording"), platforms: ["qq"] as PlatformId[] };
  const result = knownGenreDistribution([first, second, ranked("other", [])]);
  assert.equal(result.total, 2);
  assert.equal(result.known, 1);
  assert.deepEqual(result.genres.map((genre) => genre.percentage), [50, 50]);
});

test("all-unknown or empty genres return no invented one-hundred-percent Unknown chart", () => {
  const missing = knownGenreDistribution([ranked("a", []), ranked("b", ["unknown"])]);
  assert.equal(missing.total, 2);
  assert.equal(missing.known, 0);
  assert.equal(missing.coverage, 0);
  assert.deepEqual(missing.genres, []);
  assert.deepEqual(knownGenreDistribution([]).genres, []);
  assert.equal(knownGenreDistribution([]).coverage, 0);
});

test("genre colors remain stable when popularity changes and do not repeat a six-color cycle", () => {
  const first = knownGenreDistribution([ranked("pop", ["Pop"]), ranked("rock1", ["Rock"]), ranked("rock2", ["Rock"])]);
  const second = knownGenreDistribution([ranked("pop1", ["Pop"]), ranked("pop2", ["Pop"]), ranked("rock", ["Rock"])]);
  assert.equal(first.genres.find((genre) => genre.name === "Pop")!.color, second.genres.find((genre) => genre.name === "Pop")!.color);
  const extra = Array.from({ length: 12 }, (_, i) => stableGenreColor(`Genre ${i + 1}`));
  assert.equal(new Set(extra).size, 12);
  assert.equal(stableGenreColor(" R&B "), stableGenreColor("r&b"));
});
