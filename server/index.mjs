import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
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
    appleAppName: env.APPLE_MUSIC_APP_NAME || "zmusicstats",
    secureCookies: env.COOKIE_SECURE === "true",
    timeoutMs: 12_000,
  };
}

export function createApiServer(config = configFromEnv(), dependencies = {}) {
  const adapters =
    dependencies.adapters ??
    createAdapters(config, dependencies.fetch ?? fetch);
  const sessions = new Map();
  const origins = new Set(config.origins ?? []);
  const now = dependencies.now ?? Date.now;
  const token = () => randomBytes(32).toString("base64url");

  function cleanup() {
    for (const [id, session] of sessions)
      if (session.expiresAt < now()) sessions.delete(id);
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
      account: session.connections[id]?.account ?? null,
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
      const session = sessionFor(req, res);
      if (url.pathname === "/api/connections" && req.method === "GET")
        return json(res, 200, {
          providers: PROVIDERS.map((id) => providerInfo(id, session)),
        });
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
        const expiresAt = now() + QR_TTL;
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
          session.connections[provider] = {
            credential: result.credential,
            account: result.account,
            connectedAt: now(),
          };
          session.version += 1;
          session.cache.clear();
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
        delete session.connections[provider];
        session.version += 1;
        session.cache.clear();
        for (const [id, qr] of session.qrs)
          if (qr.provider === provider) session.qrs.delete(id);
        return json(res, 200, { provider, connected: false });
      }
      if (url.pathname === "/api/report" && req.method === "GET") {
        const month = url.searchParams.get("month");
        const period = monthPeriod(month);
        const connected = PROVIDERS.filter((id) => session.connections[id]);
        if (!connected.length)
          throw new ApiError(401, "NOT_CONNECTED", "请先连接一个音乐平台。");
        const cached = session.cache.get(month);
        if (cached && cached.expiresAt > now())
          return json(res, 200, cached.value);
        rateLimit(session, "report", 6);
        const version = session.version;
        const results = await Promise.allSettled(
          connected.map((id) =>
            adapters.report(id, session.connections[id].credential, month),
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
        session.cache.set(month, { value, expiresAt: now() + 5 * 60_000 });
        return json(res, 200, value);
      }
      throw new ApiError(404, "NOT_FOUND", "请求的功能不存在。");
    } catch (error) {
      // Never send raw upstream errors; these can contain credential-bearing request details.
      const known = error instanceof ApiError;
      json(res, known ? error.status : 500, {
        error: {
          code: known ? error.code : "INTERNAL_ERROR",
          message: known ? error.message : "暂时无法完成操作，请稍后重试。",
        },
      });
    }
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Node 22+ can load .env without another dependency. No secrets are printed.
  try {
    process.loadEnvFile();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const config = configFromEnv();
  const server = createApiServer(config);
  server.listen(config.port, config.host, () =>
    console.log(`zmusicstats API: http://${config.host}:${config.port}`),
  );
  process.once("SIGINT", () => server.close());
  process.once("SIGTERM", () => server.close());
}
