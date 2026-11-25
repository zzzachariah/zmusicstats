import { createHmac, randomBytes } from "node:crypto";
import { ApiError, createAdapters, monthPeriod, publicIssue } from "./adapters.mjs";
import { publicAccount } from "./account.mjs";
import { ArtworkError, createArtworkProxy } from "./artwork.mjs";
import { createTransientStore } from "./cloud-store.mjs";
import { createQqRelay } from "./cloud-qq-relay.mjs";
import { gatewayFetch } from "./cloud-gateways.mjs";

const PROVIDERS = ["netease", "qq", "apple"], COOKIE = "__Host-zmusicstats", TTL = 12 * 60 * 60_000;
const opaque = () => randomBytes(32).toString("base64url");
const validId = value => /^[A-Za-z0-9_-]{43}$/.test(value ?? "");
const failure = (status, code, message) => new ApiError(status, code, message);
const changed = () => failure(409, "CONNECTION_CHANGED", "账号连接已改变，请重新读取。");

export function createCloudApi({ env = process.env, store, adapters, artwork, waitUntil = () => {}, now = Date.now } = {}) {
  const secret = env.CLOUD_SESSION_SECRET;
  store ??= createTransientStore({ secret, namespace: env.VERCEL_ENV === "production" ? "production" : "preview", now });
  const relay = createQqRelay({ store, waitUntil, now });
  const origins = new Set(["https://zmusicstats.vercel.app", ...(env.APP_ORIGINS ?? "").split(","), ...[env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(host => `https://${host}`)]);
  adapters ??= createAdapters({ neteaseBase: "https://netease.internal", qqBase: "https://qq.internal", qqChannel: "qqmusic", timeoutMs: 35_000,
    metadataCachePath: null, appleMusicPrivateKey: env.APPLE_MUSIC_PRIVATE_KEY, appleMusicTeamId: env.APPLE_MUSIC_TEAM_ID,
    appleMusicKeyId: env.APPLE_MUSIC_KEY_ID, appleMusicOrigins: [...origins].filter(value => value.startsWith("https://")),
    appleAppName: "zmusicstats", appleMusicRequestOrigin: "https://zmusicstats.vercel.app", appleDeveloperToken: env.APPLE_MUSIC_DEVELOPER_TOKEN,
  }, gatewayFetch({ relay, qqSecret: env.QQ_SESSION_SECRET }));
  artwork ??= createArtworkProxy({ now });
  async function limit(key, max, windowMs = 60_000) {
    await store.update(`limit:${key}`, record => {
      const current = record ?? { count: 0, expiresAt: now() + windowMs };
      if (current.count >= max) throw failure(429, "RATE_LIMITED", "请求过于频繁，请稍候重试。");
      current.count++; return current;
    });
  }
  const assertSession = value => { if (!value) throw failure(401, "CONNECTION_EXPIRED", "登录已过期，请重新连接。"); return value; };
  async function body(request, max = 32768) {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw failure(415, "JSON_REQUIRED", "请求格式不正确。");
    const value = await request.text();
    if (Buffer.byteLength(value) > max) throw failure(413, "REQUEST_TOO_LARGE", "请求内容过大。");
    try { return JSON.parse(value); } catch { throw failure(400, "INVALID_JSON", "请求内容不完整。"); }
  }
  return async request => {
    let cookie;
    const reply = (value, status = 200) => Response.json(value, { status, headers: {
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    } });
    try {
      const url = new URL(request.url), method = request.method, origin = request.headers.get("origin");
      if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && !origins.has(origin)) ||
        (!["GET", "HEAD"].includes(method) && !origin)) throw failure(403, "ORIGIN_REJECTED", "请从本站页面发起操作。");
      if (url.pathname === "/api/health") return reply({ ok: true, service: "zmusicstats", mode: "local-first", reportStorage: "browser", liveData: "requires-connection" });
      if (url.pathname === "/api/artwork" && method === "GET") {
        const image = await artwork.load(url.searchParams.get("url"), { signal: request.signal });
        return new Response(image.bytes, { headers: { "Content-Type": image.contentType, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
      }
      const supplied = request.headers.get("cookie")?.match(/(?:^|;\s*)__Host-zmusicstats=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
      let id = supplied, session = id ? (await store.read(`session:${id}`)).value : null;
      if (!session) {
        if (url.pathname !== "/api/connections" || method !== "GET") throw failure(401, "CONNECTION_EXPIRED", "请先打开连接管理，再连接账号。");
        const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0] ?? "local";
        const bucket = createHmac("sha256", secret).update(ip).digest("hex");
        await limit(`new:${bucket}`, 20, 60 * 60_000);
        id = opaque(); session = { expiresAt: now() + TTL, connections: {}, qrs: {}, revision: 0 };
        await store.update(`session:${id}`, () => session);
        cookie = `${COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}`;
      }
      const sessionKey = `session:${id}`;
      const stillCurrent = async provider => {
        const current = assertSession((await store.read(sessionKey)).value);
        if (provider ? current.connections[provider]?.connectionId !== session.connections[provider]?.connectionId : current.revision !== session.revision) throw changed();
      };
      const connection = provider => {
        if (!session.connections[provider]) throw failure(401, "NOT_CONNECTED", "请先连接这个音乐平台。");
        return session.connections[provider];
      };
      if (url.pathname === "/api/connections" && method === "GET") return reply({ storage: "browser", expiresAt: session.expiresAt,
        providers: PROVIDERS.map(id => ({ id, name: { netease: "网易云音乐", qq: "QQ 音乐", apple: "Apple Music" }[id],
          configured: !!adapters.configured[id], connected: !!session.connections[id], methods: adapters.configured[id] ? [id === "apple" ? "musickit" : "qr"] : [],
          reasonCode: adapters.configured[id] ? null : id === "apple" ? "APPLE_NOT_CONFIGURED" : "GATEWAY_NOT_CONFIGURED",
          account: publicAccount(session.connections[id]?.account), connectionId: session.connections[id]?.connectionId ?? null,
          reportScope: session.connections[id]?.reportScope ?? session.connections[id]?.connectionId ?? null,
        })) });
      const qrRoute = url.pathname.match(/^\/api\/auth\/(netease|qq)\/qr(?:\/([A-Za-z0-9_-]{43}))?$/);
      if (qrRoute && method === "POST" && !qrRoute[2]) {
        const provider = qrRoute[1]; await limit(`${id}:qr`, 8, 10 * 60_000);
        const qrId = opaque();
        await store.update(sessionKey, current => { assertSession(current); current.qrs[provider] = { id: qrId, expiresAt: now() + 180_000 }; return current; });
        const upstream = await adapters.createQr(provider);
        const expiresAt = Math.min(now() + 180_000, upstream.expiresAt ?? Infinity);
        await store.update(sessionKey, current => {
          if (assertSession(current).qrs[provider]?.id !== qrId) throw changed();
          current.qrs[provider] = { id: qrId, key: upstream.key, expiresAt }; return current;
        });
        return reply({ id: qrId, provider, qrImage: upstream.qrImage, expiresAt, ...(upstream.mobileAuth ? { mobileAuth: { ...upstream.mobileAuth, expiresAt } } : {}) });
      }
      if (qrRoute && method === "GET" && validId(qrRoute[2])) {
        const provider = qrRoute[1], qr = session.qrs[provider];
        if (!qr || qr.id !== qrRoute[2]) throw failure(404, "QR_NOT_FOUND", "二维码已失效，请重新生成。");
        if (qr.expiresAt <= now()) return reply({ provider, state: "expired" });
        if (qr.done) return reply({ provider, state: "connected", account: qr.account });
        await limit(`${id}:poll`, 50);
        const result = await adapters.checkQr(provider, qr.key);
        if (result.state === "connected") {
          let profile; try { profile = await adapters.account(provider, result.credential, { includeSubject: true }); } catch { /* Keep confirmed authorization. */ }
          const reportScope = createHmac("sha256", secret).update(`${provider}:${profile?.subject ?? result.credential.secret}`).digest("hex");
          await store.update(sessionKey, current => {
          if (assertSession(current).qrs[provider]?.id !== qr.id) throw changed();
          if (current.qrs[provider].done) return undefined;
          current.connections[provider] = { credential: result.credential, account: publicAccount(profile ?? result.account), reportScope, connectionId: opaque(), connectedAt: now() };
          current.qrs[provider] = { id: qr.id, done: true, account: publicAccount(profile ?? result.account), expiresAt: qr.expiresAt };
          current.revision++; return current;
        }); }
        else { const current = assertSession((await store.read(sessionKey)).value); if (current.qrs[provider]?.id !== qr.id) throw changed(); }
        return reply({ provider, state: result.state, ...(result.account ? { account: publicAccount(result.account) } : {}) });
      }
      if (url.pathname === "/api/auth/apple/config" && method === "GET") { await limit(`${id}:apple-config`, 12); return reply(await adapters.appleConfig()); }
      if (url.pathname === "/api/auth/apple/token" && method === "POST") {
        await limit(`${id}:apple-auth`, 5); const { musicUserToken } = await body(request, 24576);
        const result = await adapters.connectApple(musicUserToken);
        await store.update(sessionKey, current => {
          if (assertSession(current).revision !== session.revision) throw changed();
          current.connections.apple = { ...result, account: publicAccount(result.account), connectionId: opaque(), connectedAt: now() };
          current.revision++; return current;
        });
        return reply({ provider: "apple", state: "connected", account: publicAccount(result.account) });
      }
      const disconnect = url.pathname.match(/^\/api\/connections\/(netease|qq|apple)$/);
      if (disconnect && method === "DELETE") {
        await store.update(sessionKey, current => {
          assertSession(current); delete current.connections[disconnect[1]]; delete current.qrs[disconnect[1]]; current.revision++; return current;
        });
        return reply({ provider: disconnect[1], connected: false });
      }
      const directory = url.pathname.match(/^\/api\/history\/(netease|qq)\/months$/);
      if (directory && method === "GET") {
        const provider = directory[1], auth = connection(provider); await limit(`${id}:directory`, 10);
        const result = await (provider === "netease" ? adapters.history(auth.credential, { signal: request.signal }) : adapters.qqHistoryMonths(auth.credential, { signal: request.signal }));
        await stillCurrent(provider); return reply(result);
      }
      if (url.pathname === "/api/report" && method === "GET") {
        const month = url.searchParams.get("month"), period = monthPeriod(month);
        const requested = url.searchParams.get("providers")?.split(",") ?? PROVIDERS;
        if (requested.some(provider => !PROVIDERS.includes(provider))) throw failure(400, "INVALID_PROVIDER", "平台不正确。");
        const connected = requested.filter(provider => session.connections[provider]);
        if (!connected.length) throw failure(401, "NOT_CONNECTED", "请先连接音乐平台。");
        await limit(`${id}:report`, 36);
        const results = await Promise.allSettled(connected.map(provider => adapters.report(provider, session.connections[provider].credential, month, { signal: request.signal, attempts: 1, timeoutMs: 30_000 })));
        await stillCurrent(); const platforms = [], issues = [];
        results.forEach((result, index) => { if (result.status === "fulfilled") { platforms.push(result.value.platform); issues.push(...result.value.issues); } else issues.push(publicIssue(connected[index], result.reason)); });
        return reply({ mode: "live", input: { mode: "live", period, expectedPlatforms: connected, platforms }, issues, fetchedAt: new Date(now()).toISOString() });
      }
      if (url.pathname === "/api/metadata" && method === "POST") {
        if (!Object.keys(session.connections).length) throw failure(401, "NOT_CONNECTED", "请先连接音乐平台。");
        await limit(`${id}:metadata`, 24);
        const { tracks } = await body(request);
        if (!Array.isArray(tracks) || tracks.length > 20 || tracks.some(track => !PROVIDERS.includes(track?.provider) || typeof track.id !== "string" || !track.id || track.id.length > 128 || typeof track.title !== "string" || track.title.length > 500 || typeof track.artist !== "string" || track.artist.length > 500 || (track.album != null && (typeof track.album !== "string" || track.album.length > 500)))) throw failure(400, "INVALID_TRACKS", "一次最多查询 20 首有效歌曲。");
        const result = await adapters.metadata(tracks.map(({ provider, id, title, artist, album }) => ({ provider, id, title, artist, album })), session.connections);
        await stillCurrent(); return reply(result);
      }
      throw failure(404, "NOT_FOUND", "请求的功能不存在。");
    } catch (error) {
      const known = error instanceof ApiError || error instanceof ArtworkError;
      return reply({ error: { code: known ? error.code : "CLOUD_SERVICE_UNAVAILABLE", message: known ? error.message : "线上连接服务暂不可用，请重试。" } }, known ? error.status : 503);
    }
  };
}
