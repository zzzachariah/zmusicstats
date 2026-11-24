import test from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "./report.ts";
import type { PlatformId, PlatformInput, TrackInput } from "./report.ts";
import { crossPlatformMatches } from "./cross-platform.ts";

const period = { start: "2026-10-01", end: "2026-10-31", timeZone: "Asia/Shanghai" };
const song = (id: string, title: string, artist: string, extra: Partial<TrackInput> = {}): TrackInput => ({ id, title, artist, count: 12, genres: [], ...extra });
const source = (id: PlatformId, tracks: TrackInput[], extra: Partial<PlatformInput> = {}): PlatformInput => ({ id, tracks, period, rankingPeriod: period, listenSeconds: null, durationKind: "unknown", coverageComplete: false, countKind: "plays", countDefinition: null, rankCoverage: "top", ...extra });
const report = (...platforms: PlatformInput[]) => buildReport({ mode: "live", period, platforms });

test("exact titles ignore case, Unicode width, whitespace and punctuation", () => {
  const input = report(source("netease", [song("n", "ＬＯＶＥ—ＳＯＮＧ!", "Artist")]), source("qq", [song("q", "love song", "artist")]));
  const result = crossPlatformMatches(input);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].platforms, ["netease", "qq"]);
});

test("different artwork and albums never prevent a same-title match; metadata is retained", () => {
  const input = report(
    source("netease", [song("n", "红豆", "王菲", { album: "Album A", artworkUrl: "https://example.com/a.jpg", count: 700, genres: ["Pop"] })]),
    source("qq", [song("q", "红豆", "王菲", { album: "Album B", artworkUrl: "https://example.com/b.jpg", count: 44, genres: ["Soul"], durationSeconds: 256 })]),
  );
  const before = structuredClone(input);
  const match = crossPlatformMatches(input)[0];
  assert.equal(match.count, null);
  assert.deepEqual(match.sourceCounts, { netease: 700, qq: 44 });
  assert.equal(match.artworkUrl, "https://example.com/a.jpg");
  assert.equal(match.durationSeconds, 256);
  assert.deepEqual(match.genres, ["Pop", "Soul"]);
  assert.equal(match.canonicalId, undefined);
  assert.deepEqual(input, before);
});

test("a title-only match is allowed even when credited artists differ", () => {
  const result = crossPlatformMatches(report(source("netease", [song("n", "Hello", "Adele")]), source("qq", [song("q", "HELLO", "Lionel Richie")])));
  assert.equal(result.length, 1);
  assert.equal(result[0].canonicalId, undefined);
});

test("similar titles can match when similar artist names support them", () => {
  const result = crossPlatformMatches(report(source("netease", [song("n", "Love Songs", "Taylor Swift")]), source("qq", [song("q", "Love Song", "Taylor Swfit")])));
  assert.equal(result.length, 1);
});

test("a central typing swap in a six-letter title remains a candidate with artist support", () => {
  const result = crossPlatformMatches(report(source("netease", [song("n", "abcdef", "Singer")]), source("qq", [song("q", "abdcef", "Singer")])));
  assert.equal(result.length, 1);
});

test("recognized edition labels support short Chinese titles with matching artists", () => {
  const result = crossPlatformMatches(report(source("netease", [song("n", "晴天", "周杰伦")]), source("qq", [song("q", "晴天（Live）", "周杰伦 / 现场乐队")])));
  assert.equal(result.length, 1);
});

test("different songs, short substrings and unsupported fuzzy artists do not match", () => {
  const input = report(
    source("netease", [song("n1", "爱", "Artist"), song("n2", "晴天", "Artist"), song("n3", "Love Song", "Artist A"), song("n4", "Yesterday", "Band")]),
    source("qq", [song("q1", "爱情转移", "Artist"), song("q2", "晴天雨天", "Artist"), song("q3", "Love Songs", "Entirely Different"), song("q4", "Tomorrow", "Band")]),
  );
  assert.deepEqual(crossPlatformMatches(input), []);
});

test("same-provider repeats do not become cross-platform matches", () => {
  const input = report(source("netease", [song("n1", "Red", "A"), song("n2", "RED", "B")]));
  input.platforms.push(structuredClone(input.platforms[0]));
  assert.deepEqual(crossPlatformMatches(input), []);
});

test("artist-supported exact matches win ambiguous duplicate titles without adding aliases", () => {
  const input = report(source("netease", [song("n-other", "Hello", "Lionel Richie"), song("n-adele", "Hello", "Adele", { count: 90 })]), source("qq", [song("q", "Hello", "Adele", { count: 60 })]));
  const result = crossPlatformMatches(input);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sourceCounts, { qq: 60, netease: 90 });
  assert.equal(result[0].platforms.length, 2);
});

test("three providers form one match and enrich missing artwork without inventing listening time", () => {
  const input = report(
    source("netease", [song("n", "A Common Song", "Singer", { count: 10, listenSeconds: 100 })]),
    source("qq", [song("q", "a common song", "Singer", { count: 20, artworkUrl: "https://example.com/q.jpg" })]),
    source("apple", [song("a", "A COMMON SONG", "Singer", { count: null, durationSeconds: 220 })]),
  );
  const match = crossPlatformMatches(input)[0];
  assert.equal(match.platforms.length, 3);
  assert.deepEqual(match.sourceCounts, { netease: 10, qq: 20, apple: null });
  assert.equal(match.count, null);
  assert.equal(match.listenSeconds, undefined);
  assert.equal(match.durationSeconds, 220);
  assert.equal(match.artworkUrl, "https://example.com/q.jpg");
});

test("undated Apple recents are not presented as favourites shared within the selected month", () => {
  const input = report(source("netease", [song("n", "Same Song", "Singer")]), source("apple", [song("a", "Same Song", "Singer")], { rankingPeriod: null }));
  assert.deepEqual(crossPlatformMatches(input), []);
});

test("existing verified recording matches survive differently localized titles", () => {
  const input = report(source("netease", [song("n", "One Title", "Singer", { canonicalId: "verified:v1" })]), source("qq", [song("q", "另一种标题", "Singer", { canonicalId: "verified:v1" })]));
  const result = crossPlatformMatches(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].canonicalId, "verified:v1");
});

test("fuzzy chains cannot pull two mutually different titles into a three-way group", () => {
  const input = report(source("netease", [song("n", "aaaaaaaaaaaa", "Singer")]), source("qq", [song("q", "bbaaaaaaaaaa", "Singer")]), source("apple", [song("a", "bbbbaaaaaaaa", "Singer")]));
  const result = crossPlatformMatches(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].platforms.length, 2);
});

test("punctuation-only titles never match and empty reports stay empty", () => {
  assert.deepEqual(crossPlatformMatches(report(source("netease", [song("n", "…", "Singer")]), source("qq", [song("q", "!", "Singer")]))), []);
  assert.deepEqual(crossPlatformMatches(report()), []);
});
