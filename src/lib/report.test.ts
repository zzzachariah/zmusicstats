import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReport,
  calculateGenres,
  formatDuration,
  samePeriod,
  validPeriod,
} from "./report.ts";
import type { ReportInput } from "./report.ts";
import { getDemoInput, getDemoReport } from "./demo-data.ts";

const approx = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.000001);

// Retain focused two-platform regressions alongside explicit three-platform cases.
function getTwoPlatformInput(): ReportInput {
  const input = getDemoInput();
  input.platforms = input.platforms.filter(
    (platform) => platform.id !== "apple",
  );
  input.expectedPlatforms = ["netease", "qq"];
  return input;
}

test("matching actual totals give meaningful shares without losing fractional hours", () => {
  const report = buildReport(getTwoPlatformInput());
  assert.equal(report.durationComparable, true);
  assert.equal(report.totalSeconds, 357120);
  assert.equal(report.totalHours, 99.2);
  approx(
    report.platformShares.reduce(
      (sum, platform) => sum + platform.percentage,
      0,
    ),
    100,
  );
  assert.equal(report.mode, "demo");
});

test("unknown duration is not counted as zero and blocks the cross-platform total", () => {
  const input = getTwoPlatformInput();
  input.platforms[1].listenSeconds = null;
  const report = buildReport(input);
  assert.equal(report.totalSeconds, null);
  assert.equal(report.durationComparable, false);
  assert.deepEqual(report.platformShares, []);
  assert.equal(report.platforms[0].listenSeconds, 218520);
  assert.equal(report.platforms[1].listenSeconds, null);
});

test("a real zero remains zero and can coexist with another valid total", () => {
  const input = getTwoPlatformInput();
  input.platforms[1].listenSeconds = 0;
  const report = buildReport(input);
  assert.equal(report.durationComparable, true);
  assert.equal(report.platformShares[1].percentage, 0);
  assert.equal(report.platforms[1].hours, 0);
  input.platforms[0].listenSeconds = 0;
  const silent = buildReport(input);
  assert.equal(silent.totalSeconds, 0);
  assert.equal(silent.durationComparable, false);
  assert.deepEqual(silent.platformShares, []);
});

test("daily averages, incomplete ranges and mismatched time zones cannot become total hours", () => {
  for (const modify of [
    (input: ReportInput) => {
      input.platforms[1].durationKind = "daily-average";
    },
    (input: ReportInput) => {
      input.platforms[1].coverageComplete = false;
    },
    (input: ReportInput) => {
      input.platforms[1].period.start = "2026-10-02";
    },
    (input: ReportInput) => {
      input.platforms[1].period.timeZone = "UTC";
    },
    (input: ReportInput) => {
      input.platforms[1].listenSeconds = Number.NaN;
    },
    (input: ReportInput) => {
      input.platforms[1].listenSeconds = -10;
    },
  ]) {
    const input = getTwoPlatformInput();
    modify(input);
    const report = buildReport(input);
    assert.equal(report.totalSeconds, null);
    assert.equal(report.durationComparable, false);
  }
});

test("missing or duplicated platforms cannot silently create a 100 percent share", () => {
  const missing = getTwoPlatformInput();
  missing.platforms.pop();
  assert.equal(buildReport(missing).totalSeconds, null);
  const duplicate = getTwoPlatformInput();
  duplicate.platforms.push(duplicate.platforms[0]);
  assert.equal(buildReport(duplicate).durationComparable, false);
});

test("only verified identical recordings have their comparable play counts combined", () => {
  const report = buildReport(getTwoPlatformInput());
  assert.equal(report.rankingMode, "combined");
  const song = report.tracks.find((track) => track.title === "Love Song")!;
  assert.equal(song.count, 128);
  assert.deepEqual(song.platforms, ["netease", "qq"]);
  assert.equal(song.countIsPartial, false);
  assert.equal(
    report.tracks.find((track) => track.title === "飞机场的10:30")!
      .countIsPartial,
    true,
  );
  assert.match(report.rankingNotice.en, /not a complete/);
});

test("title matches do not merge unidentified songs or different recording versions", () => {
  const input = getTwoPlatformInput();
  const song = input.platforms[1].tracks[0];
  song.canonicalId = "demo:lovesong:live";
  const differentVersion = buildReport(input);
  assert.equal(
    differentVersion.tracks.filter((track) => track.title === "Love Song")
      .length,
    2,
  );
  delete input.platforms[0].tracks[0].canonicalId;
  delete song.canonicalId;
  assert.equal(
    buildReport(input).tracks.filter((track) => track.title === "Love Song")
      .length,
    2,
  );
});

