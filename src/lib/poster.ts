import type { Localized, MusicReport, RankedTrack } from "./report";
import { genreDisplayLabels } from "./genre-labels.ts";
import { buildMusicPersona } from "./music-persona.ts";
import { resolvePlatformListeningTime, resolveReportListeningTime, selectTimeMetaphor } from "./listening-time.ts";
import { knownGenreDistribution, unifiedTracks } from "./unified-tracks.ts";
import { drawPosterListener } from "./poster-listener.ts";
import { wrapPosterTextLines } from "./poster-typography.ts";

/** Browser-only artwork with optional public album covers; no AI calls. */
export type PosterLanguage = "zh" | "en";
export type PosterTheme = "ink" | "paper";
export type PosterFormat = "cover" | "long" | "cards";
export type PosterModule = "summary" | "platforms" | "tracks" | "genres" | "persona" | "overlap" | "metaphor";
export type PosterSection = "cover" | "listening" | PosterModule;

export type PosterReport = MusicReport;

export interface PosterOptions {
  language: PosterLanguage;
  theme?: PosterTheme;
  format?: PosterFormat;
  /** An empty list deliberately creates a portrait-only cover. */
  modules?: PosterModule[];
  /** Number of leading tracks to include; defaults to 5 and takes priority over trackMode. */
  trackLimit?: number;
  /** Legacy internal option; the sharing UI always requests an explicit trackLimit. */
  trackMode?: "top5" | "all";
  tracksPerPage?: 10 | 20 | 30;
  /** Zero-based page, set by the export planner. */
  trackPage?: number;
  /** Used for an individual card; the series exports selected modules only. */
  section?: PosterSection;
}

export const POSTER_MODULES: readonly PosterModule[] = ["summary", "platforms", "tracks", "genres", "persona", "overlap", "metaphor"];

export function selectedPosterModules(options: PosterOptions): PosterModule[] {
  const selected = options.modules ?? POSTER_MODULES;
  return POSTER_MODULES.filter((module) => selected.includes(module));
}

/** Compress only months actually named in the report; gaps never become a continuous range. */
export function formatPosterPeriod(report: PosterReport): Localized {
  const pattern = /(\d{4})\s*年\s*((?:\d{1,2}[、,\s]*)+)\s*月/g;
  const groups = [...report.periodLabel.zh.matchAll(pattern)];
  if (!groups.length) return report.periodLabel;
  // A mix of already-compacted ranges and single months must not lose the range.
  if (report.periodLabel.zh.replace(pattern, "").replace(/[;；、,\s]/g, "")) return report.periodLabel;
  const months = [...new Set(groups.flatMap((match) => (match[2].match(/\d{1,2}/g) ?? [])
    .map((month) => `${match[1]}-${month.padStart(2, "0")}`)))].sort();
  if (!months.length || months.some((month) => Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12)) return report.periodLabel;
  const groupsOfMonths: string[][] = [];
  for (const month of months) {
    const previous = groupsOfMonths.at(-1)?.at(-1);
    const serial = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5));
    if (previous && serial(month) === serial(previous) + 1) groupsOfMonths.at(-1)!.push(month);
    else groupsOfMonths.push([month]);
  }
  const label = (month: string, language: PosterLanguage, year = true) => language === "zh"
    ? `${year ? `${month.slice(0, 4)} 年 ` : ""}${Number(month.slice(5))} 月`
    : `${MONTHS[Number(month.slice(5)) - 1]}${year ? ` ${month.slice(0, 4)}` : ""}`;
  return {
    zh: groupsOfMonths.map((group) => group.length === 1 ? label(group[0], "zh") : `${label(group[0], "zh")}—${label(group.at(-1)!, "zh", group[0].slice(0, 4) !== group.at(-1)!.slice(0, 4))}`).join("、"),
    en: groupsOfMonths.map((group) => group.length === 1 ? label(group[0], "en") : group[0].slice(0, 4) === group.at(-1)!.slice(0, 4)
      ? `${label(group[0], "en", false)}–${label(group.at(-1)!, "en")}` : `${label(group[0], "en")}–${label(group.at(-1)!, "en")}`).join("; "),
  };
}

export interface PosterExport {
  blob: Blob;
  width: number;
  height: number;
  /** The caller should revoke this URL after the preview closes. */
  url: string;
  filename: string;
  artwork?: { total: number; loaded: number; fallback: number };
}

const canvasArtwork = new WeakMap<HTMLCanvasElement, NonNullable<PosterExport["artwork"]>>();

export interface PosterExportProgress { completed: number; total: number }
export interface PosterExportControl {
  signal?: AbortSignal;
  onProgress?: (progress: PosterExportProgress) => void;
}

function checkPosterAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Poster generation cancelled.", "AbortError");
}

/** Match the providers accepted by the dashboard's metadata loader. */
export function posterArtworkUrl(value?: string): string | null {
  if (typeof value !== "string" || value.length > 2500) return null;
  try {
    const url = new URL(value.replaceAll("{w}", "160").replaceAll("{h}", "160").replaceAll("{f}", "jpg"));
    const allowed = url.hostname === "y.gtimg.cn" || /^p[1-9]\d?\.music\.126\.net$/.test(url.hostname) || /^is[1-9]\d?-ssl\.mzstatic\.com$/.test(url.hostname);
    if (!allowed || !["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && url.port !== "443") || url.hash || !/\.(?:jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) return null;
    url.protocol = "https:";
    return url.href;
  } catch { return null; }
}

type PosterArtwork = ReadonlyMap<string, HTMLImageElement>;

function loadPosterImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement | null> {
  checkPosterAbort(signal);
  return new Promise((resolve, reject) => {
    const image = new Image();
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", abort);
    };
    const finish = (loaded: boolean) => {
      cleanup();
      if (!loaded) image.removeAttribute("src");
      resolve(loaded ? image : null);
    };
    const abort = () => {
      cleanup();
      image.removeAttribute("src");
      reject(signal?.reason ?? new DOMException("Poster generation cancelled.", "AbortError"));
    };
    // Loading without CORS permission would taint the canvas and prevent PNG export.
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    // Allow the server's bounded CDN fallback to finish before using a placeholder.
    timer = setTimeout(() => finish(false), 10000);
    signal?.addEventListener("abort", abort, { once: true });
    image.src = `/api/artwork?url=${encodeURIComponent(url)}`;
  });
}

async function loadPosterArtwork(tracks: readonly RankedTrack[], signal?: AbortSignal): Promise<PosterArtwork> {
  checkPosterAbort(signal);
  const result = new Map<string, HTMLImageElement>();
  if (typeof Image === "undefined") return result;
  const urls = [...new Set(tracks.map((track) => posterArtworkUrl(track.artworkUrl)).filter((url): url is string => Boolean(url)))];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (next < urls.length) {
      checkPosterAbort(signal);
      const url = urls[next++];
      const image = await loadPosterImage(url, signal);
      if (image) result.set(url, image);
    }
  }));
  checkPosterAbort(signal);
  return result;
}

