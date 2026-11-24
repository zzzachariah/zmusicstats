import assert from "node:assert/strict";
import test from "node:test";
import { calculateGenreListeningTimes, getTimeMetaphors, listeningTimeInUnit, resolvePlatformListeningTime, resolveReportListeningTime, resolveTrackListeningTime, selectTimeMetaphor } from "./listening-time.ts";
import type { PlatformReport, RankedTrack } from "./report.ts";

const approx = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const track = (count: number | null, durationSeconds?: number, listenSeconds?: number): RankedTrack => ({
  id: "test", title: "Test", artist: "Artist", count, durationSeconds, listenSeconds, genres: ["Pop"], rank: 1,
  platforms: ["netease"], countIsPartial: false, sourceCounts: {}, coverIndex: 0,
});
const platform = (id: PlatformReport["id"], values: Partial<PlatformReport> = {}): PlatformReport => ({
  id, name: id, nameEn: id, color: "#000", listenSeconds: null, hours: null, durationAvailable: false,
  rankingMatchesPeriod: true, rankingCoverage: "complete", tracks: [], genres: [], genreScope: { zh: "", en: "" }, ...values,
});

test("actual track time, including zero, takes precedence over a longer play-count estimate", () => {
  assert.equal(resolveTrackListeningTime(track(50, 240, 123)).seconds, 123);
  assert.equal(resolveTrackListeningTime(track(50, 240, 123)).kind, "actual");
  assert.equal(resolveTrackListeningTime(track(50, 240, 0)).seconds, 0);
  assert.equal(resolveTrackListeningTime({ ...track(50, 240, 123), countIsPartial: true }).partial, true);
});

test("play counts times recording length are explicitly estimated and partial flags survive", () => {
  const value = resolveTrackListeningTime({ ...track(30, 234.5), countIsPartial: true });
  assert.equal(value.seconds, 7035);
  assert.equal(value.kind, "estimated");
  assert.equal(value.partial, true);
  assert.match(value.notice.en, /skips|Skips/);
});

test("missing, zero-product, negative and nonfinite inputs cannot fabricate listening time", () => {
  for (const input of [track(null, 240), track(12), track(0, 240), track(-1, 240), track(12, 0),
    track(12, -1), track(Infinity, 240), track(12, NaN), track(null, undefined, Infinity), track(Number.MAX_VALUE, 2)]) {
    const value = resolveTrackListeningTime(input);
    assert.equal(value.seconds, null);
    assert.equal(value.kind, "unknown");
    assert.equal(value.missingTracks, 1);
  }
  assert.equal(resolveTrackListeningTime(track(2, 200, NaN)).seconds, 400);
});

test("genre time divides fractional seconds across normalized known tags and excludes unknown time", () => {
  const rows = calculateGenreListeningTimes([
    { count: 2, durationSeconds: 100.5, genres: ["Pop", "流行", " pop ", "Jazz", "Jazz"] },
    { count: null, listenSeconds: 99, genres: [] },
  ]);
  assert.equal(rows.length, 2);
  approx(rows.reduce((sum, row) => sum + row.seconds!, 0), 201);
  approx(rows.find((row) => row.name === "Pop")!.seconds!, 100.5);
  approx(rows.find((row) => row.name === "Jazz")!.seconds!, 100.5);
  assert.equal(rows.find((row) => row.name === "Unknown"), undefined);
  approx(rows.reduce((sum, row) => sum + row.percentage, 0), 100);
});