test("unknown count definition keeps rankings and genres separate but still identifies shared songs", () => {
  const input = getTwoPlatformInput();
  input.platforms[1].countDefinition = null;
  const report = buildReport(input);
  assert.equal(report.rankingMode, "separate");
  assert.deepEqual(report.tracks, []);
  assert.deepEqual(report.genres, []);
  assert.ok(report.platforms.every((platform) => platform.tracks.length > 0));
  assert.ok(report.platforms.every((platform) => platform.genres.length > 0));
  assert.ok(report.overlappingTracks.length > 0);
  assert.ok(report.overlappingTracks.every((track) => track.count === null));
});

test("lifetime and monthly ranking inputs are never represented as one monthly genre report", () => {
  const input = getTwoPlatformInput();
  input.platforms[1].rankingPeriod = null;
  const report = buildReport(input);
  assert.equal(report.rankingMode, "separate");
  assert.deepEqual(report.platforms[1].genres, []);
  assert.deepEqual(report.overlappingTracks, []);
});

test("scores and absent play counts are not displayed as play counts", () => {
  const input = getTwoPlatformInput();
  input.platforms[0].countKind = "score";
  input.platforms[1].tracks[0].count = null;
  const report = buildReport(input);
  assert.equal(report.rankingMode, "separate");
  assert.ok(report.platforms[0].tracks.every((track) => track.count === null));
  assert.deepEqual(report.platforms[0].genres, []);
});

test("multi-genre play weights split equally, duplicate tags do not double count, unknown remains visible", () => {
  const genres = calculateGenres([
    { count: 100, genres: ["R&B", "Soul", "R&B"] },
    { count: 50, genres: [] },
    { count: 0, genres: ["Pop"] },
    { count: null, genres: ["Jazz"] },
  ]);
  assert.equal(genres.length, 3);
  assert.equal(
    genres.reduce((sum, genre) => sum + genre.weight, 0),
    150,
  );
  for (const genre of genres) approx(genre.percentage, 100 / 3);
  assert.equal(
    genres.find((genre) => genre.name === "Unknown")!.nameZh,
    "未识别",
  );
});

test("different platforms keep their own genre weights instead of multiplying unioned tags", () => {
  const input = getTwoPlatformInput();
  input.platforms[0].tracks = [
    {
      id: "a",
      canonicalId: "recording",
      title: "Song",
      artist: "Artist",
      count: 90,
      genres: ["R&B"],
    },
  ];
  input.platforms[1].tracks = [
    {
      id: "b",
      canonicalId: "recording",
      title: "Song",
      artist: "Artist",
      count: 10,
      genres: ["Pop"],
    },
  ];
  const report = buildReport(input);
  assert.equal(report.tracks.length, 1);
  assert.equal(report.tracks[0].count, 100);
  assert.equal(
    report.genres.find((genre) => genre.name === "R&B")!.percentage,
    90,
  );
  assert.equal(
    report.genres.find((genre) => genre.name === "Pop")!.percentage,
    10,
  );
});

test("demo switching returns independent data and bilingual labels without invoking a model", () => {
  const october = getDemoReport("2026-10");
  const september = getDemoReport("2026-09");
  assert.notEqual(october.totalSeconds, september.totalSeconds);
  assert.equal(october.periodLabel.en, "October 2026");
  assert.equal(september.periodLabel.zh, "2026 年 9 月");
  assert.ok(
    october.insights.every(
      (insight) =>
        insight.title.en &&
        insight.title.zh &&
        insight.body.en &&
        insight.body.zh,
    ),
  );
  const changed = getTwoPlatformInput();
  changed.platforms[0].tracks[0].genres.push("Changed");
  assert.ok(
    !getTwoPlatformInput().platforms[0].tracks[0].genres.includes("Changed"),
  );
});

test("invalid calendar dates and unconfirmed totals are not formatted as facts", () => {
  assert.equal(
    validPeriod({
      start: "2026-02-30",
      end: "2026-03-01",
      timeZone: "Asia/Shanghai",
    }),
    false,
  );
  assert.equal(samePeriod(null, getTwoPlatformInput().period), false);
  assert.equal(formatDuration(null), "暂无数据");
  assert.equal(formatDuration(3600, "en"), "1 h 0 min");
  assert.equal(formatDuration(3660), "1 小时 1 分钟");
  assert.equal(
    validPeriod({
      start: "2026-10-01",
      end: "2026-10-31",
      timeZone: "Unknown/Zone",
    }),
    false,
  );
});

