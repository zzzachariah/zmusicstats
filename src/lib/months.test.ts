import assert from "node:assert/strict";
import test from "node:test";
import { buildReport } from "./report.ts";
import type { PlatformInput, ReportInput, TrackInput } from "./report.ts";
import { formatSelectedMonths, mergeMonthlyInputs } from "./months.ts";

function song(id = "song", count: number | null = 10, genres = ["Pop"]): TrackInput {
  return { id, title: "Same title", artist: "Artist", count, genres };
}

function monthly(month: string, overrides: Partial<PlatformInput> = {}): ReportInput {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  const period = { start: `${month}-01`, end: date.toISOString().slice(0, 10), timeZone: "Asia/Shanghai" };
  return {
    mode: "live", period, expectedPlatforms: ["netease"], platforms: [{
      id: "netease", period: { ...period }, listenSeconds: 3600,
      durationKind: "actual-total", coverageComplete: true, tracks: [song()],
      rankingPeriod: { ...period }, countKind: "plays", countDefinition: null,
      rankCoverage: "top", ...overrides,
    }],
  };
}

test("single-month results preserve original data and source ranking order", () => {
  const input = monthly("2026-10", { tracks: [song("low", 2), song("high", 100)] });
  const result = mergeMonthlyInputs([input], ["2026-10"]);
  const expected = buildReport(input);
  for (const platform of result.report.platforms) delete platform.rankingCoverage;
  assert.deepEqual(result.report, expected);
});

test("duplicate selections and replacement snapshots never double monthly totals", () => {
  const first = monthly("2026-09");
  const replacement = monthly("2026-09", { listenSeconds: 7200, tracks: [song("song", 20)] });
  const october = monthly("2026-10", { tracks: [song("song", 30)] });
  const original = structuredClone([first, replacement, october]);
  const result = mergeMonthlyInputs([first, replacement, october], ["2026-10", "2026-09", "2026-09"]);
  assert.equal(result.report.totalSeconds, 10800);
  assert.equal(result.report.platforms[0].tracks[0].count, 50);
  assert.equal(result.report.platforms[0].tracks[0].countIsPartial, false);
  assert.deepEqual(result.selectedMonths, ["2026-09", "2026-10"]);
  assert.deepEqual([first, replacement, october], original);
});

test("missing months retain available ranking samples with lower-bound counts but withhold duration", () => {
  const result = mergeMonthlyInputs([monthly("2026-10")], ["2026-08", "2026-09", "2026-10"]);
  assert.equal(result.report.totalSeconds, null);
  assert.deepEqual(result.report.platformShares, []);
  assert.deepEqual(result.coverage[0].missingMonths, ["2026-08", "2026-09"]);
  assert.deepEqual(result.coverage[0].rankingMonths, ["2026-10"]);
  assert.equal(result.report.platforms[0].rankingMatchesPeriod, true);
  assert.equal(result.report.platforms[0].rankingCoverage, "partial");
  assert.equal(result.report.platforms[0].tracks[0].count, 10);
  assert.equal(result.report.platforms[0].tracks[0].countIsPartial, true);
  assert.ok(result.notices.some((notice) => notice.code === "missing-months" && notice.months.includes("2026-08")));
  assert.match(result.report.rankingNotice.en, /not a complete play total/);
});

test("truncated monthly Tops produce lower bounds; complete empty month is a known zero", () => {
  const september = monthly("2026-09", { tracks: [song("shared", 3), song("only-september", 12)] });
  const october = monthly("2026-10", { tracks: [song("shared", 4)] });
  let result = mergeMonthlyInputs([september, october], ["2026-09", "2026-10"]);
  let tracks = result.report.platforms[0].tracks;
  assert.equal(tracks.find((track) => track.id === "shared")!.count, 7);
  assert.equal(tracks.find((track) => track.id === "shared")!.countIsPartial, false);
  assert.equal(tracks.find((track) => track.id === "only-september")!.countIsPartial, true);
  october.platforms[0].rankCoverage = "complete";
  result = mergeMonthlyInputs([september, october], ["2026-09", "2026-10"]);
  tracks = result.report.platforms[0].tracks;
  assert.equal(tracks.find((track) => track.id === "only-september")!.count, 12);
  assert.equal(tracks.find((track) => track.id === "only-september")!.countIsPartial, false);
});

