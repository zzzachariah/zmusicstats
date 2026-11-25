import assert from "node:assert/strict";
import test from "node:test";
import { restoredConnectionEntry } from "./connection-entry.ts";

test("returning from an app stays on multi-platform setup until Continue was chosen", () => {
  assert.equal(restoredConnectionEntry("connections", false), "connections");
  assert.equal(restoredConnectionEntry("connections", true), "connections");
  assert.equal(restoredConnectionEntry("true", true), "connections");
  assert.equal(restoredConnectionEntry(null, false), "connections");
  assert.equal(restoredConnectionEntry("period", false), "period");
  assert.equal(restoredConnectionEntry(null, true), "report");
});
