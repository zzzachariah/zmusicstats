export type PlatformId = "netease" | "qq" | "apple";
export type ReportMode = "demo" | "live";
export type Locale = "zh" | "en";
export type Localized = { zh: string; en: string };

/** Inclusive calendar dates; timeZone is part of every comparison. */
export interface ReportPeriod {
  start: string;
  end: string;
  timeZone: string;
}

export interface TrackInput {
  id: string;
  /** A verified recording/version identity, never a title-only match. */
  canonicalId?: string;
  title: string;
  artist: string;
  album?: string;
  count: number | null;
  genres: string[];
  coverIndex?: number;
}

export interface PlatformInput {
  id: PlatformId;
  period: ReportPeriod;
  listenSeconds: number | null;
  durationKind: "actual-total" | "daily-average" | "unknown";
  coverageComplete: boolean;
  tracks: TrackInput[];
  rankingPeriod: ReportPeriod | null;
  countKind: "plays" | "score" | "unknown";
  /** Shared only after the actual count semantics have been verified. */
  countDefinition: string | null;
  rankCoverage: "top" | "complete";
}

export interface ReportInput {
  mode: ReportMode;
  period: ReportPeriod;
  expectedPlatforms?: PlatformId[];
  platforms: PlatformInput[];
}

export interface RankedTrack extends TrackInput {
  rank: number;
  platforms: PlatformId[];
  /** Missing ranks in a truncated counterpart can hide additional plays. */
  countIsPartial: boolean;
  sourceCounts: Partial<Record<PlatformId, number | null>>;
  coverIndex: number;
}

export interface GenreSlice {
  name: string;
  nameZh: string;
  weight: number;
  percentage: number;
  color: string;
}

export interface PlatformShare {
  id: PlatformId;
  name: string;
  nameEn: string;
  seconds: number;
  hours: number;
  percentage: number;
  color: string;
}

export interface PlatformReport {
  id: PlatformId;
  name: string;
  nameEn: string;
  color: string;
  listenSeconds: number | null;
  hours: number | null;
  durationAvailable: boolean;
  rankingMatchesPeriod: boolean;
  tracks: RankedTrack[];
  genres: GenreSlice[];
  genreScope: Localized;
}

export interface ReportInsight {
  id: string;
  title: Localized;
  body: Localized;
}

export interface MusicReport {
  mode: ReportMode;
  period: ReportPeriod;
  periodLabel: Localized;
  platforms: PlatformReport[];
  totalSeconds: number | null;
  totalHours: number | null;
  durationComparable: boolean;
  durationNotice: Localized;
  platformShares: PlatformShare[];
  tracks: RankedTrack[];
  rankingMode: "combined" | "separate";
  rankingNotice: Localized;
  overlappingTracks: RankedTrack[];
  sampleSongCount: number;
  genres: GenreSlice[];
  genreScope: Localized;
  insights: ReportInsight[];
}

export const PLATFORM_META = {
  netease: {
    name: "网易云音乐",
    nameEn: "NetEase Cloud Music",
    color: "#ED795F",
  },
  qq: { name: "QQ 音乐", nameEn: "QQ Music", color: "#95BAA0" },
  apple: { name: "Apple Music", nameEn: "Apple Music", color: "#C6AC7D" },
} as const;

const UNKNOWN = "Unknown";
const GENRE_COLORS = [
  "#D5AB72",
  "#ACA1D6",
  "#8EB6A8",
  "#DC8C7C",
  "#9AAFC7",
  "#C9BCA4",
];
const GENRE_ZH: Record<string, string> = {
  "R&B": "R&B",
  Pop: "流行",
  Indie: "独立",
  Jazz: "爵士",
  Rock: "摇滚",
  Electronic: "电子",
  Folk: "民谣",
  Soul: "灵魂乐",
  "Hip-Hop": "嘻哈",
  Unknown: "未识别",
};
const GENRE_ALIASES: Record<string, string> = {
  "r&b": "R&B",
  pop: "Pop",
  indie: "Indie",
  jazz: "Jazz",
  rock: "Rock",
  electronic: "Electronic",
  folk: "Folk",
  soul: "Soul",
  "hip-hop": "Hip-Hop",
  unknown: UNKNOWN,
  流行: "Pop",
  独立: "Indie",
  爵士: "Jazz",
  摇滚: "Rock",
  电子: "Electronic",
  民谣: "Folk",
  灵魂乐: "Soul",
  嘻哈: "Hip-Hop",
  未识别: UNKNOWN,
};

