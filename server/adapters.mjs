// This bridge speaks to configured gateways. It never stores music credentials in the browser.
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
        count: finiteCount(item.listenCount),
        genres: [],
      };
    })
    .filter((item) => item.id && item.title);
}

export function appleDeveloperTokenUsable(token, now = Date.now()) {
  if (
    typeof token !== "string" ||
    token.length > 16_384 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  )
    return false;
  try {
    const [encodedHeader, encodedPayload] = token.split(".");
    const header = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString(),
    );
    const claims = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString(),
    );
    // This is an expiry/shape check, not signature verification. Apple verifies the token below.
    return (
      header.alg === "ES256" &&
      typeof header.kid === "string" &&
      typeof claims.iss === "string" &&
      Number.isFinite(claims.exp) &&
      claims.exp * 1000 > now + 60_000
    );
  } catch {
    return false;
  }
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
  let appleConfigVerifiedUntil = 0;

  async function request(
    base,
    path,
    {
      body,
      headers = {},
      params = {},
      allowQr = false,
      allowEmpty = false,
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
        signal: AbortSignal.timeout(config.timeoutMs ?? 12_000),
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

  const ncm = (path, params = {}, cookie) =>
    request(ncmBase, path, {
      // Credentials stay in the HTTPS body, never in an URL or application log.
      body: { ...params, ...(cookie ? { cookie } : {}), timestamp: Date.now() },
      allowQr: path.startsWith("/login/qr/"),
    });
  const qq = (path, params = {}, token) =>
    request(qqBase, path, {
      params,
      headers: token ? { "X-QQ-Session": token } : {},
      allowQr: path.startsWith("/login/qr/"),
    });
  const qqOfficial = (apiKey) =>
    request(officialQqBase, "/me/report", {
      body: { params: { timeKey: "m" }, comm: { skill_version: "0.0.3" } },
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  const apple = (path, musicUserToken, params = {}, allowEmpty = false) => {
    if (!appleDeveloperTokenUsable(config.appleDeveloperToken))
      throw new ApiError(
        503,
        "APPLE_NOT_CONFIGURED",
        "Apple Music 连接尚未配置，或开发者令牌已过期。",
      );
    return request(appleBase, path, {
      params,
      allowEmpty,
      headers: {
        Authorization: `Bearer ${config.appleDeveloperToken}`,
        ...(musicUserToken ? { "Music-User-Token": musicUserToken } : {}),
      },
    });
  };

  return {
    configured: {
      netease: Boolean(ncmBase),
      qq: Boolean(qqBase),
      get apple() {
        return appleDeveloperTokenUsable(config.appleDeveloperToken);
      },
    },
    async appleConfig() {
      if (!appleDeveloperTokenUsable(config.appleDeveloperToken))
        throw new ApiError(
          503,
          "APPLE_NOT_CONFIGURED",
          "Apple Music 连接尚未配置，或开发者令牌已过期。",
        );
      if (appleConfigVerifiedUntil < Date.now()) {
        try {
          await apple("/v1/test", null, {}, true);
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
      }
      return {
        developerToken: config.appleDeveloperToken,
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
        account: null,
      };
    },
    async createQr(provider) {
      const keyPayload =
        provider === "netease"
          ? await ncm("/login/qr/key")
          : await qq("/login/qr/key", { channel: config.qqChannel ?? "qq" });
      const key = keyPayload?.data?.unikey;
      if (typeof key !== "string" || key.length > 1024)
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
      return { key, qrImage };
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
    async report(provider, credential, month) {
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
        const endTime = Date.parse(`${period.end}T00:00:00+08:00`);
        const results = await Promise.allSettled([
          ncm(
            "/listen/data/song/play/rank",
            { type: "month", endTime },
            credential.secret,
          ),
          ncm(
            "/listen/data/report",
            { type: "month", endTime },
            credential.secret,
          ),
        ]);
        if (results[0].status === "fulfilled")
          base.tracks = parseNeteaseRanks(results[0].value);
        else issues.push(publicIssue(provider, results[0].reason));
        if (results[1].status === "fulfilled") {
          base.listenSeconds = configuredNeteaseDuration(
            results[1].value,
            config.neteaseDurationPath,
            config.neteaseDurationUnit,
          );
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
        if (results[0].status === "fulfilled")
          base.tracks = parseQqRanks(results[0].value);
        else issues.push(publicIssue(provider, results[0].reason));
        if (results[1].status === "fulfilled") {
          const payload = results[1].value;
          if (
            payload.range === "month" &&
            (payload.date === date || payload.date === undefined)
          ) {
            base.listenSeconds = finiteCount(payload.listenSeconds);
            base.durationKind =
              base.listenSeconds === null ? "unknown" : "actual-total";
            base.coverageComplete =
              base.listenSeconds !== null && closedMonth(period);
          }
        } else issues.push(publicIssue(provider, results[1].reason));
        // Avoid a burst of per-song calls; enrich a bounded Top 10 sequentially.
        for (const track of base.tracks.slice(0, 10)) {
          if (!/^\d+$/.test(track.id)) continue;
          try {
            const genre = await qq(
              "/song/genre",
              { id: track.id },
              credential.secret,
            );
            if (Array.isArray(genre.genres))
              track.genres = genre.genres
                .map((item) => text(item.name))
                .filter(Boolean);
          } catch (error) {
            issues.push(publicIssue(provider, error));
            break;
          }
        }
      }
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
