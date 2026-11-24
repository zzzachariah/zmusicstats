import test from "node:test";
import assert from "node:assert/strict";
import { emptyReportGesture, nextReportGesture, suspendedReportGesture } from "./report-slide-gesture.ts";

const input = (now: number, overrides = {}) => ({ now, deltaY: 40, canScrollInside: false, hasAdjacentSlide: true, transitioning: false, ...overrides });

test("one wheel burst advances only once, including its inertial tail", () => {
  let result = nextReportGesture(emptyReportGesture(), input(0));
  assert.equal(result.action, "advance");
  for (const now of [16, 40, 130, 250, 400]) {
    result = nextReportGesture(result.state, input(now));
    assert.equal(result.action, "consume");
  }
  assert.equal(nextReportGesture(result.state, input(580)).action, "advance");
});

test("an internal-list gesture consumes the edge remainder, requiring a fresh gesture", () => {
  let result = nextReportGesture(emptyReportGesture(), input(0, { canScrollInside: true }));
  assert.equal(result.action, "native");
  result = nextReportGesture(result.state, input(60, { canScrollInside: true }));
  assert.equal(result.action, "native");
  result = nextReportGesture(result.state, input(100));
  assert.equal(result.action, "consume");
  result = nextReportGesture(result.state, input(180));
  assert.equal(result.action, "consume");
  assert.equal(nextReportGesture(result.state, input(360)).action, "advance");
});

test("a fresh gesture at a list edge can page in either direction", () => {
  const down = nextReportGesture(emptyReportGesture(), input(0));
  const up = nextReportGesture(emptyReportGesture(), input(0, { deltaY: -40 }));
  assert.equal(down.action, "advance"); assert.equal(down.direction, 1);
  assert.equal(up.action, "advance"); assert.equal(up.direction, -1);
});

test("small trackpad deltas accumulate, while reversal does not inherit old distance", () => {
  let result = nextReportGesture(emptyReportGesture(), input(0, { deltaY: 10 }));
  assert.equal(result.action, "consume");
  result = nextReportGesture(result.state, input(20, { deltaY: -10 }));
  assert.equal(result.action, "consume");
  result = nextReportGesture(result.state, input(40, { deltaY: -14 }));
  assert.equal(result.action, "advance"); assert.equal(result.direction, -1);
});

test("scroll animation absorbs a new burst and keeps that burst locked after settling", () => {
  let result = nextReportGesture(emptyReportGesture(), input(0, { transitioning: true }));
  assert.equal(result.action, "consume");
  result = nextReportGesture(result.state, input(80));
  assert.equal(result.action, "consume");
  assert.equal(nextReportGesture(result.state, input(260)).action, "advance");
});

test("native document scrolling is available beyond the first or last slide", () => {
  let result = nextReportGesture(emptyReportGesture(), input(0, { hasAdjacentSlide: false }));
  assert.equal(result.action, "native");
  for (const now of [16, 40, 100]) {
    result = nextReportGesture(result.state, input(now, { hasAdjacentSlide: false }));
    assert.equal(result.action, "native");
  }
});

test("reversing away from a list boundary reads the list without paging", () => {
  let result = nextReportGesture(emptyReportGesture(), input(0, { canScrollInside: true }));
  result = nextReportGesture(result.state, input(30));
  assert.equal(result.action, "consume");
  result = nextReportGesture(result.state, input(60, { deltaY: -40, canScrollInside: true }));
  assert.equal(result.action, "native");
  assert.equal(result.state.mode, "internal");
  assert.equal(result.direction, -1);
  result = nextReportGesture(result.state, input(80, { deltaY: -40 }));
  assert.equal(result.action, "consume");
});

test("direction reversal after paging cannot turn another slide or scroll its list", () => {
  const result = nextReportGesture(emptyReportGesture(), input(0));
  assert.equal(nextReportGesture(result.state, input(50, { deltaY: -60, canScrollInside: true })).action, "consume");
});

test("a dialog wheel tail is absorbed until the next fresh gesture", () => {
  let result = nextReportGesture(suspendedReportGesture(0), input(90));
  assert.equal(result.action, "consume");
  result = nextReportGesture(result.state, input(210));
  assert.equal(result.action, "consume");
  assert.equal(nextReportGesture(result.state, input(390)).action, "advance");
});