function genreName(name: string): string {
  const clean = name.trim();
  return GENRE_ALIASES[clean.toLowerCase()] ?? clean;
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPlayCount(value: unknown): value is number {
  return isFiniteNonnegative(value) && Number.isSafeInteger(value);
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function validPeriod(
  period: ReportPeriod | null | undefined,
): period is ReportPeriod {
  if (
    !period ||
    !isDate(period.start) ||
    !isDate(period.end) ||
    period.start > period.end ||
    typeof period.timeZone !== "string" ||
    !period.timeZone.trim()
  )
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: period.timeZone });
    return true;
  } catch {
    return false;
  }
}

export function samePeriod(
  a: ReportPeriod | null | undefined,
  b: ReportPeriod | null | undefined,
): boolean {
  return (
    validPeriod(a) &&
    validPeriod(b) &&
    a.start === b.start &&
    a.end === b.end &&
    a.timeZone === b.timeZone
  );
}

export function formatPeriod(period: ReportPeriod): Localized {
  if (!validPeriod(period))
    return { zh: "日期待确认", en: "Dates unconfirmed" };
  const start = new Date(`${period.start}T12:00:00Z`);
  const end = new Date(`${period.end}T12:00:00Z`);
  const sameMonth = period.start.slice(0, 7) === period.end.slice(0, 7);
  const isFullMonth =
    period.start.endsWith("-01") &&
    end.getUTCDate() ===
      new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
      ).getUTCDate();
  if (sameMonth && isFullMonth) {
    return {
      zh: `${start.getUTCFullYear()} 年 ${start.getUTCMonth() + 1} 月`,
      en: new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(start),
    };
  }
  return {
    zh: `${period.start} 至 ${period.end}`,
    en: `${period.start} – ${period.end}`,
  };
}

export function formatDuration(
  seconds: number | null,
  locale: Locale = "zh",
): string {
  if (!isFiniteNonnegative(seconds))
    return locale === "zh" ? "暂无数据" : "Unavailable";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return locale === "zh"
    ? hours
      ? `${hours} 小时 ${remainder} 分钟`
      : `${remainder} 分钟`
    : hours
      ? `${hours} h ${remainder} min`
      : `${remainder} min`;
}

function trackIdentity(track: TrackInput, platform: PlatformId): string {
  return track.canonicalId?.trim()
    ? `recording:${track.canonicalId.trim()}`
    : `${platform}:${track.id}`;
}

function normalizeTracks(source: PlatformInput): RankedTrack[] {
  const seen = new Set<string>();
  const recordings = new Set<string>();
  return source.tracks
    .filter((track) => {
      const recording = trackIdentity(track, source.id);
      if (
        !track.id ||
        !track.title ||
        !track.artist ||
        seen.has(track.id) ||
        recordings.has(recording)
      )
        return false;
      seen.add(track.id);
      recordings.add(recording);
      return true;
    })
    .map((track, index) => ({
      ...track,
      genres: [
        ...new Set(
          track.genres
            .filter((genre) => typeof genre === "string" && genre.trim())
            .map(genreName),
        ),
      ],
      count:
        source.countKind === "plays" && isPlayCount(track.count)
          ? track.count
          : null,
      rank: index + 1,
      platforms: [source.id],
      sourceCounts: {
        [source.id]:
          source.countKind === "plays" && isPlayCount(track.count)
            ? track.count
            : null,
      },
      countIsPartial: false,
      coverIndex:
        typeof track.coverIndex === "number" ? track.coverIndex : index,
    }));
}