test("duplicate aliases for the same recording on one platform never double its plays or pretend to overlap", () => {
  const input = getTwoPlatformInput();
  input.platforms[1].tracks = [];
  input.platforms[0].tracks = [
    {
      id: "one",
      canonicalId: "recording",
      title: "Song",
      artist: "Artist",
      count: 40,
      genres: ["Pop"],
    },
    {
      id: "alias",
      canonicalId: "recording",
      title: "Song",
      artist: "Artist",
      count: 40,
      genres: ["Pop"],
    },
  ];
  const report = buildReport(input);
  assert.equal(report.tracks.length, 1);
  assert.equal(report.tracks[0].count, 40);
  assert.deepEqual(report.overlappingTracks, []);
});

test("equivalent Chinese and English tags combine without inventing a genre for unrecognized labels", () => {
  const genres = calculateGenres([
    { count: 20, genres: ["流行"] },
    { count: 20, genres: ["Pop"] },
    { count: 10, genres: ["Dream Pop"] },
  ]);
  assert.equal(genres.length, 2);
  assert.equal(genres.find((genre) => genre.name === "Pop")!.percentage, 80);
  assert.equal(
    genres.find((genre) => genre.name === "Dream Pop")!.percentage,
    20,
  );
});

test("three demo platforms share the same month and their percentages sum to 100", () => {
  const october = getDemoReport("2026-10");
  const september = getDemoReport("2026-09");
  assert.equal(october.mode, "demo");
  assert.deepEqual(
    october.platformShares.map((platform) => platform.id),
    ["netease", "qq", "apple"],
  );
  assert.equal(october.totalSeconds, 455040);
  assert.equal(october.totalHours, 126.4);
  assert.equal(september.totalHours, 124);
  approx(
    october.platformShares.reduce(
      (sum, platform) => sum + platform.percentage,
      0,
    ),
    100,
  );
  approx(
    september.platformShares.reduce(
      (sum, platform) => sum + platform.percentage,
      0,
    ),
    100,
  );
  const apple = october.platformShares.find(
    (platform) => platform.id === "apple",
  )!;
  assert.equal(apple.name, "Apple Music");
  assert.equal(apple.hours, 27.2);
  assert.equal(apple.color, "#C6AC7D");
  const favorite = october.tracks.find((track) => track.title === "Love Song")!;
  assert.equal(favorite.count, 152);
  assert.deepEqual(favorite.platforms, ["netease", "qq", "apple"]);
  assert.equal(favorite.countIsPartial, false);
  assert.match(
    october.insights.find((insight) => insight.id === "home-platform")!.body.zh,
    /3 个平台/,
  );
});

test("unknown actual Apple duration blocks a full live total instead of fabricating an Apple share", () => {
  const input = getDemoInput();
  input.mode = "live";
  const apple = input.platforms.find((platform) => platform.id === "apple")!;
  apple.listenSeconds = null;
  apple.durationKind = "unknown";
  apple.coverageComplete = false;
  const report = buildReport(input);
  assert.equal(report.mode, "live");
  assert.equal(report.totalSeconds, null);
  assert.equal(report.durationComparable, false);
  assert.deepEqual(report.platformShares, []);
  assert.equal(
    report.platforms.find((platform) => platform.id === "apple")!.hours,
    null,
  );
  assert.equal(
    report.platforms.find((platform) => platform.id === "netease")!.hours,
    60.7,
  );
});

test("Apple with a different reporting month blocks combined time and ranking calculations", () => {
  const input = getDemoInput();
  const apple = input.platforms.find((platform) => platform.id === "apple")!;
  apple.period = {
    start: "2026-09-01",
    end: "2026-09-30",
    timeZone: "Asia/Shanghai",
  };
  apple.rankingPeriod = { ...apple.period };
  const report = buildReport(input);
  assert.equal(report.totalSeconds, null);
  assert.equal(report.rankingMode, "separate");
  assert.deepEqual(report.genres, []);
  assert.deepEqual(
    report.platforms.find((platform) => platform.id === "apple")!.genres,
    [],
  );
});
