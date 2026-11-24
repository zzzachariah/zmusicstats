/** Server-only developer credentials. Private keys never leave this process. */
import { createPrivateKey, sign } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

export const APPLE_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const APPLE_TOKEN_REFRESH_BEFORE_MS = 24 * 60 * 60 * 1000;

// This is an expiry/shape check, not signature verification. Apple verifies tokens.
export function appleDeveloperTokenUsable(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 16_384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  try {
    const [encodedHeader, encodedPayload] = token.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString());
    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
    return header.alg === "ES256" && typeof header.kid === "string" &&
      typeof claims.iss === "string" && Number.isFinite(claims.exp) &&
      claims.exp * 1000 > now + 60_000;
  } catch { return false; }
}

function loadPrivateKey(filename) {
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(path.resolve(filename), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size === 0 || info.size > 16_384 ||
        (process.platform !== "win32" && (info.mode & 0o077) !== 0)) throw new Error("Private key unavailable.");
    bytes = readFileSync(descriptor);
    const key = createPrivateKey(bytes);
    if (key.asymmetricKeyType !== "ec" || !["prime256v1", "P-256"].includes(key.asymmetricKeyDetails?.namedCurve))
      throw new Error("Private key unavailable.");
    return key;
  } finally {
    bytes?.fill(0);
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Signs on first use and renews on demand one day before expiry. A valid cached token
 * or explicitly configured JWT remains usable during a temporary key-file failure.
 * No timers, network requests, logs, or token/private-key writes are performed here.
 */
export function createAppleDeveloperTokenProvider(config, { now = Date.now } = {}) {
  let cached = null;
  const canSign = typeof config.appleMusicKeyPath === "string" && !!config.appleMusicKeyPath.trim() &&
    /^[A-Z0-9]{10}$/.test(config.appleMusicTeamId ?? "") &&
    /^[A-Z0-9]{10}$/.test(config.appleMusicKeyId ?? "");

  function getToken() {
    const timestamp = now();
    if (cached && cached.expiresAt > timestamp + APPLE_TOKEN_REFRESH_BEFORE_MS && cached.issuedAt <= timestamp + 60_000)
      return cached.token;
    if (canSign) {
      try {
        const key = loadPrivateKey(config.appleMusicKeyPath);
        const seconds = Math.floor(timestamp / 1000);
        const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: config.appleMusicKeyId })).toString("base64url");
        const claims = { iss: config.appleMusicTeamId, iat: seconds - 30, exp: seconds + APPLE_TOKEN_LIFETIME_SECONDS };
        const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
        const signingInput = `${header}.${payload}`;
        const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
        const token = `${signingInput}.${signature.toString("base64url")}`;
        cached = { token, expiresAt: claims.exp * 1000, issuedAt: claims.iat * 1000 };
        return token;
      } catch {
        // File paths and crypto errors can expose private configuration. Never forward them.
      }
    }
    if (cached && cached.issuedAt <= timestamp + 60_000 && appleDeveloperTokenUsable(cached.token, timestamp)) return cached.token;
    return appleDeveloperTokenUsable(config.appleDeveloperToken, timestamp) ? config.appleDeveloperToken : null;
  }

  return { getToken };
}
