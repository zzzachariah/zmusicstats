import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeQqQrImage, resolveQqAuthorizationUrl, qqMobileAuth } from "./qq-mobile-auth.mjs";
import { createAdapters } from "./adapters.mjs";

const image = `data:image/png;base64,${readFileSync(new URL("./fixtures/qq-mobile-auth.png", import.meta.url)).toString("base64")}`;
const shortUrl = "https://c6.y.qq.com/base/fcgi-bin/u?__=public-test-fixture";
const authorizeUrl = "https://y.qq.com/m/client/qr_code_login/authorize.html?qrcode_id=synthetic-same-qr-id";
const redirect = () => new Response(null, { status: 302, headers: { Location: authorizeUrl } });

test("decodes the actual PNG and preserves its QR identity through the official app link", async () => {
  assert.equal(decodeQqQrImage(image), shortUrl);
  const calls = [];
  const result = await qqMobileAuth(image, { fetchImpl: async (url, options) => {
    calls.push(url.href);
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    return redirect();
  } });
  assert.equal(result.status, "available");
  assert.equal(result.verification, "device-test-required");
  assert.deepEqual(calls, [shortUrl]);
  const outer = new URL(result.url), scheme = new URL(outer.searchParams.get("scheme"));
  assert.equal(outer.origin + outer.pathname, "https://music.qq.com/unilink/download.html");
  assert.equal(scheme.protocol + "//" + scheme.host + scheme.pathname, "qqmusic://qq.com/ui/openUrl");
  assert.deepEqual(JSON.parse(scheme.searchParams.get("p")), { url: authorizeUrl, _from_outside: "1" });
});

test("rejects nonofficial, ambiguous, credential-bearing and local redirects before fetching them", async () => {
  const bad = [
    "http://c6.y.qq.com/base/fcgi-bin/u?__=fixture", "https://c6.y.qq.com.evil.test/base/fcgi-bin/u?__=fixture",
    "https://user:pass@c6.y.qq.com/base/fcgi-bin/u?__=fixture", "https://c6.y.qq.com:8443/base/fcgi-bin/u?__=fixture",
    "https://127.0.0.1/base/fcgi-bin/u?__=fixture", "https://c6.y.qq.com/base/fcgi-bin/u?__=one&__=two",
    `${authorizeUrl}&redirect=https://evil.test`, `${authorizeUrl}#fragment`, "https://y.qq.com/other?qrcode_id=fixture",
  ];
  for (const url of bad) {
    let calls = 0;
    await assert.rejects(resolveQqAuthorizationUrl(url, { fetchImpl: async () => { calls++; return redirect(); } }), { code: "MOBILE_AUTH_URL_REJECTED" });
    assert.equal(calls, 0);
    const result = await qqMobileAuth(image, { fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { Location: url } }); } });
    assert.equal(result.status, "unavailable");
    assert.equal(result.code, "MOBILE_AUTH_URL_REJECTED");
    assert.equal(calls, 1);
    assert.equal("url" in result, false);
  }
});

test("redirect loops, unexpected HTML and network timeouts preserve the scan fallback", async () => {
  let calls = 0;
  const loop = await qqMobileAuth(image, { fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { Location: shortUrl } }); } });
  assert.equal(calls, 3);
  assert.equal(loop.code, "MOBILE_AUTH_REDIRECT_UNAVAILABLE");
  const html = await qqMobileAuth(image, { fetchImpl: async () => new Response("Unrelated landing page") });
  assert.equal(html.status, "unavailable");
  const timeout = await qqMobileAuth(image, { fetchImpl: async () => { throw new DOMException("contains a private URL", "TimeoutError"); } });
  assert.equal(timeout.code, "MOBILE_AUTH_TIMEOUT");
  assert.equal(JSON.stringify(timeout).includes("private URL"), false);
});

test("bad or oversized PNG data is rejected before image inflation or network requests", async () => {
  const huge = Buffer.from(image.split(",")[1], "base64");
  huge.writeUInt32BE(100_000, 16);
  for (const value of ["data:image/png;base64,aGVsbG8=", "data:image/jpeg;base64,aGVsbG8=", `data:image/png;base64,${huge.toString("base64")}`]) {
    let calls = 0;
    const result = await qqMobileAuth(value, { fetchImpl: async () => { calls++; return redirect(); } });
    assert.equal(result.status, "unavailable");
    assert.equal(result.code, "MOBILE_AUTH_QR_UNREADABLE");
    assert.equal(calls, 0);
  }
});

test("adapter adds mobile authorization to the same created QR and never mints a replacement", async () => {
  for (const succeeds of [true, false]) {
    const calls = [];
    const adapters = createAdapters({ qqBase: "http://127.0.0.1:3201", qqChannel: "qqmusic" }, async url => {
      calls.push(url.hostname + url.pathname);
      if (url.pathname === "/login/qr/key") return Response.json({ code: 200, data: { unikey: "gateway-private-fixture" } });
      if (url.pathname === "/login/qr/create") return Response.json({ code: 200, data: { qrimg: image } });
      if (!succeeds) throw Error("private transport URL must not be exposed");
      return redirect();
    });
    const result = await adapters.createQr("qq");
    assert.equal(result.key, "gateway-private-fixture");
    assert.equal(result.qrImage, image);
    assert.equal(result.mobileAuth.status, succeeds ? "available" : "unavailable");
    assert.equal(calls.filter(value => value.endsWith("/login/qr/key")).length, 1);
    assert.equal(calls.filter(value => value.endsWith("/login/qr/create")).length, 1);
    assert.ok(result.expiresAt <= Date.now() + 180_000);
  }
});
