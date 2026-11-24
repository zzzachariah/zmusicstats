import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { approvedArtworkUrl, createArtworkProxy } from "./artwork.mjs";
import { createApiServer } from "./index.mjs";

const cover = "https://y.gtimg.cn/music/cover.jpg";
const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const image = (bytes = png, type = "image/png", headers = {}) => new Response(bytes, { headers: { "content-type": type, ...headers } });

test("artwork accepts only exact approved public CDN patterns and HTTPS image paths", () => {
  for (const url of [cover, "https://p1.music.126.net/cover.jpg?param=160y160", "https://p3.music.126.net/a.png", "https://is1-ssl.mzstatic.com/image/160x160bb.jpg"])
    assert.equal(approvedArtworkUrl(url).href, url);
  for (const url of ["http://y.gtimg.cn/a.jpg", "https://127.0.0.1/a.jpg", "https://y.gtimg.cn.evil.example/a.jpg", "https://evil.music.126.net/a.jpg", "https://music.126.net/a.jpg", "https://user@y.gtimg.cn/a.jpg", "https://y.gtimg.cn:8080/a.jpg", "https://y.gtimg.cn/a.jpg#fragment", "https://y.gtimg.cn/api", "https://y.gtimg.cn/a.svg", "https://y.gtimg.cn/\\evil/a.jpg", "file:///a.jpg", "data:image/png;base64,abc", null])
    assert.throws(() => approvedArtworkUrl(url), { code: "ARTWORK_URL_REJECTED" }, String(url));
});

test("artwork fetch uses fixed image headers and never forwards cookies or credentials", async () => {
  const calls = [];
  const proxy = createArtworkProxy({ fetchImpl: async (url, options) => { calls.push({ url, options }); return image(); } });
  const result = await proxy.load(cover);
  assert.deepEqual(result.bytes, png);
  assert.equal(result.contentType, "image/png");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "manual");
  assert.deepEqual(Object.keys(calls[0].options.headers), ["Accept"]);
  assert.match(calls[0].options.headers.Accept, /^image\/jpeg,/);
});

test("artwork validates every redirect and never contacts an unapproved location", async () => {
  const requested = [];
  const proxy = createArtworkProxy({ fetchImpl: async (url) => {
    requested.push(url);
    return new Response(null, { status: 302, headers: { location: requested.length === 1 ? "https://p2.music.126.net/other.jpg" : "http://127.0.0.1/private.jpg" } });
  } });
  await assert.rejects(proxy.load(cover), { code: "ARTWORK_REDIRECT_REJECTED" });
  assert.deepEqual(requested, [cover, "https://p2.music.126.net/other.jpg"]);
  let redirects = 0;
  const loop = createArtworkProxy({ fetchImpl: async () => { redirects++; return new Response(null, { status: 307, headers: { location: "/again.jpg" } }); } });
  await assert.rejects(loop.load(cover), { code: "ARTWORK_REDIRECT_REJECTED" });
  assert.equal(redirects, 4);
});

test("NetEase export images use equivalent small CDN objects and normalize valid image/jpg", async () => {
  const requests = [];
  const jpeg = Buffer.from("ffd8ffe00000", "hex");
  const source = "https://p4.music.126.net/public-cover-hash/109951172651476790.jpg";
  const proxy = createArtworkProxy({ fetchImpl: async (url) => {
    requests.push(url);
    if (requests.length === 1) throw new TypeError("network reset");
    return image(jpeg, "image/jpg");
  } });
  const result = await proxy.load(source);
  assert.deepEqual(requests, [
    "https://p1.music.126.net/public-cover-hash/109951172651476790.jpg?param=200y200",
    "https://p2.music.126.net/public-cover-hash/109951172651476790.jpg?param=200y200",
  ]);
  assert.equal(result.contentType, "image/jpeg");
  assert.deepEqual(result.bytes, jpeg);
  await proxy.load(source.replace("p4.", "p3."));
  assert.equal(requests.length, 2, "equivalent object URLs share the bounded cache");
  const spoofed = createArtworkProxy({ fetchImpl: async () => image("<svg/>", "image/jpg") });
  await assert.rejects(spoofed.load(source), { code: "ARTWORK_TYPE_REJECTED" });
});