/** Give the pending progress animation a paint opportunity, including in hidden tabs. */
function yieldPosterFrame(signal?: AbortSignal): Promise<void> {
  checkPosterAbort(signal);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", abort);
    };
    const finish = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Poster generation cancelled.", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    // rAF followed by a task lets the browser paint before the next canvas job.
    if (typeof requestAnimationFrame === "function") {
      timer = setTimeout(finish, 48);
      frame = requestAnimationFrame(() => { if (timer !== undefined) clearTimeout(timer); timer = setTimeout(finish, 0); });
    } else timer = setTimeout(finish, 0);
  });
}

const WIDTH = 1080;
const SANS =
  '"Manrope Variable", "Noto Sans SC Variable", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
const SERIF =
  '"Instrument Serif", "Bodoni 72", "Didot", "Times New Roman", serif';
const SERIF_ZH = '"Noto Serif SC Variable", "Songti SC", "STSong", serif';
const MONO = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTHS_ZH = [
  "一月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月",
];

const THEMES = {
  ink: {
    background: "#16191a",
    text: "#f0ece2",
    muted: "#a8a9a3",
    faint: "#666d6c",
    line: "#3b4140",
    accent: "#e27c60",
    paper: "#ede8dc",
  },
  paper: {
    background: "#f0ede4",
    text: "#202522",
    muted: "#656f68",
    faint: "#858c84",
    line: "#c8cbc0",
    accent: "#ac4e38",
    paper: "#e9e4d8",
  },
} satisfies Record<PosterTheme, Record<string, string>>;

type Palette = typeof THEMES.ink;
type Context = CanvasRenderingContext2D;

function font(
  ctx: Context,
  size: number,
  family = SANS,
  weight: string | number = 400,
) {
  ctx.font = `${weight} ${size}px ${family}`;
}

function text(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  family = SANS,
  weight: string | number = 400,
) {
  font(ctx, size, family, weight);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function fit(ctx: Context, value: string, width: number): string {
  if (ctx.measureText(value).width <= width) return value;
  const characters = Array.from(value);
  while (
    characters.length &&
    ctx.measureText(`${characters.join("")}…`).width > width
  )
    characters.pop();
  return `${characters.join("")}…`;
}

function fittedText(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color: string,
  family = SANS,
  weight: string | number = 400,
) {
  font(ctx, size, family, weight);
  ctx.fillStyle = color;
  ctx.fillText(fit(ctx, value, width), x, y);
}

function wrappedText(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color: string,
) {
  font(ctx, size);
  ctx.fillStyle = color;
  const useCharacters = /[\u3400-\u9fff]/.test(value);
  const tokens = useCharacters ? Array.from(value) : value.split(" ");
  const separator = useCharacters ? "" : " ";
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    const next = current ? `${current}${separator}${token}` : token;
    if (current && ctx.measureText(next).width > width) {
      lines.push(current);
      current = token;
    } else current = next;
  }
  if (current) lines.push(current);
  lines.slice(0, 2).forEach((row, index) => {
    const remainder =
      index === 1 && lines.length > 2 ? lines.slice(1).join(separator) : row;
    ctx.fillText(fit(ctx, remainder, width), x, y + index * (size + 5));
  });
}

