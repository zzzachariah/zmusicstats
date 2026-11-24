import test from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "./report.ts";
import { getDemoInput } from "./demo-data.ts";
import { selectPosterTracks } from "./poster.ts";

test("monthly posters exclude Apple recent tracks with no matching ranking period", () => {
  const input = getDemoInput();
  const apple = input.platforms.find((platform) => platform.id === "apple")!;
  apple.rankingPeriod = null;
  apple.countKind = "unknown";
  apple.countDefinition = null;
  const report = buildReport(input);

  assert.equal(report.rankingMode, "separate");
  assert.ok(
    report.platforms.find((platform) => platform.id === "apple")!.tracks
      .length > 0,
  );
  const selected = selectPosterTracks(report, 10);
  assert.ok(selected.length > 0);
  assert.ok(selected.every((track) => !track.platforms.includes("apple")));
  assert.ok(selected.some((track) => track.platforms.includes("netease")));
  assert.ok(selected.some((track) => track.platforms.includes("qq")));
});

test("monthly poster has no Top tracks when every platform has an unknown ranking period", () => {
  const input = getDemoInput();
  input.platforms.forEach((platform) => {
    platform.rankingPeriod = null;
  });
  const report = buildReport(input);

  assert.ok(report.platforms.every((platform) => platform.tracks.length > 0));
  assert.deepEqual(selectPosterTracks(report, 10), []);
  assert.deepEqual(report.genres, []);
});
