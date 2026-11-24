import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { dirname, join } from "node:path";
import { createEncryptedSessionStore } from "./session-store.mjs";
import { createHistoryImporter } from "./history-import.mjs";
import { publicAccount } from "./account.mjs";
import { ArtworkError, createArtworkProxy } from "./artwork.mjs";
import {
  ApiError,
  createAdapters,
  monthPeriod,
  publicIssue,
} from "./adapters.mjs";

export const SESSION_COOKIE = "zmusicstats_session";
const PROVIDERS = ["netease", "qq", "apple"];
const SESSION_TTL = 12 * 60 * 60 * 1000;
const QR_TTL = 3 * 60 * 1000;

export function configFromEnv(env = process.env) {
  return {
    host: env.API_HOST || "127.0.0.1",
    port: Number(env.API_PORT || 8787),
    origins: (
      env.APP_ORIGINS ||
      "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
    )
      .split(",")
      .map((value) => value.trim()),
    neteaseBase: env.NETEASE_API_BASE_URL || null,
    qqBase: env.QQ_API_BASE_URL || null,
    qqChannel: env.QQ_QR_CHANNEL || "qq",
    enableQqKey: env.ENABLE_QQ_PERSONAL_KEY === "true",
    neteaseDurationPath: env.NETEASE_DURATION_PATH || null,
    neteaseDurationUnit: env.NETEASE_DURATION_UNIT || null,
    appleDeveloperToken: env.APPLE_MUSIC_DEVELOPER_TOKEN || null,
    appleMusicKeyPath: env.APPLE_MUSIC_KEY_PATH || null,
    appleMusicTeamId: env.APPLE_MUSIC_TEAM_ID || null,
    appleMusicKeyId: env.APPLE_MUSIC_KEY_ID || null,
    appleAppName: env.APPLE_MUSIC_APP_NAME || "zmusicstats",
    secureCookies: env.COOKIE_SECURE === "true",
    timeoutMs: 12_000,
    sessionStorePath: env.SESSION_STORE_PATH === "off" ? null : env.SESSION_STORE_PATH || ".auth-state/sessions.enc",
    metadataCachePath: env.METADATA_CACHE_PATH || "work/music-metadata/catalog.json",
  };
}