function line(ctx: Context, y: number, color: string, x = 80, width = 920) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function circle(
  ctx: Context,
  x: number,
  y: number,
  r: number,
  color: string | CanvasGradient,
) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function arc(
  ctx: Context,
  x: number,
  y: number,
  r: number,
  from: number,
  to: number,
  color: string,
  width: number,
) {
  if (to <= from) return;
  ctx.beginPath();
  ctx.arc(x, y, r, from, to);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function tracked(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  spacing = 3,
) {
  font(ctx, size, MONO);
  ctx.fillStyle = color;
  for (const character of value) {
    ctx.fillText(character, x, y);
    x += ctx.measureText(character).width + spacing;
  }
}

function monthDetails(period: PosterReport["period"]) {
  const match = /^(\d{4})-(\d{2})/.exec(period.start);
  const single = period.start.slice(0, 7) === period.end.slice(0, 7);
  const validMonth = single && match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
  return {
    single,
    year: validMonth ? match[1] : "SELECTED MONTHS",
    number: validMonth ? match[2] : "MIX",
    en: validMonth ? MONTHS[Number(match[2]) - 1] : "Your music",
    zh: validMonth ? MONTHS_ZH[Number(match[2]) - 1] : "这一辑",
    key: validMonth ? `${match[1]}-${match[2]}` : `${period.start.slice(0, 7)}-to-${period.end.slice(0, 7)}-selection`,
  };
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function platformName(id: string, name: string, language: PosterLanguage) {
  if (id === "netease")
    return language === "zh" ? "网易云音乐" : "NetEase Music";
  if (id === "qq") return language === "zh" ? "QQ 音乐" : "QQ Music";
  if (id === "apple") return "Apple Music";
  return name;
}

function genreName(name: string, language: PosterLanguage) {
  return genreDisplayLabels(name)[language];
}

/** The same upright, serif-cut Z used on the site’s record labels. */
function recordMonogram(ctx: Context, x: number, y: number, height: number) {
  ctx.save();
  const scale = height / 36;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(-14, -18); ctx.lineTo(14, -18); ctx.lineTo(14, -14);
  ctx.lineTo(-9, 13); ctx.lineTo(9, 13); ctx.lineTo(9, 8);
  ctx.lineTo(14, 8); ctx.lineTo(14, 18); ctx.lineTo(-15, 18);
  ctx.lineTo(-15, 14); ctx.lineTo(8, -13); ctx.lineTo(-9, -13);
  ctx.lineTo(-9, -8); ctx.lineTo(-14, -8); ctx.closePath();
  ctx.fillStyle = "#f1ddba";
  ctx.fill();
  ctx.restore();
}

function wordmark(ctx: Context, x: number, y: number, palette: Palette) {
  // Match the header's 31 px record, 11 px gap and 22 px Manrope wordmark.
  const scale = 30 / 22;
  const radius = 15.5 * scale;
  const centerX = x + radius;
  const centerY = y - 10.5;
  ctx.save();
  for (let r = 3.85; r < 15; r += 4.1)
    arc(ctx, centerX, centerY, r * scale, 0, Math.PI * 2, "#777c6f5c", 0.5 * scale);
  arc(ctx, centerX, centerY, radius - scale / 2, 0, Math.PI * 2, "#86877b", scale);
  circle(ctx, centerX, centerY, 8 * scale, "#b34c43");
  recordMonogram(ctx, centerX, centerY, 10 * scale);
  font(ctx, 30, SANS, 650);
  ctx.letterSpacing = `${-1.1 * scale}px`;
  ctx.fillStyle = palette.text;
  const textX = x + (31 + 11) * scale;
  ctx.fillText("zmusicstats", textX, y);
  const width = ctx.measureText("zmusicstats").width;
  ctx.fillStyle = "#d57757";
  ctx.fillText(".", textX + width, y);
  ctx.restore();
}

function drawHeadline(
  ctx: Context, report: PosterReport, palette: Palette, options: PosterOptions,
  _month: ReturnType<typeof monthDetails>,
) {
  const zh = options.language === "zh";
  const modules = selectedPosterModules(options);
  const persona = modules.includes("persona") ? buildMusicPersona(report) : null;
  const summary = modules.includes("summary");
  tracked(ctx, persona ? "YOUR LISTENING PORTRAIT" : "YOUR MUSIC, ON RECORD", 80, 166, 14, palette.muted, 1.5);
  const heading = persona?.line[options.language] ?? (zh ? "你的音乐，\n这一面。" : "Your music,\non record.");
  let headingSize = zh ? 36 : 45;
  if (zh) {
    // The longest current portrait fits two complete lines; never leave its final punctuation alone.
    for (; headingSize > 30; headingSize--) {
      font(ctx, headingSize, titleFace(options.language));
      if (wrapPosterTextLines(heading, 410, value => ctx.measureText(value).width).length <= 2) break;
    }
  }
  drawTextBlock(ctx, heading, 78, 224, 410, headingSize, palette.text, titleFace(options.language), 4, 51);
  drawTextBlock(ctx, formatPosterPeriod(report)[options.language], 80, summary ? 430 : 455, 365, 18, palette.muted, SANS, 2, 27);
  if (!summary) return;
  const time = resolveReportListeningTime(report);
  const hours = time.seconds === null ? null : time.seconds / 3600;
  const number = hours === null ? "—" : `${time.kind === "estimated" ? "≈ " : ""}${formatNumber(hours)}`;
  let numberSize = 76;
  font(ctx, numberSize, SERIF);
  while (ctx.measureText(number).width > 275 && numberSize > 48) { numberSize -= 4; font(ctx, numberSize, SERIF); }
  text(ctx, number, 78, 536, numberSize, palette.text, SERIF);
  font(ctx, numberSize, SERIF);
  text(ctx, zh ? "小时" : "hours", 94 + ctx.measureText(number).width, 532, 18, palette.muted);
  const notice = time.samplePlatformCount ? zh ? `${time.actualPlatformCount ? "实际时长 + " : ""}榜单样本${time.kind === "estimated" ? "估算" : "时长"}；非完整总时长。` : `${time.actualPlatformCount ? "Reported time + " : ""}ranking sample ${time.kind === "estimated" ? "estimates" : "time"}; not a complete total.`
    : hours === null ? zh ? "平台暂未提供可汇总的时长。" : "Listening time is unavailable."
    : time.partial ? zh ? "已取得的平台实际时长；未含缺失来源。" : "Reported platform time; missing sources excluded."
    : zh ? "在这段时间，让音乐陪伴。" : "Time spent with your music.";
  drawTextBlock(ctx, notice, 80, 572, 365, 14, palette.muted, SANS, 2, 21);
  text(ctx, `${report.sampleSongCount} ${zh ? "首样本曲目" : "sampled tracks"}   ·   ${report.platforms.length} ${zh ? "个平台" : "platforms"}`, 80, 626, 15, palette.faint);
}

export function selectPosterTracks(
  report: PosterReport,
  limit = 5,
): RankedTrack[] {
  const tracks = unifiedTracks(report).tracks;
  return tracks.slice(0, boundedTrackLimit(limit, tracks.length));
}

function boundedTrackLimit(limit: number, available: number): number {
  if (!available || !Number.isFinite(limit)) return 0;
  return Math.min(available, Math.max(1, Math.trunc(limit)));
}

/** Keep incomplete input invalid instead of reusing an earlier selection. */
export function parsePosterTrackLimit(value: string, available: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= available ? count : null;
}

function drawTrackArtwork(ctx: Context, track: RankedTrack, artwork: PosterArtwork, x: number, y: number, size = 50) {
  const url = posterArtworkUrl(track.artworkUrl);
  const image = url ? artwork.get(url) : undefined;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 4);
  ctx.clip();
  ctx.fillStyle = "#252b29";
  ctx.fillRect(x, y, size, size);
  if (image) {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, x, y, size, size);
  } else {
    circle(ctx, x + size / 2, y + size / 2, size * 0.4, "#111615");
    for (const ratio of [0.28, 0.35]) arc(ctx, x + size / 2, y + size / 2, size * ratio, 0, Math.PI * 2, "#44504a", 0.6);
    circle(ctx, x + size / 2, y + size / 2, size * 0.17, "#b34c43");
    recordMonogram(ctx, x + size / 2, y + size / 2, size * 0.2);
  }
  ctx.restore();
}

