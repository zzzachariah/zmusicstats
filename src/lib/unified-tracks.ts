import { calculateGenres } from "./report.ts";
import type { GenreSlice, Localized, MusicReport, PlatformId, RankedTrack } from "./report.ts";

export interface UnifiedTracks {
  tracks: RankedTrack[];
  notice: Localized;
}

export interface KnownGenreDistribution {
  genres: GenreSlice[];
  /** Eligible unique songs with known genres, and all eligible unique songs. */
  known: number;
  total: number;
  /** Unique songs excluded by the >10 display-count rule, including unknown counts. */
  excluded: number;
  /** The known fraction, from 0 to 1. Genre percentages use known songs only. */
  coverage: number;
  notice: Localized;
}

function cloneTrack(track: RankedTrack): RankedTrack {
  return { ...track, genres: [...track.genres], platforms: [...track.platforms], sourceCounts: { ...track.sourceCounts } };
}

function sourceIdentity(track: RankedTrack, platform: PlatformId): string {
  const canonical = track.canonicalId?.trim();
  return canonical ? `recording:${canonical}` : `${platform}:${track.id}`;
}

function sourceRank(track: RankedTrack, index: number): number {
  return Number.isSafeInteger(track.rank) && track.rank > 0 ? track.rank : index + 1;
}

/** One list without pretending differently defined platform counts are additive. */
export function unifiedTracks(report: MusicReport): UnifiedTracks {
  if (report.rankingMode === "combined") {
    return { tracks: report.tracks.map(cloneTrack), notice: { ...report.rankingNotice } };
  }

  const combined = new Map<string, { track: RankedTrack; bestRank: number; order: number }>();
  const platformsSeen = new Set<PlatformId>();
  let partial = false;
  for (const platform of report.platforms) {
    // Apple recent tracks have an order, but no monthly play ranking.
    if (!platform.rankingMatchesPeriod || platform.rankingCoverage === "undated" || platformsSeen.has(platform.id)) continue;
    platformsSeen.add(platform.id);
    partial ||= platform.rankingCoverage === "partial";
    const entries = platform.tracks.map((track, index) => ({ track, rank: sourceRank(track, index), index }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index);
    const identitiesSeen = new Set<string>();
    const idsSeen = new Set<string>();
    for (const { track, rank } of entries) {
      if (!track.id || !track.title || !track.artist) continue;
      const key = sourceIdentity(track, platform.id);
      if (identitiesSeen.has(key) || idsSeen.has(track.id)) continue;
      identitiesSeen.add(key);
      idsSeen.add(track.id);
      const existing = combined.get(key);
      const sourceCount = Object.hasOwn(track.sourceCounts, platform.id) ? track.sourceCounts[platform.id] : track.count;
      if (!existing) {
        combined.set(key, {
          track: { ...cloneTrack(track), platforms: [platform.id], sourceCounts: { [platform.id]: sourceCount ?? null } },
          bestRank: rank, order: combined.size,
        });
      } else {
        // Cross-provider matches reach this branch only through a verified recording ID.
        existing.bestRank = Math.min(existing.bestRank, rank);
        existing.track.id = key;
        existing.track.platforms.push(platform.id);
        existing.track.sourceCounts[platform.id] = sourceCount ?? null;
        existing.track.count = null;
        existing.track.countIsPartial ||= track.countIsPartial;
        existing.track.genres = [...new Set([...existing.track.genres, ...track.genres])];
      }
    }
  }

  const tracks = [...combined.values()]
    .sort((a, b) => (b.track.count ?? -1) - (a.track.count ?? -1) || a.bestRank - b.bestRank || a.order - b.order)
    .map(({ track }, index) => ({ ...track, rank: index + 1 }));
  return {
    tracks,
    notice: {
      zh: `按已获取播放次数排序；跨平台次数沿用各自统计口径，月榜之外的播放未知。同曲跨平台的次数不直接相加。${partial ? "仅包含所选月份中已返回的榜单样本。" : ""}`,
      en: `Ordered by available play counts, retaining each platform's counting definition; plays outside the returned monthly rankings are unknown. Counts for the same recording are not added across platforms.${partial ? " Only returned ranking samples within the selected months are included." : ""}`,
    },
  };
}

function knownTags(genres: readonly string[]): string[] {
  return genres.map((genre) => genre.trim()).filter((genre) => genre && !["unknown", "未识别"].includes(genre.toLowerCase()));
}

/** A genre keeps its ink across changing ranks; extra tags never cycle a short palette. */
export function stableGenreColor(name: string): string {
  const key = name.trim().toLowerCase();
  const colors: Record<string, string> = {
    pop: "#d8ae72", rock: "#8da7b9", "r&b": "#b2a0c6", soul: "#91b7a5",
    jazz: "#d78d7d", electronic: "#8fb2bf", folk: "#b1b68c", indie: "#b693a0",
    "hip-hop": "#c18f64", classical: "#ccc2a5", cantopop: "#a9b8b0", mandopop: "#bd927a",
    "alternative": "#8ca98a", "blues": "#a6a6c8", "country": "#b8ae82", "metal": "#b79292",
  };
  if (colors[key]) return colors[key];
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  return `hsl(${hash % 360} ${(hash >>> 12) % 18 + 24}% ${(hash >>> 20) % 14 + 58}%)`;
}

/** Equal song weights: unequal/unknown play-count definitions cannot bias genre shares. */
export function knownGenreDistribution(tracks: readonly RankedTrack[]): KnownGenreDistribution {
  const unique = new Map<string, { count: number | null; tags: Set<string> }>();
  for (const track of tracks) {
    const canonical = track.canonicalId?.trim();
    const key = canonical ? `recording:${canonical}` : `${[...track.platforms].sort().join(",")}:${track.id}`;
    // The first displayed row supplies the count. Duplicate identities can add verified
    // tags, but must not add source counts or make an unknown display count look known.
    const item = unique.get(key) ?? { count: track.count, tags: new Set<string>() };
    knownTags(track.genres).forEach((tag) => item.tags.add(tag));
    unique.set(key, item);
  }
  const eligible = [...unique.values()].filter(({ count }) => typeof count === "number" && Number.isFinite(count) && count > 10);
  const classified = eligible.filter(({ tags }) => tags.size > 0).map(({ tags }) => tags);
  const known = classified.length;
  const total = eligible.length;
  const excluded = unique.size - total;
  const genres = calculateGenres(classified.map((tags) => ({ count: 1, genres: [...tags] }))).map((genre) => ({ ...genre, color: stableGenreColor(genre.name) }));
  return {
    genres,
    known,
    total,
    excluded,
    coverage: total ? known / total : 0,
    notice: {
      zh: `仅纳入播放次数严格大于 10（不含 10）的歌曲；次数未知不参与。已排除 ${excluded} 首独立曲目，符合门槛的 ${total} 首中，已识别 ${known} 首歌曲的曲风。每首歌权重相同，多曲风均分；${known ? "未识别歌曲不参与占比，已识别部分重新归一为 100%。" : "暂无已识别曲风可计算占比。"}`,
      en: `Only songs with more than 10 plays qualify (10 is excluded); unknown counts are excluded. ${excluded} unique songs fall outside this rule. Genres are known for ${known} of ${total} qualifying songs. Shares use equal song weights split across their genres; ${known ? "unclassified songs are excluded and known genres are normalized to 100%." : "no verified genres are available to calculate shares."}`,
    },
  };
}
