import test from "node:test";
import assert from "node:assert/strict";
import { getTimeMetaphors } from "./listening-time.ts";
import { createTimeMetaphorHistory, createTimePerspectiveSession, timePerspectiveKey, TIME_METAPHOR_HISTORY_KEY, TIME_METAPHOR_HISTORY_LIMITS, type MetaphorHistoryStorage } from "./time-metaphor-history.ts";

const FIVE_HOURS = 5 * 3600;

function storage(initial: string | null = null): MetaphorHistoryStorage {
  let value = initial;
  return {
    getItem(key) { assert.equal(key, TIME_METAPHOR_HISTORY_KEY); return value; },
    setItem(key, next) { assert.equal(key, TIME_METAPHOR_HISTORY_KEY); value = next; },
  };
}

test("the persisted shuffle visits every eligible scene before repeating across reloads", () => {
  const store = storage();
  const count = getTimeMetaphors(FIVE_HOURS, "song:a").length;
  const seen: string[] = [];
  for (let index = 0; index < count; index++) {
    // A fresh manager models an actual page reload, not merely a component rerender.
    const history = createTimeMetaphorHistory(() => store);
    seen.push(history.next(FIVE_HOURS, "song:a")!.id);
  }
  assert.ok(count >= 100);
  assert.equal(new Set(seen).size, count);
  assert.deepEqual([...seen].sort(), getTimeMetaphors(FIVE_HOURS, "song:a").map(entry => entry.id).sort());
  const history = createTimeMetaphorHistory(() => store);
  const nextRound = Array.from({ length: count }, () => history.next(FIVE_HOURS, "song:a")!.id);
  assert.equal(new Set(nextRound).size, count);
  assert.notEqual(nextRound[0], seen.at(-1), "The cycle boundary must not immediately repeat");
  assert.notDeepEqual(nextRound, seen, "A new cycle should reshuffle the deck");
});

test("independent fresh histories choose a stable order for the same sequence of requests", () => {
  const left = createTimeMetaphorHistory(() => storageA);
  const right = createTimeMetaphorHistory(() => storageB);
  const storageA = storage();
  const storageB = storage();
  for (let index = 0; index < 20; index++) {
    const seed = index % 2 ? "platform:qq" : "song:a";
    assert.equal(left.next(FIVE_HOURS, seed)!.id, right.next(FIVE_HOURS, seed)!.id);
  }
});

test("recent comparisons are avoided across different songs and after refreshing", () => {
  const store = storage();
  const chosen: string[] = [];
  for (let index = 0; index < 35; index++) {
    const history = createTimeMetaphorHistory(() => store);
    const id = history.next(FIVE_HOURS, `song:${index}`)!.id;
    assert.ok(!chosen.slice(-TIME_METAPHOR_HISTORY_LIMITS.recent).includes(id));
    chosen.push(id);
  }
});

test("a changed duration preserves used eligible scenes and updates the arithmetic", () => {
  const store = storage();
  const history = createTimeMetaphorHistory(() => store);
  const before = new Set(Array.from({ length: 25 }, () => history.next(FIVE_HOURS, "platform:netease")!.id));
  const duration = 23.7 * 3600;
  for (let index = 0; index < 25; index++) {
    const next = history.next(duration, "platform:netease")!;
    assert.ok(!before.has(next.id), `${next.id} repeated on changing month`);
    assert.ok(Math.abs(next.value * next.secondsPerUnit - duration) < 1e-8);
    before.add(next.id);
  }
});

test("newly eligible scenes remain reachable without repeating previously used scenes", () => {
  const store = storage();
  const history = createTimeMetaphorHistory(() => store);
  const shortIds = getTimeMetaphors(1, "changing").map(entry => entry.id);
  assert.ok(shortIds.length > 0 && shortIds.length < 5);
  const seen = new Set(shortIds.map(() => history.next(1, "changing")!.id));
  for (let index = 0; index < 20; index++) {
    const next = history.next(FIVE_HOURS, "changing")!;
    assert.ok(!seen.has(next.id));
    seen.add(next.id);
  }
});