function drawTracks(
  ctx: Context,
  report: PosterReport,
  palette: Palette,
  language: PosterLanguage,
  startY = 675,
  limit = 5,
  selectedTracks?: RankedTrack[],
  offset = 0,
  total = limit,
  artwork: PosterArtwork = new Map(),
) {
  const zh = language === "zh";
  const tracks = selectedTracks ?? selectPosterTracks(report, limit);
  const combined = report.rankingMode === "combined";
  line(ctx, startY, palette.line);
  text(
    ctx,
    combined
      ? zh
        ? "反复回到的旋律"
        : "The tracks you came back to"
      : zh
        ? "常听歌曲选集"
        : "From your most-played tracks",
    80,
    startY + 53,
    25,
    palette.text,
    zh ? SERIF_ZH : SANS,
    500,
  );
  ctx.textAlign = "right";
  text(
    ctx,
    `TOP ${total || "—"}${total > tracks.length ? ` · ${offset + 1}–${offset + tracks.length}` : ""}`,
    1000,
    startY + 52,
    15,
    palette.muted,
    MONO,
  );
  ctx.textAlign = "left";

  if (!tracks.length) {
    text(
      ctx,
      zh
        ? "所选时间范围内暂无歌曲排行。"
        : "No track ranking is available for this period.",
      80,
      startY + 153,
      23,
      palette.muted,
    );
    return;
  }

  tracks.forEach((track, index) => {
    const y = startY + 118 + index * 70;
    text(
      ctx,
      `${offset + index + 1}`.padStart(2, "0"),
      80,
      y,
      23,
      palette.accent,
      MONO,
    );
    drawTrackArtwork(ctx, track, artwork, 143, y - 24);
    fittedText(
      ctx,
      track.title || (zh ? "未命名歌曲" : "Untitled track"),
      211,
      y - 1,
      565,
      25,
      palette.text,
      SANS,
      450,
    );
    const labels: Record<string, string> = {
      netease: zh ? "网易云" : "NetEase",
      qq: "QQ",
      apple: "Apple Music",
    };
    const platforms = Array.from(
      new Set(track.platforms.map((id) => labels[id] ?? id)),
    ).join(" + ");
    fittedText(
      ctx,
      track.artist || (zh ? "未知艺人" : "Unknown artist"),
      211,
      y + 26,
      544,
      17,
      palette.muted,
    );
    ctx.textAlign = "right";
    if (track.count !== null && Number.isFinite(track.count)) {
      text(
        ctx,
        `${track.countIsPartial ? "≥ " : ""}${formatNumber(track.count)} ${zh ? "次" : "plays"}`,
        1000,
        y - 1,
        18,
        palette.text,
        MONO,
      );
    }
    text(ctx, platforms, 1000, y + 25, 14, palette.muted, MONO);
    ctx.textAlign = "left";
    if (index < tracks.length - 1) line(ctx, y + 42, palette.line, 143, 857);
  });
  const note = tracks.some((track) => track.countIsPartial)
    ? zh
      ? "≥ 表示已知播放次数；未上榜平台可能还有额外播放。"
      : "≥ indicates known plays; other platforms may contain additional plays."
    : !combined
      ? zh
        ? "按已获取次数排列；不同平台保留各自统计口径。"
        : "Ordered by available counts; each platform retains its own definition."
      : "";
  if (note)
    fittedText(
      ctx,
      note,
      80,
      startY + 115 + tracks.length * 70,
      920,
      13,
      palette.muted,
    );
}

function titleFace(language: PosterLanguage) {
  return language === "zh" ? SERIF_ZH : SERIF;
}

function drawTextBlock(
  ctx: Context, value: string, x: number, y: number, width: number, size: number,
  color: string, family = SANS, maxLines = 3, lineHeight = size * 1.5, weight: number = 400,
): number {
  font(ctx, size, family, weight);
  ctx.fillStyle = color;
  const lines = wrapPosterTextLines(value, width, row => ctx.measureText(row).width);
  lines.slice(0, maxLines).forEach((row, index) => {
    const value = index === maxLines - 1 && lines.length > maxLines ? `${row}…` : row;
    ctx.fillText(fit(ctx, value, width), x, y + index * lineHeight);
  });
  return Math.min(lines.length, maxLines) * lineHeight;
}

export function posterTrackPage(report: PosterReport, options: PosterOptions): { tracks: RankedTrack[]; offset: number; pages: number; total: number } {
  const all = unifiedTracks(report).tracks;
  const total = boundedTrackLimit(options.trackLimit ?? (options.trackMode === "all" ? all.length : 5), all.length);
  const size = [10, 20, 30].includes(options.tracksPerPage ?? 20) ? options.tracksPerPage ?? 20 : 20;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.max(0, Math.min(pages - 1, Number.isFinite(options.trackPage) ? Math.trunc(options.trackPage!) : 0));
  const offset = page * size;
  return { tracks: all.slice(offset, Math.min(offset + size, total)), offset, pages, total };
}

/** One bounded image per track page, even when a user asks for every available song. */
export function planPosterExports(report: PosterReport, options: PosterOptions): PosterOptions[] {
  const modules = selectedPosterModules(options);
  const pages = modules.includes("tracks") ? posterTrackPage(report, options).pages : 0;
  if (options.format === "cards") {
    const results: PosterOptions[] = [{ ...options, section: "cover", modules: modules.filter((module) => module === "summary" || module === "persona") }];
    for (const module of modules.filter((module) => module !== "summary" && module !== "persona")) {
      const count = module === "tracks" ? pages : 1;
      for (let page = 0; page < count; page++) results.push({ ...options, section: module, trackPage: page, modules: [module] });
    }
    return results;
  }
  const result: PosterOptions[] = [{ ...options, section: "cover", trackPage: 0, modules }];
  for (let page = 1; page < pages; page++) result.push({ ...options, format: "cards", section: "tracks", trackPage: page, modules: ["tracks"] });
  return result;
}

