import assert from "node:assert/strict";
import test from "node:test";
import { canOpenMobileAuth, readQQMobileAuth } from "./mobile-auth.ts";

const deadline = 2_000_000_000_000;
function response(target = "https://y.qq.com/m/client/qr_code_login/authorize.html?qrcode_id=test-challenge") {
  const scheme = new URL("qqmusic://qq.com/ui/openUrl");
  scheme.searchParams.set("p", JSON.stringify({ url: target, _from_outside: "1" }));
  const url = new URL("https://music.qq.com/unilink/download.html");
  url.searchParams.set("scheme", scheme.href);
  return { status: "available", kind: "app-authorization", url: url.href, expiresAt: deadline, verification: "device-test-required" };
}

test("accepts a request-bound QQ authorization link without changing its payload", () => {
  const input = response();
  assert.deepEqual(readQQMobileAuth(input, deadline), input);
});

test("rejects links that only open an app, another site, or no challenge", () => {
  for (const target of ["https://example.com/authorize?qrcode_id=test", "https://y.qq.com/", "https://y.qq.com/m/client/qr_code_login/authorize.html"]) {
    assert.equal(readQQMobileAuth(response(target), deadline).status, "unavailable");
  }
  assert.equal(readQQMobileAuth({ ...response(), url: "qqmusic://qq.com/ui/myTab" }, deadline).status, "unavailable");
  assert.equal(readQQMobileAuth({ ...response(), url: "https://music.qq.com.evil.test/unilink/download.html" }, deadline).status, "unavailable");
});

test("missing, malformed, and mismatched challenge metadata keep QR fallback available", () => {
  for (const input of [null, {}, { status: "unavailable" }, { ...response(), expiresAt: deadline - 1000 }, { ...response(), verification: "verified" }]) {
    assert.equal(readQQMobileAuth(input, deadline).status, "unavailable");
  }
});

test("only a live waiting or scanned challenge may open the app", () => {
  const auth = readQQMobileAuth(response(), deadline);
  assert.equal(canOpenMobileAuth(auth, "waiting", deadline - 1), true);
  assert.equal(canOpenMobileAuth(auth, "scanned", deadline - 1), true);
  assert.equal(canOpenMobileAuth(auth, "waiting", deadline), false);
  assert.equal(canOpenMobileAuth(auth, "expired", deadline - 1), false);
  assert.equal(canOpenMobileAuth(auth, "connected", deadline - 1), false);
  assert.equal(canOpenMobileAuth(undefined, "waiting", deadline - 1), false);
});

test("keeps known launch failure reasons but never displays arbitrary upstream text", () => {
  assert.deepEqual(readQQMobileAuth({ status: "unavailable", code: "MOBILE_AUTH_TIMEOUT" }, deadline), { status: "unavailable", code: "MOBILE_AUTH_TIMEOUT" });
  assert.deepEqual(readQQMobileAuth({ status: "unavailable", code: "https://example.com/private-token" }, deadline), { status: "unavailable", code: "MOBILE_AUTH_UNAVAILABLE" });
});