test("unknown counts, changed definitions and numeric scores are never silently added", () => {
  const september = monthly("2026-09");
  let october = monthly("2026-10", { tracks: [song("song", null)] });
  let result = mergeMonthlyInputs([september, october], ["2026-09", "2026-10"]);
  assert.equal(result.report.platforms[0].tracks[0].count, null);
  assert.equal(result.report.platforms[0].tracks[0].countIsPartial, true);
  october = monthly("2026-10", { countDefinition: "different-counting-rule" });
  result = mergeMonthlyInputs([september, october], ["2026-09", "2026-10"]);
  assert.equal(result.report.platforms[0].tracks[0].count, null);
  assert.equal(result.coverage[0].countComparable, false);
  assert.ok(result.notices.some((notice) => notice.code === "incompatible-counts"));
  october.platforms[0].countKind = "score";
  result = mergeMonthlyInputs([october, monthly("2026-09", { countKind: "score" })], ["2026-09", "2026-10"]);
  assert.equal(result.report.platforms[0].tracks[0].count, null);
  assert.deepEqual(result.report.platforms[0].genres, []);
});

test("missing, daily-average, incomplete and timezone-mismatched time cannot become totals; real zero remains zero", () => {
  for (const override of [
    { listenSeconds: null }, { durationKind: "daily-average" as const }, { coverageComplete: false },
    { period: { start: "2026-10-01", end: "2026-10-31", timeZone: "UTC" } },
    { listenSeconds: Number.NaN }, { listenSeconds: -1 },
  ]) {
    const result = mergeMonthlyInputs([monthly("2026-09"), monthly("2026-10", override)], ["2026-09", "2026-10"]);
    assert.equal(result.report.totalSeconds, null);
    assert.equal(result.coverage[0].durationComplete, false);
  }
  const zero = mergeMonthlyInputs([monthly("2026-09", { listenSeconds: 0 }), monthly("2026-10", { listenSeconds: 0 })], ["2026-09", "2026-10"]);
  assert.equal(zero.report.totalSeconds, 0);
  assert.equal(zero.coverage[0].durationComplete, true);
});

test("Apple recent snapshots are retained once by fetch order and excluded from monthly ranking and genre totals", () => {
  const apple = (month: string, id: string) => {
    const input = monthly(month, { id: "apple", tracks: [song(id, 99)], rankingPeriod: null, countKind: "unknown", listenSeconds: null, durationKind: "unknown", coverageComplete: false });
    input.expectedPlatforms = ["apple"];
    return input;
  };
  // September was fetched after October: use fetch order, never assume report month is snapshot time.
  const result = mergeMonthlyInputs([apple("2026-10", "old"), apple("2026-09", "latest")], ["2026-09", "2026-10"]);
  const platform = result.report.platforms[0];
  assert.equal(platform.tracks.length, 1);
  assert.equal(platform.tracks[0].id, "latest");
  assert.equal(platform.tracks[0].count, null);
  assert.equal(platform.rankingMatchesPeriod, false);
  assert.equal(platform.rankingCoverage, "undated");
  assert.deepEqual(platform.genres, []);
  assert.deepEqual(result.report.tracks, []);
  assert.equal(result.report.totalSeconds, null);
});

test("discontiguous month labels list exactly selected months, including across years", () => {
  const result = mergeMonthlyInputs([monthly("2025-12"), monthly("2026-02")], ["2026-02", "2025-12"]);
  assert.equal(result.hasGaps, true);
  assert.equal(result.periodLabel.zh, "2025 年 12 月；2026 年 2 月");
  assert.equal(result.periodLabel.en, "Dec 2025; Feb 2026");
  assert.equal(result.report.totalSeconds, 7200);
  assert.doesNotMatch(result.report.periodLabel.en, /Jan/);
  assert.deepEqual(formatSelectedMonths(["2026-01", "2026-03"]), { zh: "2026 年 1 月；2026 年 3 月", en: "Jan 2026; Mar 2026" });
});

