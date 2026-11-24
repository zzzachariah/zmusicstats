import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMusicMetadata, matchAppleCatalog, parseNeteaseDetails, parseNeteaseWiki, qqArtworkUrl, safeArtworkUrl } from "./music-metadata.mjs";
import { parseNeteaseRanks, parseQqRanks, parseAppleRecentTracks } from "./adapters.mjs";

const track = { provider: "netease", id: "123", title: "Love Song", artist: "Khalil Fong", album: "Wonderland" };
const resource = name => ({ resourceType: "melody_style", valid: true, uiElement: { mainTitle: { title: name } } });
const wiki = { data: { blocks: [{ code: "SONG_PLAY_ABOUT_SONG_BASIC", uiElement: { images: [{ imageUrl: "http://p1.music.126.net/example/cover.jpg" }] }, creatives: [
  { creativeType: "songTag", resources: [resource("R&B"), resource("Soul")] },
  { creativeType: "songBizTag", resources: [resource("KTV"), resource("Happy")] },
  { creativeType: "language", resources: [resource("Chinese")] },
] }] } };
const song = (name = "Love Song", artistName = "Khalil Fong", albumName = "Wonderland") => ({ type: "songs", id: "apple-1", attributes: { name, artistName, albumName, durationInMillis: 245500, genreNames: ["Music", "R&B/Soul"], artwork: { url: "https://is1-ssl.mzstatic.com/image/thumb/cover/{w}x{h}bb.jpg" } } });
const catalog = (...songs) => ({ results: { songs: { data: songs } } });

test("NetEase wiki takes only the verified songTag genre group, never mood/language/recommendation tags", () => {
  const result = parseNeteaseWiki(wiki);
  assert.deepEqual(result.genres, ["R&B", "Soul"]);
  assert.equal(result.genreSource, "netease-wiki");
  assert.equal(result.artworkUrl, "https://p1.music.126.net/example/cover.jpg");
  const invalid = structuredClone(wiki); invalid.data.blocks[0].creatives[0].resources[0].valid = false;
  assert.deepEqual(parseNeteaseWiki(invalid).genres, ["Soul"]);
  assert.deepEqual(parseNeteaseWiki({ data: { blocks: {} } }).genres, []);
});

test("Apple fallback requires exact title and artist, ignores album editions, and preserves title version identity", () => {
  assert.deepEqual(matchAppleCatalog(track, catalog(song())).genres, ["R&B/Soul"]);
  for (const mismatch of [song("Love Song (Live)"), song("Love Song", "Different Artist")])
    assert.equal(matchAppleCatalog(track, catalog(mismatch)), null);
  assert.deepEqual(matchAppleCatalog(track, catalog(song("Love Song", "Khalil Fong", "Another Edition"))).genres, ["R&B/Soul"]);
  const multiple = matchAppleCatalog(track, catalog(song(), song("Love Song", "Khalil Fong", "Another Edition")));
  assert.deepEqual(multiple.genres, ["R&B/Soul"]); assert.equal(multiple.artworkUrl, undefined); assert.equal(multiple.durationSeconds, undefined);
  const conflicting = song(); conflicting.attributes.genreNames = ["Pop"];
  assert.equal(matchAppleCatalog(track, catalog(song(), conflicting)), null);
  assert.equal(matchAppleCatalog({ ...track, artist: "" }, catalog(song())), null);
  assert.equal(matchAppleCatalog(track, { results: { songs: { data: {} } } }), null);
});

test("only known artwork CDNs survive; Apple templates resolve and QQ uses validated album mid", () => {
  assert.match(safeArtworkUrl(song().attributes.artwork.url), /512x512bb\.jpg$/);
  assert.match(qqArtworkUrl("001ABC"), /T002R500x500M000001ABC\.jpg$/);
  for (const url of ["javascript:alert(1)", "https://evil.example/pic.jpg", "https://y.gtimg.cn.evil.example/a.jpg", "https://secret@y.gtimg.cn/a.jpg", "http://127.0.0.1/a.jpg"]) assert.equal(safeArtworkUrl(url), undefined);
  assert.equal(qqArtworkUrl("../x"), undefined);
});

test("rank parsers preserve actual artwork without inventing genre from numeric IDs", () => {
  const qq = parseQqRanks({ items: [{ track: { id: 1, name: "A", singer: [{ name: "B" }], album: { mid: "MID01", name: "Album" }, genre: 33, interval: 245 }, listenCount: 8 }] });
  assert.equal(qq[0].artworkUrl, qqArtworkUrl("MID01")); assert.deepEqual(qq[0].genres, []);
  assert.equal(qq[0].durationSeconds, 245); assert.equal(qq[0].listenSeconds, undefined);
  const ncm = parseNeteaseRanks({ data: { songItems: [{ songId: 1, songName: "A", artists: [{ name: "B" }], albumPicUrl: "http://p2.music.126.net/image.jpg" }] } });
  assert.equal(ncm[0].artworkUrl, "https://p2.music.126.net/image.jpg");
  const apple = parseAppleRecentTracks({ data: [song()] }); assert.match(apple[0].artworkUrl, /512x512/); assert.equal(apple[0].durationSeconds, 245.5);
  const details = parseNeteaseDetails({ songs: [{ id: 1, dt: 245500, al: { picUrl: "http://p2.music.126.net/image.jpg" } }, { id: 2, dt: 125000 }] });
  assert.equal(details[0].id, "1"); assert.equal(details[0].durationSeconds, 245.5); assert.equal(details[1].durationSeconds, 125);
});

