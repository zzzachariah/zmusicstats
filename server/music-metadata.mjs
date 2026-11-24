import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PROVIDERS = new Set(["netease", "qq", "apple"]);
const POSITIVE_TTL = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL = 60 * 60 * 1000;
const cleanText = value => typeof value === "string" ? value.trim().slice(0, 500) : "";
const normalize = value => cleanText(value).normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]/gu, "");
const genresOf = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === "string").map(value => value.trim()).filter(value => value && !["music", "音乐", "unknown"].includes(value.toLowerCase())))].slice(0, 12);
export const songDurationSeconds = value => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

export function safeArtworkUrl(value) {
  if (typeof value !== "string" || value.length > 2500) return undefined;
  try {
    const url = new URL(value.replaceAll("{w}", "512").replaceAll("{h}", "512").replaceAll("{f}", "jpg"));
    const allowed = url.hostname === "y.gtimg.cn" || url.hostname.endsWith(".music.126.net") || url.hostname.endsWith(".mzstatic.com");
    if (!allowed || !["https:", "http:"].includes(url.protocol) || url.username || url.password || (url.port && url.port !== "443") || /[{}]/.test(url.pathname)) return undefined;
    url.protocol = "https:";
    return url.href;
  } catch { return undefined; }
}

export function qqArtworkUrl(mid) {
  return typeof mid === "string" && /^[A-Za-z0-9]{1,64}$/.test(mid)
    ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${mid}.jpg` : undefined;
}

export function parseNeteaseWiki(payload) {
  const block = (Array.isArray(payload?.data?.blocks) ? payload.data.blocks : []).find(item => item?.code === "SONG_PLAY_ABOUT_SONG_BASIC");
  const tags = (Array.isArray(block?.creatives) ? block.creatives : [])
    .filter(creative => creative?.creativeType === "songTag")
    .flatMap(creative => Array.isArray(creative.resources) ? creative.resources : [])
    .filter(resource => resource?.resourceType === "melody_style" && resource.valid === true)
    .map(resource => resource.uiElement?.mainTitle?.title);
  const artworkUrl = (Array.isArray(block?.uiElement?.images) ? block.uiElement.images : []).map(image => safeArtworkUrl(image?.imageUrl)).find(Boolean);
  const genres = genresOf(tags);
  return { ...(artworkUrl ? { artworkUrl } : {}), genres, ...(genres.length ? { genreSource: "netease-wiki" } : {}) };
}

export function parseNeteaseDetails(payload) {
  return (Array.isArray(payload?.songs) ? payload.songs : []).flatMap(song => {
    const artworkUrl = safeArtworkUrl(song?.al?.picUrl ?? song?.album?.picUrl);
    const durationSeconds = songDurationSeconds(song?.dt / 1000);
    return song?.id && (artworkUrl || durationSeconds) ? [{ id: String(song.id), ...(artworkUrl ? { artworkUrl } : {}), ...(durationSeconds ? { durationSeconds } : {}) }] : [];
  });
}

export function matchAppleCatalog(track, payload) {
  const title = normalize(track.title);
  const artist = normalize(track.artist);
  if (!title || !artist) return null;
  // Version text is preserved: studio, live, remastered and translated names never fuzzy-match.
  const candidates = (Array.isArray(payload?.results?.songs?.data) ? payload.results.songs.data : []).filter(resource => resource?.type === "songs"
    && normalize(resource.attributes?.name) === title && normalize(resource.attributes?.artistName) === artist);
  if (!candidates.length) return null;
  if (candidates.length > 1) {
    const genres = genresOf(candidates[0].attributes?.genreNames);
    const identity = values => genresOf(values).map(value => value.toLowerCase()).sort().join("\u0000");
    if (!genres.length || !candidates.every(candidate => identity(candidate.attributes?.genreNames) === identity(genres))) return null;
    // Reissues can share verified genre labels while their artwork and recording lengths differ.
    return { genres, genreSource: "apple-catalog" };
  }
  const attributes = candidates[0].attributes;
  const artworkUrl = safeArtworkUrl(attributes.artwork?.url);
  const genres = genresOf(attributes.genreNames);
  const durationSeconds = songDurationSeconds(attributes.durationInMillis / 1000);
  return { ...(artworkUrl ? { artworkUrl } : {}), ...(durationSeconds ? { durationSeconds } : {}), genres, ...(genres.length ? { genreSource: "apple-catalog" } : {}) };
}

function trackKey(track) {
  const identity = createHash("sha256").update(JSON.stringify([normalize(track.title), normalize(track.artist), normalize(track.album)])).digest("hex").slice(0, 24);
  return `${track.provider}:${track.id}:${identity}`;
}

function safeItem(track, metadata = {}) {
  const artworkUrl = safeArtworkUrl(metadata.artworkUrl);
  const genres = genresOf(metadata.genres);
  const durationSeconds = songDurationSeconds(metadata.durationSeconds);
  return { provider: track.provider, id: track.id, ...(artworkUrl ? { artworkUrl } : {}), ...(durationSeconds ? { durationSeconds } : {}), genres,
    complete: metadata.complete === true, retryable: metadata.complete !== true,
    ...(genres.length && ["netease-wiki", "qq-music", "apple-catalog"].includes(metadata.genreSource) ? { genreSource: metadata.genreSource } : {}) };
}

function bounded(operation, parentSignal, timeoutMs) {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback, value) => {
      if (done) return;
      done = true; clearTimeout(timer); parentSignal.removeEventListener("abort", abort); callback(value);
    };
    const abort = () => { controller.abort(); finish(reject, new Error("METADATA_CANCELLED")); };
    const timer = setTimeout(() => { controller.abort(); finish(reject, new Error("METADATA_TIMEOUT")); }, timeoutMs);
    parentSignal.addEventListener("abort", abort, { once: true });
    if (parentSignal.aborted) { abort(); return; }
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error("METADATA_CANCELLED");
      return operation(controller.signal);
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

/** Public song metadata only. Listening counts, account credentials and user identities never enter this cache. */
export function createMusicMetadata({ loadNeteaseDetails, loadNeteaseWiki, loadQqGenres, searchApple, cachePath,
  now = Date.now, concurrency = 3, timeoutMs = 4500, budgetMs = 16_000 } = {}) {
  const cache = new Map();
  const file = cachePath ? resolve(cachePath) : null;
  if (file && existsSync(file)) {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Metadata cache must be a regular file.");
    if (stat.size <= 16 * 1024 * 1024) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8"));
        if (Array.isArray(saved)) for (const record of saved) {
          if (typeof record?.key === "string" && record.key.length < 300 && record.expiresAt > now() && PROVIDERS.has(record.item?.provider) && typeof record.item.id === "string")
            cache.set(record.key, { ...record, item: safeItem(record.item, record.item) });
        }
      } catch { /* Public metadata can be refreshed if its optional cache is damaged. */ }
    }
  }
  function persist() {
    if (!file) return;
    let temporary;
    try {
      const directory = dirname(file);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (lstatSync(directory).isSymbolicLink()) return;
      chmodSync(directory, 0o700);
      for (const [key, value] of cache) if (value.expiresAt <= now()) cache.delete(key);
      while (cache.size > 15_000) cache.delete(cache.keys().next().value);
      temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
      writeFileSync(temporary, JSON.stringify([...cache.values()]), { mode: 0o600, flag: "wx" });
      renameSync(temporary, file);
    } catch { if (temporary) try { unlinkSync(temporary); } catch { /* Metadata persistence is optional. */ } }
  }
  function getCached(track) {
    const entry = cache.get(trackKey(track));
    return entry?.expiresAt > now() ? structuredClone(entry.item) : null;
  }
  function save(track, metadata) {
    const item = safeItem(track, metadata);
    cache.set(trackKey(track), { key: trackKey(track), item, expiresAt: now() + (item.genres.length ? POSITIVE_TTL : NEGATIVE_TTL) });
    return item;
  }
  return {
    getCached,
    cachedTracks(provider, tracks) {
      return tracks.map(track => {
        const identity = { ...track, provider };
        const existing = getCached(identity);
        const metadata = save(identity, { ...existing,
          ...(safeArtworkUrl(track.artworkUrl) ? { artworkUrl: track.artworkUrl } : {}),
          ...(songDurationSeconds(track.durationSeconds) ? { durationSeconds: track.durationSeconds } : {}),
          ...(genresOf(track.genres).length ? { genres: track.genres, genreSource: track.genreSource } : {}),
          complete: existing?.complete === true || Boolean(track.artworkUrl && songDurationSeconds(track.durationSeconds) && genresOf(track.genres).length),
        });
        return { ...track, ...(metadata.artworkUrl ? { artworkUrl: metadata.artworkUrl } : {}),
          ...(metadata.durationSeconds ? { durationSeconds: metadata.durationSeconds } : {}),
          ...(metadata.genres.length ? { genres: metadata.genres, genreSource: metadata.genreSource } : {}) };
      });
    },
    async enrich(rawTracks, { connections = {}, signal, onProgress } = {}) {
      const tracks = (Array.isArray(rawTracks) ? rawTracks : []).slice(0, 20)
        .filter(track => PROVIDERS.has(track?.provider) && typeof track.id === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(track.id) && cleanText(track.title) && cleanText(track.artist))
        .map(track => ({ provider: track.provider, id: track.id, title: cleanText(track.title), artist: cleanText(track.artist), album: cleanText(track.album) }));
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(abort, budgetMs);
      const items = tracks.map(track => getCached(track) ?? safeItem(track));
      const pending = tracks.map((track, index) => ({ track, index })).filter(({ track }) => getCached(track)?.complete !== true);
      const detailsById = new Map();
      let detailsChecked = false;
      try {
        const ids = [...new Set(pending.filter(({ track }) => track.provider === "netease" && /^\d+$/.test(track.id)).map(({ track }) => track.id))];
        if (ids.length && loadNeteaseDetails && !controller.signal.aborted) {
          try {
            const details = await bounded(nextSignal => loadNeteaseDetails(ids, nextSignal), controller.signal, timeoutMs);
            for (const item of parseNeteaseDetails(details)) detailsById.set(item.id, item);
            detailsChecked = Array.isArray(details?.songs);
          } catch { /* Wiki artwork can still supply the image if the batch lookup fails. */ }
        }
        let cursor = 0;
        let completed = tracks.length - pending.length;
        const worker = async () => {
          while (!controller.signal.aborted) {
            const next = pending[cursor++];
            if (!next) return;
            const { track, index } = next;
            let metadata = { ...items[index], ...(track.provider === "netease" ? detailsById.get(track.id) : {}) };
            let genreChecked = metadata.genres.length > 0;
            let durationChecked = Boolean(metadata.durationSeconds) || (track.provider === "netease" && detailsChecked);
            try {
              if (!genreChecked && track.provider === "netease" && /^\d+$/.test(track.id) && loadNeteaseWiki) {
                const wiki = await bounded(nextSignal => loadNeteaseWiki(track.id, nextSignal), controller.signal, timeoutMs);
                metadata = { ...metadata, ...parseNeteaseWiki(wiki) }; genreChecked = Array.isArray(wiki?.data?.blocks);
              } else if (!genreChecked && track.provider === "qq" && /^\d+$/.test(track.id) && loadQqGenres && connections.qq?.credential) {
                const response = await bounded(nextSignal => loadQqGenres(track.id, connections.qq.credential, nextSignal), controller.signal, timeoutMs);
                metadata.genres = genresOf(response?.genres?.map(genre => genre?.name));
                if (metadata.genres.length) metadata.genreSource = "qq-music";
                genreChecked = Array.isArray(response?.genres);
              }
            } catch { /* Native lookup failure must not hide verified cover or other song metadata. */ }
            if ((!metadata.genres.length || !durationChecked) && searchApple && !controller.signal.aborted) {
              try {
                const catalog = await bounded(nextSignal => searchApple(track, nextSignal), controller.signal, timeoutMs);
                const matched = matchAppleCatalog(track, catalog);
                if (matched) metadata = { ...metadata, ...matched,
                  ...(metadata.genres.length ? { genres: metadata.genres, genreSource: metadata.genreSource } : {}),
                  ...(metadata.artworkUrl ? { artworkUrl: metadata.artworkUrl } : {}),
                  ...(metadata.durationSeconds ? { durationSeconds: metadata.durationSeconds } : {}) };
                if (matched?.genres.length || track.provider === "apple") genreChecked = true;
                durationChecked ||= Boolean(matched?.durationSeconds) || track.provider !== "netease";
              } catch { /* Unmatched or unavailable catalog metadata remains unknown. */ }
            }
            // A timeout or an untouched queue item is never a completed negative lookup.
            const complete = genreChecked && (durationChecked || track.provider !== "netease");
            items[index] = save(track, { ...metadata, complete });
            completed++;
            onProgress?.({ completed, total: tracks.length });
          }
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(3, Math.floor(concurrency) || 1)) }, worker));
        // Covers resolved in the batched request remain useful even if the genre pass reaches its deadline.
        for (const { track, index } of pending) if (track.provider === "netease" && detailsById.has(track.id))
          items[index] = save(track, { ...items[index], ...detailsById.get(track.id) });
        persist();
        return { items };
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    },
  };
}
