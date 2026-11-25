import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { get, put, BlobPreconditionFailedError, BlobServiceRateLimited } from "@vercel/blob";
import { ApiError } from "./adapters.mjs";

// Only short-lived login sessions and QR events are stored here. Never reports.
export function createTransientStore({ secret, namespace = "production", sdk = { get, put }, now = Date.now } = {}) {
  const key = Buffer.from(secret ?? "", "base64url");
  if (key.length !== 32) throw new ApiError(503, "CLOUD_NOT_CONFIGURED", "线上登录服务尚未配置完成。");
  const pathFor = id => `auth-v1/${namespace}/${createHmac("sha256", key).update(id).digest("hex")}.json`;
  const encode = (id, value) => {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(id));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: bytes.toString("base64url") });
  };
  const decode = (id, envelope) => {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64url"));
    decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const bytes = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64url")), decipher.final()]);
    try { return JSON.parse(bytes.toString()); } finally { bytes.fill(0); }
  };
  async function read(id) {
    // Compressed responses carry W/ weak ETags, which cannot be used with If-Match.
    // Identity encoding keeps the bytes and strong ETag from the same consistent read.
    const response = await sdk.get(pathFor(id), { access: "private", useCache: false, headers: { "Accept-Encoding": "identity" } });
    if (!response || response.statusCode !== 200) return { value: null, etag: null };
    const value = decode(id, await new Response(response.stream).json());
    return { value: value.expiresAt > now() ? value : null, etag: response.blob.etag };
  }
  async function update(id, transform) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { value, etag } = await read(id);
      const next = transform(value ? structuredClone(value) : null);
      if (next === undefined) return value;
      try {
        await sdk.put(pathFor(id), encode(id, next), { access: "private", addRandomSuffix: false,
          allowOverwrite: !!etag, ...(etag ? { ifMatch: etag } : {}), contentType: "application/json", ttlDays: 1 });
        return next;
      } catch (error) {
        if (error instanceof BlobServiceRateLimited || /RateLimited/.test(error?.name ?? "") || /too many|once per|once every/i.test(error?.message ?? "")) { await new Promise(resolve => setTimeout(resolve, 1100 + attempt * 200)); continue; }
        // The SDK's subclasses keep Error.name === "Error"; use their actual class.
        if (!(error instanceof BlobPreconditionFailedError) && !/Precondition|AlreadyExists|Conflict/.test(error?.name ?? "") && !/already exists/i.test(error?.message ?? "")) throw error;
      }
    }
    throw new ApiError(409, "SESSION_BUSY", "账号状态正在更新，请稍后重试。");
  }
  return { read, update };
}