test("artwork rejects SVG, HTML, MIME spoofing and empty images", async () => {
  for (const response of [image("<svg></svg>", "image/svg+xml"), image("<html>error</html>", "text/html"), image("<svg></svg>", "image/png"), image(png, "image/jpeg"), image(Buffer.alloc(0))]) {
    const proxy = createArtworkProxy({ fetchImpl: async () => response });
    await assert.rejects(proxy.load(cover), { code: "ARTWORK_TYPE_REJECTED" });
  }
});

test("artwork enforces the byte limit both before and during streaming", async () => {
  const declared = createArtworkProxy({ maxBytes: 16, fetchImpl: async () => image(png, "image/png", { "content-length": "17" }) });
  await assert.rejects(declared.load(cover), { code: "ARTWORK_TOO_LARGE" });
  let cancelled = false;
  const streaming = createArtworkProxy({ maxBytes: 16, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(png); controller.enqueue(new Uint8Array(10)); }, cancel() { cancelled = true; },
  }), { headers: { "content-type": "image/png" } }) });
  await assert.rejects(streaming.load(cover), { code: "ARTWORK_TOO_LARGE" });
  assert.equal(cancelled, true);
});

test("artwork times out during headers or body and supports caller cancellation", async () => {
  const pending = createArtworkProxy({ timeoutMs: 10, fetchImpl: async () => new Promise(() => {}) });
  await assert.rejects(pending.load(cover), { code: "ARTWORK_TIMEOUT", status: 504 });
  let cancelled = false;
  const streaming = createArtworkProxy({ timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(png); }, cancel() { cancelled = true; },
  }), { headers: { "content-type": "image/png" } }) });
  await assert.rejects(streaming.load(cover), { code: "ARTWORK_TIMEOUT" });
  assert.equal(cancelled, true);
  const controller = new AbortController();
  const requested = pending.load(cover, { signal: controller.signal });
  controller.abort();
  await assert.rejects(requested, { code: "ARTWORK_CANCELLED" });
});

test("artwork cache is bounded by entries and bytes, honors expiry and does not cache failures", async () => {
  let reads = 0, clock = 0;
  const proxy = createArtworkProxy({ now: () => clock, cacheTtlMs: 100, maxCacheEntries: 2, maxCacheBytes: png.length * 2,
    fetchImpl: async () => { reads++; return image(); } });
  const urls = [cover, "https://p1.music.126.net/a.jpg", "https://p2.music.126.net/b.jpg"];
  await proxy.load(urls[0]); await proxy.load(urls[1]); await proxy.load(urls[0]); assert.equal(reads, 2);
  await proxy.load(urls[2]); await proxy.load(urls[1]); assert.equal(reads, 4, "least recently used cover was evicted");
  clock = 101; await proxy.load(urls[1]); assert.equal(reads, 5);
  let failures = 0;
  const failure = createArtworkProxy({ fetchImpl: async () => { failures++; throw new Error("raw URL must stay private"); } });
  for (let index = 0; index < 2; index++) await assert.rejects(failure.load(cover), { code: "ARTWORK_UNAVAILABLE" });
  assert.equal(failures, 2);
});

test("public artwork route returns raster data without a session or upstream URL details", async (t) => {
  const calls = [];
  const server = createApiServer({ origins: ["http://localhost:5173"] }, {
    adapters: { configured: {} }, artworkFetch: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("failed")) throw new Error(`Request failed: ${url}`);
      return image();
    },
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/artwork?url=${encodeURIComponent(cover)}`, { headers: { Cookie: "private-browser-cookie", Authorization: "private-browser-token" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.deepEqual(Object.keys(calls[0].options.headers), ["Accept"]);
  const failed = await fetch(`${base}/api/artwork?url=${encodeURIComponent("https://y.gtimg.cn/failed-private-marker.jpg")}`);
  assert.equal(failed.status, 502);
  const body = await failed.text();
  assert.ok(!body.includes("private-marker")); assert.ok(!body.includes("https:"));
  const rejected = await fetch(`${base}/api/artwork?url=${encodeURIComponent(cover)}`, { headers: { Origin: "https://other.example" } });
  assert.equal(rejected.status, 403);
});