test("same titles with unverified identities stay separate and recording versions remain distinct", () => {
  const result = mergeMonthlyInputs([
    monthly("2026-09", { tracks: [song("version-a", 3)] }),
    monthly("2026-10", { tracks: [song("version-b", 4)] }),
  ], ["2026-09", "2026-10"]);
  assert.equal(result.report.platforms[0].tracks.length, 2);
  assert.ok(result.report.platforms[0].tracks.every((track) => track.countIsPartial));
});

test("partial monthly counts propagate into verified combined cross-platform rankings", () => {
  const september = monthly("2026-09", { countDefinition: "verified", tracks: [{ ...song("n", 10), canonicalId: "recording" }] });
  const october = monthly("2026-10", { countDefinition: "verified", tracks: [] });
  for (const input of [september, october]) {
    input.expectedPlatforms = ["netease", "qq"];
    input.platforms.push({ ...structuredClone(input.platforms[0]), id: "qq", tracks: [{ ...song("q", 5), canonicalId: "recording" }] });
  }
  const result = mergeMonthlyInputs([september, october], ["2026-09", "2026-10"]);
  assert.equal(result.report.rankingMode, "combined");
  assert.equal(result.report.tracks[0].count, 20);
  assert.equal(result.report.tracks[0].countIsPartial, true);
  assert.deepEqual(result.report.tracks[0].sourceCounts, { netease: 10, qq: 10 });
});

test("genre weights preserve per-month source tags instead of applying their union to the total", () => {
  const result = mergeMonthlyInputs([
    monthly("2026-09", { tracks: [song("song", 10, ["Pop"])] }),
    monthly("2026-10", { tracks: [song("song", 30, ["Jazz"])] }),
  ], ["2026-09", "2026-10"]);
  assert.equal(result.report.platforms[0].genres.find((genre) => genre.name === "Jazz")!.percentage, 75);
});

test("empty or invalid selection, mixed demo/live and mixed time zones cannot silently aggregate", () => {
  assert.throws(() => mergeMonthlyInputs([], []), /EMPTY_SELECTION/);
  assert.throws(() => mergeMonthlyInputs([], ["2026-13"]), /INVALID_MONTH/);
  const september = monthly("2026-09");
  const october = monthly("2026-10");
  october.mode = "demo";
  assert.throws(() => mergeMonthlyInputs([september, october], ["2026-09", "2026-10"]), /MIXED_MODES/);
  october.mode = "live";
  october.period.timeZone = "UTC";
  assert.throws(() => mergeMonthlyInputs([september, october], ["2026-09", "2026-10"]), /MIXED_TIME_ZONES/);
  const empty = mergeMonthlyInputs([], ["2026-10"]);
  assert.equal(empty.report.totalSeconds, null);
  assert.deepEqual(empty.report.tracks, []);
  assert.ok(empty.notices.some((notice) => notice.code === "missing-months"));
});

test("duplicate provider entries do not duplicate duration or rankings", () => {
  const september = monthly("2026-09");
  september.platforms.push(structuredClone(september.platforms[0]));
  const result = mergeMonthlyInputs([september, monthly("2026-10")], ["2026-09", "2026-10"]);
  assert.equal(result.report.totalSeconds, null);
  assert.equal(result.report.platforms[0].tracks[0].count, 10);
  assert.equal(result.report.platforms[0].tracks[0].countIsPartial, true);
  assert.ok(result.notices.some((notice) => notice.code === "duplicate-platform"));
});


test("month labels compress runs without filling gaps", () => {
  assert.deepEqual(formatSelectedMonths(["2026-04","2026-02","2026-01","2026-02"]), {zh:"2026 年 1 月—2 月；2026 年 4 月",en:"Jan–Feb 2026; Apr 2026"});
  assert.deepEqual(formatSelectedMonths(["2025-12","2026-01","2026-02"]), {zh:"2025 年 12 月—2026 年 2 月",en:"Dec 2025–Feb 2026"});
});
