import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APPLE_TOKEN_LIFETIME_SECONDS, createAppleDeveloperTokenProvider } from "./apple-developer.mjs";
import { createAdapters } from "./adapters.mjs";
import { loadConfigFromEnvFile } from "./index.mjs";

const DAY = 24 * 60 * 60 * 1000;
const initialTime = Date.UTC(2026, 10, 24);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "zmusicstats-apple-renew-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const keyPath = join(directory, "fixture.p8");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  writeFileSync(keyPath, pem, { mode: 0o600 });
  return { directory, keyPath, pem, publicKey, config: { appleMusicKeyPath: keyPath, appleMusicTeamId: "TEAM123456", appleMusicKeyId: "KEY1234567" } };
}

function decode(token) {
  const [header, claims, signature] = token.split(".");
  return { header: JSON.parse(Buffer.from(header, "base64url")), claims: JSON.parse(Buffer.from(claims, "base64url")), signature: Buffer.from(signature, "base64url"), input: `${header}.${claims}` };
}

test("local provider issues valid ES256 JWTs with bounded lifetime and caches them", t => {
  const { config, publicKey } = fixture(t);
  let timestamp = initialTime;
  const provider = createAppleDeveloperTokenProvider(config, { now: () => timestamp });
  const first = provider.getToken();
  const decoded = decode(first);
  assert.deepEqual(decoded.header, { alg: "ES256", kid: config.appleMusicKeyId });
  assert.equal(decoded.claims.iss, config.appleMusicTeamId);
  assert.equal(decoded.claims.exp, initialTime / 1000 + APPLE_TOKEN_LIFETIME_SECONDS);
  assert.equal(decoded.signature.length, 64);
  assert.ok(verify("sha256", Buffer.from(decoded.input), { key: publicKey, dsaEncoding: "ieee-p1363" }, decoded.signature));
  timestamp += 28 * DAY;
  assert.equal(provider.getToken(), first);
});

test("tokens refresh before expiry and remain usable beyond the original thirty days", t => {
  const { config, publicKey } = fixture(t);
  let timestamp = initialTime;
  const provider = createAppleDeveloperTokenProvider(config, { now: () => timestamp });
  const first = provider.getToken();
  timestamp += 29 * DAY;
  const refreshed = provider.getToken();
  assert.notEqual(refreshed, first);
  const decoded = decode(refreshed);
  assert.equal(decoded.claims.exp, timestamp / 1000 + APPLE_TOKEN_LIFETIME_SECONDS);
  assert.ok(verify("sha256", Buffer.from(decoded.input), { key: publicKey, dsaEncoding: "ieee-p1363" }, decoded.signature));
  timestamp += 3 * DAY;
  assert.equal(provider.getToken(), refreshed);
});

test("a temporarily missing key keeps a cached token only while valid, and recovers when restored", t => {
  const { config, keyPath, pem } = fixture(t);
  let timestamp = initialTime;
  const provider = createAppleDeveloperTokenProvider(config, { now: () => timestamp });
  const first = provider.getToken();
  unlinkSync(keyPath);
  timestamp += 29 * DAY;
  assert.equal(provider.getToken(), first);
  timestamp += 2 * DAY;
  assert.equal(provider.getToken(), null);
  writeFileSync(keyPath, pem, { mode: 0o600 });
  assert.notEqual(provider.getToken(), first);
  assert.ok(provider.getToken());
});

test("explicit developer JWT remains a fallback, while expired credentials never do", t => {
  const { config, keyPath } = fixture(t);
  const token = createAppleDeveloperTokenProvider(config, { now: () => initialTime }).getToken();
  unlinkSync(keyPath);
  let timestamp = initialTime;
  const provider = createAppleDeveloperTokenProvider({ ...config, appleDeveloperToken: token }, { now: () => timestamp });
  assert.equal(provider.getToken(), token);
  assert.equal(createAppleDeveloperTokenProvider({ appleDeveloperToken: token }, { now: () => timestamp }).getToken(), token);
  timestamp += 31 * DAY;
  assert.equal(provider.getToken(), null);
});