function combineTracks(
  sources: PlatformInput[],
  platforms: PlatformReport[],
): RankedTrack[] {
  const merged = new Map<string, RankedTrack>();
  for (const source of platforms) {
    for (const track of source.tracks) {
      const key = trackIdentity(track, source.id);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          ...track,
          id: key,
          platforms: [...track.platforms],
          sourceCounts: { ...track.sourceCounts },
          genres: [...track.genres],
        });
      } else {
        existing.count = (existing.count ?? 0) + (track.count ?? 0);
        existing.platforms.push(source.id);
        existing.sourceCounts[source.id] = track.count;
        existing.genres = [...new Set([...existing.genres, ...track.genres])];
      }
    }
  }
  return [...merged.values()]
    .map((track) => ({
      ...track,
      countIsPartial: sources.some(
        (source) =>
          source.rankCoverage === "top" && !track.platforms.includes(source.id),
      ),
    }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.rank - b.rank)
    .map((track, index) => ({ ...track, rank: index + 1 }));
}

/** Distributes each song's play weight across its tags; missing tags stay visible. */
export function calculateGenres(
  tracks: Pick<RankedTrack, "count" | "genres">[],
): GenreSlice[] {
  const weights = new Map<string, number>();
  for (const track of tracks) {
    if (!isPlayCount(track.count) || track.count === 0) continue;
    const genres = [
      ...new Set(
        track.genres
          .filter((genre) => typeof genre === "string" && genre.trim())
          .map(genreName),
      ),
    ];
    const labels = genres.length ? genres : [UNKNOWN];
    for (const genre of labels)
      weights.set(
        genre,
        (weights.get(genre) ?? 0) + track.count / labels.length,
      );
  }
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, weight], index) => ({
      name,
      nameZh: GENRE_ZH[name] ?? name,
      weight,
      percentage: (weight / total) * 100,
      color:
        name === UNKNOWN
          ? "#77736F"
          : GENRE_COLORS[index % GENRE_COLORS.length],
    }));
}