export interface PosterLayout {
  width: number;
  height: number;
  heroHeight: number;
  blocks: { module: PosterModule; y: number; height: number }[];
}

export function buildPosterLayout(report: PosterReport, options: PosterOptions): PosterLayout {
  const modules = selectedPosterModules(options);
  const chapter = options.format === "cards" && options.section && options.section !== "cover";
  const heroHeight = chapter ? 310 : modules.includes("summary") ? 650 : 510;
  const requested = chapter ? [options.section === "listening" ? "platforms" : options.section as PosterModule]
    : modules.filter((module) => module !== "summary" && module !== "persona");
  const page = posterTrackPage(report, options);
  const genreCount = Math.min(8, knownGenreDistribution(unifiedTracks(report).tracks).genres.length);
  const heights: Record<PosterModule, number> = {
    summary: 0, persona: 0,
    platforms: 390,
    tracks: page.tracks.length ? 155 + page.tracks.length * 70 : 205,
    genres: 190 + Math.ceil(genreCount / 2) * 70,
    overlap: 150 + Math.min(report.overlappingTracks.length, options.format === "cover" ? 3 : 5) * 72,
    metaphor: 350,
  };
  if (options.format === "cover") {
    heights.platforms = 190;
    heights.genres = 210;
    heights.metaphor = 185;
  }
  const gap = options.format === "cover" ? 42 : 60;
  let y = heroHeight + 66;
  const blocks = requested.map((module) => {
    const block = { module, y, height: heights[module] };
    y += block.height + gap;
    return block;
  });
  return { width: WIDTH, height: Math.ceil((blocks.length ? y - gap : heroHeight) + 140), heroHeight, blocks };
}

export function posterPlatformData(report: PosterReport) {
  const actualTime = report.durationComparable && report.platformShares.length > 0
    && report.platformShares.every((share) => Number.isFinite(share.seconds) && share.seconds >= 0)
    && report.platformShares.some((share) => share.seconds > 0);
  const sources = report.platforms.map((platform) => {
    const seen = new Set<string>();
    const tracks = platform.tracks.filter((track) => {
      const key = track.canonicalId?.trim() ? `recording:${track.canonicalId.trim()}` : track.id;
      if (!track.id || seen.has(key)) return false;
      seen.add(key); return true;
    });
    const time = resolvePlatformListeningTime({ ...platform, tracks });
    return { ...platform, sampleCount: tracks.length, seconds: time.seconds, time,
      value: actualTime ? report.platformShares.find((share) => share.id === platform.id)?.seconds ?? 0 : tracks.length };
  });
  const total = sources.reduce((sum, source) => sum + source.value, 0);
  return { actualTime, total, sources: sources.map((source) => ({ ...source, percentage: total > 0 ? source.value / total * 100 : 0 })) };
}

function drawPlatformModule(ctx: Context, report: PosterReport, palette: Palette, language: PosterLanguage, y: number) {
  const zh = language === "zh";
  const data = posterPlatformData(report);
  text(ctx, zh ? "音乐在哪一边响起" : "Where your music lives", 80, y, 35, palette.text, titleFace(language));
  text(ctx, data.actualTime ? zh ? "实际听歌时长占比" : "Actual listening-time shares" : zh ? "已读取曲目来源占比" : "Shares of retrieved track sources", 80, y + 42, 17, palette.muted);
  const cx = 227, cy = y + 205, radius = 106;
  arc(ctx, cx, cy, radius, 0, Math.PI * 2, palette.line, 25);
  let angle = -Math.PI / 2;
  for (const source of data.sources) {
    const next = angle + source.percentage / 100 * Math.PI * 2;
    if (source.percentage > 0) arc(ctx, cx, cy, radius, angle + 0.015, next - 0.015, source.color, 25);
    angle = next;
  }
  ctx.textAlign = "center";
  text(ctx, data.total > 0 ? formatNumber(data.actualTime ? data.total / 3600 : data.total) : "—", cx, cy + 9, 50, palette.text, SERIF);
  text(ctx, data.actualTime ? zh ? "小时" : "hours" : zh ? "条平台曲目" : "track entries", cx, cy + 42, 14, palette.muted);
  ctx.textAlign = "left";
  data.sources.forEach((source, index) => {
    const top = y + 112 + index * 83;
    circle(ctx, 420, top - 6, 5, source.color);
    text(ctx, platformName(source.id, source.name, language), 440, top, 21, palette.text, SANS, 450);
    ctx.textAlign = "right";
    text(ctx, data.total > 0 ? `${formatNumber(source.percentage)}%` : "—", 1000, top, 22, palette.text, SANS);
    ctx.textAlign = "left";
    const duration = source.seconds === null ? (zh ? "时长未提供" : "Time unavailable")
      : source.time.kind === "estimated" ? `≈ ${formatNumber(source.seconds / 3600)} ${zh ? "小时 · 样本估算" : "h · sample estimate"}`
        : `${formatNumber(source.seconds / 3600)} ${zh ? "小时实际收听" : "hours actually listened"}`;
    fittedText(ctx, `${duration}  ·  ${source.sampleCount} ${zh ? "首已读取" : "retrieved tracks"}`, 440, top + 30, 560, 15, palette.muted);
  });
  drawTextBlock(ctx, data.actualTime ? report.durationNotice[language]
    : zh ? "按各平台已读取曲目计算，同一首歌在不同平台分别计数；该占比不代表听歌时长。" : "Counts retrieved tracks once per platform. A song on two platforms counts in each; these shares do not represent listening time.",
    80, y + 352, 920, 15, palette.muted, SANS, 2, 23);
}