test("unavailable time and creating a manager do not touch or consume storage", () => {
  const history = createTimeMetaphorHistory(() => { throw new Error("Storage must not be requested"); });
  for (const value of [null, 0, -1, NaN, Infinity, Number.MAX_VALUE]) assert.equal(history.next(value, "song"), null);
  const store = storage();
  const first = createTimeMetaphorHistory(() => store).next(FIVE_HOURS, "song")!;
  createTimeMetaphorHistory(() => store);
  const snapshot = store.getItem(TIME_METAPHOR_HISTORY_KEY);
  assert.equal(createTimeMetaphorHistory(() => store).next(null, "song"), null);
  assert.equal(store.getItem(TIME_METAPHOR_HISTORY_KEY), snapshot);
  assert.notEqual(createTimeMetaphorHistory(() => store).next(FIVE_HOURS, "song")!.id, first.id);
});

test("blocked, missing and quota-full storage retain an in-memory deck", () => {
  const factories = [
    () => null,
    () => { throw new Error("Storage blocked"); },
    () => ({ getItem: () => { throw new Error("Read blocked"); }, setItem: () => { throw new Error("Write blocked"); } }),
    () => ({ getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } }),
  ];
  for (const factory of factories) {
    const history = createTimeMetaphorHistory(factory);
    const ids = Array.from({ length: 20 }, () => history.next(FIVE_HOURS, "same-song")!.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  // The default factory is also safe in Node/SSR, where window does not exist.
  assert.ok(createTimeMetaphorHistory().next(FIVE_HOURS, "ssr"));
});

test("a failed write never reloads an older cursor while the same page remains open", () => {
  let failWrites = false;
  const delegate = storage();
  const store = {
    getItem: delegate.getItem,
    setItem(key: string, value: string) { if (failWrites) throw new Error("Quota"); delegate.setItem(key, value); },
  };
  const history = createTimeMetaphorHistory(() => store);
  const first = history.next(FIVE_HOURS, "song")!.id;
  failWrites = true;
  const second = history.next(FIVE_HOURS, "song")!.id;
  const third = history.next(FIVE_HOURS, "song")!.id;
  failWrites = false;
  const fourth = history.next(FIVE_HOURS, "song")!.id;
  const fifth = createTimeMetaphorHistory(() => store).next(FIVE_HOURS, "song")!.id;
  assert.equal(new Set([first, second, third, fourth, fifth]).size, 5);
});

test("malformed or outdated storage is ignored without breaking a comparison", () => {
  for (const initial of ["{", "null", "[]", "x".repeat(512_001),
    JSON.stringify({ version: 0, entities: [], recent: [] }),
    JSON.stringify({ version: 1, entities: [null, { entity: "bad", order: {}, cursor: -3 }], recent: [null, 12, {}] }),
  ]) {
    const store = storage(initial);
    const result = createTimeMetaphorHistory(() => store).next(FIVE_HOURS, "song");
    assert.ok(result);
    const saved = JSON.parse(store.getItem(TIME_METAPHOR_HISTORY_KEY)!);
    assert.equal(saved.version, 1);
    assert.equal(saved.entities.length, 1);
  }
});

test("history is capped and stores hashed entities instead of song names", () => {
  const store = storage();
  const history = createTimeMetaphorHistory(() => store);
  for (let index = 0; index < TIME_METAPHOR_HISTORY_LIMITS.entities + 5; index++) {
    history.next(FIVE_HOURS, `sensitive-song-name:${index}`);
  }
  const raw = store.getItem(TIME_METAPHOR_HISTORY_KEY)!;
  const saved = JSON.parse(raw);
  assert.equal(saved.entities.length, TIME_METAPHOR_HISTORY_LIMITS.entities);
  assert.equal(saved.recent.length, TIME_METAPHOR_HISTORY_LIMITS.recent);
  assert.ok(!raw.includes("sensitive-song-name"));
  assert.ok(raw.length < 512_000);
  assert.ok(saved.entities.every((entry: { order: string[] }) => entry.order.length <= TIME_METAPHOR_HISTORY_LIMITS.deck));
});

test("a visible perspective consumes once through Strict Mode replay and viewport reentry", () => {
  const choices = getTimeMetaphors(FIVE_HOURS, "song");
  let calls = 0;
  const session = createTimePerspectiveSession({ next() { return choices[calls++]; } });
  assert.equal(calls, 0, "Creating render state must not consume a scene");
  assert.equal(session.select(FIVE_HOURS, "song", false), null);
  assert.equal(calls, 0, "Hidden sections must not consume a scene");
  const first = session.select(FIVE_HOURS, "song", true);
  assert.equal(calls, 1);
  assert.strictEqual(session.select(FIVE_HOURS, "song", true), first, "Effect replay returns the identical object");
  assert.equal(calls, 1);
  assert.equal(session.select(FIVE_HOURS, "song", false), null);
  assert.strictEqual(session.select(FIVE_HOURS, "song", true), first, "Returning to a visible section keeps the scene");
  assert.equal(calls, 1);
});

test("locale changes do not consume a scene; explicit refresh consumes exactly one", () => {
  const choices = getTimeMetaphors(FIVE_HOURS, "song");
  let calls = 0;
  const session = createTimePerspectiveSession({ next() { return choices[calls++]; } });
  const selected = session.select(FIVE_HOURS, "song", true)!;
  // Locale is deliberately absent from the selection identity: only its text changes.
  for (const locale of ["zh", "en", "zh", "en"] as const) {
    const same = session.select(FIVE_HOURS, "song", true)!;
    assert.strictEqual(same, selected);
    assert.ok(choices.find(choice => choice.id === same.id)!.text[locale]);
  }
  assert.equal(calls, 1);
  const refreshed = session.select(FIVE_HOURS, "song", true, true)!;
  assert.notEqual(refreshed.id, selected.id);
  assert.equal(calls, 2);
  assert.strictEqual(session.select(FIVE_HOURS, "song", true), refreshed);
  assert.equal(calls, 2);
});

test("seed or time changes invalidate the old selection and consume once when visible", () => {
  const choices = getTimeMetaphors(FIVE_HOURS, "song");
  let calls = 0;
  const session = createTimePerspectiveSession({ next() { return choices[calls++]; } });
  const original = session.select(FIVE_HOURS, "same-seed", true)!;
  const newDuration = 23.7 * 3600;
  assert.notEqual(original.key, timePerspectiveKey(newDuration, "same-seed"), "Old content cannot match the new render key");
  assert.equal(session.select(newDuration, "same-seed", false), null);
  assert.equal(calls, 1);
  const changedTime = session.select(newDuration, "same-seed", true)!;
  assert.equal(changedTime.key, timePerspectiveKey(newDuration, "same-seed"));
  assert.notEqual(changedTime.id, original.id);
  assert.strictEqual(session.select(newDuration, "same-seed", true), changedTime);
  assert.equal(calls, 2);
  const changedSeed = session.select(newDuration, "different-seed", true)!;
  assert.notEqual(changedSeed.key, changedTime.key);
  assert.equal(calls, 3);
});

test("a real remount gets the next persisted scene while effect replay keeps the same one", () => {
  const store = storage();
  const firstSession = createTimePerspectiveSession(createTimeMetaphorHistory(() => store));
  const first = firstSession.select(FIVE_HOURS, "song", true)!;
  assert.strictEqual(firstSession.select(FIVE_HOURS, "song", true), first);
  const snapshot = store.getItem(TIME_METAPHOR_HISTORY_KEY);
  const afterRefresh = createTimePerspectiveSession(createTimeMetaphorHistory(() => store));
  assert.equal(store.getItem(TIME_METAPHOR_HISTORY_KEY), snapshot, "Creating a replacement render cannot advance history");
  const next = afterRefresh.select(FIVE_HOURS, "song", true)!;
  assert.notEqual(next.id, first.id);
  assert.strictEqual(afterRefresh.select(FIVE_HOURS, "song", true), next);
  assert.equal(JSON.parse(store.getItem(TIME_METAPHOR_HISTORY_KEY)!).entities[0].cursor, 2);
});

test("unknown time does not spend a valid scene and later data can select normally", () => {
  const store = storage();
  const session = createTimePerspectiveSession(createTimeMetaphorHistory(() => store));
  const missing = session.select(null, "song", true)!;
  assert.equal(missing.id, null);
  assert.equal(store.getItem(TIME_METAPHOR_HISTORY_KEY), null);
  assert.strictEqual(session.select(null, "song", true), missing);
  const valid = session.select(FIVE_HOURS, "song", true)!;
  assert.ok(valid.id);
  assert.notEqual(valid.key, missing.key);
  assert.equal(JSON.parse(store.getItem(TIME_METAPHOR_HISTORY_KEY)!).entities[0].cursor, 1);
});