export function buildReport(input: ReportInput): MusicReport {
  const expected = [
    ...new Set(
      input.expectedPlatforms ?? input.platforms.map((source) => source.id),
    ),
  ];
  const uniqueSources = new Map<PlatformId, PlatformInput>();
  const duplicateSources = new Set<PlatformId>();
  for (const source of input.platforms) {
    if (uniqueSources.has(source.id)) duplicateSources.add(source.id);
    else uniqueSources.set(source.id, source);
  }
  const sources = [...uniqueSources.values()].filter((source) =>
    expected.includes(source.id),
  );
  const allSourcesPresent =
    expected.length > 0 &&
    sources.length === expected.length &&
    duplicateSources.size === 0;
  const platforms: PlatformReport[] = sources.map((source) => {
    const durationAvailable =
      source.durationKind === "actual-total" &&
      source.coverageComplete &&
      samePeriod(source.period, input.period) &&
      isFiniteNonnegative(source.listenSeconds);
    const tracks = normalizeTracks(source);
    const rankingMatchesPeriod = samePeriod(source.rankingPeriod, input.period);
    const validGenreTracks = tracks.filter((track) => track.count !== null);
    return {
      id: source.id,
      ...PLATFORM_META[source.id],
      listenSeconds: durationAvailable ? source.listenSeconds : null,
      hours: durationAvailable ? source.listenSeconds! / 3600 : null,
      durationAvailable,
      rankingMatchesPeriod,
      tracks,
      genres: rankingMatchesPeriod ? calculateGenres(validGenreTracks) : [],
      genreScope: {
        zh: rankingMatchesPeriod
          ? `基于已获取的 ${tracks.length} 首歌曲，按播放次数计算，缺失次数不参与；不代表全部听歌历史。`
          : "歌曲榜单的日期范围尚未确认，暂不生成本期曲风分布。",
        en: rankingMatchesPeriod
          ? `Based on ${tracks.length} available songs, weighted by play count; missing counts are excluded. Not your full listening history.`
          : "The ranking period is unconfirmed; no genre distribution is shown for this period.",
      },
    };
  });
  const allDurationsValid =
    allSourcesPresent && platforms.every((source) => source.durationAvailable);
  const candidateTotal = allDurationsValid
    ? platforms.reduce((sum, source) => sum + source.listenSeconds!, 0)
    : null;
  const totalSeconds = isFiniteNonnegative(candidateTotal)
    ? candidateTotal
    : null;
  const durationComparable =
    platforms.length >= 2 &&
    allDurationsValid &&
    totalSeconds !== null &&
    totalSeconds > 0;
  const platformShares: PlatformShare[] = durationComparable
    ? platforms.map((source) => ({
        id: source.id,
        name: source.name,
        nameEn: source.nameEn,
        color: source.color,
        seconds: source.listenSeconds!,
        hours: source.hours!,
        percentage: (source.listenSeconds! / totalSeconds!) * 100,
      }))
    : [];
  const durationNotice = durationComparable
    ? {
        zh: "同一日期范围内，各平台实际累计听歌时长。",
        en: "Actual listening time reported by each platform for the same date range.",
      }
    : totalSeconds === 0
      ? {
          zh: "该周期没有已记录的听歌时长，暂无占比。",
          en: "No listening time was recorded for this period.",
        }
      : platforms.length < 2 && allDurationsValid
        ? {
            zh: "连接第二个平台后可比较时长占比。",
            en: "Connect another platform to compare listening time.",
          }
        : {
            zh: "尚未取得所有平台同一周期的完整时长，暂不合计或显示占比。",
            en: "Complete, matching listening periods are not available for every platform; totals and shares are withheld.",
          };

  const definition = sources[0]?.countDefinition;
  const canCombine =
    allSourcesPresent &&
    sources.every(
      (source, index) =>
        samePeriod(source.rankingPeriod, input.period) &&
        source.countKind === "plays" &&
        !!definition?.trim() &&
        source.countDefinition === definition &&
        platforms[index].tracks.every((track) => isPlayCount(track.count)),
    );
  const rankingMode = canCombine ? "combined" : "separate";
  const tracks = canCombine ? combineTracks(sources, platforms) : [];
  const truncated = sources.some((source) => source.rankCoverage === "top");
  const rankingNotice: Localized = !canCombine
    ? {
        zh: "各平台的次数口径或榜单周期尚未对齐，分别展示原始排行。",
        en: "Counting methods or ranking periods are not aligned; rankings are shown separately.",
      }
    : truncated
      ? {
          zh: "仅合并已获取的 Top 歌曲；未上榜部分未知，因此这不是完整的跨平台总榜。",
          en: "Only available top songs are combined. Omitted plays are unknown, so this is not a complete cross-platform ranking.",
        }
      : {
          zh: "同一周期、相同次数口径；仅合并已确认的相同录音版本。",
          en: "Matching periods and count definitions; only verified identical recordings are combined.",
        };

  // Shared recordings can be identified even when their counts cannot be summed.
  const overlapMap = new Map<string, RankedTrack>();
  for (const platform of platforms) {
    if (!platform.rankingMatchesPeriod) continue;
    for (const track of platform.tracks) {
      if (!track.canonicalId?.trim()) continue;
      const existing = overlapMap.get(track.canonicalId);
      if (existing) {
        existing.platforms.push(platform.id);
        existing.sourceCounts[platform.id] = track.count;
      } else
        overlapMap.set(track.canonicalId, {
          ...track,
          count: null,
          platforms: [...track.platforms],
          sourceCounts: { ...track.sourceCounts },
        });
    }
  }
  const overlappingTracks = [...overlapMap.values()].filter(
    (track) => track.platforms.length > 1,
  );
  const sampleKeys = new Set(
    platforms.flatMap((platform) =>
      platform.tracks.map((track) => trackIdentity(track, platform.id)),
    ),
  );
  // Preserve each platform's own tags and proportional count contribution.
  const genres = canCombine
    ? calculateGenres(platforms.flatMap((platform) => platform.tracks))
    : [];
  const sampleSongCount = sampleKeys.size;
  const sampleEntries = platforms.reduce(
    (sum, source) => sum + source.tracks.length,
    0,
  );
  const genreScope: Localized = canCombine
    ? {
        zh: `基于 ${platforms.length} 个平台的 ${sampleEntries} 条榜单记录（${sampleSongCount} 首歌曲）；按已获取播放次数加权，多曲风均分，缺失保留为未识别。`,
        en: `Based on ${sampleEntries} ranking entries (${sampleSongCount} songs) from ${platforms.length} platforms. Weighted by available plays; multiple tags share each song's weight, missing tags remain unknown.`,
      }
    : {
        zh: "统计口径未对齐，暂不生成合并曲风分布；可查看各平台的有效样本。",
        en: "The inputs are not comparable. Combined genres are withheld; valid samples remain available per platform.",
      };
  const insights: ReportInsight[] = [];
  const leadingGenre = genres[0]?.name !== UNKNOWN ? genres[0] : undefined;
  if (leadingGenre)
    insights.push({
      id: "leading-genre",
      title: {
        zh: `${leadingGenre.nameZh}，是这一期的底色。`,
        en: `${leadingGenre.name} sets the tone.`,
      },
      body: {
        zh: `在已获取的歌曲样本中，${leadingGenre.nameZh} 占加权曲风分布的 ${Math.round(leadingGenre.percentage)}%。这些熟悉的声音，组成了这一期的音乐底色。`,
        en: `${leadingGenre.name} accounts for ${Math.round(leadingGenre.percentage)}% of the weighted genre sample. The familiar sounds that colour this chapter of your listening.`,
      },
    });
  if (overlappingTracks.length > 0)
    insights.push({
      id: "shared-favorites",
      title: {
        zh: "换了播放器，还是这首歌。",
        en: "Different players. A familiar favorite.",
      },
      body: {
        zh: `《${overlappingTracks[0].title}》在 ${overlappingTracks[0].platforms.length} 个平台都上榜。共有 ${overlappingTracks.length} 首已确认相同版本的歌曲，出现在至少两个平台的榜单中。`,
        en: `“${overlappingTracks[0].title}” appears on ${overlappingTracks[0].platforms.length} platforms. ${overlappingTracks.length} verified recordings are shared across at least two available rankings.`,
      },
    });
  if (durationComparable) {
    const main = [...platformShares].sort((a, b) => b.seconds - a.seconds)[0];
    insights.push({
      id: "home-platform",
      title: {
        zh: `${main.name}，这一期的主场。`,
        en: `${main.nameEn}, your main listening room.`,
      },
      body: {
        zh: `它承载了 ${platforms.length} 个平台合计听歌时长的 ${Math.round(main.percentage)}%。切换平台，也可以把音乐记忆放在一起。`,
        en: `${Math.round(main.percentage)}% of your combined listening time was here. Your music memories can live together, across platforms.`,
      },
    });
  }
  return {
    mode: input.mode,
    period: { ...input.period },
    periodLabel: formatPeriod(input.period),
    platforms,
    totalSeconds,
    totalHours: totalSeconds === null ? null : totalSeconds / 3600,
    durationComparable,
    durationNotice,
    platformShares,
    tracks,
    rankingMode,
    rankingNotice,
    overlappingTracks,
    sampleSongCount,
    genres,
    genreScope,
    insights,
  };
}
