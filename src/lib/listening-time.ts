import { calculateGenres } from "./report.ts";
import type { Localized, MusicReport, PlatformId, PlatformReport, TrackInput } from "./report.ts";

export type ListeningTimeTrack = Pick<TrackInput, "count" | "durationSeconds" | "listenSeconds"> & {
  countIsPartial?: boolean;
  genres?: string[];
};

export interface ListeningTime {
  seconds: number | null;
  kind: "actual" | "estimated" | "unknown";
  partial: boolean;
  scope: "track" | "genre-sample" | "platform" | "platform-sample" | "report";
  notice: Localized;
  knownTracks: number;
  missingTracks: number;
}

export interface GenreListeningTime extends ListeningTime {
  name: string;
  nameZh: string;
  nameEn: string;
  /** Share of known sample time, never a share of all platform listening. */
  percentage: number;
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function timeNotice(value: Omit<ListeningTime, "notice">): Localized {
  if (value.seconds === null) return { zh: "暂无可用时长", en: "Listening time unavailable" };
  const sample = value.scope === "genre-sample" || value.scope === "platform-sample";
  if (sample) return value.kind === "estimated"
    ? {
        zh: `榜单样本时长，含播放次数 × 歌曲时长的估算${value.missingTracks ? "；部分歌曲时长缺失" : ""}，非平台总时长`,
        en: `Ranking sample time, including plays × track length estimates${value.missingTracks ? "; some tracks lack time data" : ""}; not the platform total`,
      }
    : {
        zh: `榜单样本中的已知收听时长${value.missingTracks ? "；部分歌曲时长缺失" : ""}，非平台总时长`,
        en: `Known listening time within the ranking sample${value.missingTracks ? "; some tracks lack time data" : ""}; not the platform total`,
      };
  if (value.kind === "estimated") return {
    zh: `按播放次数 × 歌曲时长估算，未扣除跳过或未听完的部分${value.partial ? "；次数可能不完整" : ""}`,
    en: `Estimated as plays × track length; skips and partial plays are not deducted${value.partial ? "; play counts may be incomplete" : ""}`,
  };
  return value.partial
    ? { zh: "平台提供的已知收听时长，覆盖可能不完整", en: "Reported listening time; coverage may be incomplete" }
    : { zh: "平台提供的收听时长", en: "Listening time reported by the platform" };
}

function withNotice(value: Omit<ListeningTime, "notice">): ListeningTime {
  return { ...value, notice: timeNotice(value) };
}

/** A verified zero is real; absent/invalid time is never silently converted to zero. */
export function resolveTrackListeningTime(track: ListeningTimeTrack): ListeningTime {
  const partial = Boolean(track.countIsPartial);
  if (nonnegative(track.listenSeconds)) return withNotice({
    seconds: track.listenSeconds, kind: "actual", partial, scope: "track", knownTracks: 1, missingTracks: 0,
  });
  const seconds = nonnegative(track.count) && nonnegative(track.durationSeconds)
    ? track.count * track.durationSeconds : Number.NaN;
  if (Number.isFinite(seconds) && seconds > 0) return withNotice({
    seconds, kind: "estimated", partial, scope: "track", knownTracks: 1, missingTracks: 0,
  });
  return withNotice({ seconds: null, kind: "unknown", partial: true, scope: "track", knownTracks: 0, missingTracks: 1 });
}

/** Only pass tracks eligible for this report period; never mix periods or count scores. */
export function calculateGenreListeningTimes(tracks: readonly ListeningTimeTrack[]): GenreListeningTime[] {
  const groups = new Map<string, { nameZh: string; nameEn: string; values: ListeningTime[] }>();
  for (const track of tracks) {
    // Reuse alias normalization and tag deduplication, then divide only across known tags.
    // Unknown is missing classification, not a genre or part of the known-time denominator.
    const labels = calculateGenres([{ count: 1, genres: track.genres ?? [] }]).filter(label => label.name !== "Unknown");
    if (!labels.length) continue;
    const time = resolveTrackListeningTime(track);
    for (const label of labels) {
      const group = groups.get(label.name) ?? { nameZh: label.nameZh, nameEn: label.nameEn ?? label.name, values: [] };
      group.values.push({ ...time, seconds: time.seconds === null ? null : time.seconds / labels.length });
      groups.set(label.name, group);
    }
  }
  const rows = [...groups].map(([name, group]) => ({
    ...sumSample(group.values, "genre-sample"), name, nameZh: group.nameZh, nameEn: group.nameEn,
  }));
  const total = rows.reduce((sum, row) => sum + (row.seconds ?? 0), 0);
  return rows.map((row) => ({ ...row, percentage: total > 0 && Number.isFinite(total) ? (row.seconds ?? 0) / total * 100 : 0 }))
    .sort((a, b) => (b.seconds ?? -1) - (a.seconds ?? -1) || a.name.localeCompare(b.name));
}

function sumSample(values: readonly ListeningTime[], scope: "genre-sample" | "platform-sample"): ListeningTime {
  const known = values.filter((value) => value.seconds !== null);
  const sum = known.reduce((total, value) => total + value.seconds!, 0);
  const valid = known.length > 0 && Number.isFinite(sum);
  return withNotice({
    seconds: valid ? sum : null,
    kind: !valid ? "unknown" : known.some((value) => value.kind === "estimated") ? "estimated" : "actual",
    // Even a complete sum of a Top-N list is only a sample of platform listening.
    partial: true,
    scope,
    knownTracks: valid ? known.length : 0,
    missingTracks: valid ? values.length - known.length : values.length,
  });
}

/** Preserve an eligible actual platform total; otherwise expose a separately labelled sample. */
export function resolvePlatformListeningTime(
  platform: Pick<PlatformReport, "durationAvailable" | "listenSeconds" | "tracks">
    & Partial<Pick<PlatformReport, "rankingMatchesPeriod" | "rankingCoverage">>,
): ListeningTime {
  if (platform.durationAvailable && nonnegative(platform.listenSeconds)) return withNotice({
    seconds: platform.listenSeconds, kind: "actual", partial: false, scope: "platform", knownTracks: 0, missingTracks: 0,
  });
  if (platform.rankingMatchesPeriod !== true || platform.rankingCoverage === "undated") return {
    ...sumSample([], "platform-sample"),
    notice: { zh: "榜单日期范围尚未确认，暂不估算本期收听时长", en: "The ranking dates are unconfirmed; listening time for this period is not estimated" },
  };
  return sumSample(platform.tracks.map(resolveTrackListeningTime), "platform-sample");
}

export interface ReportListeningTime extends ListeningTime {
  scope: "report";
  actualPlatformCount: number;
  samplePlatformCount: number;
  estimatedPlatformCount: number;
  knownPlatformCount: number;
  missingPlatformCount: number;
  missingPlatformIds: PlatformId[];
}

/** Sum once per provider; a platform total replaces its ranking sample, never adds to it. */
export function resolveReportListeningTime(
  report: Pick<MusicReport, "platforms"> & { expectedPlatforms?: readonly PlatformId[] },
): ReportListeningTime {
  const providers = new Map<PlatformId, ListeningTime>();
  for (const platform of report.platforms) {
    const next = resolvePlatformListeningTime(platform);
    const previous = providers.get(platform.id);
    if (!previous || (previous.seconds === null && next.seconds !== null)
      || (previous.scope !== "platform" && next.scope === "platform")) providers.set(platform.id, next);
  }
  const expected = new Set<PlatformId>([...providers.keys(), ...(report.expectedPlatforms ?? [])]);
  const known = [...providers.values()].filter(value => value.seconds !== null);
  const missingPlatformIds = [...expected].filter(id => providers.get(id)?.seconds == null);
  const sum = known.reduce((total, value) => total + value.seconds!, 0);
  const valid = known.length > 0 && Number.isFinite(sum);
  const actualPlatformCount = known.filter(value => value.scope === "platform").length;
  const samplePlatformCount = known.length - actualPlatformCount;
  const estimatedPlatformCount = known.filter(value => value.kind === "estimated").length;
  const partial = !valid || samplePlatformCount > 0 || missingPlatformIds.length > 0 || known.some(value => value.partial);
  const kind = !valid ? "unknown" : estimatedPlatformCount > 0 ? "estimated" : "actual";
  const notice: Localized = !valid
    ? { zh: "暂无可汇总的收听时长", en: "No listening time is available to combine" }
    : samplePlatformCount > 0
      ? {
          zh: `${actualPlatformCount ? "平台实际时长 + " : ""}已取得的榜单样本${estimatedPlatformCount ? "估算（次数 × 歌长）" : "时长"}；非完整总时长${missingPlatformIds.length ? `，另有 ${missingPlatformIds.length} 个平台时长缺失` : ""}`,
          en: `${actualPlatformCount ? "Reported platform totals + " : ""}retrieved ranking sample ${estimatedPlatformCount ? "estimates (plays × track length)" : "time"}; not a complete total${missingPlatformIds.length ? `; ${missingPlatformIds.length} platform(s) lack time data` : ""}`,
        }
      : missingPlatformIds.length
        ? { zh: `已取得的平台实际时长；${missingPlatformIds.length} 个平台时长缺失`, en: `Available reported platform totals; ${missingPlatformIds.length} platform(s) lack time data` }
        : { zh: "各平台提供的实际收听时长之和", en: "Sum of listening time reported by each platform" };
  return {
    seconds: valid ? sum : null, kind, partial, scope: "report", notice,
    knownTracks: known.reduce((count, value) => count + value.knownTracks, 0),
    missingTracks: [...providers.values()].reduce((count, value) => count + value.missingTracks, 0),
    actualPlatformCount, samplePlatformCount, estimatedPlatformCount,
    knownPlatformCount: known.length, missingPlatformCount: missingPlatformIds.length, missingPlatformIds,
  };
}

export type ListeningTimeUnit = "hours" | "days" | "months" | "years";

/** Display units only: a month is fixed at 30 days and a year at 365 days. */
export function listeningTimeInUnit(seconds: number, unit: ListeningTimeUnit): number | null {
  if (!nonnegative(seconds)) return null;
  const divisor = { hours: 3600, days: 86_400, months: 30 * 86_400, years: 365 * 86_400 }[unit];
  return seconds / divisor;
}

export type TimeMetaphorAnimation = "sunlight" | "earth-spin" | "earth-orbit" | "moon-orbit" | "moon-phase"
  | "satellite" | "vinyl" | "walk" | "bloom" | "film" | "dance" | "rain" | "tea" | "stars"
  | "bird" | "bee" | "wave" | "train" | "bicycle" | "book";

export interface TimeMetaphor {
  id: string;
  category: "space" | "nature" | "life";
  basis: "fact" | "assumption";
  title: Localized;
  text: Localized;
  value: number;
  valueLabel: Localized;
  unit: Localized;
  formula: Localized;
  assumption: Localized;
  source?: { title: string; url: string };
  animation: TimeMetaphorAnimation;
  secondsPerUnit: number;
}

interface MetaphorDefinition extends Omit<TimeMetaphor, "value" | "valueLabel" | "formula"> {
  maxValue?: number;
}

const DAY = 86_400;
const JPL = { title: "NASA/JPL · Astrodynamic Parameters", url: "https://ssd.jpl.nasa.gov/astro_par.html" };
const EARTH = { title: "NASA · Facts About Earth", url: "https://science.nasa.gov/earth/facts/" };
const MOON = { title: "NASA · Moon Phases", url: "https://science.nasa.gov/moon/moon-phases/" };
const ISS = { title: "NASA · Space Station Orbit Tutorial", url: "https://esrs.jsc.nasa.gov/Tools/orbitTutorial.htm" };
const HUMMINGBIRD = { title: "Cornell Lab of Ornithology · Ruby-throated Hummingbird", url: "https://www.allaboutbirds.org/guide/Ruby-throated_Hummingbird/overview" };
const HONEYBEE = { title: "Caltech · Deciphering the Mystery of Bee Flight", url: "https://www.caltech.edu/about/news/deciphering-mystery-bee-flight-1075" };

/** Creative comparisons have an explicit chosen duration, never an invented natural law. */
function sessionMetaphor(
  id: string, category: TimeMetaphor["category"], animation: TimeMetaphorAnimation, minutes: number,
  title: readonly [string, string], unit: readonly [string, string], text: readonly [string, string],
): MetaphorDefinition {
  return {
    id, category, animation, basis: "assumption", secondsPerUnit: minutes * 60, maxValue: 5_000,
    title: { zh: title[0], en: title[1] }, unit: { zh: unit[0], en: unit[1] },
    text: { zh: text[0], en: text[1] },
    assumption: {
      zh: `设定每次 ${minutes} 分钟，作为时间想象；不是自然规律或实际经历。`,
      en: `Assumes ${minutes} minutes per session: an imagined comparison, not a natural law or an account of actual events.`,
    },
  };
}

/** Offline arithmetic and reviewed copy. Facts are approximate comparisons, not live ephemerides. */
const METAPHORS: readonly MetaphorDefinition[] = [
  {
    id: "sunlight", category: "space", basis: "fact", animation: "sunlight", secondsPerUnit: 499.004783836,
    title: { zh: "追上阳光", en: "Following sunlight" }, unit: { zh: "趟", en: "journeys" },
    text: { zh: "这段时间，够阳光从太阳来到地球约 {value} 趟。", en: "Enough time for about {value} light journeys from the Sun to Earth." },
    assumption: { zh: "按 1 个天文单位的光行时约 499 秒计算；实际日地距离会变化。", en: "Using about 499 seconds for light to cross 1 AU; the actual Earth–Sun distance varies." }, source: JPL,
  },
  {
    id: "earth-orbit", category: "space", basis: "fact", animation: "earth-orbit", secondsPerUnit: 365.25 * DAY / 360,
    title: { zh: "绕太阳走一小段", en: "A little way around the Sun" }, unit: { zh: "度", en: "degrees" },
    text: { zh: "把地球公转近似成匀速，这段时间相当于沿轨道前进 {value}°。", en: "At Earth's average orbital pace, that is about {value}° around the Sun." },
    assumption: { zh: "按公转约 365.25 天一圈、匀速近似换算；不是实时轨道位置。", en: "Assuming a uniform 365.25-day orbit; this is not a live orbital position." }, source: EARTH,
  },
  {
    id: "moon-orbit", category: "space", basis: "fact", animation: "moon-orbit", secondsPerUnit: 27.322 * DAY / 360,
    title: { zh: "月亮走到哪里", en: "A little lunar journey" }, unit: { zh: "度", en: "degrees" },
    text: { zh: "以月球平均公转速度换算，足够它绕地球前进约 {value}°。", en: "At the Moon's average orbital pace, that is about {value}° around Earth." },
    assumption: { zh: "按月球公转约 27.322 天一圈、匀速近似计算。", en: "Assuming a uniform lunar orbit of about 27.322 days." }, source: MOON,
  },
  {
    id: "moon-phase", category: "space", basis: "fact", animation: "moon-phase", secondsPerUnit: 29.5 * DAY,
    title: { zh: "月圆月缺", en: "From new Moon to new Moon" }, unit: { zh: "轮月相", en: "lunar cycles" },
    text: { zh: "这段时间相当于约 {value} 轮从新月到下一次新月的等待。", en: "The same time spans about {value} cycles from one new Moon to the next." },
    assumption: { zh: "按月相周期约 29.5 天计算；不同于月球公转周期。", en: "Using a lunar phase cycle of about 29.5 days, distinct from the orbital period." }, source: MOON,
  },
  {
    id: "iss-orbit", category: "space", basis: "fact", animation: "satellite", secondsPerUnit: 90 * 60,
    title: { zh: "从太空看地球", en: "Around Earth from space" }, unit: { zh: "圈", en: "orbits" },
    text: { zh: "足够国际空间站绕地球飞行约 {value} 圈。", en: "Enough time for about {value} International Space Station orbits." },
    assumption: { zh: "采用约 90 分钟一圈；实际轨道周期约 90–93 分钟，随高度变化。", en: "Using about 90 minutes per orbit; actual periods are roughly 90–93 minutes and vary with altitude." }, source: ISS,
  },
  {
    id: "vinyl", category: "life", basis: "assumption", animation: "vinyl", secondsPerUnit: 60 / (100 / 3), maxValue: 20_000,
    title: { zh: "唱片还在转", en: "The record keeps turning" }, unit: { zh: "转", en: "revolutions" },
    text: { zh: "如果唱盘一直以 33⅓ RPM 转动，它会转过约 {value} 圈。", en: "A turntable running continuously at 33⅓ RPM would make about {value} turns." },
    assumption: { zh: "按唱盘连续以 33⅓ 转/分钟运行换算。", en: "Assumes continuous rotation at 33⅓ RPM." },
  },
  {
    id: "walk", category: "life", basis: "assumption", animation: "walk", secondsPerUnit: 30 * 60, maxValue: 10_000,
    title: { zh: "去散个步", en: "Time for a walk" }, unit: { zh: "次散步", en: "walks" },
    text: { zh: "按每次散步 30 分钟，足够安排约 {value} 次。", en: "At 30 minutes per walk, that leaves time for about {value} walks." },
    assumption: { zh: "设定每次散步 30 分钟。", en: "Assumes a 30-minute walk." },
  },
  {
    id: "garden-pause", category: "nature", basis: "assumption", animation: "bloom", secondsPerUnit: 15 * 60,
    title: { zh: "在花园里多待一会儿", en: "A little longer in the garden" }, unit: { zh: "次花间小憩", en: "garden pauses" },
    text: { zh: "每次留 15 分钟看花，这些歌能换来约 {value} 次花间小憩。", en: "At 15 minutes among the flowers, that is about {value} garden pauses." },
    assumption: { zh: "设定每次停留 15 分钟，不以花期作换算。", en: "Assumes a 15-minute pause, not a fixed flowering period." },
  },
  {
    id: "film", category: "life", basis: "assumption", animation: "film", secondsPerUnit: 120 * 60, maxValue: 5_000,
    title: { zh: "电影散场以后", en: "When the credits roll" }, unit: { zh: "部电影", en: "films" },
    text: { zh: "按每部电影 120 分钟，这段时间约能看 {value} 部。", en: "At 120 minutes per film, that is enough time for about {value} films." },
    assumption: { zh: "设定每部电影 120 分钟。", en: "Assumes a two-hour film." },
  },
  {
    id: "dance", category: "life", basis: "assumption", animation: "dance", secondsPerUnit: 4 * 60,
    title: { zh: "再跳一支舞", en: "One more dance" }, unit: { zh: "支舞", en: "dances" },
    text: { zh: "如果一支舞持续 4 分钟，足够跳上约 {value} 支。", en: "If each dance lasted 4 minutes, there would be time for about {value} dances." },
    assumption: { zh: "设定每支舞 4 分钟。", en: "Assumes four minutes per dance." },
  },
  {
    id: "rain-window", category: "nature", basis: "assumption", animation: "rain", secondsPerUnit: 20 * 60,
    title: { zh: "听雨的空隙", en: "A little time for rain" }, unit: { zh: "段听雨时光", en: "rain-watching breaks" },
    text: { zh: "假设每次留 20 分钟听雨，可以留出约 {value} 段安静时光。", en: "Setting aside 20 minutes to watch the rain each time gives about {value} quiet breaks." },
    assumption: { zh: "设定每次听雨 20 分钟。", en: "Assumes a 20-minute rain-watching break." },
  },
  {
    id: "tea-break", category: "life", basis: "assumption", animation: "tea", secondsPerUnit: 10 * 60,
    title: { zh: "一杯茶的空闲", en: "A pause for tea" }, unit: { zh: "次茶歇", en: "tea breaks" },
    text: { zh: "按每次茶歇 10 分钟，可以从容停下约 {value} 次。", en: "At 10 minutes per tea break, that is time for about {value} pauses." },
    assumption: { zh: "设定每次茶歇 10 分钟。", en: "Assumes a ten-minute tea break." },
  },
  {
    id: "stargaze", category: "nature", basis: "assumption", animation: "stars", secondsPerUnit: 60 * 60, maxValue: 5_000,
    title: { zh: "抬头看星星", en: "Looking up at the stars" }, unit: { zh: "次观星", en: "stargazing sessions" },
    text: { zh: "假设每次用 1 小时观星，足够仰望星空约 {value} 次。", en: "With one hour set aside each time, that makes about {value} stargazing sessions." },
    assumption: { zh: "设定每次观星 1 小时。", en: "Assumes one hour per stargazing session." },
  },
  {
    id: "hummingbird-wings", category: "nature", basis: "fact", animation: "bird", secondsPerUnit: 1_000_000 / 53,
    title: { zh: "听见蜂鸟的翅膀", en: "A hummingbird rhythm" }, unit: { zh: "百万次振翅", en: "million wingbeats" },
    text: { zh: "换成红喉蜂鸟的振翅节奏，约是 {value} 百万次轻盈扑动。", en: "At a ruby-throated hummingbird's wingbeat rate, about {value} million tiny beats." },
    assumption: { zh: "按约 53 次/秒换算；不表示持续飞行。", en: "Using about 53 beats per second; not continuous flight." }, source: HUMMINGBIRD,
  },
  {
    id: "honeybee-wings", category: "nature", basis: "fact", animation: "bee", secondsPerUnit: 1_000_000 / 230,
    title: { zh: "花丛里的小马达", en: "A tiny motor among flowers" }, unit: { zh: "百万次振翅", en: "million wingbeats" },
    text: { zh: "按蜜蜂悬停时的振翅节奏，约能数出 {value} 百万次扑动。", en: "At a hovering honeybee's wingbeat rate, about {value} million beats." },
    assumption: { zh: "采用研究中的悬停频率约 230 次/秒；不表示持续飞行。", en: "Uses the study's hovering rate of about 230 beats per second, not continuous flight." }, source: HONEYBEE,
  },
  {
    id: "shore-waves", category: "nature", basis: "assumption", animation: "wave", secondsPerUnit: 8, maxValue: 20_000,
    title: { zh: "海浪一遍遍靠岸", en: "Waves finding the shore" }, unit: { zh: "道浪", en: "waves" },
    text: { zh: "想象每 8 秒一道浪靠岸，你能等到约 {value} 道。", en: "Imagine a wave arriving every eight seconds: about {value} waves reaching shore." },
    assumption: { zh: "设定浪间隔为 8 秒；实际浪周期随海况变化。", en: "Assumes eight seconds between waves; real periods vary with sea conditions." },
  },
  {
    id: "forest-loop", category: "nature", basis: "assumption", animation: "walk", secondsPerUnit: 45 * 60, maxValue: 5_000,
    title: { zh: "沿树影绕一圈", en: "A loop beneath the trees" }, unit: { zh: "圈林间步道", en: "woodland loops" },
    text: { zh: "按一圈林间步道 45 分钟，够走约 {value} 圈。", en: "With a 45-minute woodland loop, that is about {value} walks beneath the trees." },
    assumption: { zh: "设定每圈步道用时 45 分钟。", en: "Assumes 45 minutes for each woodland loop." },
  },
  {
    id: "birdwatch", category: "nature", basis: "assumption", animation: "bird", secondsPerUnit: 20 * 60,
    title: { zh: "等枝头动一下", en: "Waiting for a flutter" }, unit: { zh: "次观鸟", en: "birdwatching pauses" },
    text: { zh: "每次安静观鸟 20 分钟，够守候约 {value} 次。", en: "At 20 minutes of quiet birdwatching, about {value} pauses to look and listen." },
    assumption: { zh: "设定每次观鸟 20 分钟。", en: "Assumes a 20-minute birdwatching pause." },
  },
  {
    id: "train-window", category: "life", basis: "assumption", animation: "train", secondsPerUnit: 3600 / 250, maxValue: 20_000,
    title: { zh: "让风景从车窗流过", en: "A view from the train" }, unit: { zh: "公里", en: "km" },
    text: { zh: "如果列车以 250 公里/小时不停前行，窗外会掠过约 {value} 公里风景。", en: "On a train cruising nonstop at 250 km/h, about {value} km of scenery would pass the window." },
    assumption: { zh: "设定恒速 250 公里/小时，不计停站。", en: "Assumes a steady 250 km/h with no stops." },
  },
  {
    id: "bicycle-ride", category: "life", basis: "assumption", animation: "bicycle", secondsPerUnit: 3600 / 15, maxValue: 5_000,
    title: { zh: "把风装进车篮", en: "A breeze in the basket" }, unit: { zh: "公里", en: "km" },
    text: { zh: "按 15 公里/小时的骑行节奏，约能骑出 {value} 公里。", en: "At a cycling pace of 15 km/h, that is about {value} km on two wheels." },
    assumption: { zh: "设定恒速 15 公里/小时，不计休息。", en: "Assumes a steady 15 km/h with no breaks." },
  },
  {
    id: "turn-pages", category: "life", basis: "assumption", animation: "book", secondsPerUnit: 90, maxValue: 5_000,
    title: { zh: "书签可以往后挪了", en: "Move the bookmark" }, unit: { zh: "页", en: "pages" },
    text: { zh: "如果每 90 秒读一页，书签能向后移动约 {value} 页。", en: "At one page every 90 seconds, the bookmark could move about {value} pages." },
    assumption: { zh: "设定每页阅读 90 秒。", en: "Assumes 90 seconds per page." },
  },
  {
    id: "postcards", category: "life", basis: "assumption", animation: "book", secondsPerUnit: 8 * 60,
    title: { zh: "寄给远方的你", en: "A note from somewhere" }, unit: { zh: "张明信片", en: "postcards" },
    text: { zh: "每张明信片写 8 分钟，够把想说的话写上约 {value} 张。", en: "With eight minutes for each postcard, about {value} little notes to send." },
    assumption: { zh: "设定每张明信片写 8 分钟。", en: "Assumes eight minutes to write a postcard." },
  },
  {
    id: "paper-cranes", category: "life", basis: "assumption", animation: "bird", secondsPerUnit: 3 * 60,
    title: { zh: "折一群纸鹤", en: "A flock of paper cranes" }, unit: { zh: "只纸鹤", en: "paper cranes" },
    text: { zh: "如果每 3 分钟折一只纸鹤，桌上能落下约 {value} 只。", en: "At three minutes per folded crane, about {value} paper birds could gather on the table." },
    assumption: { zh: "设定每只纸鹤用时 3 分钟。", en: "Assumes three minutes to fold one paper crane." },
  },
  {
    id: "window-sketch", category: "life", basis: "assumption", animation: "book", secondsPerUnit: 30 * 60,
    title: { zh: "把窗外画下来", en: "Sketch what you see" }, unit: { zh: "幅速写", en: "sketches" },
    text: { zh: "每幅速写留半小时，够画下约 {value} 幅窗外风景。", en: "At half an hour per sketch, about {value} views from the window." },
    assumption: { zh: "设定每幅速写 30 分钟。", en: "Assumes 30 minutes per sketch." },
  },
  {
    id: "bread-oven", category: "life", basis: "assumption", animation: "tea", secondsPerUnit: 35 * 60,
    title: { zh: "等面包香飘出来", en: "Waiting for warm bread" }, unit: { zh: "次烘烤等待", en: "oven waits" },
    text: { zh: "假设一次烘烤等 35 分钟，够等来约 {value} 次面包香。", en: "With a 35-minute oven wait, about {value} moments of warm-bread anticipation." },
    assumption: { zh: "设定每次等待 35 分钟，不作为烘焙配方。", en: "Assumes a 35-minute wait, not a baking recipe." },
  },
  {
    id: "ferry-window", category: "life", basis: "assumption", animation: "wave", secondsPerUnit: 3600 / 20, maxValue: 5_000,
    title: { zh: "慢慢驶过水面", en: "Across the water" }, unit: { zh: "公里", en: "km" },
    text: { zh: "如果渡轮以 20 公里/小时不停航行，约能驶过 {value} 公里水面。", en: "On a ferry cruising nonstop at 20 km/h, about {value} km across the water." },
    assumption: { zh: "设定恒速 20 公里/小时，不计靠岸。", en: "Assumes a steady 20 km/h with no dock stops." },
  },
  {
    id: "cloud-watch", category: "nature", basis: "assumption", animation: "rain", secondsPerUnit: 12 * 60,
    title: { zh: "看云换个形状", en: "Let the clouds change shape" }, unit: { zh: "次看云小憩", en: "cloud-watching pauses" },
    text: { zh: "每次给云 12 分钟，约能留出 {value} 次什么也不赶的空白。", en: "Twelve minutes for the clouds, about {value} little pauses with nowhere to rush." },
    assumption: { zh: "设定每次看云 12 分钟。", en: "Assumes 12 minutes of cloud watching." },
  },
  {
    id: "shore-picnic", category: "nature", basis: "assumption", animation: "wave", secondsPerUnit: 90 * 60,
    title: { zh: "把午后摊在海边", en: "An afternoon by the sea" }, unit: { zh: "次海边野餐", en: "seaside picnics" },
    text: { zh: "假如每次海边野餐待 90 分钟，够铺开约 {value} 次这样的午后。", en: "With 90 minutes for each seaside picnic, about {value} afternoons beside the waves." },
    assumption: { zh: "设定每次野餐 90 分钟。", en: "Assumes a 90-minute picnic." },
  },
  {
    id: "tidepool-look", category: "nature", basis: "assumption", animation: "wave", secondsPerUnit: 25 * 60,
    title: { zh: "岩石间的小小海洋", en: "A small ocean in the rocks" }, unit: { zh: "次潮池观察", en: "tide-pool visits" },
    text: { zh: "每次留 25 分钟看潮池，约能蹲下来看 {value} 次小小的海洋。", en: "At 25 minutes beside a tide pool, about {value} chances to study a miniature ocean." },
    assumption: { zh: "设定每次观察 25 分钟，不按潮汐周期换算。", en: "Assumes a 25-minute visit, not a fixed tidal cycle." },
  },
  {
    id: "leaf-notebook", category: "nature", basis: "assumption", animation: "book", secondsPerUnit: 10 * 60,
    title: { zh: "记住一片叶子的纹路", en: "Remember a leaf's veins" }, unit: { zh: "页叶子手记", en: "leaf-study pages" },
    text: { zh: "如果用 10 分钟画一片叶子，能攒下约 {value} 页绿色手记。", en: "Ten minutes to sketch a leaf could fill about {value} pages with green details." },
    assumption: { zh: "设定每页观察与记录 10 分钟。", en: "Assumes ten minutes to observe and sketch each page." },
  },
  {
    id: "garden-water", category: "nature", basis: "assumption", animation: "bloom", secondsPerUnit: 12 * 60,
    title: { zh: "给阳台一点照顾", en: "A little care for the balcony" }, unit: { zh: "次园艺小憩", en: "gardening pauses" },
    text: { zh: "每次给阳台植物留 12 分钟，够慢慢照料约 {value} 次。", en: "Twelve minutes with the balcony plants gives about {value} quiet gardening pauses." },
    assumption: { zh: "设定每次照料 12 分钟，不代表浇水频率建议。", en: "Assumes 12 minutes of plant care, not a watering schedule." },
  },
  {
    id: "forest-listen", category: "nature", basis: "assumption", animation: "walk", secondsPerUnit: 15 * 60,
    title: { zh: "把耳机留给森林", en: "Let the forest take a turn" }, unit: { zh: "段林间聆听", en: "forest-listening pauses" },
    text: { zh: "如果每次停下听森林 15 分钟，约有 {value} 段风声可以慢慢听。", en: "With 15 minutes to listen to the forest, about {value} pauses for the wind in the trees." },
    assumption: { zh: "设定每次林间停留 15 分钟。", en: "Assumes a 15-minute pause in the forest." },
  },
  {
    id: "river-pause", category: "nature", basis: "assumption", animation: "wave", secondsPerUnit: 10 * 60,
    title: { zh: "坐着看河水过去", en: "Watch the river go by" }, unit: { zh: "段河边时光", en: "riverside pauses" },
    text: { zh: "每次在河边坐 10 分钟，这些歌够换约 {value} 段流水声。", en: "Ten minutes by the river each time: about {value} pauses with the sound of water." },
    assumption: { zh: "设定每次河边停留 10 分钟。", en: "Assumes ten minutes beside the river." },
  },
  {
    id: "pond-watch", category: "nature", basis: "assumption", animation: "wave", secondsPerUnit: 20 * 60,
    title: { zh: "等水面画一个圈", en: "Wait for a ripple" }, unit: { zh: "次池边小坐", en: "pond-side pauses" },
    text: { zh: "按每次在池边坐 20 分钟，约有 {value} 次空闲留给涟漪。", en: "At 20 minutes by a pond, about {value} quiet pauses to watch the ripples." },
    assumption: { zh: "设定每次停留 20 分钟，不预测涟漪出现的频率。", en: "Assumes a 20-minute pause, not a prediction of ripple frequency." },
  },
  {
    id: "butterfly-walk", category: "nature", basis: "assumption", animation: "bloom", secondsPerUnit: 30 * 60,
    title: { zh: "沿蝴蝶的方向走走", en: "Take the butterfly path" }, unit: { zh: "次花间漫步", en: "flower-path walks" },
    text: { zh: "每次拿半小时在花间漫步，足够安排约 {value} 次轻轻的出走。", en: "Half an hour along a flower path, about {value} gentle little escapes." },
    assumption: { zh: "设定每次漫步 30 分钟。", en: "Assumes a 30-minute walk among flowers." },
  },
  {
    id: "hilltop-view", category: "nature", basis: "assumption", animation: "walk", secondsPerUnit: 40 * 60,
    title: { zh: "在山顶多看一会儿", en: "Stay a little at the summit" }, unit: { zh: "次远眺", en: "hilltop pauses" },
    text: { zh: "假设每次用 40 分钟眺望山野，能留给远方约 {value} 次注视。", en: "With 40 minutes to take in the hills, about {value} long looks into the distance." },
    assumption: { zh: "设定每次眺望 40 分钟，不含登山时间。", en: "Assumes a 40-minute view, excluding the climb." },
  },
  {
    id: "winter-window", category: "nature", basis: "assumption", animation: "rain", secondsPerUnit: 15 * 60,
    title: { zh: "给冬天留一扇窗", en: "A window for winter" }, unit: { zh: "次窗边小憩", en: "winter-window pauses" },
    text: { zh: "每次靠窗发呆 15 分钟，约能拥有 {value} 段不着急的冬日。", en: "Fifteen minutes at the window, about {value} unhurried winter pauses." },
    assumption: { zh: "设定每次窗边停留 15 分钟。", en: "Assumes a 15-minute pause at the window." },
  },
  {
    id: "campfire-evening", category: "nature", basis: "assumption", animation: "stars", secondsPerUnit: 2 * 3600, maxValue: 5_000,
    title: { zh: "火光照着慢慢聊", en: "Stories in the firelight" }, unit: { zh: "次围炉夜谈", en: "fireside evenings" },
    text: { zh: "每次围着火光聊两小时，约有 {value} 个夜晚可把故事说慢一点。", en: "Two hours around the fire, about {value} evenings to let the stories unfold." },
    assumption: { zh: "设定每次夜谈 2 小时。", en: "Assumes two hours per fireside evening." },
  },
  {
    id: "night-under-stars", category: "nature", basis: "assumption", animation: "stars", secondsPerUnit: 8 * 3600,
    title: { zh: "把夜晚交给星空", en: "A night beneath the stars" }, unit: { zh: "个露营夜晚", en: "camping nights" },
    text: { zh: "按每晚在营地待 8 小时，约能铺开 {value} 个星空下的夜晚。", en: "At eight hours in camp each night, about {value} nights beneath the stars." },
    assumption: { zh: "设定每个露营夜晚 8 小时。", en: "Assumes eight hours for a night in camp." },
  },
  {
    id: "sunrise-wait", category: "nature", basis: "assumption", animation: "sunlight", secondsPerUnit: 30 * 60,
    title: { zh: "等天空慢慢亮起来", en: "Wait for the sky to brighten" }, unit: { zh: "次日出守候", en: "sunrise waits" },
    text: { zh: "如果每次留半小时等日出，约能把 {value} 个清晨留给天光。", en: "With half an hour to wait for sunrise, about {value} mornings saved for the light." },
    assumption: { zh: "设定每次等待 30 分钟，不把曙光持续时间固定化。", en: "Assumes a 30-minute wait, not a fixed length of dawn." },
  },
  {
    id: "handwritten-letter", category: "life", basis: "assumption", animation: "book", secondsPerUnit: 25 * 60,
    title: { zh: "有些话适合手写", en: "Some words belong on paper" }, unit: { zh: "封手写信", en: "handwritten letters" },
    text: { zh: "如果一封信写 25 分钟，约能把惦念装进 {value} 个信封。", en: "With 25 minutes for a letter, about {value} envelopes full of things left unsaid." },
    assumption: { zh: "设定每封信用时 25 分钟。", en: "Assumes 25 minutes to write a letter." },
  },
  {
    id: "long-hug", category: "life", basis: "assumption", animation: "bloom", secondsPerUnit: 30, maxValue: 5_000,
    title: { zh: "让拥抱再长一点", en: "Let the hug last a little longer" }, unit: { zh: "次拥抱", en: "hugs" },
    text: { zh: "每次拥抱 30 秒，这些歌的长度约够 {value} 次不急着松手。", en: "At 30 seconds per hug, about {value} moments of not letting go just yet." },
    assumption: { zh: "设定每次拥抱 30 秒。", en: "Assumes a 30-second hug." },
  },
  {
    id: "night-phone", category: "life", basis: "assumption", animation: "moon-phase", secondsPerUnit: 40 * 60,
    title: { zh: "晚安可以晚一点说", en: "Goodnight can wait" }, unit: { zh: "次夜间通话", en: "late-night calls" },
    text: { zh: "如果每次通话 40 分钟，足够把晚安推迟约 {value} 次。", en: "With 40 minutes for each call, about {value} goodnights that can wait a little." },
    assumption: { zh: "设定每次通话 40 分钟。", en: "Assumes a 40-minute call." },
  },
  {
    id: "shared-breakfast", category: "life", basis: "assumption", animation: "tea", secondsPerUnit: 35 * 60,
    title: { zh: "早餐不用赶着吃", en: "Breakfast without the rush" }, unit: { zh: "次慢早餐", en: "slow breakfasts" },
    text: { zh: "给每顿早餐 35 分钟，约有 {value} 次可以慢慢说早安。", en: "Thirty-five minutes for breakfast, about {value} mornings with time to say hello." },
    assumption: { zh: "设定每顿早餐 35 分钟。", en: "Assumes 35 minutes for breakfast." },
  },
  {
    id: "coffee-chat", category: "life", basis: "assumption", animation: "tea", secondsPerUnit: 45 * 60,
    title: { zh: "咖啡凉了也没关系", en: "Let the coffee go cold" }, unit: { zh: "次咖啡闲聊", en: "coffee conversations" },
    text: { zh: "如果一次咖啡闲聊 45 分钟，够聊约 {value} 场不赶时间的话。", en: "At 45 minutes over coffee, about {value} conversations with no hurry to leave." },
    assumption: { zh: "设定每次闲聊 45 分钟。", en: "Assumes a 45-minute coffee conversation." },
  },
  {
    id: "bookshop-wander", category: "life", basis: "assumption", animation: "book", secondsPerUnit: 3600, maxValue: 5_000,
    title: { zh: "在书店迷路一会儿", en: "Get lost in a bookshop" }, unit: { zh: "次书店漫游", en: "bookshop visits" },
    text: { zh: "每次在书店逛一小时，这些歌够换约 {value} 次书架间的迷路。", en: "An hour in a bookshop each time, about {value} chances to get lost between the shelves." },
    assumption: { zh: "设定每次逛书店 1 小时。", en: "Assumes a one-hour bookshop visit." },
  },
  {
    id: "museum-room", category: "life", basis: "assumption", animation: "walk", secondsPerUnit: 15 * 60,
    title: { zh: "在一幅画前多站一会儿", en: "Stay with a painting" }, unit: { zh: "次赏画停留", en: "painting pauses" },
    text: { zh: "如果每幅画前站 15 分钟，能给约 {value} 幅画一次慢慢相遇。", en: "Fifteen minutes with each painting, about {value} unhurried encounters with art." },
    assumption: { zh: "设定每幅画前停留 15 分钟。", en: "Assumes 15 minutes with each painting." },
  },
  {
    id: "old-photos", category: "life", basis: "assumption", animation: "film", secondsPerUnit: 20, maxValue: 10_000,
    title: { zh: "翻到那年夏天", en: "Find that summer again" }, unit: { zh: "张旧照片", en: "old photographs" },
    text: { zh: "每张旧照片看 20 秒，约能重逢 {value} 个被留下的瞬间。", en: "Twenty seconds for each old photograph, about {value} moments to meet again." },
    assumption: { zh: "设定每张照片停留 20 秒。", en: "Assumes 20 seconds with each photograph." },
  },
  {
    id: "photo-walk", category: "life", basis: "assumption", animation: "film", secondsPerUnit: 90 * 60,
    title: { zh: "带相机出门绕绕", en: "Take the camera for a walk" }, unit: { zh: "次摄影漫步", en: "photo walks" },
    text: { zh: "按每次摄影漫步 90 分钟，够出门寻找约 {value} 次好光线。", en: "With 90 minutes for a photo walk, about {value} outings to look for the light." },
    assumption: { zh: "设定每次摄影漫步 90 分钟。", en: "Assumes a 90-minute photo walk." },
  },
  {
    id: "jigsaw-piece", category: "life", basis: "assumption", animation: "book", secondsPerUnit: 45, maxValue: 5_000,
    title: { zh: "把零散慢慢拼好", en: "Bring the pieces together" }, unit: { zh: "块拼图", en: "puzzle pieces" },
    text: { zh: "假如每 45 秒找到一块拼图的位置，约能拼上 {value} 块。", en: "Finding a place for one puzzle piece every 45 seconds would fit about {value} pieces." },
    assumption: { zh: "设定每块拼图用时 45 秒。", en: "Assumes 45 seconds to place each piece." },
  },
  {
    id: "puzzle-afternoon", category: "life", basis: "assumption", animation: "book", secondsPerUnit: 3 * 3600, maxValue: 5_000,
    title: { zh: "把一个下午摊开", en: "Spread out an afternoon" }, unit: { zh: "个拼图下午", en: "puzzle afternoons" },
    text: { zh: "每次拿三小时慢慢拼图，约能留住 {value} 个这样安静的下午。", en: "Three hours with a puzzle, about {value} quiet afternoons spread across the table." },
    assumption: { zh: "设定每次拼图 3 小时，不保证完成整幅。", en: "Assumes a three-hour session, not necessarily a finished puzzle." },
  },
  {
    id: "kitchen-dinner", category: "life", basis: "assumption", animation: "tea", secondsPerUnit: 50 * 60,
    title: { zh: "为晚饭留一点认真", en: "Make an evening of dinner" }, unit: { zh: "次下厨", en: "home-cooking sessions" },
    text: { zh: "如果每次下厨 50 分钟，约能把厨房的灯点亮 {value} 次。", en: "Fifty minutes in the kitchen, about {value} evenings of making something at home." },
    assumption: { zh: "设定每次下厨 50 分钟。", en: "Assumes a 50-minute cooking session." },
  },
  {
    id: "soup-simmer", category: "life", basis: "assumption", animation: "tea", secondsPerUnit: 75 * 60,
    title: { zh: "让汤慢慢咕嘟着", en: "Let the pot bubble quietly" }, unit: { zh: "次炖汤等待", en: "soup-pot waits" },
    text: { zh: "假设一锅汤等 75 分钟，够等来约 {value} 次热气腾腾。", en: "With a 75-minute wait for a pot of soup, about {value} warm, steaming arrivals." },
    assumption: { zh: "设定每次等待 75 分钟，不作为烹饪配方。", en: "Assumes a 75-minute wait, not a cooking recipe." },
  },
  {
    id: "playlist-making", category: "life", basis: "assumption", animation: "vinyl", secondsPerUnit: 20 * 60,
    title: { zh: "把心情排成歌单", en: "Put the feeling in a playlist" }, unit: { zh: "份歌单", en: "playlists" },
    text: { zh: "每份歌单认真挑 20 分钟，约能为不同心情排好 {value} 份。", en: "Twenty minutes choosing each playlist, about {value} little soundtracks for different moods." },
    assumption: { zh: "设定每份歌单整理 20 分钟。", en: "Assumes 20 minutes to arrange a playlist." },
  },
  {
    id: "album-side", category: "life", basis: "assumption", animation: "vinyl", secondsPerUnit: 22 * 60,
    title: { zh: "听完这一面再说", en: "Stay until the side ends" }, unit: { zh: "面唱片", en: "record sides" },
    text: { zh: "如果唱片一面放 22 分钟，约够安静听完 {value} 面。", en: "At 22 minutes per record side, about {value} sides to hear from beginning to end." },
    assumption: { zh: "设定每面唱片 22 分钟。", en: "Assumes a 22-minute record side." },
  },
  {
    id: "piano-practice", category: "life", basis: "assumption", animation: "vinyl", secondsPerUnit: 25 * 60,
    title: { zh: "再弹一遍那段旋律", en: "Play that passage once more" }, unit: { zh: "次练琴", en: "practice sessions" },
    text: { zh: "每次练琴 25 分钟，够和琴键约会约 {value} 次。", en: "With 25 minutes at the keys, about {value} little appointments with a melody." },
    assumption: { zh: "设定每次练琴 25 分钟。", en: "Assumes a 25-minute practice session." },
  },
  {
    id: "station-wait", category: "life", basis: "assumption", animation: "train", secondsPerUnit: 18 * 60,
    title: { zh: "等下一班车，也等你", en: "Waiting for the train, and you" }, unit: { zh: "次站台等候", en: "platform waits" },
    text: { zh: "如果一班车等 18 分钟，这些歌约够陪你等 {value} 次。", en: "At 18 minutes for the next train, these songs could keep you company for about {value} waits." },
    assumption: { zh: "设定每次等候 18 分钟，不代表实际班次。", en: "Assumes an 18-minute wait, not an actual timetable." },
  },
  {
    id: "city-bus", category: "life", basis: "assumption", animation: "train", secondsPerUnit: 3600 / 35, maxValue: 5_000,
    title: { zh: "坐到城市的另一边", en: "To the other side of town" }, unit: { zh: "公里", en: "km" },
    text: { zh: "如果巴士平均每小时走 35 公里，约能陪你经过 {value} 公里的街景。", en: "On a bus averaging 35 km/h, about {value} km of streets would pass by." },
    assumption: { zh: "设定全程平均速度 35 公里/小时。", en: "Assumes an overall average speed of 35 km/h." },
  },
  {
    id: "walking-distance", category: "life", basis: "assumption", animation: "walk", secondsPerUnit: 3600 / 4,
    title: { zh: "用脚步量一量城市", en: "Measure the city in footsteps" }, unit: { zh: "公里", en: "km" },
    text: { zh: "按每小时走 4 公里的节奏，约能走过 {value} 公里街巷。", en: "At a walking pace of 4 km/h, about {value} km of streets and side roads." },
    assumption: { zh: "设定恒速 4 公里/小时，不计休息。", en: "Assumes a steady 4 km/h with no breaks." },
  },
  {
    id: "road-trip", category: "life", basis: "assumption", animation: "train", secondsPerUnit: 3600 / 80, maxValue: 5_000,
    title: { zh: "给公路配一张歌单", en: "A soundtrack for the open road" }, unit: { zh: "公里", en: "km" },
    text: { zh: "假如旅途平均时速 80 公里，这段歌声约能伴行 {value} 公里。", en: "On a road trip averaging 80 km/h, these songs could accompany about {value} km." },
    assumption: { zh: "设定全程平均速度 80 公里/小时。", en: "Assumes an overall average speed of 80 km/h." },
  },
  {
    id: "paper-plane", category: "life", basis: "assumption", animation: "bird", secondsPerUnit: 2 * 60,
    title: { zh: "让纸飞机排成一队", en: "A fleet of paper planes" }, unit: { zh: "架纸飞机", en: "paper planes" },
    text: { zh: "如果每两分钟折好一架，约能让 {value} 架纸飞机等待起飞。", en: "Folding one every two minutes would leave about {value} paper planes ready for takeoff." },
    assumption: { zh: "设定每架纸飞机折叠 2 分钟。", en: "Assumes two minutes to fold a paper plane." },
  },
  {
    id: "balcony-evening", category: "life", basis: "assumption", animation: "bloom", secondsPerUnit: 35 * 60,
    title: { zh: "今晚就在阳台吹吹风", en: "Stay on the balcony tonight" }, unit: { zh: "段阳台晚风", en: "balcony evenings" },
    text: { zh: "每次给晚风 35 分钟，约能留住 {value} 段不必安排的夜色。", en: "Thirty-five minutes for the evening breeze, about {value} little nights with nothing planned." },
    assumption: { zh: "设定每次阳台停留 35 分钟。", en: "Assumes a 35-minute pause on the balcony." },
  },
  sessionMetaphor("wetland-boardwalk", "nature", "walk", 90,
    ["走进芦苇的声音里", "Follow the reeds"], ["次湿地漫步", "wetland walks"],
    ["给芦苇沙沙的午后 90 分钟：这些歌，约能陪你沿栈道走 {value} 回。", "Reeds rustling beside a boardwalk: about {value} afternoons, allowing 90 minutes for each walk."]),
  sessionMetaphor("orchard-afternoon", "nature", "bloom", 120,
    ["果园里慢慢挑", "An afternoon in the orchard"], ["次果园探访", "orchard visits"],
    ["留两小时去果园看看，约有 {value} 次抬头找果子的闲暇。", "With two hours in an orchard, about {value} visits spent looking up through the branches."]),
  sessionMetaphor("botanical-greenhouse", "nature", "bloom", 75,
    ["温室里借一点夏天", "Borrow a little summer"], ["次温室游览", "greenhouse visits"],
    ["如果一次温室游览留 75 分钟，你可以向绿意借来约 {value} 段小小的夏天。", "Borrow a little summer from a greenhouse: about {value} visits, given 75 minutes for each."]),
  sessionMetaphor("coastal-path", "nature", "wave", 180,
    ["沿着海岸走到风里", "Follow the coast into the wind"], ["次海岸徒步", "coastal hikes"],
    ["按每次海岸徒步三小时，这段歌声约能铺开 {value} 条有海风的路。", "At three hours per coastal hike, about {value} walks with salt in the air."]),
  sessionMetaphor("waterfall-stop", "nature", "rain", 45,
    ["让水声盖过别的事", "Let the water do the talking"], ["次瀑布停留", "waterfall pauses"],
    ["水声可以填满约 {value} 段空白——假设你每回在瀑布边停留 45 分钟。", "Let the water fill about {value} quiet pauses, imagining 45 minutes beside the waterfall each time."]),
  sessionMetaphor("pine-trail", "nature", "walk", 120,
    ["在松针上走轻一点", "Soft steps beneath the pines"], ["次松林徒步", "pine-forest hikes"],
    ["换成每回两小时的松林徒步，这段歌声约够走 {value} 回，脚下都是柔软的松针。", "Trade these songs for two-hour pine-forest hikes: about {value} walks with soft needles underfoot."]),
  sessionMetaphor("meadow-blanket", "nature", "bloom", 90,
    ["在草地上摊开一本书", "A book on a picnic blanket"], ["次草地阅读", "meadow reading sessions"],
    ["一本书，一块草地。如果每回读 90 分钟，约能留出 {value} 个翻页与风声交替的下午。", "A book, a patch of grass, and about {value} afternoons of reading — allowing 90 minutes each."]),
  sessionMetaphor("lake-kayak", "nature", "wave", 60,
    ["划桨时留下一条水线", "A line across the lake"], ["次湖上划艇", "lake paddles"],
    ["假设每次湖上划艇一小时，约能划出 {value} 段与岸边保持距离的时光。", "At an hour paddling on a lake, about {value} little journeys away from the shore."]),
  sessionMetaphor("shell-sketch", "nature", "book", 45,
    ["把贝壳的纹路画下来", "Draw the shell's small spirals"], ["次贝壳写生", "shell studies"],
    ["贝壳上的细纹也值得慢慢看。以每幅写生 45 分钟计，约能画下 {value} 份海边的小细节。", "Even a shell's fine lines deserve a closer look: about {value} studies, at 45 minutes apiece."]),
  sessionMetaphor("mountain-cabin", "nature", "rain", 240,
    ["山中木屋的一整个午后", "An afternoon in a mountain cabin"], ["个木屋午后", "cabin afternoons"],
    ["按每次在山中木屋歇四小时，约能留出 {value} 个不看时钟的午后。", "Four hours in a mountain cabin gives about {value} afternoons without watching the clock."]),
  sessionMetaphor("dune-walk", "nature", "walk", 75,
    ["把脚印留给沙丘", "Footprints along the dunes"], ["次沙丘漫步", "dune walks"],
    ["让脚印替你记路：以一趟沙丘漫步 75 分钟计，约能出发 {value} 次。", "Let footprints mark the way: about {value} dune walks, given 75 minutes for each outing."]),
  sessionMetaphor("autumn-avenue", "nature", "bloom", 60,
    ["顺着落叶走一条路", "Take the leaf-strewn avenue"], ["次秋日散步", "autumn walks"],
    ["按一小时一趟的散步来换，约是 {value} 段踩着落叶、听脚下沙沙的秋日时光。", "Imagine hour-long walks along a leaf-strewn avenue: about {value} outings with autumn underfoot."]),
  sessionMetaphor("rockpool-drawing", "nature", "wave", 60,
    ["画一张潮池的小地图", "Map a miniature coast"], ["次潮池写生", "tide-pool sketches"],
    ["这些歌够你画约 {value} 张潮池小地图——如果一张画花一小时，慢慢描岩石与水。", "These songs leave room for about {value} little tide-pool maps, if each sketch takes an hour."]),
  sessionMetaphor("rain-shelter", "nature", "rain", 45,
    ["在檐下等雨慢一点", "Pause beneath the eaves"], ["段檐下听雨", "rain-shelter pauses"],
    ["想象每次在檐下听雨 45 分钟，这些歌约能陪你停留 {value} 次。", "Imagine 45 minutes listening beneath the eaves: about {value} pauses with the rain."]),
  sessionMetaphor("winter-forest", "nature", "walk", 90,
    ["雪地里的脚步放慢了", "Slow steps through winter woods"], ["次冬林散步", "winter-wood walks"],
    ["把步子放慢，换成每趟 90 分钟的冬林散步，约能展开 {value} 段安静的白色路程。", "Slow your steps through winter woods: about {value} quiet walks, if each lasts 90 minutes."]),
  sessionMetaphor("moonlit-shore", "nature", "moon-phase", 60,
    ["月光把海边照亮一点", "Moonlight along the shore"], ["次月下海边小坐", "moonlit shore visits"],
    ["假如在月下海岸一次坐一小时，约有 {value} 段空闲，能留给那片亮着的水面。", "An hour at a moonlit shore each time would leave about {value} visits for the shining water."]),
  sessionMetaphor("rooftop-sky", "nature", "stars", 45,
    ["把城市的屋顶当看台", "A rooftop seat for the sky"], ["次屋顶看天", "rooftop sky sessions"],
    ["屋顶可以当看台。若一场看天时光留 45 分钟，约够看 {value} 场没有银幕的放映。", "A rooftop can be a cinema: about {value} sky screenings, with 45 minutes set aside for each."]),
  sessionMetaphor("trail-notebook", "nature", "book", 120,
    ["把山路写进手帐", "Keep a trail notebook"], ["次自然手记漫步", "nature-journal walks"],
    ["背上手帐出门吧。按一次自然观察与记录两小时，约能攒下 {value} 回写满小发现的路程。", "Take a notebook along: about {value} outings full of small discoveries, allowing two hours to walk and record."]),
  sessionMetaphor("riverbank-cycle", "nature", "bicycle", 90,
    ["沿河骑到桥的那一头", "Ride along the river"], ["次沿河骑行", "riverside rides"],
    ["按每次沿河骑行 90 分钟，约有 {value} 趟路可让风追着车轮跑。", "At 90 minutes cycling beside a river, about {value} rides with the wind at your wheels."]),
  sessionMetaphor("garden-bench", "nature", "bloom", 60,
    ["长椅替你留了个位置", "A garden bench is waiting"], ["次花园长椅小坐", "garden-bench visits"],
    ["长椅上还空着一个位置。以每回坐一小时计，这段歌声约够 {value} 次只管看花的停留。", "There is a spare seat on the garden bench: about {value} visits with nothing to do, at an hour each."]),
  sessionMetaphor("night-sounds", "nature", "bird", 45,
    ["听夜色里谁还没睡", "Listen to the night"], ["次夜间自然聆听", "night-sound sessions"],
    ["夜里也有自己的声部。留 45 分钟去听一次，约能慢慢分辨 {value} 段这样的安静。", "The night has its own voices: about {value} listening sessions, giving each one 45 minutes."]),
  sessionMetaphor("island-day", "nature", "wave", 360,
    ["给一座小岛半天时间", "Half a day on an island"], ["次小岛探访", "island visits"],
    ["假设一趟小岛探访留六小时，这些歌约能换 {value} 趟四面都是海的出走。", "Imagine six hours exploring an island each time: about {value} visits with water in every direction."]),
  sessionMetaphor("poetry-evening", "life", "book", 60,
    ["把诗读给夜晚听", "Read a poem to the evening"], ["次读诗夜晚", "poetry evenings"],
    ["句子可以读得慢一点。若一次读诗留一小时，约能把 {value} 个夜晚交给诗页。", "Let the sentences take their time: about {value} poetry evenings, setting aside an hour for each."]),
  sessionMetaphor("pottery-wheel", "life", "vinyl", 120,
    ["让泥土在掌心成形", "Clay taking shape in your hands"], ["次陶艺课", "pottery sessions"],
    ["一团泥土，也能盛住时间。按一节陶艺课两小时，约够坐到转盘前 {value} 次。", "A lump of clay can hold a little time: about {value} pottery sessions, at two hours each."]),
  sessionMetaphor("watercolour-afternoon", "life", "bloom", 90,
    ["把今天调成一抹颜色", "Mix the colour of today"], ["次水彩时光", "watercolour sessions"],
    ["把今天调成喜欢的颜色：以一次水彩练习 90 分钟计，约能画上 {value} 回。", "Mix a colour for today: about {value} watercolour sessions, if each painting session lasts 90 minutes."]),
  sessionMetaphor("cinema-double", "life", "film", 240,
    ["连看两场，再慢慢回家", "A double bill, then the walk home"], ["次电影双场", "double bills"],
    ["如果两场电影合计四小时，约够安排 {value} 次灯光暗下又亮起的约会。", "With four hours for a double bill, about {value} visits as the cinema lights fall and rise."]),
  sessionMetaphor("theatre-night", "life", "dance", 150,
    ["等舞台把故事讲完", "Stay for the final bow"], ["场舞台演出", "theatre performances"],
    ["设定一场舞台演出 150 分钟，约能坐到 {value} 次谢幕的灯光亮起。", "At 150 minutes per theatre performance, enough time for about {value} final bows."]),
  sessionMetaphor("jazz-table", "life", "vinyl", 90,
    ["在爵士乐里坐一会儿", "Stay for another jazz set"], ["场爵士现场", "jazz sessions"],
    ["每场爵士现场留 90 分钟，约能把 {value} 个夜晚放在舞台边的小桌上。", "At 90 minutes per jazz session, about {value} evenings at a small table by the stage."]),
  sessionMetaphor("choir-rehearsal", "life", "dance", 120,
    ["把自己的声音放进去", "Find your place in the harmony"], ["次合唱排练", "choir rehearsals"],
    ["换成两小时一次的合唱排练，约能和别人的声音并肩 {value} 次，找到自己的和声位置。", "Trade this time for two-hour choir rehearsals: about {value} chances to find your place in the harmony."]),
  sessionMetaphor("guitar-afternoon", "life", "vinyl", 45,
    ["慢慢按好下一个和弦", "Find the next chord"], ["次吉他练习", "guitar sessions"],
    ["每次吉他练习 45 分钟，约能留出 {value} 段从指尖开始的旋律。", "At 45 minutes practising guitar, about {value} sessions of melodies beginning at your fingertips."]),
  sessionMetaphor("sewing-hour", "life", "book", 60,
    ["一针一线把时间缝好", "An hour stitched together"], ["次手作缝纫", "sewing sessions"],
    ["若一回缝纫留一小时，约有 {value} 段空闲能一针一线地缝进布料里。", "Spare time stitched into fabric: about {value} sewing sessions, allowing an hour for each."]),
  sessionMetaphor("knitting-corner", "life", "book", 45,
    ["毛线绕过安静的一角", "A quiet corner and a ball of yarn"], ["次编织时光", "knitting sessions"],
    ["让手里的毛线慢慢成形：按一回编织 45 分钟，约是 {value} 段安静的针线时光。", "A ball of yarn and a quiet corner: about {value} knitting sessions, given 45 minutes each."]),
  sessionMetaphor("calligraphy-desk", "life", "book", 60,
    ["把每一笔写慢一点", "Let each stroke take its time"], ["次书写练习", "calligraphy sessions"],
    ["每次在桌前练字一小时，约能留出 {value} 段只有纸与笔的相处。", "An hour practising calligraphy gives about {value} sessions with just paper and ink."]),
  sessionMetaphor("board-game-night", "life", "book", 120,
    ["再来一局，夜还很长", "One more game before goodnight"], ["次桌游聚会", "board-game nights"],
    ["再来一局也来得及。若一场桌游聚会两小时，约能围坐在一起 {value} 次。", "There is time for another game: about {value} gatherings around the board, allowing two hours each."]),
  sessionMetaphor("chess-match", "life", "book", 45,
    ["为下一步想一会儿", "A little time for the next move"], ["盘棋", "chess games"],
    ["如果一盘棋用 45 分钟，约够走完 {value} 盘落子前的思考。", "With 45 minutes per chess game, about {value} games of thinking one move ahead."]),
  sessionMetaphor("market-morning", "life", "walk", 90,
    ["去早市挑一点热闹", "A morning at the market"], ["次早市闲逛", "market mornings"],
    ["买点菜，也逛点热闹。按一趟早市 90 分钟，约够走进 {value} 个热腾腾的早晨。", "Shop a little, wander a little: about {value} market mornings, at 90 minutes per visit."]),
  sessionMetaphor("train-daytrip", "life", "train", 180,
    ["坐上去隔壁城市的车", "A train to a neighbouring city"], ["段火车小旅行", "train trips"],
    ["设定每段火车旅程三小时，约能装下 {value} 次把日常留在车站的出发。", "At three hours per train trip, about {value} departures with everyday life left at the station."]),
  sessionMetaphor("scenic-ferry", "life", "wave", 75,
    ["在甲板上看岸线退后", "Watch the shoreline drift away"], ["次渡轮短途", "ferry trips"],
    ["每次渡轮短途 75 分钟，约能在甲板上看岸线退后 {value} 次。", "With a 75-minute ferry trip, about {value} chances to watch the shoreline slip away."]),
  sessionMetaphor("old-town-lanes", "life", "walk", 150,
    ["在老街转几个弯", "Turn a few corners in the old town"], ["次老街漫游", "old-town walks"],
    ["走到巷口，再拐个弯。设定一趟老街漫游 150 分钟，约够闲逛 {value} 回。", "Reach the corner, then take another turn: about {value} old-town walks, each lasting 150 minutes."]),
  sessionMetaphor("gallery-afternoon", "life", "film", 120,
    ["让画廊的白墙留住你", "An afternoon in the gallery"], ["次画廊游览", "gallery visits"],
    ["把目光借给画廊的白墙。若一趟游览两小时，约有 {value} 次机会慢慢认识新的色彩。", "Lend your eyes to a gallery's white walls: about {value} visits, with two hours to explore each time."]),
  sessionMetaphor("library-table", "life", "book", 180,
    ["借一张靠窗的书桌", "Borrow a desk by the window"], ["次图书馆自习", "library sessions"],
    ["每次在图书馆坐三小时，约能拥有 {value} 段专心到忘记看钟的时光。", "Three hours at a library desk gives about {value} sessions to settle into a subject."]),
  sessionMetaphor("language-lesson", "life", "book", 60,
    ["换一种语言说你好", "Learn another way to say hello"], ["节语言学习", "language sessions"],
    ["从另一种“你好”开始。以每节语言学习一小时计，约能安排 {value} 次和新词的见面。", "Begin with another way to say hello: about {value} language sessions, at an hour apiece."]),
  sessionMetaphor("recipe-notebook", "life", "tea", 45,
    ["把家的味道写下来", "Write down a taste of home"], ["次食谱整理", "recipe-writing sessions"],
    ["每次花 45 分钟整理家里的食谱，约能留下 {value} 段写着烟火气的记录。", "With 45 minutes writing family recipes, about {value} sessions saving a taste of home."]),
  sessionMetaphor("shared-dumplings", "life", "tea", 90,
    ["围着桌子包一会儿饺子", "Gather around the kitchen table"], ["次包饺子相聚", "dumpling-making gatherings"],
    ["围着桌子，手上忙一点，话也多一点。若包饺子一次 90 分钟，约够相聚 {value} 回。", "Busy hands, easy conversation: about {value} dumpling-making gatherings, allowing 90 minutes each."]),
  sessionMetaphor("slow-lunch", "life", "tea", 75,
    ["午饭之后也不急着走", "Lunch with nowhere else to be"], ["顿悠长午餐", "unhurried lunches"],
    ["每顿午餐留 75 分钟，约够享用 {value} 次饭后还想聊两句的从容。", "With 75 minutes for lunch, about {value} meals with room for a little more conversation."]),
  sessionMetaphor("home-bakery", "life", "tea", 120,
    ["让厨房像一家小面包店", "A little bakery at home"], ["次烘焙时光", "baking sessions"],
    ["每次给烘焙留两小时，约能把 {value} 段空闲变成厨房里的香气。", "At two hours baking at home, about {value} sessions filling the kitchen with warm aromas."]),
  sessionMetaphor("friend-reunion", "life", "tea", 180,
    ["把好久不见慢慢聊完", "Catch up on the time between"], ["次老友相聚", "reunions with friends"],
    ["把“好久不见”慢慢聊完。以每回相聚三小时计，约够和老友见上 {value} 面。", "Catch up on all the time between: about {value} reunions with old friends, at three hours each."]),
  sessionMetaphor("family-stories", "life", "book", 60,
    ["听长辈讲以前的事", "Listen to a family story"], ["次家事闲谈", "family-story sessions"],
    ["每次拿一小时听家里的旧故事，约能打开 {value} 次还没听完的往事。", "An hour listening to family stories gives about {value} visits to a time before your own."]),
  sessionMetaphor("photo-album-making", "life", "film", 120,
    ["给照片找一个家", "Give the photographs a home"], ["次相册整理", "album-making sessions"],
    ["给散落的照片找个家。若整理相册一次两小时，约能重新摆好 {value} 回珍藏的过去。", "Give the scattered photographs a home: about {value} album-making sessions, at two hours apiece."]),
  sessionMetaphor("memory-box", "life", "book", 45,
    ["打开装纪念品的盒子", "Open the keepsake box"], ["次纪念物整理", "keepsake sessions"],
    ["旧票根还记得那一天。设定一回纪念物整理 45 分钟，约能打开时光盒 {value} 次。", "The old ticket still remembers that day: about {value} keepsake-sorting sessions, given 45 minutes each."]),
  sessionMetaphor("dance-class", "life", "dance", 60,
    ["让脚步先找到节拍", "Let your feet find the beat"], ["节舞蹈课", "dance classes"],
    ["每节舞蹈课设为一小时，约够上 {value} 次，把节拍从耳朵带到脚尖。", "At an hour per dance class, about {value} lessons taking the beat from your ears to your feet."]),
  sessionMetaphor("badminton-evening", "life", "bird", 90,
    ["让羽毛球在灯下往返", "A shuttle moving through the light"], ["次羽毛球相约", "badminton sessions"],
    ["每次约朋友打球 90 分钟，约能留下 {value} 个球拍与笑声交替的夜晚。", "With 90 minutes playing badminton, about {value} evenings of rallies and laughter."]),
  sessionMetaphor("swimming-session", "life", "wave", 60,
    ["把喧闹留在水面上", "Leave the noise above the water"], ["次游泳时光", "swimming sessions"],
    ["每次游泳留一小时，约能拥有 {value} 次耳边只剩水声的空闲。", "At an hour swimming, about {value} sessions with water replacing the noise around you."]),
  sessionMetaphor("picnic-friends", "life", "bloom", 180,
    ["给朋友和草地一个下午", "An afternoon for friends and grass"], ["次朋友野餐", "picnics with friends"],
    ["每次和朋友野餐三小时，约够铺开 {value} 张不用着急收起的野餐垫。", "With three hours picnicking with friends, about {value} afternoons without rushing to pack up."]),
  sessionMetaphor("sunday-reset", "life", "book", 90,
    ["把房间重新收拾喜欢", "Make the room feel like yours again"], ["次房间整理", "room resets"],
    ["每次花 90 分钟整理房间，约够 {value} 次把喜欢的东西放回看得见的地方。", "At 90 minutes tidying a room, about {value} chances to put the things you love back in view."]),
  sessionMetaphor("craft-workshop", "life", "bloom", 150,
    ["做一个只属于你的小东西", "Make something of your own"], ["次手作工坊", "craft workshops"],
    ["让一个想法在手里成形。以一场手作工坊 150 分钟计，约能亲手试上 {value} 回。", "Give an idea a shape with your hands: about {value} craft workshops, allowing 150 minutes for each."]),
  sessionMetaphor("planetarium-show", "space", "stars", 45,
    ["在穹顶下看一场宇宙", "A universe on the dome"], ["场天文馆放映", "planetarium shows"],
    ["设定一场天文馆放映 45 分钟，约够看 {value} 场在头顶展开的星空。", "At 45 minutes per planetarium show, about {value} skies unfolding overhead."]),
  sessionMetaphor("telescope-evening", "space", "moon-orbit", 120,
    ["从望远镜里借一眼远方", "Borrow a closer look at the sky"], ["次望远镜观测", "telescope sessions"],
    ["每次留两小时用望远镜看天，约能把 {value} 个夜晚交给遥远的光。", "With two hours at a telescope, about {value} evenings for light from far away."]),
];

function stableHash(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  // Mix the final bits so nearby song IDs do not share the same category order.
  hash = Math.imul(hash ^ hash >>> 16, 0x85ebca6b);
  hash = Math.imul(hash ^ hash >>> 13, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function numberLabel(value: number): Localized {
  const maximumFractionDigits = value < 1 ? 2 : value < 100 ? 1 : 0;
  return {
    zh: new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value),
    en: new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value),
  };
}

/** Seeded choices, interleaved by category so no category is permanently relegated to the end. */
export function getTimeMetaphors(seconds: number | null, seed: string): TimeMetaphor[] {
  if (!nonnegative(seconds) || seconds === 0) return [];
  const eligible = METAPHORS.map((definition) => ({ definition, value: seconds / definition.secondsPerUnit }))
    .filter(({ definition, value }) => Number.isFinite(value) && value >= 0.1 && value <= (definition.maxValue ?? 1_000))
    .sort((a, b) => stableHash(`${seed}:item:${a.definition.id}`) - stableHash(`${seed}:item:${b.definition.id}`)
      || a.definition.id.localeCompare(b.definition.id));
  const categories = (["nature", "life", "space"] as const)
    .map(category => ({ category, entries: eligible.filter(entry => entry.definition.category === category) }))
    .filter(group => group.entries.length)
    .sort((a, b) => stableHash(`${seed}:category:${a.category}`) - stableHash(`${seed}:category:${b.category}`)
      || a.category.localeCompare(b.category));
  const ordered: typeof eligible = [];
  for (let index = 0; ordered.length < eligible.length; index++) {
    for (const group of categories) if (group.entries[index]) ordered.push(group.entries[index]);
  }
  return ordered.map(({ definition, value }) => {
      const valueLabel = numberLabel(value);
      const denominator = numberLabel(definition.secondsPerUnit);
      const duration = numberLabel(seconds);
      const { maxValue: _maxValue, ...entry } = definition;
      return {
        ...entry, value, valueLabel,
        text: { zh: entry.text.zh.replace("{value}", valueLabel.zh), en: entry.text.en.replace("{value}", valueLabel.en) },
        formula: {
          zh: `${duration.zh} 秒 ÷ 约 ${denominator.zh} 秒/${entry.unit.zh} ≈ ${valueLabel.zh} ${entry.unit.zh}`,
          en: `${duration.en} s ÷ about ${denominator.en} s per unit ≈ ${valueLabel.en} ${entry.unit.en}`,
        },
      };
    });
}

export function selectTimeMetaphor(seconds: number | null, seed: string, cycle = 0): TimeMetaphor | null {
  const choices = getTimeMetaphors(seconds, seed);
  if (!choices.length) return null;
  const index = Number.isFinite(cycle) ? Math.trunc(cycle) : 0;
  return choices[((index % choices.length) + choices.length) % choices.length];
}