test("batched native detail covers and wiki genres are cached, and listening counts never enter public cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zmusicstats-metadata-"));
  try {
    const cachePath = join(dir, "public.json"); let details = 0; let wikis = 0;
    const options = { cachePath, loadNeteaseDetails: async ids => { details++; assert.deepEqual(ids, ["123"]); return { songs: [{ id: 123, dt: 245500, al: { picUrl: "https://p1.music.126.net/detail.jpg" } }] }; }, loadNeteaseWiki: async () => { wikis++; return wiki; } };
    const service = createMusicMetadata(options);
    const first = await service.enrich([{ ...track, count: 999, secret: "never-store" }]);
    assert.deepEqual(first.items[0].genres, ["R&B", "Soul"]);
    assert.equal(first.items[0].durationSeconds, 245.5); assert.equal(first.items[0].complete, true);
    const restored = createMusicMetadata(options); const second = await restored.enrich([track]);
    assert.equal(second.items[0].durationSeconds, 245.5);
    assert.equal(details, 1); assert.equal(wikis, 1);
    const stored = JSON.parse(readFileSync(cachePath, "utf8"));
    assert.equal(Object.hasOwn(stored[0].item, "count"), false);
    assert.equal(Object.hasOwn(stored[0].item, "secret"), false);
    assert.doesNotMatch(JSON.stringify(stored), /never-store|Khalil Fong|Wonderland/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("metadata lookup concurrency stays bounded and native genre avoids Apple search", async () => {
  let active = 0; let maximum = 0; let searches = 0;
  const service = createMusicMetadata({ concurrency: 20, loadNeteaseDetails: async ids => ({ songs: ids.map(id => ({ id, dt: 240000 })) }), loadNeteaseWiki: async () => { maximum = Math.max(maximum, ++active); await new Promise(resolve => setImmediate(resolve)); active--; return wiki; }, searchApple: async () => { searches++; return catalog(song()); } });
  const result = await service.enrich(Array.from({ length: 8 }, (_, index) => ({ ...track, id: String(index + 1) })));
  assert.equal(maximum, 3); assert.equal(searches, 0); assert.equal(result.items.length, 8);
});

test("failed genre lookup preserves cover and length but never becomes a completed negative cache hit", async () => {
  let clock = 1000; let calls = 0;
  const service = createMusicMetadata({ now: () => clock, loadNeteaseDetails: async () => ({ songs: [{ id: 123, dt: 245000, al: { picUrl: "https://p1.music.126.net/image.jpg" } }] }), loadNeteaseWiki: async () => { calls++; throw new Error("no response"); } });
  let result = await service.enrich([track]); assert.deepEqual(result.items[0].genres, []); assert.ok(result.items[0].artworkUrl);
  assert.equal(result.items[0].durationSeconds, 245); assert.equal(result.items[0].complete, false); assert.equal(result.items[0].retryable, true);
  await service.enrich([track]); assert.equal(calls, 2);
  clock += 3_600_001; await service.enrich([track]); assert.equal(calls, 3);
});

test("QQ official names are used without passing account credentials into public output", async () => {
  const service = createMusicMetadata({ loadQqGenres: async (id, credential) => { assert.equal(id, "7"); assert.equal(credential.secret, "fixture-only"); return { genres: [{ id: 3, name: "Jazz" }] }; } });
  const result = await service.enrich([{ ...track, provider: "qq", id: "7" }], { connections: { qq: { credential: { secret: "fixture-only" } } } });
  assert.deepEqual(result.items[0].genres, ["Jazz"]); assert.equal(result.items[0].genreSource, "qq-music");
  assert.doesNotMatch(JSON.stringify(result), /fixture-only/);
});

test("cancellation has a bounded response even when upstream ignores its abort signal", async () => {
  const service = createMusicMetadata({ loadNeteaseWiki: async () => new Promise(() => {}), budgetMs: 10, timeoutMs: 1000 });
  const started = Date.now(); const result = await service.enrich([track]);
  assert.ok(Date.now() - started < 500); assert.deepEqual(result.items[0].genres, []);
  assert.equal(result.items[0].complete, false); assert.equal(result.items[0].retryable, true);
});

test("tracks untouched at the deadline remain retryable, and a native cached duration is never discarded", async () => {
  const service = createMusicMetadata({ concurrency: 1, budgetMs: 10, loadNeteaseWiki: async () => new Promise(() => {}) });
  service.cachedTracks("netease", [{ ...track, durationSeconds: 245 }]);
  const response = await service.enrich([track, { ...track, id: "456" }]);
  assert.equal(response.items[0].durationSeconds, 245);
  assert.equal(response.items[1].complete, false); assert.equal(response.items[1].retryable, true);
});

test("a completed native empty genre result is reusable and distinct from a network failure", async () => {
  let calls = 0;
  const service = createMusicMetadata({ loadNeteaseDetails: async () => ({ songs: [{ id: 123, dt: 245000 }] }), loadNeteaseWiki: async () => { calls++; return { data: { blocks: [] } }; } });
  assert.equal((await service.enrich([track])).items[0].complete, true);
  await service.enrich([track]); assert.equal(calls, 1);
});
