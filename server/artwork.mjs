const MAX_BYTES = 3 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif";
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const IMAGE_TYPES = new Set(ACCEPT.split(","));
const NETEASE_OBJECT = /^\/[^/]+\/\d{10,}\.(?:jpe?g|png|webp|gif|avif)$/i;

function neteaseImageObject(url) {
  return /^p[1-9]\d?\.music\.126\.net$/.test(url.hostname) && NETEASE_OBJECT.test(url.pathname);
}

function artworkRequestUrl(url) {
  const request = new URL(url);
  if (neteaseImageObject(request)) {
    // The numbered NetEase image CDN hosts serve the same object paths. p4 can
    // fail TLS on networks where p1/p2 work; use the stable pair for exports.
    request.hostname = "p1.music.126.net";
    request.searchParams.set("param", "200y200");
  }
  return request;
}

export class ArtworkError extends Error {
  constructor(status = 502, code = "ARTWORK_UNAVAILABLE") {
    super("专辑封面暂时无法读取，已使用唱片图案。");
    this.status = status;
    this.code = code;
  }
}

/** Public image CDN hosts only, never arbitrary subdomains or credentials. */
export function approvedArtworkUrl(value) {
  if (typeof value !== "string" || value.length > 2500 || /[\\\r\n]/.test(value)) throw new ArtworkError(400, "ARTWORK_URL_REJECTED");
  let url;
  try { url = new URL(value); } catch { throw new ArtworkError(400, "ARTWORK_URL_REJECTED"); }
  const allowed = url.hostname === "y.gtimg.cn"
    || /^p[1-9]\d?\.music\.126\.net$/.test(url.hostname)
    || /^is[1-9]\d?-ssl\.mzstatic\.com$/.test(url.hostname);
  if (!allowed || url.protocol !== "https:" || url.port || url.username || url.password || url.hash
    || !/\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) throw new ArtworkError(400, "ARTWORK_URL_REJECTED");
  return url;
}

function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp"
    && /avif|avis/.test(bytes.toString("ascii", 8, Math.min(64, bytes.length)))) return "image/avif";
  return null;
}

function aborted(signal) {
  if (signal.aborted) throw signal.reason;
}

function abortable(promise, signal) {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

export function createArtworkProxy({
  fetchImpl = fetch, now = Date.now, timeoutMs = 8000, maxBytes = MAX_BYTES,
  maxCacheEntries = 128, maxCacheBytes = 24 * 1024 * 1024, cacheTtlMs = 60 * 60 * 1000,
} = {}) {
  const cache = new Map();
  let cacheBytes = 0;
  let active = 0;
  function remove(key) { const item = cache.get(key); if (item) cacheBytes -= item.bytes.length; cache.delete(key); }
  function remember(key, value) {
    if (value.bytes.length > maxCacheBytes || maxCacheEntries < 1) return;
    remove(key);
    while (cache.size >= maxCacheEntries || cacheBytes + value.bytes.length > maxCacheBytes) remove(cache.keys().next().value);
    cache.set(key, { ...value, expiresAt: now() + cacheTtlMs });
    cacheBytes += value.bytes.length;
  }
  return {
    async load(value, { signal: callerSignal } = {}) {
      let url = artworkRequestUrl(approvedArtworkUrl(value));
      const key = url.href;
      if (callerSignal?.aborted) throw new ArtworkError(499, "ARTWORK_CANCELLED");
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        cache.delete(key); cache.set(key, cached);
        return { bytes: cached.bytes, contentType: cached.contentType };
      }
      if (cached) remove(key);
      if (active >= 8) throw new ArtworkError(429, "ARTWORK_BUSY");
      active++;
      const controller = new AbortController();
      const cancel = () => controller.abort(new ArtworkError(499, "ARTWORK_CANCELLED"));
      callerSignal?.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(() => controller.abort(new ArtworkError(504, "ARTWORK_TIMEOUT")), timeoutMs);
      let response;
      try {
        const readHeaders = async (requestUrl) => {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(timeoutMs, 3500))]);
          return abortable(fetchImpl(requestUrl.href, {
            method: "GET", redirect: "manual", credentials: "omit", signal,
            headers: { Accept: ACCEPT },
          }), signal);
        };
        for (let hop = 0; hop <= 3; hop++) {
          aborted(controller.signal);
          try { response = await readHeaders(url); }
          catch (error) {
            if (controller.signal.aborted || url.hostname !== "p1.music.126.net" || !neteaseImageObject(url)) throw error;
            url = approvedArtworkUrl(new URL(url.href.replace("//p1.music.126.net/", "//p2.music.126.net/")).href);
            response = await readHeaders(url);
          }
          if (!REDIRECTS.has(response.status)) break;
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location || hop === 3) throw new ArtworkError(502, "ARTWORK_REDIRECT_REJECTED");
          try { url = approvedArtworkUrl(new URL(location, url).href); }
          catch { throw new ArtworkError(502, "ARTWORK_REDIRECT_REJECTED"); }
        }
        if (!response.ok || !response.body) throw new ArtworkError();
        const reportedType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
        // NetEase sends the non-standard image/jpg alias for valid JPEG bytes.
        // Normalize the label while retaining the independent signature check.
        const contentType = reportedType === "image/jpg" ? "image/jpeg" : reportedType;
        if (!IMAGE_TYPES.has(contentType)) throw new ArtworkError(415, "ARTWORK_TYPE_REJECTED");
        const declaredSize = response.headers.get("content-length");
        if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > maxBytes)) throw new ArtworkError(413, "ARTWORK_TOO_LARGE");
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        try {
          while (true) {
            const { value: chunk, done } = await abortable(reader.read(), controller.signal);
            if (done) break;
            length += chunk.byteLength;
            if (length > maxBytes) throw new ArtworkError(413, "ARTWORK_TOO_LARGE");
            chunks.push(Buffer.from(chunk));
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const bytes = Buffer.concat(chunks, length);
        if (imageType(bytes) !== contentType) throw new ArtworkError(415, "ARTWORK_TYPE_REJECTED");
        aborted(controller.signal);
        const result = { bytes, contentType };
        remember(key, result);
        return result;
      } catch (error) {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        throw controller.signal.aborted ? controller.signal.reason
          : error instanceof ArtworkError ? error : new ArtworkError();
      } finally {
        clearTimeout(timeout);
        callerSignal?.removeEventListener("abort", cancel);
        active--;
      }
    },
  };
}