export function loadConfigFromEnvFile(file = ".env", env = process.env) {
  let local = {};
  try { local = parseEnv(readFileSync(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const merged = { ...local, ...env };
  // The dev launcher inherits .env once. Read connector settings afresh on each API restart.
  for (const key of ["NETEASE_API_BASE_URL", "QQ_API_BASE_URL", "QQ_QR_CHANNEL", "ENABLE_QQ_PERSONAL_KEY",
    "NETEASE_DURATION_PATH", "NETEASE_DURATION_UNIT", "APPLE_MUSIC_DEVELOPER_TOKEN", "APPLE_MUSIC_APP_NAME",
    "APPLE_MUSIC_KEY_PATH", "APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID", "SESSION_STORE_PATH"]) {
    if (Object.hasOwn(local, key)) merged[key] = local[key];
  }
  // Keep automatically discovered phone/LAN origins supplied by the dev launcher.
  if (local.APP_ORIGINS && env.APP_ORIGINS)
    merged.APP_ORIGINS = [...new Set(`${local.APP_ORIGINS},${env.APP_ORIGINS}`.split(",").map(value => value.trim()))].join(",");
  return configFromEnv(merged);
}

export function createApiServer(config = configFromEnv(), dependencies = {}) {
  const adapters =
    dependencies.adapters ??
    createAdapters(config, dependencies.fetch ?? fetch);
  const sessions = new Map();
  const origins = new Set(config.origins ?? []);
  const now = dependencies.now ?? Date.now;
  const artwork = dependencies.artwork ?? createArtworkProxy({ fetchImpl: dependencies.artworkFetch ?? fetch, now });
  const token = () => randomBytes(32).toString("base64url");
  // Explicit config keeps injected test servers memory-only. Normal local startup opts in via env config.
  const sessionStore = config.sessionStorePath ? createEncryptedSessionStore(config.sessionStorePath, { now }) : null;
  for (const record of sessionStore?.load() ?? []) {
    sessions.set(record.id, { ...record, qrs: new Map(), cache: new Map(), requests: [] });
  }
  function persistConnections() { sessionStore?.save([...sessions.values()]); }
  const informationalCodes = new Set([
    "DURATION_MAPPING_REQUIRED", "GENRE_NOT_AVAILABLE", "APPLE_RECENT_NOT_PERIOD", "OFFICIAL_MONTH_DURATION_UNAVAILABLE",
  ]);
  function trustedHistory(result, period) {
    const platform = result?.platform;
    const matches = value => value?.start === period.start && value?.end === period.end && value?.timeZone === period.timeZone;
    return platform?.id === "netease" && matches(platform.period) && matches(platform.rankingPeriod)
      && platform.durationKind === "actual-total" && platform.coverageComplete === true
      && Number.isFinite(platform.listenSeconds) && platform.listenSeconds >= 0
      && Array.isArray(platform.tracks) && (platform.tracks.length > 0 || platform.listenSeconds === 0)
      && Array.isArray(result.issues) && result.issues.every(issue => informationalCodes.has(issue.code));
  }
  function withCachedMetadata(platform) {
    if (typeof adapters.cachedMetadata !== "function" || !Array.isArray(platform.tracks)) return platform;
    return { ...platform, tracks: adapters.cachedMetadata(platform.id, platform.tracks) };
  }
  function decorateReport(value, persisted) {
    const platforms = value.input.platforms.map(platform =>
      withCachedMetadata(persisted && platform.id === "netease" ? persisted.platform : platform));
    return { ...value, input: { ...value.input, platforms },
      issues: persisted ? [...value.issues.filter(issue => issue.provider !== "netease"), ...persisted.issues] : value.issues };
  }
  const transientIssues = new Set(["UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE", "UPSTREAM_REJECTED", "UPSTREAM_INVALID_RESPONSE"]);
  const history = createHistoryImporter({
    now,
    storePath: config.sessionStorePath ? join(dirname(config.sessionStorePath), "history.enc") : undefined,
    discoverMonths: (session, signal) => adapters.history(session.connections.netease.credential, { signal }),
    readMonth: async (session, month, signal, { cached, refreshDuration } = {}) => {
      const credential = session.connections.netease.credential;
      if (refreshDuration && cached) {
        let duration;
        try { duration = await adapters.neteaseDuration(credential, month, { signal, attempts: 1, timeoutMs: 12_000 }); }
        catch (error) {
          if (signal.aborted || !transientIssues.has(error?.code)) throw error;
          duration = await adapters.neteaseDuration(credential, month, { signal, attempts: 1, timeoutMs: 30_000 });
        }
        const partialRank = cached.issues.some(issue => issue.code === "TOP_RANK_PARTIAL");
        return {
          platform: { ...cached.platform, ...duration },
          issues: cached.issues.filter(issue => issue.code !== "DURATION_MAPPING_REQUIRED"
            && (partialRank || !transientIssues.has(issue.code))),
        };
      }
      const first = await adapters.report("netease", credential, month, { signal, attempts: 1, timeoutMs: 12_000 });
      if (signal.aborted || !first.issues.some(issue => transientIssues.has(issue.code))) return first;
      // A fast first pass limits slow months; one longer retry can recover intermittent upstream delays.
      const retry = await adapters.report("netease", credential, month, { signal, attempts: 1, timeoutMs: 30_000 });
      return retry.platform.tracks.length >= first.platform.tracks.length ? retry : first;
    },
  });

  async function refreshAccounts(session) {
    if (typeof adapters.account !== "function") return;
    await Promise.all(PROVIDERS.map(async id => {
      const connection = session.connections[id];
      if (!connection) return;
      if (connection.accountRefresh) return connection.accountRefresh;
      if (connection.accountCheckedAt && now() - connection.accountCheckedAt < 60_000) return;
      connection.accountCheckedAt = now();
      connection.accountRefresh = (async () => {
        try {
          const account = publicAccount(await adapters.account(id, connection.credential));
          // An old profile request must not overwrite a replacement account or undo disconnect.
          if (account && session.connections[id] === connection) {
            connection.account = account;
            persistConnections();
          }
        } catch { /* Display-name lookup failure must never invalidate a confirmed login. */ }
      })();
      try { await connection.accountRefresh; } finally { delete connection.accountRefresh; }
    }));
  }

  function cleanup() {
    let changed = false;
    for (const [id, session] of sessions)
      if (session.expiresAt < now()) { history.clear(session); sessions.delete(id); changed = true; }
    if (changed) persistConnections();
  }
  function sessionFor(req, res) {
    cleanup();
    const cookie = req.headers.cookie?.match(
      /(?:^|;\s*)zmusicstats_session=([A-Za-z0-9_-]{43})(?:;|$)/,
    )?.[1];
    let session = cookie ? sessions.get(cookie) : null;
    if (!session) {
      if (sessions.size >= 500)
        throw new ApiError(503, "SERVER_BUSY", "服务暂时繁忙，请稍后重试。");
      const id = token();
      session = {
        id,
        version: 0,
        expiresAt: now() + SESSION_TTL,
        connections: {},
        qrs: new Map(),
        cache: new Map(),
        requests: [],
      };
      sessions.set(id, session);
      res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${config.secureCookies ? "; Secure" : ""}`,
      );
    }
    return session;
  }
  function json(res, status, body) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(JSON.stringify(body));
  }
  function protect(req) {
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (site === "cross-site" || (origin && !origins.has(origin)))
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "请从本站页面发起操作。");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !origin)
      throw new ApiError(403, "ORIGIN_REQUIRED", "请从本站页面发起操作。");
  }
  async function body(req, maxBytes = 4096) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new ApiError(415, "JSON_REQUIRED", "请求格式不正确。");
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes)
        throw new ApiError(413, "REQUEST_TOO_LARGE", "请求内容过长。");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new ApiError(400, "INVALID_JSON", "请求格式不正确。");
    }
  }
  function rateLimit(session, category, limit, window = 60_000) {
    session.requests = session.requests.filter(
      (item) => item.at > now() - window,
    );
    if (
      session.requests.filter((item) => item.category === category).length >=
      limit
    )
      throw new ApiError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。");
    session.requests.push({ category, at: now() });
  }
  function providerInfo(id, session) {
    const connected = Boolean(session.connections[id]);
    const methods = [
      ...(adapters.configured[id] ? [id === "apple" ? "musickit" : "qr"] : []),
      ...(id === "qq" && config.enableQqKey ? ["api-key"] : []),
    ];
    return {
      id,
      name: { netease: "网易云音乐", qq: "QQ 音乐", apple: "Apple Music" }[id],
      configured: methods.length > 0,
      connected,
      methods,
      reasonCode: methods.length
        ? null
        : id === "apple"
          ? "APPLE_NOT_CONFIGURED"
          : "GATEWAY_NOT_CONFIGURED",
      account: publicAccount(session.connections[id]?.account),
    };
  }
  const server = createServer(async (req, res) => {
    try {
      protect(req);
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/"))
        throw new ApiError(404, "NOT_FOUND", "页面不存在。");
      if (url.pathname === "/api/health" && req.method === "GET")
        return json(res, 200, {
          ok: true,
          service: "zmusicstats",
          liveData: "requires-connection",
        });
      if (url.pathname === "/api/artwork" && req.method === "GET") {
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once("close", cancel);
        try {
          const image = await artwork.load(url.searchParams.get("url"), { signal: controller.signal });
          if (res.destroyed) return;
          res.writeHead(200, {
            "Content-Type": image.contentType,
            "Content-Length": image.bytes.length,
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Referrer-Policy": "no-referrer",
          });
          return res.end(image.bytes);
        } finally { res.removeListener("close", cancel); }
      }
      const session = sessionFor(req, res);
      if (url.pathname === "/api/metadata" && req.method === "POST") {
        rateLimit(session, "metadata", 20);
        const { tracks } = await body(req, 32_768);
        if (!Array.isArray(tracks) || tracks.length > 20 || tracks.some(track =>
          !PROVIDERS.includes(track?.provider) || typeof track.id !== "string" || !track.id || track.id.length > 128
          || typeof track.title !== "string" || track.title.length > 500 || typeof track.artist !== "string" || track.artist.length > 500
          || (track.album != null && (typeof track.album !== "string" || track.album.length > 500))))
          throw new ApiError(400, "INVALID_TRACKS", "一次最多查询 20 首有效歌曲。");
        if (typeof adapters.metadata !== "function") throw new ApiError(503, "METADATA_UNAVAILABLE", "歌曲资料服务暂不可用。");
        const safeTracks = tracks.map(({ provider, id, title, artist, album }) => ({ provider, id, title, artist, ...(album ? { album } : {}) }));
        return json(res, 200, await adapters.metadata(safeTracks, session.connections));
      }
      if (url.pathname === "/api/history/netease/reports" && req.method === "GET") {
        const saved = history.reports(session);
        return json(res, 200, {
          inputs: saved.map(({ result }) => ({ mode: "live", period: result.platform.period, expectedPlatforms: ["netease"], platforms: [withCachedMetadata(result.platform)] })),
          months: saved.map(item => item.month),
          issues: saved.flatMap(({ month, result }) => result.issues.map(issue => ({ month, ...issue }))),
        });
      }
      if (url.pathname === "/api/history/qq/months" && req.method === "GET") {
        const connection = session.connections.qq;
        if (!connection) throw new ApiError(401, "NOT_CONNECTED", "请先连接 QQ 音乐账号。");
        if (typeof adapters.qqHistoryMonths !== "function")
          throw new ApiError(503, "HISTORY_DIRECTORY_UNAVAILABLE", "QQ 音乐历史月份目录暂不可用。");
        rateLimit(session, "history-qq-months", 10);
        const directory = await adapters.qqHistoryMonths(connection.credential);
        if (session.connections.qq !== connection)
          throw new ApiError(409, "CONNECTION_CHANGED", "QQ 音乐账号连接已改变，请重新读取历史月份。");
        return json(res, 200, directory);
      }
      if (url.pathname === "/api/history/netease") {
        if (req.method === "GET") return json(res, 200, { job: history.status(session) });
        if (req.method === "DELETE") return json(res, 200, { job: history.cancel(session) });
        if (req.method === "POST") {
          if (!session.connections.netease) throw new ApiError(401, "NOT_CONNECTED", "请先连接网易云音乐账号。");
          rateLimit(session, "history-start", 5);
          const options = req.headers["content-type"]?.startsWith("application/json") ? await body(req) : {};
          if (options.refreshDuration === true) session.cache.clear();
          return json(res, 200, { job: history.start(session, { refreshDuration: options.refreshDuration === true }) });
        }
      }
      if (url.pathname === "/api/connections" && req.method === "GET") {
        await refreshAccounts(session);
        return json(res, 200, {
          providers: PROVIDERS.map((id) => providerInfo(id, session)),
        });
      }
      if (url.pathname === "/api/auth/apple/config" && req.method === "GET") {
        if (!adapters.configured.apple)
          throw new ApiError(
            503,
            "APPLE_NOT_CONFIGURED",
            "Apple Music 连接尚未配置，或开发者令牌已过期。",
          );
        rateLimit(session, "apple-config", 10);
        return json(res, 200, await adapters.appleConfig());
      }
      if (url.pathname === "/api/auth/apple/token" && req.method === "POST") {
        if (!adapters.configured.apple)
          throw new ApiError(
            503,
            "APPLE_NOT_CONFIGURED",
            "Apple Music 连接尚未配置，或开发者令牌已过期。",
          );
        rateLimit(session, "apple-connect", 5);
        const { musicUserToken } = await body(req, 24_576);
        const version = session.version;
        const result = await adapters.connectApple(musicUserToken);
        if (session.version !== version)
          throw new ApiError(
            409,
            "CONNECTION_CHANGED",
            "账号连接已改变，请重新操作。",
          );
        session.connections.apple = { ...result, connectedAt: now() };
        session.version += 1;
        session.cache.clear();
        persistConnections();
        return json(res, 200, {
          provider: "apple",
          state: "connected",
          account: result.account,
        });
      }
      const auth = url.pathname.match(
        /^\/api\/auth\/(netease|qq)\/qr(?:\/([A-Za-z0-9_-]{43}))?$/,
      );
      if (auth && req.method === "POST" && !auth[2]) {
        const provider = auth[1];
        if (!adapters.configured[provider])
          throw new ApiError(
            503,
            "GATEWAY_NOT_CONFIGURED",
            "这个平台还没有配置扫码连接服务。",
          );
        rateLimit(session, "create-qr", 5);
        const upstream = await adapters.createQr(provider);
        // A newer QR replaces an older pending QR for the same platform and browser.
        for (const [id, qr] of session.qrs)
          if (qr.provider === provider || qr.expiresAt < now())
            session.qrs.delete(id);
        const id = token();
        const expiresAt = Number.isFinite(upstream.expiresAt)
          ? Math.min(now() + QR_TTL, upstream.expiresAt) : now() + QR_TTL;
        session.qrs.set(id, {
          provider,
          key: upstream.key,
          expiresAt,
          lastPoll: 0,
        });
        return json(res, 200, {
          id,
          provider,
          qrImage: upstream.qrImage,
          expiresAt,
          ...(provider === "qq" && upstream.mobileAuth ? { mobileAuth: { ...upstream.mobileAuth, expiresAt } } : {}),
        });
      }
      if (auth && req.method === "GET" && auth[2]) {
        const provider = auth[1],
          id = auth[2],
          qr = session.qrs.get(id);
        if (!qr || qr.provider !== provider)
          throw new ApiError(404, "QR_NOT_FOUND", "二维码已失效，请重新生成。");
        if (qr.expiresAt < now()) {
          session.qrs.delete(id);
          return json(res, 200, { provider, state: "expired" });
        }
        if (qr.done)
          return json(res, 200, {
            provider,
            state: "connected",
            account: qr.account,
          });
        if (now() - qr.lastPoll < 1200)
          throw new ApiError(429, "RATE_LIMITED", "正在等待确认，请稍候。");
        qr.lastPoll = now();
        const result = await adapters.checkQr(provider, qr.key);
        // Ignore results of a request whose QR was replaced or disconnected while awaiting upstream.
        if (session.qrs.get(id) !== qr)
          throw new ApiError(409, "QR_CANCELLED", "本次连接已取消。");
        if (result.state === "connected") {
          if (provider === "netease") history.clear(session);
          session.connections[provider] = {
            credential: result.credential,
            account: result.account,
            connectedAt: now(),
          };
          session.version += 1;
          session.cache.clear();
          persistConnections();
          qr.done = true;
          qr.account = result.account;
        } else if (result.state === "expired") session.qrs.delete(id);
        return json(res, 200, {
          provider,
          state: result.state,
          ...(result.state === "connected" ? { account: result.account } : {}),
        });
      }
      if (url.pathname === "/api/auth/qq/key" && req.method === "POST") {
        if (!config.enableQqKey)
          throw new ApiError(
            503,
            "PERSONAL_KEY_DISABLED",
            "个人密钥连接尚未启用。",
          );
        rateLimit(session, "connect-key", 5);
        const { apiKey } = await body(req);
        const version = session.version;
        const result = await adapters.connectKey(apiKey);
        if (session.version !== version)
          throw new ApiError(
            409,
            "CONNECTION_CHANGED",
            "账号连接已改变，请重新操作。",
          );
        session.connections.qq = { ...result, connectedAt: now() };
        session.version += 1;
        session.cache.clear();
        persistConnections();
        return json(res, 200, {
          provider: "qq",
          state: "connected",
          account: result.account,
        });
      }
      const connection = url.pathname.match(
        /^\/api\/connections\/(netease|qq|apple)$/,
      );
      if (connection && req.method === "DELETE") {
        const provider = connection[1];
        if (provider === "netease") history.clear(session);
        delete session.connections[provider];
        session.version += 1;
        session.cache.clear();
        for (const [id, qr] of session.qrs)
          if (qr.provider === provider) session.qrs.delete(id);
        persistConnections();
        return json(res, 200, { provider, connected: false });
      }
      if (url.pathname === "/api/report" && req.method === "GET") {
        const month = url.searchParams.get("month");
        const period = monthPeriod(month);
        const connected = PROVIDERS.filter((id) => session.connections[id]);
        if (!connected.length)
          throw new ApiError(401, "NOT_CONNECTED", "请先连接一个音乐平台。");
        const saved = session.connections.netease ? history.getCached(session, month) : null;
        const persisted = trustedHistory(saved, period) ? saved : null;
        const cached = session.cache.get(month);
        if (cached && cached.expiresAt > now())
          return json(res, 200, decorateReport(cached.value, persisted));
        // Restoring many already-imported months is local work, while uncached reads stay more tightly bounded.
        rateLimit(session, persisted ? "saved-report" : "report", persisted ? 120 : 24);
        const version = session.version;
        const results = await Promise.allSettled(
          connected.map((id) =>
            id === "netease" && persisted ? Promise.resolve(persisted)
              : adapters.report(id, session.connections[id].credential, month),
          ),
        );
        if (session.version !== version)
          throw new ApiError(
            409,
            "CONNECTION_CHANGED",
            "账号连接已改变，请重新载入报告。",
          );
        const platforms = [],
          issues = [];
        results.forEach((result, index) => {
          const provider = connected[index];
          if (result.status === "fulfilled") {
            platforms.push(result.value.platform);
            issues.push(...result.value.issues);
            if (provider === "netease" && !persisted) {
              try { history.remember(session, month, result.value); }
              catch { /* Empty or unverified periods do not become durable history. */ }
            }
          } else issues.push(publicIssue(provider, result.reason));
        });
        const value = {
          mode: "live",
          input: {
            mode: "live",
            period,
            expectedPlatforms: connected,
            platforms,
          },
          issues,
          fetchedAt: new Date(now()).toISOString(),
        };
        // An upstream outage or partially failed report must be immediately retryable.
        if (platforms.length === connected.length && issues.every(issue => informationalCodes.has(issue.code)))
          session.cache.set(month, { value, expiresAt: now() + 5 * 60_000 });
        return json(res, 200, decorateReport(value));
      }
      throw new ApiError(404, "NOT_FOUND", "请求的功能不存在。");
    } catch (error) {
      // Never send raw upstream errors; these can contain credential-bearing request details.
      if (res.destroyed) return;
      const known = error instanceof ApiError || error instanceof ArtworkError;
      json(res, known ? error.status : 500, {
        error: {
          code: known ? error.code : "INTERNAL_ERROR",
          message: known ? error.message : "暂时无法完成操作，请稍后重试。",
        },
      });
    }
  });
  server.once("close", () => history.dispose());
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = loadConfigFromEnvFile();
  const server = createApiServer(config);
  server.listen(config.port, config.host, () =>
    console.log(`zmusicstats API: http://${config.host}:${config.port}`),
  );
  process.once("SIGINT", () => server.close());
  process.once("SIGTERM", () => server.close());
}
