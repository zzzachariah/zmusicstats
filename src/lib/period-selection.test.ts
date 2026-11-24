import test from "node:test";
import assert from "node:assert/strict";
import { latestCompletedMonth, recentCompletedMonths, validatePeriodSelection } from "./period-selection.ts";

test("the last completed month follows the China boundary, not the host timezone", () => {
  assert.equal(latestCompletedMonth(Date.parse("2026-10-31T15:59:59.999Z")), "2026-09");
  assert.equal(latestCompletedMonth(Date.parse("2026-10-31T16:00:00.000Z")), "2026-10");
  assert.equal(latestCompletedMonth(Date.parse("2026-12-31T16:00:00.000Z")), "2026-12");
});

test("presets contain exactly their completed months across year boundaries", () => {
  const now = Date.parse("2026-11-25T00:00:00+08:00");
  assert.deepEqual(recentCompletedMonths(3, now), ["2026-08", "2026-09", "2026-10"]);
  const annual = recentCompletedMonths(12, now);
  assert.equal(annual.length, 12);
  assert.equal(annual[0], "2025-11");
  assert.equal(annual.at(-1), "2026-10");
  assert.deepEqual(recentCompletedMonths(6, Date.parse("2027-01-02T00:00:00+08:00")), ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
});

test("a single month and a leap-year boundary are valid inclusive selections", () => {
  assert.deepEqual(validatePeriodSelection("2024-02", "2024-02", "2026-10"), { months: ["2024-02"], error: null });
  assert.deepEqual(validatePeriodSelection("2023-12", "2024-03", "2026-10").months, ["2023-12", "2024-01", "2024-02", "2024-03"]);
});

test("empty, malformed, reversed, unfinished and pre-floor ranges cannot start an import", () => {
  for (const [start, end, error] of [
    ["", "2026-10", "empty"], ["2026-01", "", "empty"], ["2026-13", "2026-10", "invalid"],
    ["2026-1", "2026-10", "invalid"], ["2026-10", "2026-09", "reversed"],
    ["2026-10", "2026-11", "unfinished"], ["2026-12", "2026-12", "unfinished"],
    ["2004-12", "2026-10", "before-minimum"],
  ]) assert.deepEqual(validatePeriodSelection(start, end, "2026-10"), { months: [], error });
});

test("a corrupt or huge range is bounded before month enumeration", () => {
  assert.equal(validatePeriodSelection("2005-01", "2038-04", "9999-12").months.length, 400);
  assert.deepEqual(validatePeriodSelection("2005-01", "9999-12", "9999-12"), { months: [], error: "too-long" });
  for (const count of [0, -1, 1.5, Infinity, 401, 1e9]) assert.deepEqual(recentCompletedMonths(count), []);
  assert.throws(() => latestCompletedMonth(NaN), /INVALID_CURRENT_TIME/);
});