function drawGenreModule(ctx: Context, report: PosterReport, palette: Palette, language: PosterLanguage, y: number) {
  const zh = language === "zh";
  const distribution = knownGenreDistribution(unifiedTracks(report).tracks);
  const genres = distribution.genres.slice(0, 7);
  if (distribution.genres.length > 7) genres.push({ name: "Other", nameZh: "其他", nameEn: "Other", color: palette.faint,
    percentage: distribution.genres.slice(7).reduce((sum, genre) => sum + genre.percentage, 0), weight: 0 });
  text(ctx, zh ? "你的音乐底色" : "The colors of your music", 80, y, 35, palette.text, titleFace(language));
  text(ctx, zh ? `${distribution.known} 首常听歌曲已识别曲风 · 每首等权` : `${distribution.known} frequent tracks with identified genres · equal song weights`, 80, y + 44, 16, palette.muted);
  if (!genres.length) {
    text(ctx, zh ? "曲风资料还在等待发现。" : "Your genre palette is waiting to take shape.", 80, y + 105, 23, palette.muted);
    return;
  }
  let x = 80;
  for (const genre of genres) {
    const width = 920 * genre.percentage / 100;
    ctx.fillStyle = genre.color; ctx.fillRect(x, y + 74, Math.max(0, width - 3), 15); x += width;
  }
  genres.forEach((genre, index) => {
    const left = 80 + index % 2 * 480, top = y + 145 + Math.floor(index / 2) * 70;
    circle(ctx, left + 5, top - 7, 5, genre.color);
    fittedText(ctx, language === "zh" ? genre.nameZh : genre.nameEn ?? genreDisplayLabels(genre.name).en, left + 23, top, 300, 22, palette.text, SANS, 450);
    ctx.textAlign = "right"; text(ctx, `${formatNumber(genre.percentage)}%`, left + 430, top, 20, palette.muted, SANS); ctx.textAlign = "left";
  });
  drawTextBlock(ctx, zh ? "只看播放超过 10 次的已识别曲目；多曲风均分，未识别歌曲不参与占比。" : "Only identified tracks with more than 10 plays. Multi-genre songs split their weight; unclassified tracks are excluded.",
    80, y + 155 + Math.ceil(genres.length / 2) * 70, 920, 15, palette.muted, SANS, 2, 23);
}

function drawOverlapModule(ctx: Context, report: PosterReport, palette: Palette, language: PosterLanguage, y: number, limit: number, artwork: PosterArtwork) {
  const zh = language === "zh";
  text(ctx, zh ? "换个平台，还是会听" : "Different players, familiar songs", 80, y, 35, palette.text, titleFace(language));
  const tracks = report.overlappingTracks.slice(0, limit);
  if (!tracks.length) { text(ctx, zh ? "暂未发现两个平台共同出现的歌曲。" : "No shared songs have been identified across platforms yet.", 80, y + 65, 20, palette.muted); return; }
  tracks.forEach((track, index) => {
    const top = y + 73 + index * 72;
    drawTrackArtwork(ctx, track, artwork, 80, top - 24);
    fittedText(ctx, track.title, 148, top, 597, 23, palette.text, SANS, 450);
    fittedText(ctx, track.artist, 148, top + 27, 597, 16, palette.muted);
    ctx.textAlign = "right"; text(ctx, track.platforms.map((id) => platformName(id, id, language)).join(" + "), 1000, top + 4, 15, palette.muted); ctx.textAlign = "left";
  });
  drawTextBlock(ctx, zh ? "按相同或相近歌名匹配；相近歌名同时参考歌手，不据此相加播放次数。" : "Matched by equal or similar titles; similar titles also use the artist. Their play counts are not added.", 80, y + 95 + tracks.length * 72, 920, 14, palette.muted, SANS, 2, 22);
}

function drawMetaphorModule(ctx: Context, report: PosterReport, palette: Palette, language: PosterLanguage, y: number) {
  const zh = language === "zh", time = resolveReportListeningTime(report);
  const metaphor = selectTimeMetaphor(time.seconds, `poster:${report.period.start}:${report.period.end}`);
  text(ctx, zh ? "把时间，换一种看法" : "Another way to see the time", 80, y, 35, palette.text, titleFace(language));
  if (!metaphor) { text(ctx, zh ? "有了可换算的时长，再一起展开想象。" : "A time comparison will appear when listening time is available.", 80, y + 70, 21, palette.muted); return; }
  const value = `${time.kind === "estimated" ? "≈ " : ""}${metaphor.valueLabel[language]}`;
  text(ctx, value, 80, y + 116, 73, palette.accent, SERIF);
  font(ctx, 73, SERIF);
  text(ctx, metaphor.unit[language], 96 + ctx.measureText(value).width, y + 110, 20, palette.muted);
  drawTextBlock(ctx, metaphor.text[language], 80, y + 167, 730, 23, palette.text, SANS, 2, 34);
  // A quiet orbital motif shares the dashboard's circular visual language.
  arc(ctx, 912, y + 116, 51, 0, Math.PI * 2, palette.line, 1);
  circle(ctx, 912, y + 116, 12, palette.accent); circle(ctx, 947, y + 79, 6, palette.muted);
  drawTextBlock(ctx, time.notice[language], 80, y + 250, 920, 14, palette.muted, SANS, 2, 21);
  drawTextBlock(ctx, metaphor.assumption[language], 80, y + 295, 920, 14, palette.muted, SANS, 2, 21);
  if (metaphor.source) text(ctx, metaphor.source.title, 80, y + 342, 12, palette.faint);
}

