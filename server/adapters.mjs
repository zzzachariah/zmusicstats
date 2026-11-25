// This bridge speaks to configured gateways. It never stores music credentials in the browser.
import { publicAccount } from "./account.mjs";
import { neteaseMonthReadiness, neteasePeriodMatches, neteaseTopSongFallback, neteaseHistoryDirectory, neteaseMonthSeconds } from "./netease-report.mjs";
import { appleDeveloperTokenUsable, createAppleDeveloperTokenProvider } from "./apple-developer.mjs";
import { createMusicMetadata, qqArtworkUrl, safeArtworkUrl, songDurationSeconds } from "./music-metadata.mjs";
import { qqMobileAuth } from "./qq-mobile-auth.mjs";
export { appleDeveloperTokenUsable } from "./apple-developer.mjs";
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function monthPeriod(month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month ?? "")) {
    throw new ApiError(400, "INVALID_MONTH", "请选择有效的月份。");
  }
  const [year, index] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${days}`,
    timeZone: "Asia/Shanghai",
  };
}

export function closedMonth(period, now = Date.now()) {
  return Date.parse(`${period.end}T23:59:59.999+08:00`) < now;
}

function qqDirectoryMonths(payload) {
  if (!Array.isArray(payload?.availableDates) || payload.availableDates.length === 0)
    throw new ApiError(502, "HISTORY_DIRECTORY_UNAVAILABLE", "QQ 音乐暂未返回可读取月份目录，请稍后重试。");
  if (payload.range !== "month" || payload.availableDates.some(value =>
    typeof value !== "string" || !/^20\d{2}(0[1-9]|1[0-2])$/.test(value)))
    throw new ApiError(502, "HISTORY_DIRECTORY_INVALID", "QQ 音乐返回的历史月份目录格式无法确认，请稍后重试。");
  return [...new Set(payload.availableDates.map(value => `${value.slice(0, 4)}-${value.slice(4)}`))].sort();
}

function finiteCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function text(value) {
  return typeof value === "string" ? value.slice(0, 500) : "";
}
function people(items) {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) =>
      typeof item === "string" ? item : text(item?.name ?? item?.artistName),
    )
    .filter(Boolean)
    .join(" / ");
}

export function parseNeteaseRanks(payload) {
  const items = payload?.data?.songItems;
  if (!Array.isArray(items))
    throw new ApiError(
      502,
      "REPORT_SCHEMA_CHANGED",
      "歌曲排行格式发生变化，暂时无法读取。",
    );
  return items
    .slice(0, 100)
    .map((item) => ({
      id: String(item.songId ?? ""),
      title: text(item.songName),
      artist: people(item.artists),
      album: text(item.albumName),
      ...(safeArtworkUrl(item.albumPicUrl ?? item.picUrl) ? { artworkUrl: safeArtworkUrl(item.albumPicUrl ?? item.picUrl) } : {}),
      count: finiteCount(item.playCount),
      genres: [],
    }))
    .filter((item) => item.id && item.title);
}

export function parseQqRanks(payload) {
  if (!Array.isArray(payload?.items))
    throw new ApiError(
      502,
      "REPORT_SCHEMA_CHANGED",
      "歌曲排行格式发生变化，暂时无法读取。",
    );
  return payload.items
    .slice(0, 100)
    .map((item) => {
      const track = item.track ?? {};
      return {
        id: String(track.id ?? track.songid ?? track.mid ?? ""),
        title: text(track.name ?? track.title ?? track.songname),
        artist: people(track.singer ?? track.singers),
        album: text(track.album?.name ?? track.albumname),
        ...(songDurationSeconds(track.interval) ? { durationSeconds: songDurationSeconds(track.interval) } : {}),
        ...(qqArtworkUrl(track.album?.mid ?? track.albummid) ? { artworkUrl: qqArtworkUrl(track.album?.mid ?? track.albummid) } : {}),
        count: finiteCount(item.listenCount),
        genres: [],
      };
    })
    .filter((item) => item.id && item.title);
}

export function parseAppleRecentTracks(payload) {
  if (!Array.isArray(payload?.data))
    throw new ApiError(
      502,
      "REPORT_SCHEMA_CHANGED",
      "Apple Music 最近播放数据格式发生变化。",
    );
  const seen = new Set();
  return payload.data
    .filter((resource) => ["songs", "library-songs"].includes(resource.type))
    .map((resource) => {
      const attributes = resource.attributes ?? {};
      return {
        id: String(resource.id ?? ""),
        title: text(attributes.name),
        artist: text(attributes.artistName),
        album: text(attributes.albumName),
        ...(songDurationSeconds(attributes.durationInMillis / 1000) ? { durationSeconds: songDurationSeconds(attributes.durationInMillis / 1000) } : {}),
        ...(safeArtworkUrl(attributes.artwork?.url) ? { artworkUrl: safeArtworkUrl(attributes.artwork?.url) } : {}),
        count: null,
        genres: Array.isArray(attributes.genreNames)
          ? attributes.genreNames
              .filter((value) => typeof value === "string" && value !== "Music")
              .map(text)
          : [],
      };
    })
    .filter((track) => {
      if (!track.id || !track.title || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
}

// Explicit deployment mapping only. Do not guess that arbitrary "time" fields mean seconds.
export function configuredNeteaseDuration(payload, path, unit) {
  if (!path || !["seconds", "milliseconds", "minutes"].includes(unit))
    return null;
  const segments = path.split(".");
  if (
    segments.some(
      (segment) =>
        !/^[a-zA-Z0-9_]+$/.test(segment) ||
        ["__proto__", "constructor", "prototype"].includes(segment),
    )
  )
    return null;
  let value = payload;
  for (const segment of segments)
    value =
      value != null && Object.hasOwn(value, segment)
        ? value[segment]
        : undefined;
  const count = finiteCount(value);
  return count === null
    ? null
    : count * (unit === "minutes" ? 60 : unit === "milliseconds" ? 0.001 : 1);
}

export function validateBaseUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Gateway URL must be absolute.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Gateway URL must be HTTP(S) without credentials, query, or fragment.",
    );
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Remote gateways require HTTPS.");
  return url.href.replace(/\/$/, "");
}

export function createAdapters(config, fetchImpl = fetch) {
  const ncmBase = validateBaseUrl(config.neteaseBase);
  const qqBase = validateBaseUrl(config.qqBase);
  const officialQqBase = validateBaseUrl(
    config.qqOfficialBase ?? "https://a.y.qq.com",
  );
  const appleBase = "https://api.music.apple.com";
  const appleDeveloper = createAppleDeveloperTokenProvider(config);
  let appleConfigVerifiedUntil = 0;
  let appleConfigVerifiedToken = null;
  const qqAvailableMonths = new WeakMap();

  async function request(
    base,
    path,
    {
      body,
      headers = {},
      params = {},
      allowQr = false,
      allowEmpty = false,
      timeoutMs = config.timeoutMs ?? 12_000,
      signal,
    } = {},
  ) {
    if (!base)
      throw new ApiError(
        503,
        "GATEWAY_NOT_CONFIGURED",
        "这个平台还没有配置连接服务。",
      );
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(params))
      if (value !== undefined) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetchImpl(url, {
        method: body ? "POST" : "GET",
        redirect: "error",
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError")
        throw new ApiError(
          504,
          "UPSTREAM_TIMEOUT",
          "音乐平台暂时没有响应，请稍后重试。",
        );
      throw new ApiError(
        502,
        "UPSTREAM_UNAVAILABLE",
        "暂时无法连接音乐平台，请稍后重试。",
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new ApiError(
        401,
        "CONNECTION_EXPIRED",
        "音乐平台连接已失效，请重新连接。",
      );
    if (response.status === 429)
      throw new ApiError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。");
    if (!response.ok)
      throw new ApiError(
        502,
        "UPSTREAM_REJECTED",
        "音乐平台暂时无法提供这些数据。",
      );
    let payload;
    try {
      const raw = await response.text();
      if (raw.length > 4_000_000) throw new Error("Response too large");
      payload = raw.trim() === "" && allowEmpty ? {} : JSON.parse(raw);
    } catch {
      throw new ApiError(
        502,
        "UPSTREAM_INVALID_RESPONSE",
        "音乐平台返回了无法读取的数据。",
      );
    }
    const code = payload?.code;
    if ([301, 401, 403].includes(code))
      throw new ApiError(
        401,
        "CONNECTION_EXPIRED",
        "音乐平台连接已失效，请重新连接。",
      );
    if (
      code != null &&
      ![0, 200].includes(code) &&
      !(allowQr && [800, 801, 802, 803].includes(code))
    )
      throw new ApiError(
        502,
        "UPSTREAM_REJECTED",
        "音乐平台暂时无法提供这些数据。",
      );
    if (
      (payload.ret != null && payload.ret !== 0) ||
      (payload.sub_ret != null && payload.sub_ret !== 0)
    )
      throw new ApiError(
        502,
        "UPSTREAM_REJECTED",
        "音乐平台暂时无法提供这些数据。",
      );
    return payload;
  }

  const ncm = (path, params = {}, cookie, options = {}) =>
    request(ncmBase, path, {
      ...options,
      // Credentials stay in the HTTPS body, never in an URL or application log.
      body: { ...params, ...(cookie ? { cookie } : {}), timestamp: Date.now(),
        // A disconnected bridge request does not abort the gateway's Axios request.
        // Bound upstream work too, slightly before our own deadline.
        timeout: Math.max(1, (options.timeoutMs ?? config.timeoutMs ?? 12_000) - 750) },
      // The gateway's cache key ignores POST bodies. Bypass it for every account-scoped
      // request, including QR polling, so neither stale auth states nor other users' data leak.
      headers: { "x-apicache-bypass": "1", "Cache-Control": "no-store" },
      allowQr: path.startsWith("/login/qr/"),
    });
  const qq = (path, params = {}, token, options = {}) =>
    request(qqBase, path, {
      ...options,
      params,
      headers: token ? { "X-QQ-Session": token } : {},
      allowQr: path.startsWith("/login/qr/"),
    });
  const ncmReport = async (path, params, cookie, options = {}) => {
    const attempts = options.attempts ?? 2;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { return await ncm(path, params, cookie, { signal: options.signal, timeoutMs: options.timeoutMs ?? config.neteaseReportTimeoutMs ?? 40_000 }); }
      catch (error) {
        if (options.signal?.aborted || attempt >= attempts - 1 || !["UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE"].includes(error?.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  };
  const qqOfficial = (apiKey) =>
    request(officialQqBase, "/me/report", {
      body: { params: { timeKey: "m" }, comm: { skill_version: "0.0.3" } },
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  const apple = (path, musicUserToken, params = {}, allowEmpty = false, developerToken = appleDeveloper.getToken()) => {
    if (!appleDeveloperTokenUsable(developerToken))
      throw new ApiError(
        503,
        "APPLE_NOT_CONFIGURED",
        "Apple Music 连接尚未配置，或开发者令牌已过期。",
      );
    return request(appleBase, path, {
      params,
      allowEmpty,
      headers: {
        Authorization: `Bearer ${developerToken}`,
        ...(config.appleMusicRequestOrigin ? { Origin: config.appleMusicRequestOrigin } : {}),
        ...(musicUserToken ? { "Music-User-Token": musicUserToken } : {}),
      },
    });
  };

  const metadata = createMusicMetadata({
    cachePath: config.metadataCachePath,
    // These endpoints contain public song metadata. GET keys the gateway cache by song IDs;
    // the account-report POST/cache-bypass path is intentionally not used here.
    loadNeteaseDetails: (ids, signal) => request(ncmBase, "/song/detail", { params: { ids: ids.join(",") }, signal, timeoutMs: 4500 }),
    loadNeteaseWiki: (id, signal) => request(ncmBase, "/song/wiki/summary", { params: { id }, signal, timeoutMs: 4500 }),
    loadQqGenres: (id, credential, signal) => qq("/song/genre", { id }, credential.secret, { signal, timeoutMs: 4500 }),
    searchApple: (track, signal) => {
      const token = appleDeveloper.getToken();
      if (!appleDeveloperTokenUsable(token)) throw new ApiError(503, "APPLE_NOT_CONFIGURED", "目录查询暂不可用。");
      return request(appleBase, "/v1/catalog/cn/search", {
        params: { term: `${track.title} ${track.artist}`, types: "songs", limit: 10 },
        headers: { Authorization: `Bearer ${token}`, ...(config.appleMusicRequestOrigin ? { Origin: config.appleMusicRequestOrigin } : {}) }, signal, timeoutMs: 4500,
      });
    },
  });

  return {
    async qqHistoryMonths(credential, { signal } = {}) {
      if (credential?.kind !== "gateway")
        throw new ApiError(422, "HISTORY_DIRECTORY_UNAVAILABLE", "当前 QQ 连接方式暂未提供可读取月份目录。");
      let directory = qqAvailableMonths.get(credential);
      if (!directory || directory.expiresAt <= Date.now()) {
        // Without date, GetBar returns its current readable directory. The directory is
        // authoritative for availability only, not proof that every report has loaded.
        const payload = await qq("/user/listening-report", { range: "month" }, credential.secret, { signal });
        directory = { months: new Set(qqDirectoryMonths(payload)), expiresAt: Date.now() + 10 * 60_000 };
        qqAvailableMonths.set(credential, directory);
      }
      return {
        provider: "qq",
        months: [...directory.months].filter(month => closedMonth(monthPeriod(month))).sort(),
        source: "qq-listening-report.availableDates",
        rangeVerified: true,
        scope: "currently-readable",
      };
    },
    async neteaseDuration(credential, month, readOptions = {}) {
      const period = monthPeriod(month);
      const readiness = neteaseMonthReadiness(period);
      if (readiness) throw new ApiError(422, readiness, "请选择已结束的月份。");
      const payload = await ncmReport("/listen/data/report", { type: "month", endTime: Date.parse(`${period.end}T00:00:00+08:00`) }, credential.secret, readOptions);
      if (!neteasePeriodMatches(payload, period)) throw new ApiError(422, "PERIOD_MISMATCH", "返回数据的日期与所选月份不一致。");
      const seconds = config.neteaseDurationPath
        ? configuredNeteaseDuration(payload, config.neteaseDurationPath, config.neteaseDurationUnit)
        : neteaseMonthSeconds(payload);
      if (seconds === null) throw new ApiError(422, "DURATION_MAPPING_REQUIRED", "这个月份尚未返回可核对单位的时长字段。");
      return { listenSeconds: seconds, durationKind: "actual-total", coverageComplete: closedMonth(period) };
    },
    async history(credential, { signal } = {}) {
      const options = { signal, timeoutMs: 20_000 };
      const requests = await Promise.allSettled([
        ncm("/api", { uri: "/api/vipmusic/newrecord/timedetail", data: { userId: "" }, crypto: "weapi" }, credential.secret, options),
        ncm("/listen/data/year/report", {}, credential.secret, options),
        ncm("/user/account", {}, credential.secret, { signal, timeoutMs: 5000 }),
      ]);
      const value = index => requests[index].status === "fulfilled" ? requests[index].value : undefined;
      const directory = neteaseHistoryDirectory({ timedetail: value(0), yearReport: value(1), account: value(2) });
      if (!directory) throw new ApiError(502, "HISTORY_DIRECTORY_UNAVAILABLE", "暂时无法取得历史月份目录，请稍后重试。");
      return directory;
    },
    cachedMetadata: (provider, tracks) => metadata.cachedTracks(provider, tracks),
    metadata: (tracks, connections = {}, options = {}) => metadata.enrich(tracks, { ...options, connections }),
    configured: {
      netease: Boolean(ncmBase),
      qq: Boolean(qqBase),
      get apple() {
        return appleDeveloperTokenUsable(appleDeveloper.getToken());
      },
    },
    async account(provider, credential, { includeSubject = false } = {}) {
      // Profile loading is optional and has its own short deadline; 803 already completed login.
      const options = { timeoutMs: Math.min(config.timeoutMs ?? 12_000, 2500) };
      if (provider === "apple") return { nickname: "Apple Music 账号" };
      if (credential.kind !== "gateway") return null;
      if (provider === "netease") {
        const payload = await ncm("/user/account", {}, credential.secret, options);
        const profile = payload.profile ?? payload.data?.profile;
        return { ...publicAccount(profile), ...(includeSubject && profile?.userId ? { subject: String(profile.userId) } : {}) };
      }
      const payload = await qq("/login/status", {}, credential.secret, options);
      const profile = payload.data?.profile;
      return { ...publicAccount({ nickname: profile?.nickname ?? profile?.nick, avatarUrl: profile?.avatarUrl }),
        ...(includeSubject && (profile?.musicid ?? profile?.uin) ? { subject: String(profile.musicid ?? profile.uin) } : {}) };
    },
    async appleConfig() {
      const developerToken = appleDeveloper.getToken();
      if (!appleDeveloperTokenUsable(developerToken))
        throw new ApiError(
          503,
          "APPLE_NOT_CONFIGURED",
          "Apple Music 连接尚未配置，或开发者令牌已过期。",
        );
      if (appleConfigVerifiedUntil < Date.now() || appleConfigVerifiedToken !== developerToken) {
        try {
          await apple("/v1/test", null, {}, true, developerToken);
        } catch (error) {
          if (error instanceof ApiError && error.code === "CONNECTION_EXPIRED")
            throw new ApiError(
              503,
              "APPLE_CONFIG_INVALID",
              "Apple Music 开发者配置未通过验证。",
            );
          throw error;
        }
        appleConfigVerifiedUntil = Date.now() + 5 * 60_000;
        appleConfigVerifiedToken = developerToken;
      }
      return {
        developerToken,
        appName: config.appleAppName || "zmusicstats",
      };
    },
    async connectApple(musicUserToken) {
      if (
        typeof musicUserToken !== "string" ||
        musicUserToken.length < 10 ||
        musicUserToken.length > 16_384 ||
        !/^[\x21-\x7E]+$/.test(musicUserToken)
      )
        throw new ApiError(
          400,
          "INVALID_MUSIC_USER_TOKEN",
          "Apple Music 未返回有效授权，请重新连接。",
        );
      const payload = await apple("/v1/me/storefront", musicUserToken);
      if (
        !Array.isArray(payload.data) ||
        !payload.data.some(
          (item) => item.type === "storefronts" && typeof item.id === "string",
        )
      )
        throw new ApiError(
          502,
          "APPLE_AUTH_INVALID_RESPONSE",
          "暂时无法确认 Apple Music 授权。",
        );
      return {
        credential: { kind: "musickit", secret: musicUserToken },
        account: { nickname: "Apple Music 账号" },
      };
    },
    async createQr(provider) {
      const createdAt = Date.now();
      const keyPayload =
        provider === "netease"
          ? await ncm("/login/qr/key")
          : await qq("/login/qr/key", { channel: config.qqChannel ?? "qq" });
      const key = keyPayload?.data?.unikey;
      if (typeof key !== "string" || key.length > (provider === "qq" ? 65_536 : 1024))
        throw new ApiError(502, "QR_UNAVAILABLE", "暂时无法生成登录二维码。");
      const payload =
        provider === "netease"
          ? await ncm("/login/qr/create", { key, qrimg: true })
          : await qq("/login/qr/create", { key });
      const qrImage = payload?.data?.qrimg;
      if (
        typeof qrImage !== "string" ||
        !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(
          qrImage,
        ) ||
        qrImage.length > 1_000_000
      )
        throw new ApiError(502, "QR_UNAVAILABLE", "二维码图片格式无法读取。");
      const mobileAuth = provider === "qq" && config.qqChannel === "qqmusic"
        ? await qqMobileAuth(qrImage, { fetchImpl, timeoutMs: config.mobileAuthTimeoutMs ?? 5000 })
        : undefined;
      return { key, qrImage, expiresAt: createdAt + 3 * 60_000, ...(mobileAuth ? { mobileAuth } : {}) };
    },
    async checkQr(provider, key) {
      const payload =
        provider === "netease"
          ? await ncm("/login/qr/check", { key })
          : await qq("/login/qr/check", { key });
      const state = {
        800: "expired",
        801: "waiting",
        802: "scanned",
        803: "connected",
      }[payload?.code];
      if (!state)
        throw new ApiError(502, "QR_UNAVAILABLE", "无法确认二维码状态。");
      if (state !== "connected") return { state };
      let secret;
      if (provider === "netease") secret = payload.cookie;
      else {
        const cookie = typeof payload.cookie === "string" ? payload.cookie : "";
        secret =
          cookie.match(/(?:^|;\s*)qqmusic_session=([^;]+)/)?.[1] ??
          payload?.data?.token;
      }
      if (typeof secret !== "string" || !secret || secret.length > 32_768)
        throw new ApiError(
          502,
          "AUTH_CREDENTIAL_MISSING",
          "确认登录后未收到有效连接，请重新连接。",
        );
      return { state, credential: { kind: "gateway", secret }, account: null };
    },
    async connectKey(apiKey) {
      if (
        typeof apiKey !== "string" ||
        !/^qmk-[A-Za-z0-9_-]{8,256}$/.test(apiKey)
      )
        throw new ApiError(
          400,
          "INVALID_API_KEY",
          "请输入有效的 QQ 音乐个人连接密钥。",
        );
      await qqOfficial(apiKey);
      return { credential: { kind: "api-key", secret: apiKey }, account: null };
    },
    async report(provider, credential, month, readOptions = {}) {
      const period = monthPeriod(month);
      const base = {
        id: provider,
        period,
        listenSeconds: null,
        durationKind: "unknown",
        coverageComplete: false,
        tracks: [],
        rankingPeriod: period,
        countKind: "plays",
        countDefinition: null,
        rankCoverage: "top",
      };
      const issues = [];
      if (provider === "netease") {
        const readiness = neteaseMonthReadiness(period);
        if (readiness) throw new ApiError(422, readiness, readiness === "MONTH_NOT_READY"
          ? "网易云当月报告尚未生成，请选择已结束的月份。"
          : "这个月份还未开始，请选择过去的月份。");
        const endTime = Date.parse(`${period.end}T00:00:00+08:00`);
        const results = await Promise.allSettled([
          ncmReport(
            "/listen/data/song/play/rank",
            { type: "month", endTime },
            credential.secret,
            readOptions,
          ),
          ncmReport(
            "/listen/data/report",
            { type: "month", endTime },
            credential.secret,
            readOptions,
          ),
        ]);
        for (const result of results) {
          if (result.status === "fulfilled" && !neteasePeriodMatches(result.value, period))
            throw new ApiError(422, "PERIOD_MISMATCH", "网易云返回的日期与所选月份不一致，已停止展示这份数据。");
        }
        if (results[0].status === "fulfilled")
          base.tracks = parseNeteaseRanks(results[0].value);
        else issues.push(publicIssue(provider, results[0].reason));
        if (results[1].status === "fulfilled") {
          if (results[0].status === "rejected") {
            base.tracks = neteaseTopSongFallback(results[1].value);
            if (base.tracks.length) issues.push({ provider, code: "TOP_RANK_PARTIAL",
              message: "完整排行榜暂时未响应，先显示月报中已确认的第 1 名歌曲。" });
          }
          base.listenSeconds = config.neteaseDurationPath ? configuredNeteaseDuration(
            results[1].value,
            config.neteaseDurationPath,
            config.neteaseDurationUnit,
          ) : neteaseMonthSeconds(results[1].value);
          base.durationKind =
            base.listenSeconds === null ? "unknown" : "actual-total";
          base.coverageComplete =
            base.listenSeconds !== null && closedMonth(period);
          if (base.listenSeconds === null)
            issues.push({
              provider,
              code: "DURATION_MAPPING_REQUIRED",
              message: "已获取网易云报告，但听歌时长字段和单位仍需核对。",
            });
        } else issues.push(publicIssue(provider, results[1].reason));
        // Per-song genre schema is not yet verified. Empty tags remain unknown rather than guessed.
        issues.push({
          provider,
          code: "GENRE_NOT_AVAILABLE",
          message: "本次未获取可核实的歌曲曲风标签。",
        });
      } else if (provider === "apple") {
        const payload = await apple(
          "/v1/me/recent/played/tracks",
          credential.secret,
          { types: "songs,library-songs", limit: 30 },
        );
        base.tracks = parseAppleRecentTracks(payload);
        base.rankingPeriod = null;
        base.countKind = "unknown";
        // durationInMillis is song length, not actual listening time. The endpoint has no month filter.
        issues.push({
          provider,
          code: "APPLE_RECENT_NOT_PERIOD",
          message:
            "Apple Music 显示最近播放歌曲；接口未提供这个月份的播放次数或实际总时长，不计入月份排行榜及占比。",
        });
      } else if (credential.kind === "api-key") {
        const payload = await qqOfficial(credential.secret);
        const detail = payload?.monthData?.monthDetailList;
        const entry = Array.isArray(detail)
          ? detail.find(
              (item) =>
                item.dataTime === month ||
                item.dataTime === month.replace("-", ""),
            )
          : null;
        if (!entry || !Array.isArray(entry.songs))
          throw new ApiError(
            422,
            "PERIOD_UNAVAILABLE",
            "QQ 音乐暂未提供这个月份的数据。",
          );
        base.tracks = entry.songs
          .map((item) => ({
            id: text(item.songMid),
            title: text(item.songName),
            artist: text(item.singerName),
            count: null,
            genres: [],
          }))
          .filter((item) => item.id && item.title);
        // monthDetailList.songs[].sum does not have a verified unit; preserve rank only.
        base.countKind = "unknown";
        issues.push({
          provider,
          code: "OFFICIAL_MONTH_DURATION_UNAVAILABLE",
          message: "QQ 官方月报未提供已核实的整月总时长，暂不计入时长占比。",
        });
      } else {
        const date = month.replace("-", "");
        const unavailableMonth = () => ({ platform: base, issues: [{ provider, code: "PERIOD_UNAVAILABLE", message: "QQ 音乐当前返回的可读取月份目录不包含这个月份，不代表该月没有听歌。" }] });
        const knownMonths = qqAvailableMonths.get(credential);
        if (knownMonths?.expiresAt > Date.now() && !knownMonths.months.has(month)) return unavailableMonth();
        const results = await Promise.allSettled([
          qq(
            "/user/listening-rank",
            { range: "month", date },
            credential.secret,
          ),
          qq(
            "/user/listening-report",
            { range: "month", date },
            credential.secret,
          ),
        ]);
        if (results[1].status === "fulfilled" && results[1].value?.range === "month" && results[1].value.date === date) {
          let months;
          try { months = qqDirectoryMonths(results[1].value); }
          catch { /* A missing or malformed directory must never suppress a later read. */ }
          if (months) {
            qqAvailableMonths.set(credential, { months: new Set(months), expiresAt: Date.now() + 10 * 60_000 });
            if (!months.includes(month)) return unavailableMonth();
          }
        }
        if (results[0].status === "fulfilled") {
          try {
            const payload = results[0].value;
            // 3.3.8 always echoes the explicit range/date. Never relabel a current
            // or undated ranking as the historical month the user selected.
            if (payload.range !== "month" || payload.date !== date)
              throw new ApiError(502, "PERIOD_UNCONFIRMED", "QQ 音乐返回的歌曲榜单月份未匹配所选月份。");
            base.tracks = parseQqRanks(payload);
          } catch (error) {
            base.rankingPeriod = null;
            issues.push(publicIssue(provider, error));
          }
        } else {
          base.rankingPeriod = null;
          issues.push(publicIssue(provider, results[0].reason));
        }
        if (results[1].status === "fulfilled") {
          const payload = results[1].value;
          if (payload.range === "month" && payload.date === date) {
            base.listenSeconds = finiteCount(payload.listenSeconds);
            if (base.listenSeconds === 0 && base.tracks.some(track => typeof track.count === "number" && track.count > 0)) {
              base.listenSeconds = null;
              issues.push({ provider, code: "DURATION_INCONSISTENT", message: "QQ 音乐返回的零时长与实际歌曲播放次数矛盾，暂不计入时长统计。" });
            }
            base.durationKind =
              base.listenSeconds === null ? "unknown" : "actual-total";
            base.coverageComplete =
              base.listenSeconds !== null && closedMonth(period);
            if (base.listenSeconds === null && !issues.some(issue => issue.code === "DURATION_INCONSISTENT"))
              issues.push({ provider, code: "DURATION_UNAVAILABLE", message: "QQ 音乐未返回所选月份的实际听歌时长，不按零计算。" });
          } else {
            issues.push({ provider, code: "PERIOD_UNCONFIRMED", message: "QQ 音乐返回的听歌时长月份未匹配所选月份，暂不计入。" });
          }
        } else issues.push(publicIssue(provider, results[1].reason));
      }
      // Public metadata is collected separately; monthly history reads never wait on per-song lookups.
      base.tracks = metadata.cachedTracks(provider, base.tracks);
      return { platform: base, issues };
    },
  };
}

export function publicIssue(provider, error) {
  return {
    provider,
    code: error instanceof ApiError ? error.code : "UPSTREAM_UNAVAILABLE",
    message:
      error instanceof ApiError
        ? error.message
        : "暂时无法读取这个平台的数据。",
  };
}