test("Unknown never dilutes known-genre percentages or consumes a known track's allocated time", () => {
  const rows = calculateGenreListeningTimes([
    { count: null, listenSeconds: 100, genres: ["Pop", "Unknown", "未识别"] },
    { count: null, listenSeconds: 100, genres: [] },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Pop");
  assert.equal(rows[0].seconds, 100);
  assert.equal(rows[0].percentage, 100);
  assert.deepEqual(calculateGenreListeningTimes([{ count: 20, durationSeconds: 200, genres: ["Unknown"] }]), []);
});

test("unknown genre durations remain null while partially covered groups retain a warning", () => {
  const rows = calculateGenreListeningTimes([
    { count: null, genres: ["Pop"] },
    { count: 2, durationSeconds: 100, genres: ["Jazz"] },
    { count: null, genres: ["Jazz"] },
  ]);
  const pop = rows.find((row) => row.name === "Pop")!;
  assert.equal(pop.seconds, null);
  assert.equal(pop.kind, "unknown");
  const jazz = rows.find((row) => row.name === "Jazz")!;
  assert.equal(jazz.seconds, 200);
  assert.equal(jazz.missingTracks, 1);
  assert.equal(jazz.partial, true);
  assert.match(jazz.notice.en, /sample/);
});

test("platform actual totals cannot be overwritten by sample estimates, including an actual zero", () => {
  const platform = { listenSeconds: 100, durationAvailable: true, rankingMatchesPeriod: true, tracks: [track(100, 300)] };
  const actual = resolvePlatformListeningTime(platform);
  assert.equal(actual.seconds, 100);
  assert.equal(actual.scope, "platform");
  assert.equal(actual.partial, false);
  assert.equal(resolvePlatformListeningTime({ ...platform, listenSeconds: 0 }).seconds, 0);
  const sample = resolvePlatformListeningTime({ ...platform, durationAvailable: false });
  assert.equal(sample.seconds, 30_000);
  assert.equal(sample.scope, "platform-sample");
  assert.equal(sample.kind, "estimated");
  assert.equal(sample.partial, true);
  assert.match(sample.notice.en, /not the platform total/);
});

test("empty or wholly unknown samples stay unavailable; mixed samples expose missing tracks", () => {
  const base = { listenSeconds: null, durationAvailable: false, rankingMatchesPeriod: true };
  assert.equal(resolvePlatformListeningTime({ ...base, tracks: [] }).seconds, null);
  assert.equal(resolvePlatformListeningTime({ ...base, tracks: [track(null)] }).seconds, null);
  const partial = resolvePlatformListeningTime({ ...base, tracks: [track(2, 120), track(null)] });
  assert.equal(partial.seconds, 240);
  assert.equal(partial.knownTracks, 1);
  assert.equal(partial.missingTracks, 1);
});

test("sample estimates require confirmed ranking dates; an independently verified total still wins", () => {
  const base = { listenSeconds: null, durationAvailable: false, tracks: [track(20, 240)] };
  for (const eligibility of [
    {}, { rankingMatchesPeriod: false }, { rankingMatchesPeriod: true, rankingCoverage: "undated" as const },
  ]) {
    const result = resolvePlatformListeningTime({ ...base, ...eligibility });
    assert.equal(result.seconds, null);
    assert.equal(result.kind, "unknown");
    assert.match(result.notice.en, /dates are unconfirmed/);
  }
  const partial = resolvePlatformListeningTime({ ...base, rankingMatchesPeriod: true, rankingCoverage: "partial" });
  assert.equal(partial.seconds, 4800);
  assert.equal(partial.partial, true);
  const actual = resolvePlatformListeningTime({ ...base, durationAvailable: true, listenSeconds: 123, rankingMatchesPeriod: false });
  assert.equal(actual.seconds, 123);
  assert.equal(actual.kind, "actual");
});

test("report time adds reported totals to eligible sample estimates without adding their tracks twice", () => {
  const report = { platforms: [
    platform("netease", { durationAvailable: true, listenSeconds: 1000, tracks: [track(99, 200)] }),
    platform("qq", { tracks: [track(2, 120), track(null)], rankingCoverage: "partial" }),
  ] };
  const total = resolveReportListeningTime(report);
  assert.equal(total.seconds, 1240);
  assert.equal(total.kind, "estimated");
  assert.equal(total.scope, "report");
  assert.equal(total.partial, true);
  assert.equal(total.actualPlatformCount, 1);
  assert.equal(total.samplePlatformCount, 1);
  assert.equal(total.estimatedPlatformCount, 1);
  assert.equal(total.knownPlatformCount, 2);
  assert.equal(total.missingPlatformCount, 0);
  assert.equal(total.missingTracks, 1);
  assert.match(total.notice.en, /not a complete total/);
});

test("report time excludes undated samples and exposes absent or unavailable platforms", () => {
  const total = resolveReportListeningTime({
    expectedPlatforms: ["netease", "qq", "apple"],
    platforms: [platform("netease", { durationAvailable: true, listenSeconds: 100 }),
      platform("apple", { rankingMatchesPeriod: false, rankingCoverage: "undated", tracks: [track(10, 300)] })],
  });
  assert.equal(total.seconds, 100);
  assert.equal(total.kind, "actual");
  assert.equal(total.partial, true);
  assert.equal(total.missingPlatformCount, 2);
  assert.deepEqual(new Set(total.missingPlatformIds), new Set(["qq", "apple"]));
  assert.equal(total.samplePlatformCount, 0);
  assert.match(total.notice.en, /lack time data/);
});

test("each provider contributes once and a later actual total replaces its sample", () => {
  const actual = platform("qq", { durationAvailable: true, listenSeconds: 600, tracks: [track(50, 300)] });
  const sample = platform("qq", { tracks: [track(2, 120)] });
  for (const platforms of [[sample, actual, actual], [actual, sample, actual]]) {
    const total = resolveReportListeningTime({ platforms });
    assert.equal(total.seconds, 600);
    assert.equal(total.kind, "actual");
    assert.equal(total.partial, false);
    assert.equal(total.actualPlatformCount, 1);
    assert.equal(total.knownPlatformCount, 1);
  }
});

test("report totals preserve verified zero and reject unavailable or overflowing aggregates", () => {
  const zero = resolveReportListeningTime({ platforms: [platform("netease", { durationAvailable: true, listenSeconds: 0 })] });
  assert.equal(zero.seconds, 0);
  assert.equal(zero.kind, "actual");
  assert.equal(zero.partial, false);
  for (const platforms of [[], [platform("qq")], [
    platform("netease", { durationAvailable: true, listenSeconds: Number.MAX_VALUE }),
    platform("qq", { durationAvailable: true, listenSeconds: Number.MAX_VALUE }),
  ]]) {
    const total = resolveReportListeningTime({ platforms });
    assert.equal(total.seconds, null);
    assert.equal(total.kind, "unknown");
    assert.equal(total.partial, true);
  }
});

test("basic display units use fixed 30-day months and 365-day years without calendar arithmetic", () => {
  assert.equal(listeningTimeInUnit(3600, "hours"), 1);
  assert.equal(listeningTimeInUnit(86_400, "days"), 1);
  assert.equal(listeningTimeInUnit(30 * 86_400, "months"), 1);
  assert.equal(listeningTimeInUnit(365 * 86_400, "years"), 1);
  approx(listeningTimeInUnit(365 * 86_400, "months")!, 365 / 30);
  assert.equal(listeningTimeInUnit(0, "years"), 0);
  assert.equal(listeningTimeInUnit(-1, "hours"), null);
  assert.equal(listeningTimeInUnit(NaN, "days"), null);
  assert.equal(listeningTimeInUnit(Infinity, "months"), null);
});

test("space facts have traceable sources and arithmetic uses the stated time constants", () => {
  const light = getTimeMetaphors(499.004783836 * 5, "sun").find((entry) => entry.id === "sunlight")!;
  approx(light.value, 5);
  assert.equal(light.source?.url, "https://ssd.jpl.nasa.gov/astro_par.html");
  const orbit = getTimeMetaphors(365.25 * 86400, "earth").find((entry) => entry.id === "earth-orbit")!;
  approx(orbit.value, 360);
  const lunar = getTimeMetaphors(29.5 * 86400, "moon").find((entry) => entry.id === "moon-phase")!;
  approx(lunar.value, 1);
});

test("animal rhythms use species-specific sourced rates and do not imply uninterrupted flight", () => {
  const bird = getTimeMetaphors(1_000_000 / 53, "bird").find(entry => entry.id === "hummingbird-wings")!;
  const bee = getTimeMetaphors(1_000_000 / 230, "bee").find(entry => entry.id === "honeybee-wings")!;
  for (const value of [bird, bee]) {
    approx(value.value, 1);
    assert.equal(value.unit.en, "million wingbeats");
    assert.equal(value.basis, "fact");
    assert.match(value.assumption.en, /not continuous flight/);
  }
  assert.match(bird.text.en, /ruby-throated hummingbird/);
  assert.equal(new URL(bird.source!.url).hostname, "www.allaboutbirds.org");
  assert.match(bee.text.en, /hovering honeybee/);
  assert.equal(new URL(bee.source!.url).hostname, "www.caltech.edu");
});

test("travel, waves and reading use their stated assumptions with correct dimensions", () => {
  const choices = getTimeMetaphors(3600, "assumptions");
  for (const [id, expected] of [
    ["train-window", 250], ["bicycle-ride", 15], ["ferry-window", 20],
    ["turn-pages", 40], ["shore-waves", 450], ["postcards", 7.5],
  ] as const) {
    const entry = choices.find(value => value.id === id)!;
    approx(entry.value, expected);
    assert.equal(entry.basis, "assumption");
    assert.equal(entry.source, undefined);
  }
  assert.match(choices.find(entry => entry.id === "shore-waves")!.assumption.en, /real periods vary/);
});

test("23.7 hours offers varied category-balanced choices rather than fractions of Earth rotations", () => {
  const duration = 23.7 * 3600;
  const firstChoices = new Set<string>();
  const firstCategories = new Map<string, number>();
  for (let index = 0; index < 300; index++) {
    const choices = getTimeMetaphors(duration, `song:${index}`);
    assert.ok(choices.length >= 100);
    assert.ok(!choices.some(entry => entry.id === "earth-spin"));
    assert.equal(new Set(choices.slice(0, 3).map(entry => entry.category)).size, 3);
    const first = choices[0];
    firstChoices.add(first.id);
    firstCategories.set(first.category, (firstCategories.get(first.category) ?? 0) + 1);
  }
  assert.ok(firstChoices.size >= 50, `Only ${firstChoices.size} first choices across 300 songs`);
  for (const category of ["nature", "life", "space"]) {
    const count = firstCategories.get(category) ?? 0;
    assert.ok(count >= 70 && count <= 130, `${category} led ${count}/300 choices`);
  }
  // Multi-year archives must still have everyday options, not only orbital comparisons.
  const archive = getTimeMetaphors(3357.7 * 3600, "archive");
  assert.equal(new Set(archive.slice(0, 3).map(entry => entry.category)).size, 3);
  assert.ok(archive.length >= 40, `Long archives only offered ${archive.length} comparisons`);
  assert.ok(archive.filter(entry => entry.category === "nature").length >= 15);
  assert.ok(archive.filter(entry => entry.category === "life").length >= 20);
});

test("ordinary five-hour and day-long listening have at least one hundred distinct usable scenes", () => {
  const supportedAnimations = new Set(["sunlight", "earth-spin", "earth-orbit", "moon-orbit", "moon-phase",
    "satellite", "vinyl", "walk", "bloom", "film", "dance", "rain", "tea", "stars",
    "bird", "bee", "wave", "train", "bicycle", "book"]);
  for (const hours of [5, 23.7]) {
    const entries = getTimeMetaphors(hours * 3600, "selection:romantic-and-everyday");
    assert.ok(entries.length >= 100, `${hours}h only offered ${entries.length} scenes`);
    assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
    assert.equal(new Set(entries.map(entry => entry.title.zh)).size, entries.length);
    for (const entry of entries) {
      assert.ok(supportedAnimations.has(entry.animation));
      assert.ok(entry.secondsPerUnit > 0 && Number.isFinite(entry.secondsPerUnit));
      approx(entry.value * entry.secondsPerUnit, hours * 3600);
    }
    for (const id of ["long-hug", "handwritten-letter", "night-phone", "shared-breakfast", "cloud-watch",
      "tidepool-look", "bookshop-wander", "road-trip", "paper-plane"]) {
      assert.equal(entries.find(entry => entry.id === id)?.basis, "assumption", id);
    }
    const cycleIds = entries.map((_, index) => selectTimeMetaphor(hours * 3600, "selection:romantic-and-everyday", index)!.id);
    assert.equal(new Set(cycleIds).size, entries.length, "A cycle repeated a scene before visiting all options");
  }
});

test("same duration has stable song-specific choices and explicit cycle visits every eligible choice", () => {
  const duration = 5 * 3600;
  const first = selectTimeMetaphor(duration, "song:a");
  assert.deepEqual(first, selectTimeMetaphor(duration, "song:a"));
  const ids = new Set(Array.from({ length: 30 }, (_, index) => selectTimeMetaphor(duration, `song:${index}`)!.id));
  assert.ok(ids.size >= 4, `Only ${ids.size} distinct choices for 30 songs`);
  const choices = getTimeMetaphors(duration, "song:a");
  assert.ok(choices.length >= 100);
  assert.equal(new Set(choices.map((entry) => entry.id)).size, choices.length);
  for (let index = 0; index < choices.length; index++) assert.equal(selectTimeMetaphor(duration, "song:a", index)!.id, choices[index].id);
  assert.equal(selectTimeMetaphor(duration, "song:a", choices.length)!.id, first!.id);
  assert.equal(selectTimeMetaphor(duration, "song:a", -1)!.id, choices.at(-1)!.id);
});

test("metaphors avoid zero-rounding and unreadable amounts, with bilingual assumptions", () => {
  for (const value of [null, -1, 0, NaN, Infinity, 1e-10, Number.MAX_VALUE]) assert.equal(selectTimeMetaphor(value, "test"), null);
  const all = new Map([10, 100, 18000, 86400, 365.25 * 86400].flatMap((seconds) => getTimeMetaphors(seconds, "test").map((entry) => [entry.id, entry] as const)));
  assert.ok(all.size >= 120);
  for (const entry of all.values()) {
    assert.ok(entry.value >= 0.1 && entry.value <= 20000);
    assert.notEqual(entry.valueLabel.en, "0");
    assert.ok(entry.text.zh && entry.text.en && entry.assumption.zh && entry.assumption.en);
    assert.ok(!entry.text.zh.includes("{value}") && !entry.text.en.includes("{value}"));
    if (entry.basis === "fact") assert.ok(entry.source?.url.startsWith("https://"));
    else assert.equal(entry.source, undefined);
  }
});

test("new natural, creative and everyday scenes state their chosen duration rather than inventing facts", () => {
  const choices = getTimeMetaphors(5 * 3600, "new-scenes");
  for (const [id, minutes] of [
    ["wetland-boardwalk", 90], ["orchard-afternoon", 120], ["moonlit-shore", 60],
    ["poetry-evening", 60], ["pottery-wheel", 120], ["train-daytrip", 180],
    ["family-stories", 60], ["planetarium-show", 45], ["telescope-evening", 120],
  ] as const) {
    const entry = choices.find(choice => choice.id === id)!;
    assert.ok(entry, id);
    assert.equal(entry.basis, "assumption");
    assert.equal(entry.source, undefined);
    assert.equal(entry.secondsPerUnit, minutes * 60);
    assert.match(entry.assumption.zh, /设定每次/);
    assert.match(entry.assumption.en, /not a natural law/);
    assert.ok(entry.assumption.zh.includes(String(minutes)));
    assert.ok(entry.assumption.en.includes(String(minutes)));
  }
});
