import test from "node:test";
import assert from "node:assert/strict";
import { createAdapters, monthPeriod } from "./adapters.mjs";
import { neteaseMonthReadiness, neteasePeriodMatches, neteaseTopSongFallback, neteaseHistoryDirectory, neteaseMonthSeconds } from "./netease-report.mjs";

const period = monthPeriod("2026-08");
const datedReport = () => ({ code: 200, data: {
  startTime: Date.parse("2026-08-01T00:00:00+08:00"),
  endTime: Date.parse("2026-08-31T00:00:00+08:00"),
  topSongBlock: { songId: 123, songName: "Fixture song", artists: [{name: "Fixture artist"}], playCount: 8 },
} });

test("history combines verified directories and account bounds without claiming every month is readable", () => {
  const result = neteaseHistoryDirectory({
    timedetail: { data: [{ year: 2021, month: [6, 7] }, { year: 2026, month: [10, 11] }] },
    yearReport: { data: { yearItems: [{ year: 2020 }, { year: 2021 }] } },
    account: { profile: { createTime: Date.parse("2021-05-23T00:00:00+08:00") } },
  }, Date.parse("2026-11-24T12:00:00+08:00"));
  assert.equal(result.months.length, 66);
  assert.equal(result.months[0], "2021-05");
  assert.equal(result.months.at(-1), "2026-10");
  assert.equal(result.rangeVerified, false);
  assert.deepEqual(result.catalogMonths, ["2021-06", "2021-07", "2026-10"]);
});

test("verified monthly minutes convert to seconds without treating annual seconds as minutes", () => {
  const payload = {data: {listenTimeBlock: {blockType: "LISTEN_TIME_MONTH_BLOCK", playDuration: 2340}}};
  assert.equal(neteaseMonthSeconds(payload), 140400);
  payload.data.listenTimeBlock.blockType = "LISTEN_TIME_YEAR_BLOCK";
  assert.equal(neteaseMonthSeconds(payload), null);
  assert.equal(neteaseMonthSeconds({data: {listenTimeBlock: {playDuration: 2340}}}), null);
  assert.equal(neteaseMonthSeconds({data: {listenTimeBlock: {blockType: "LISTEN_TIME_MONTH_BLOCK", playDuration: -1}}}), null);
});

test("duration-only refresh reads one monthly report and never fetches rankings", async () => {
  const calls = [];
  const adapter = createAdapters({neteaseBase: "http://localhost:3101"}, async (url, init) => {
    calls.push(url.pathname);
    assert.ok(JSON.parse(init.body).timeout < 12000, "the upstream request is bounded before the bridge timeout");
    const payload = datedReport();
    payload.data.listenTimeBlock = {blockType: "LISTEN_TIME_MONTH_BLOCK", playDuration: 2340};
    return new Response(JSON.stringify(payload));
  });
  const duration = await adapter.neteaseDuration({secret: "fixture"}, "2026-08", {timeoutMs: 12000, attempts: 1});
  assert.deepEqual(calls, ["/listen/data/report"]);
  assert.equal(duration.listenSeconds, 140400);
  assert.equal(duration.coverageComplete, true);
});

test("NetEase distinguishes unfinished month from future and validates returned dates", () => {
  const now = Date.parse("2026-11-24T12:00:00+08:00");
  assert.equal(neteaseMonthReadiness(monthPeriod("2026-10"), now), null);
  assert.equal(neteaseMonthReadiness(monthPeriod("2026-11"), now), "MONTH_NOT_READY");
  assert.equal(neteaseMonthReadiness(monthPeriod("2026-12"), now), "FUTURE_MONTH");
  assert.equal(neteasePeriodMatches(datedReport(), period), true);
  assert.equal(neteasePeriodMatches(datedReport(), monthPeriod("2026-09")), false);
  assert.equal(neteasePeriodMatches({ data: { startTime: "not a timestamp" } }, period), false);
});

test("unfinished NetEase months fail before contacting the platform", async () => {
  let calls = 0;
  const adapter = createAdapters({ neteaseBase: "http://localhost:3101" }, async () => { calls++; });
  const current = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);
  await assert.rejects(adapter.report("netease", {secret: "fixture"}, current), {code: "MONTH_NOT_READY"});
  assert.equal(calls, 0);
});

test("a transient NetEase rank timeout gets one retry, then keeps the verified monthly headline song", async () => {
  let rankCalls = 0;
  const adapter = createAdapters({ neteaseBase: "http://localhost:3101" }, async url => {
    if (url.pathname.endsWith("/rank")) { rankCalls++; throw new DOMException("fixture", "TimeoutError"); }
    return new Response(JSON.stringify(datedReport()));
  });
  const result = await adapter.report("netease", { secret: "fixture" }, "2026-08");
  assert.equal(rankCalls, 2);
  assert.equal(result.platform.tracks.length, 1);
  assert.equal(result.platform.tracks[0].count, 8);
  assert.equal(result.issues.some(issue => issue.code === "UPSTREAM_TIMEOUT"), true);
  assert.equal(result.issues.some(issue => issue.code === "TOP_RANK_PARTIAL"), true);
  assert.equal(result.platform.listenSeconds, null);
  assert.deepEqual(neteaseTopSongFallback({ data: { topSongBlock: { songId: 123, songName: "Missing count" } } }), []);
});

test("NetEase never retries rejected credentials or labels a different month as the requested month", async () => {
  let calls = 0;
  const expired = createAdapters({ neteaseBase: "http://localhost:3101" }, async () => { calls++; return new Response("", {status: 401}); });
  const failed = await expired.report("netease", { secret: "fixture" }, "2026-08");
  assert.equal(calls, 2, "one attempt for each independent endpoint");
  assert.equal(failed.issues.filter(issue => issue.code === "CONNECTION_EXPIRED").length, 2);
  const wrong = createAdapters({ neteaseBase: "http://localhost:3101" }, async () => new Response(JSON.stringify(datedReport())));
  await assert.rejects(wrong.report("netease", { secret: "fixture" }, "2026-09"), {code: "PERIOD_MISMATCH"});
});