test("unsafe or invalid private key files fail closed without exposing paths or crypto errors", t => {
  const { config, keyPath, directory } = fixture(t);
  const alias = join(directory, "alias.p8");
  symlinkSync(keyPath, alias);
  assert.equal(createAppleDeveloperTokenProvider({ ...config, appleMusicKeyPath: alias }).getToken(), null);
  if (process.platform !== "win32") {
    chmodSync(keyPath, 0o644);
    assert.equal(createAppleDeveloperTokenProvider(config).getToken(), null);
    chmodSync(keyPath, 0o600);
  }
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  assert.equal(createAppleDeveloperTokenProvider(config).getToken(), null);
  writeFileSync(keyPath, "invalid-key");
  assert.equal(createAppleDeveloperTokenProvider(config).getToken(), null);
  assert.equal(createAppleDeveloperTokenProvider({ ...config, appleMusicTeamId: "invalid" }).getToken(), null);
});

test("live adapters validate a locally signed token before exposing it and use it for Apple requests", async t => {
  const { config, publicKey } = fixture(t);
  const requests = [];
  const adapters = createAdapters({ ...config, appleDeveloperToken: "expired-fallback" }, async (url, init) => {
    const token = init.headers.Authorization.slice("Bearer ".length);
    const decoded = decode(token);
    assert.ok(verify("sha256", Buffer.from(decoded.input), { key: publicKey, dsaEncoding: "ieee-p1363" }, decoded.signature));
    requests.push({ url: String(url), token });
    return String(url).endsWith("/v1/test")
      ? new Response("", { status: 200 })
      : Response.json({ data: [{ id: "cn", type: "storefronts" }] });
  });
  assert.equal(adapters.configured.apple, true);
  const first = await adapters.appleConfig();
  const second = await adapters.appleConfig();
  assert.equal(first.developerToken, second.developerToken);
  assert.equal(requests.length, 1);
  await adapters.connectApple("fixture-user-token");
  assert.ok(requests[1].url.endsWith("/v1/me/storefront"));
  assert.equal(requests[1].token, first.developerToken);
  const rejected = createAdapters(config, async () => new Response("", { status: 401 }));
  await assert.rejects(rejected.appleConfig(), { code: "APPLE_CONFIG_INVALID" });
});

test("API reload reads current automatic-signing settings instead of stale inherited values", t => {
  const { directory } = fixture(t);
  const envPath = join(directory, ".env");
  writeFileSync(envPath, "APPLE_MUSIC_KEY_PATH=.auth-state/apple/current.p8\nAPPLE_MUSIC_TEAM_ID=NEWTEAM001\nAPPLE_MUSIC_KEY_ID=NEWKEY0001\n", { mode: 0o600 });
  const config = loadConfigFromEnvFile(envPath, { APPLE_MUSIC_KEY_PATH: "old.p8", APPLE_MUSIC_TEAM_ID: "OLDTEAM001", APPLE_MUSIC_KEY_ID: "OLDKEY0001" });
  assert.equal(config.appleMusicKeyPath, ".auth-state/apple/current.p8");
  assert.equal(config.appleMusicTeamId, "NEWTEAM001");
  assert.equal(config.appleMusicKeyId, "NEWKEY0001");
  writeFileSync(envPath, "APPLE_MUSIC_KEY_PATH=\nAPPLE_MUSIC_TEAM_ID=\nAPPLE_MUSIC_KEY_ID=\n");
  const cleared = loadConfigFromEnvFile(envPath, { APPLE_MUSIC_KEY_PATH: "old.p8", APPLE_MUSIC_TEAM_ID: "OLDTEAM001", APPLE_MUSIC_KEY_ID: "OLDKEY0001" });
  assert.equal(cleared.appleMusicKeyPath, null);
  assert.equal(cleared.appleMusicTeamId, null);
  assert.equal(cleared.appleMusicKeyId, null);
});

test('cloud PEM credentials sign an origin-bound token without a private key file', t => {
  const { pem, publicKey, config } = fixture(t);
  const provider = createAppleDeveloperTokenProvider({ ...config, appleMusicKeyPath: null, appleMusicPrivateKey: pem, appleMusicOrigins: ['https://zmusicstats.vercel.app'] }, { now: () => initialTime });
  const token = provider.getToken(), decoded = decode(token);
  assert.deepEqual(decoded.claims.origin, ['https://zmusicstats.vercel.app']);
  assert.equal(verify('sha256', Buffer.from(decoded.input), { key: publicKey, dsaEncoding: 'ieee-p1363' }, decoded.signature), true);
  assert.ok(!token.includes('PRIVATE KEY'));
});