function drawCompactModule(ctx: Context, report: PosterReport, palette: Palette, language: PosterLanguage, module: PosterModule, y: number) {
  const zh = language === "zh";
  if (module === "platforms") {
    const data = posterPlatformData(report);
    text(ctx, data.actualTime ? zh ? "实际听歌时长" : "Actual listening time" : zh ? "已读取的音乐来源" : "Retrieved music sources", 80, y, 29, palette.text, titleFace(language));
    let x = 80;
    data.sources.forEach((source) => { const width = 920 * source.percentage / 100; ctx.fillStyle = source.color; ctx.fillRect(x, y + 30, Math.max(0, width - 3), 10); x += width; });
    const column = 920 / Math.max(1, data.sources.length);
    data.sources.forEach((source, index) => {
      const left = 80 + index * column;
      text(ctx, platformName(source.id, source.name, language), left, y + 83, 18, palette.muted);
      text(ctx, data.actualTime ? `${formatNumber(source.value / 3600)} h` : `${source.sampleCount} ${zh ? "首" : "tracks"}`, left, y + 128, 32, palette.text, SANS, 450);
      if (!data.actualTime && source.seconds !== null) fittedText(ctx,
        `${source.time.kind === "estimated" ? "≈ " : ""}${formatNumber(source.seconds / 3600)} h · ${source.time.kind === "estimated" ? zh ? "样本估算" : "sample estimate" : zh ? "实际收听" : "actual listening"}`,
        left, y + 151, column - 16, 13, palette.muted);
    });
    text(ctx, data.actualTime ? zh ? "同一时间范围内的实际收听时长。" : "Actual listening time across matching dates."
      : zh ? "按曲目来源计数，不代表听歌时长。" : "Track-source counts, not listening-time shares.", 80, y + 172, 14, palette.muted);
  } else if (module === "genres") {
    const distribution = knownGenreDistribution(unifiedTracks(report).tracks);
    text(ctx, zh ? "你的音乐底色" : "Your sonic palette", 80, y, 29, palette.text, titleFace(language));
    distribution.genres.slice(0, 4).forEach((genre, index) => {
      const x = 80 + index % 2 * 480, top = y + 60 + Math.floor(index / 2) * 52;
      circle(ctx, x + 4, top - 6, 4, genre.color);
      fittedText(ctx, zh ? genre.nameZh : genre.nameEn ?? genreDisplayLabels(genre.name).en, x + 22, top, 300, 21, palette.text, SANS, 450);
      ctx.textAlign = "right"; text(ctx, `${formatNumber(genre.percentage)}%`, x + 430, top, 18, palette.muted); ctx.textAlign = "left";
    });
    if (!distribution.genres.length) text(ctx, zh ? "曲风资料还在等待发现。" : "Genre tags are still waiting to be discovered.", 80, y + 66, 19, palette.muted);
    drawTextBlock(ctx, zh ? "仅纳入播放超过 10 次的已识别歌曲，每首等权；显示前四种曲风，未识别不计入。" : "Top four genres among identified songs with more than 10 plays. Equal song weights; unknown genres excluded.", 80, y + 171, 920, 14, palette.muted, SANS, 2, 22);
  } else if (module === "metaphor") {
    const time = resolveReportListeningTime(report);
    const metaphor = selectTimeMetaphor(time.seconds, `poster:${report.period.start}:${report.period.end}`);
    text(ctx, zh ? "时间的另一种形状" : "Time, in another form", 80, y, 29, palette.text, titleFace(language));
    drawTextBlock(ctx, metaphor?.text[language] ?? (zh ? "等待可换算的时长。" : "Waiting for listening-time data."), 80, y + 55, 920, 23, palette.text, SANS, 2, 34);
    if (metaphor) drawTextBlock(ctx, `${time.kind === "estimated" ? zh ? "样本估算 · " : "Sample estimate · " : time.partial ? zh ? "已知样本 · " : "Known sample · " : ""}${metaphor.assumption[language]}`, 80, y + 137, 920, 13, palette.muted, SANS, 2, 21);
  }
}

async function prepareFonts(report: PosterReport, language: PosterLanguage) {
  if (!document.fonts?.ready) return;
  const characters = [
    "一二三四五六七八九十月的声音，收进这一面。反复回到旋律时间流向音乐偏爱自有形状",
    buildMusicPersona(report).line[language],
    buildMusicPersona(report).evidence[language],
    formatPosterPeriod(report)[language],
    ...knownGenreDistribution(unifiedTracks(report).tracks).genres.map((genre) => genre.nameZh),
    ...report.insights.map((insight) => insight.title[language]),
    ...unifiedTracks(report).tracks.flatMap((track) => [
      track.title,
      track.artist,
    ]),
    report.genreScope[language],
    report.durationNotice[language],
    report.rankingNotice[language],
  ].join("");
  await Promise.allSettled([
    document.fonts.load(
      '400 64px "Instrument Serif"',
      "Your music, on record. 0123456789",
    ),
    document.fonts.load(
      '500 30px "Manrope Variable"',
      "zmusicstatsABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ),
    document.fonts.load('400 20px "Noto Sans SC Variable"', characters),
    document.fonts.load('500 26px "Noto Sans SC Variable"', characters),
    document.fonts.load('500 51px "Noto Serif SC Variable"', characters),
    document.fonts.load('400 54px "Noto Serif SC Variable"', characters),
  ]);
  await document.fonts.ready;
}

/** Render at a fixed print-like resolution; no devicePixelRatio-dependent output. */
export async function renderPosterCanvas(report: PosterReport, options: PosterOptions, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  checkPosterAbort(signal);
  if (typeof document === "undefined") throw new Error("Poster rendering requires a browser.");
  const layout = buildPosterLayout(report, options);
  const page = posterTrackPage(report, options);
  const artworkTracks = [
    ...(layout.blocks.some((block) => block.module === "tracks") ? page.tracks : []),
    ...(layout.blocks.some((block) => block.module === "overlap") ? report.overlappingTracks.slice(0, options.format === "cover" ? 3 : 5) : []),
  ];
  const [, artwork] = await Promise.all([prepareFonts(report, options.language), loadPosterArtwork(artworkTracks, signal)]);
  checkPosterAbort(signal);
  const canvas = document.createElement("canvas");
  const loadedCovers = artworkTracks.filter((track) => { const url = posterArtworkUrl(track.artworkUrl); return url !== null && artwork.has(url); }).length;
  canvasArtwork.set(canvas, { total: artworkTracks.length, loaded: loadedCovers, fallback: artworkTracks.length - loadedCovers });
  canvas.width = layout.width; canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is not available in this browser.");
  const palette = THEMES[options.theme ?? "ink"], month = monthDetails(report.period), zh = options.language === "zh";
  ctx.fillStyle = palette.background; ctx.fillRect(0, 0, WIDTH, layout.height);
  for (let index = 0; index < layout.height * 3.5; index++) {
    ctx.fillStyle = index % 2 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.025)";
    ctx.fillRect((index * 137.508) % WIDTH, (index * 73.137) % layout.height, 1, 1);
  }
  wordmark(ctx, 80, 78, palette);
  ctx.textAlign = "right";
  text(ctx, report.mode === "demo" ? zh ? "演示数据 · 非个人记录" : "DEMO · NOT PERSONAL DATA" : zh ? "个人音乐合辑" : "PERSONAL MUSIC REPORT", 1000, 74, 14, palette.muted);
  ctx.textAlign = "left"; line(ctx, 112, palette.line);
  const chapter = options.format === "cards" && options.section && options.section !== "cover";
  if (chapter) {
    const titles: Record<PosterModule | "listening", Localized> = {
      summary: { zh: "音乐陪伴的时间", en: "Time spent with music" }, persona: { zh: "你的听歌画像", en: "Your listening portrait" },
      platforms: { zh: "音乐的来处", en: "Where music lives" }, listening: { zh: "音乐的来处", en: "Where music lives" },
      tracks: { zh: "常听的旋律", en: "The ones on repeat" }, genres: { zh: "偏爱的声音", en: "Your sonic palette" },
      overlap: { zh: "换个平台，还是你", en: "The common ground" }, metaphor: { zh: "时间的另一种形状", en: "Time, in another form" },
    };
    drawTextBlock(ctx, formatPosterPeriod(report)[options.language], 80, 163, 920, 17, palette.muted, SANS, 2, 26);
    text(ctx, titles[options.section as Exclude<PosterSection, "cover">][options.language], 78, 252, zh ? 48 : 59, palette.text, titleFace(options.language));
  } else {
    const summary = selectedPosterModules(options).includes("summary");
    drawPosterListener(ctx, { x: 515, y: 135, width: 485, height: summary ? 490 : 365 });
    drawHeadline(ctx, report, palette, options, month);
  }
  for (const block of layout.blocks) {
    line(ctx, block.y - 46, palette.line);
    if (options.format === "cover" && ["platforms", "genres", "metaphor"].includes(block.module)) drawCompactModule(ctx, report, palette, options.language, block.module, block.y);
    else if (block.module === "platforms") drawPlatformModule(ctx, report, palette, options.language, block.y);
    else if (block.module === "tracks") drawTracks(ctx, report, palette, options.language, block.y - 53, page.tracks.length, page.tracks, page.offset, page.total, artwork);
    else if (block.module === "genres") drawGenreModule(ctx, report, palette, options.language, block.y);
    else if (block.module === "overlap") drawOverlapModule(ctx, report, palette, options.language, block.y, options.format === "cover" ? 3 : 5, artwork);
    else if (block.module === "metaphor") drawMetaphorModule(ctx, report, palette, options.language, block.y);
  }
  const footerY = layout.height - 83;
  line(ctx, footerY - 20, palette.line);
  tracked(ctx, "ZM / PERSONAL COLLECTION", 80, footerY + 25, 12, palette.muted, 1.3);
  ctx.textAlign = "right";
  fittedText(ctx, formatPosterPeriod(report)[options.language], 1000, footerY + 24, 540, 13, palette.muted);
  ctx.textAlign = "left";
  return canvas;
}

/** Generates a PNG preview/download URL. Caller owns URL.revokeObjectURL(url). */
export async function exportPoster(
  report: PosterReport,
  options: PosterOptions,
  control: Pick<PosterExportControl, "signal"> = {},
): Promise<PosterExport> {
  checkPosterAbort(control.signal);
  const canvas = await renderPosterCanvas(report, options, control.signal);
  const { width, height } = canvas;
  try {
    checkPosterAbort(control.signal);
    const blob = await new Promise<Blob>((resolve, reject) => {
      const aborted = () => reject(control.signal?.reason ?? new DOMException("Poster generation cancelled.", "AbortError"));
      control.signal?.addEventListener("abort", aborted, { once: true });
      try {
        canvas.toBlob((value) => {
          control.signal?.removeEventListener("abort", aborted);
          if (control.signal?.aborted) aborted();
          else if (value) resolve(value);
          else reject(new Error("Poster export failed."));
        }, "image/png");
      } catch (error) { control.signal?.removeEventListener("abort", aborted); reject(error); }
    });
    checkPosterAbort(control.signal);
    const suffix = report.mode === "demo" ? "-demo" : "";
    return {
      blob, width, height, url: URL.createObjectURL(blob), artwork: canvasArtwork.get(canvas),
      filename: `zmusicstats-${monthDetails(report.period).key}-${options.format === "long" ? "long" : (options.section ?? "cover")}${(options.trackPage ?? 0) > 0 ? `-page-${options.trackPage! + 1}` : ""}-${options.language}${suffix}.png`,
    };
  } finally {
    // Blob URLs own their encoded data; retaining large canvas backing stores wastes phone memory.
    canvas.width = 0; canvas.height = 0;
  }
}

/** Selected modules and bounded track pages. Revoke every URL when no longer needed. */
export async function exportPosterSeries(
  report: PosterReport,
  options: PosterOptions,
  control: PosterExportControl = {},
): Promise<PosterExport[]> {
  const results: PosterExport[] = [];
  try {
    checkPosterAbort(control.signal);
    const pages = planPosterExports(report, options);
    control.onProgress?.({ completed: 0, total: pages.length });
    for (const pageOptions of pages) {
      await yieldPosterFrame(control.signal);
      checkPosterAbort(control.signal);
      results.push(await exportPoster(report, pageOptions, control));
      checkPosterAbort(control.signal);
      control.onProgress?.({ completed: results.length, total: pages.length });
      checkPosterAbort(control.signal);
    }
    return results;
  } catch (error) {
    results.forEach((result) => URL.revokeObjectURL(result.url));
    throw error;
  }
}

/** Download fallback. On mobile, the UI can also present the URL for long-press saving. */
export function downloadPoster(poster: PosterExport): void {
  const link = document.createElement("a");
  link.href = poster.url;
  link.download = poster.filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
