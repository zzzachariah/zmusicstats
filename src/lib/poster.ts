import type { MusicReport, RankedTrack } from "./report";

/** Browser-only, deterministic artwork. No remote images, fonts or AI calls. */
export type PosterLanguage = "zh" | "en";
export type PosterTheme = "ink" | "paper";
export type PosterFormat = "cover" | "long" | "cards";
export type PosterSection = "cover" | "listening" | "tracks" | "genres";

export type PosterReport = MusicReport;

export interface PosterOptions {
  language: PosterLanguage;
  theme?: PosterTheme;
  format?: PosterFormat;
  /** Used for an individual card; exportPosterSeries generates all four. */
  section?: PosterSection;
}

export interface PosterExport {
  blob: Blob;
  /** The caller should revoke this URL after the preview closes. */
  url: string;
  filename: string;
}

const WIDTH = 1080;
const HEIGHT = 1440;
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
  const validMonth = match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
  return {
    year: validMonth ? match[1] : "—",
    number: validMonth ? match[2] : "—",
    en: validMonth ? MONTHS[Number(match[2]) - 1] : "Your music",
    zh: validMonth ? MONTHS_ZH[Number(match[2]) - 1] : "音乐",
    key: validMonth ? `${match[1]}-${match[2]}` : "report",
  };
}

function hasDuration(report: PosterReport): boolean {
  return (
    report.durationComparable &&
    report.totalHours !== null &&
    Number.isFinite(report.totalHours) &&
    report.totalHours >= 0
  );
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
  const dictionary: Record<string, [string, string]> = {
    Pop: ["流行", "Pop"],
    Indie: ["独立", "Indie"],
    Jazz: ["爵士", "Jazz"],
    Rock: ["摇滚", "Rock"],
    Electronic: ["电子", "Electronic"],
    Folk: ["民谣", "Folk"],
    "Hip-Hop": ["嘻哈", "Hip-Hop"],
    unknown: ["未识别", "Unclassified"],
    Unknown: ["未识别", "Unclassified"],
    未识别: ["未识别", "Unclassified"],
  };
  return dictionary[name]?.[language === "zh" ? 0 : 1] ?? name;
}

function wordmark(ctx: Context, x: number, y: number, palette: Palette) {
  [13, 25, 34, 20, 11].forEach((height, i) => {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(x + i * 7, y - height + 2, 3, height);
  });
  text(ctx, "zmusicstats", x + 48, y, 30, palette.text, SANS, 500);
}

function vinyl(
  ctx: Context,
  report: PosterReport,
  palette: Palette,
  month: ReturnType<typeof monthDetails>,
) {
  const x = 716,
    y = 365,
    radius = 253;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 35;
  ctx.shadowOffsetY = 18;
  circle(ctx, x, y, radius, "#080b0b");
  ctx.restore();
  circle(ctx, x, y, radius - 4, "#1a1e1d");

  // The surface is entirely vector-drawn, so it stays clean on high-density screens.
  for (let r = 109; r < radius - 10; r += 3.3) {
    arc(
      ctx,
      x,
      y,
      r,
      0,
      Math.PI * 2,
      Math.round(r) % 3 ? "#2c3230" : "#353c38",
      0.8,
    );
  }
  const sheen = ctx.createLinearGradient(
    x - radius,
    y - radius,
    x + radius,
    y + radius,
  );
  sheen.addColorStop(0, "rgba(177,190,172,0.13)");
  sheen.addColorStop(0.27, "rgba(0,0,0,0)");
  sheen.addColorStop(0.5, "rgba(230,237,215,0.08)");
  sheen.addColorStop(0.7, "rgba(0,0,0,0)");
  sheen.addColorStop(1, "rgba(174,191,179,0.12)");
  circle(ctx, x, y, radius - 8, sheen);
  for (let r = 132; r < 235; r += 4) {
    arc(ctx, x, y, r, -0.88, -0.29, "rgba(223,230,214,0.10)", 1);
    arc(ctx, x, y, r, 2.32, 2.85, "rgba(223,230,214,0.07)", 1);
  }

  let angle = -Math.PI / 2;
  if (hasDuration(report) && (report.totalHours ?? 0) > 0) {
    report.platformShares.forEach((share, index) => {
      const portion = Math.max(0, Math.min(100, share.percentage)) / 100;
      const next = angle + Math.PI * 2 * portion;
      arc(
        ctx,
        x,
        y,
        radius + 7,
        angle + 0.025,
        next - 0.025,
        share.color || (index === 0 ? "#e27c60" : "#b0c1a5"),
        4,
      );
      angle = next;
    });
  } else {
    arc(ctx, x, y, radius + 7, 0, Math.PI * 2, palette.line, 1);
  }

  circle(ctx, x, y, 98, palette.paper);
  circle(ctx, x, y, 87, "#d9d4c6");
  circle(ctx, x, y, 86, palette.paper);
  ctx.textAlign = "center";
  text(ctx, "YOUR MONTH, ON RECORD", x, y - 52, 10, "#4c554c", MONO, 500);
  text(ctx, month.number, x, y + 16, 82, "#252e29", SERIF);
  text(ctx, month.year, x, y + 46, 15, "#5e685e", MONO);
  text(ctx, "ZM / PERSONAL COLLECTION", x, y + 68, 8, "#697166", MONO);
  circle(ctx, x, y, 7, "#111716");
  circle(ctx, x, y, 2.4, "#686f65");
  ctx.textAlign = "left";
}

function drawHeadline(
  ctx: Context,
  report: PosterReport,
  palette: Palette,
  options: PosterOptions,
  month: ReturnType<typeof monthDetails>,
) {
  const zh = options.language === "zh";
  tracked(
    ctx,
    `${month.en.toUpperCase()} ${month.year}`,
    80,
    167,
    17,
    palette.muted,
    2,
  );
  if (zh) {
    text(ctx, `${month.zh}的声音，`, 76, 249, 51, palette.text, SERIF_ZH, 500);
    text(ctx, "收进这一面。", 76, 318, 51, palette.text, SERIF_ZH, 500);
  } else {
    text(ctx, "Your music,", 76, 250, 64, palette.text, SERIF);
    text(ctx, "on record.", 76, 322, 64, palette.text, SERIF);
  }

  const available = hasDuration(report);
  const duration = available ? formatNumber(report.totalHours!) : "—";
  font(ctx, 82, SERIF);
  ctx.fillStyle = palette.text;
  ctx.fillText(duration, 78, 445);
  const durationWidth = ctx.measureText(duration).width;
  text(
    ctx,
    zh ? "小时" : "hrs",
    92 + durationWidth,
    442,
    20,
    palette.muted,
    SANS,
  );
  text(
    ctx,
    available
      ? zh
        ? "音乐陪伴的时间"
        : "Time spent with your music"
      : zh
        ? "尚无可比较的时长数据"
        : "Comparable duration unavailable",
    80,
    483,
    18,
    palette.muted,
  );

  if (available) {
    report.platformShares.slice(0, 3).forEach((share, index) => {
      const y = 536 + index * 33;
      circle(
        ctx,
        85,
        y - 6,
        4,
        share.color || (index === 0 ? "#e27c60" : "#b0c1a5"),
      );
      fittedText(
        ctx,
        platformName(share.id, share.name, options.language),
        100,
        y,
        158,
        17,
        palette.muted,
      );
      const value = Number.isFinite(share.hours)
        ? `${formatNumber(share.hours)} h`
        : "—";
      text(ctx, value, 274, y, 17, palette.text, MONO);
    });
  } else {
    text(
      ctx,
      zh ? "先保留此刻的音乐偏好。" : "A snapshot of what you love.",
      80,
      539,
      17,
      palette.faint,
    );
  }
}

export function selectPosterTracks(
  report: PosterReport,
  limit = 5,
): RankedTrack[] {
  if (report.rankingMode === "combined") return report.tracks.slice(0, limit);
  // Only period-matched rankings belong in a monthly report; recent tracks are not rankings.
  const matchedPlatforms = report.platforms.filter(
    (platform) => platform.rankingMatchesPeriod,
  );
  // Alternate between valid platform rankings; never fabricate a merged ranking.
  const selected: RankedTrack[] = [];
  for (let rank = 0; rank < limit && selected.length < limit; rank++) {
    for (const platform of matchedPlatforms) {
      if (platform.tracks[rank] && selected.length < limit)
        selected.push(platform.tracks[rank]);
    }
  }
  return selected;
}

function drawTracks(
  ctx: Context,
  report: PosterReport,
  palette: Palette,
  language: PosterLanguage,
  startY = 675,
  limit = 5,
) {
  const zh = language === "zh";
  const tracks = selectPosterTracks(report, limit);
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
    combined
      ? `TOP ${tracks.length || "—"}`
      : zh
        ? "分平台选集"
        : "BY PLATFORM",
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
      `${combined ? index + 1 : track.rank}`.padStart(2, "0"),
      80,
      y,
      23,
      palette.accent,
      MONO,
    );
    fittedText(
      ctx,
      track.title || (zh ? "未命名歌曲" : "Untitled track"),
      143,
      y - 1,
      633,
      26,
      palette.text,
      SANS,
      500,
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
      145,
      y + 26,
      610,
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
        ? "名次为歌曲在各自平台的排名，不构成跨平台总榜。"
        : "Ranks refer to each platform, not a combined chart."
      : "";
  if (note)
    fittedText(
      ctx,
      note,
      80,
      startY + 115 + limit * 70,
      920,
      13,
      palette.muted,
    );
}

function drawGenre(
  ctx: Context,
  report: PosterReport,
  palette: Palette,
  language: PosterLanguage,
) {
  const zh = language === "zh";
  line(ctx, 1158, palette.line);
  tracked(
    ctx,
    zh ? "偏爱曲风" : "YOUR LEADING GENRE",
    80,
    1202,
    15,
    palette.muted,
    zh ? 4 : 2,
  );
  const genre = [...report.genres]
    .filter(
      (item) =>
        !["unknown", "unclassified", "未识别", "未知"].includes(
          item.name.toLowerCase(),
        ) &&
        Number.isFinite(item.percentage) &&
        item.percentage > 0,
    )
    .sort((a, b) => b.percentage - a.percentage)[0];
  fittedText(
    ctx,
    genre
      ? genreName(genre.name, language)
      : zh
        ? "等待发现"
        : "Yet to discover",
    78,
    1261,
    855,
    49,
    palette.text,
    zh ? SERIF_ZH : SERIF,
  );

  const scope = report.genreScope[language];
  wrappedText(
    ctx,
    scope ||
      (zh
        ? "曲风基于本报告中的 Top 歌曲样本。"
        : "Genre profile is based on the top-track sample."),
    80,
    1295,
    920,
    15,
    palette.muted,
  );
}

function titleFace(language: PosterLanguage) {
  return language === "zh" ? SERIF_ZH : SERIF;
}

function drawDurationDetails(
  ctx: Context,
  report: PosterReport,
  palette: Palette,
  language: PosterLanguage,
  startY: number,
) {
  const zh = language === "zh";
  text(
    ctx,
    zh ? "音乐在哪一边响起" : "Where your music lives",
    80,
    startY,
    35,
    palette.text,
    titleFace(language),
    400,
  );
  text(
    ctx,
    zh
      ? "同一时间范围内的平台实际听歌时长"
      : "Actual listening time across the same dates",
    80,
    startY + 34,
    17,
    palette.muted,
  );
  if (hasDuration(report) && (report.totalHours ?? 0) > 0) {
    let x = 80;
    for (const share of report.platformShares) {
      const width = (920 * Math.max(0, Math.min(100, share.percentage))) / 100;
      ctx.fillStyle = share.color;
      ctx.fillRect(x, startY + 61, Math.max(0, width - 4), 15);
      x += width;
    }
  } else {
    ctx.fillStyle = palette.line;
    ctx.fillRect(80, startY + 61, 920, 2);
  }

  const platforms = report.platforms;
  const columnWidth = platforms.length ? 920 / platforms.length : 920;
  if (!platforms.length) {
    text(
      ctx,
      zh ? "尚未连接音乐平台" : "No music platforms connected",
      80,
      startY + 133,
      23,
      palette.muted,
    );
  }
  platforms.forEach((platform, index) => {
    const x = 80 + index * columnWidth;
    circle(ctx, x + 5, startY + 119, 4, platform.color);
    fittedText(
      ctx,
      platformName(platform.id, platform.name, language),
      x + 22,
      startY + 125,
      columnWidth - 44,
      platforms.length > 2 ? 17 : 19,
      palette.muted,
    );
    const number =
      platform.durationAvailable && platform.hours !== null
        ? formatNumber(platform.hours)
        : "—";
    text(ctx, number, x, startY + 181, 54, palette.text, SERIF);
    font(ctx, 54, SERIF);
    const width = ctx.measureText(number).width;
    text(
      ctx,
      zh ? "小时" : "hours",
      x + width + 12,
      startY + 179,
      17,
      palette.muted,
    );
    const share = report.platformShares.find((item) => item.id === platform.id);
    const shareText =
      share && hasDuration(report) && (report.totalHours ?? 0) > 0
        ? `${formatNumber(share.percentage)}% ${zh ? "的平台时长占比" : "of listening time"}`
        : zh
          ? "暂无可比较的占比"
          : "Comparable share unavailable";
    fittedText(
      ctx,
      shareText,
      x,
      startY + 213,
      columnWidth - 24,
      16,
      palette.muted,
    );
  });
}

function drawGenreDetails(
  ctx: Context,
  report: PosterReport,
  palette: Palette,
  language: PosterLanguage,
  startY: number,
) {
  const zh = language === "zh";
  text(
    ctx,
    zh ? "你的声音光谱" : "The spectrum of your taste",
    80,
    startY,
    35,
    palette.text,
    titleFace(language),
    400,
  );
  const unknown = report.genres.find((item) =>
    ["unknown", "unclassified", "未识别"].includes(item.name.toLowerCase()),
  );
  const classified = report.genres.filter((item) => item !== unknown);
  const keep = report.genres.length > 8 ? (unknown ? 6 : 7) : classified.length;
  const genres = classified.slice(0, keep);
  if (classified.length > keep) {
    const rest = classified.slice(keep);
    genres.push({
      name: "Other",
      nameZh: "其他",
      percentage: rest.reduce((sum, item) => sum + item.percentage, 0),
      weight: rest.reduce((sum, item) => sum + item.weight, 0),
      color: palette.faint,
    });
  }
  if (unknown) genres.push(unknown);
  const legendStep = genres.length > 6 ? 52 : 66;
  if (!genres.length) {
    text(
      ctx,
      zh
        ? "曲风资料还不够，先保留一份期待。"
        : "Your genre profile is still waiting to take shape.",
      80,
      startY + 75,
      23,
      palette.muted,
    );
    wrappedText(
      ctx,
      report.genreScope[language],
      80,
      startY + 135,
      920,
      17,
      palette.muted,
    );
    return;
  }
  let x = 80;
  for (const genre of genres) {
    const width = (920 * Math.max(0, Math.min(100, genre.percentage))) / 100;
    ctx.fillStyle = genre.color;
    ctx.fillRect(x, startY + 40, Math.max(0, width - 3), 18);
    x += width;
  }
  genres.forEach((genre, index) => {
    const left = 80 + (index % 2) * 480;
    const top = startY + 115 + Math.floor(index / 2) * legendStep;
    circle(ctx, left + 5, top - 7, 5, genre.color);
    fittedText(
      ctx,
      zh ? genre.nameZh : genre.name,
      left + 24,
      top,
      280,
      23,
      palette.text,
      SANS,
      500,
    );
    ctx.textAlign = "right";
    text(
      ctx,
      `${formatNumber(genre.percentage)}%`,
      left + 430,
      top,
      22,
      palette.muted,
      MONO,
    );
    ctx.textAlign = "left";
  });
  wrappedText(
    ctx,
    report.genreScope[language],
    80,
    startY + 295,
    920,
    16,
    palette.muted,
  );
}

function drawInsights(
  ctx: Context,
  report: PosterReport,
  palette: Palette,
  language: PosterLanguage,
  startY: number,
  limit = 3,
) {
  const zh = language === "zh";
  text(
    ctx,
    zh ? "唱片之外的小发现" : "A few things between the grooves",
    80,
    startY,
    35,
    palette.text,
    titleFace(language),
    400,
  );
  const insights = report.insights.slice(0, limit);
  if (!insights.length) {
    text(
      ctx,
      zh
        ? "更多数据，会留下更多发现。"
        : "More music will leave more to discover.",
      80,
      startY + 65,
      22,
      palette.muted,
    );
    return;
  }
  insights.forEach((insight, index) => {
    const y = startY + 63 + index * 131;
    ctx.fillStyle = palette.accent;
    ctx.fillRect(80, y - 21, 3, 82);
    fittedText(
      ctx,
      insight.title[language],
      107,
      y,
      865,
      25,
      palette.text,
      zh ? SERIF_ZH : SANS,
      500,
    );
    wrappedText(
      ctx,
      insight.body[language],
      107,
      y + 36,
      865,
      18,
      palette.muted,
    );
  });
}

function drawChapter(
  ctx: Context,
  report: PosterReport,
  palette: Palette,
  language: PosterLanguage,
  section: PosterSection,
) {
  const zh = language === "zh";
  const month = monthDetails(report.period);
  tracked(
    ctx,
    `${month.en.toUpperCase()} ${month.year}`,
    80,
    171,
    17,
    palette.muted,
    2,
  );
  const titles = {
    cover: zh ? "你的音乐，这一面。" : "Your music, on record.",
    listening: zh ? "时间，流向音乐。" : "Time well listened.",
    tracks: zh ? "一直在听的那些歌。" : "The ones on repeat.",
    genres: zh ? "偏爱，自有形状。" : "Taste has a shape.",
  };
  fittedText(
    ctx,
    titles[section],
    78,
    260,
    920,
    zh ? 54 : 70,
    palette.text,
    titleFace(language),
    400,
  );
  const subtitles = {
    cover: zh
      ? "这一段时间，与你相伴的声音。"
      : "The music that kept you company.",
    listening: zh
      ? "每个平台，都收着一部分音乐生活。"
      : "A little of your music life, in every player.",
    tracks:
      report.rankingMode === "combined"
        ? zh
          ? "按已获取的播放次数排序；相同录音版本才会合并。"
          : "Sorted by known plays; only matching recordings are combined."
        : zh
          ? "各平台的常听选集，保留各自排名。"
          : "A selection from each platform, with its own rankings.",
    genres: zh
      ? "从常听歌曲里，找到偏爱的声音。"
      : "Find your favorite colors in the music you return to.",
  };
  wrappedText(ctx, subtitles[section], 80, 311, 920, 20, palette.muted);
  if (section === "tracks") {
    drawTracks(ctx, report, palette, language, 375, 10);
    wrappedText(
      ctx,
      report.rankingNotice[language],
      80,
      1255,
      920,
      16,
      palette.muted,
    );
  } else if (section === "genres") {
    drawGenreDetails(ctx, report, palette, language, 411);
    drawInsights(ctx, report, palette, language, 858, 3);
  } else if (section === "listening") {
    // The record remains an actual platform-share chart when comparable time exists.
    ctx.save();
    ctx.translate(-176, 234);
    vinyl(ctx, report, palette, month);
    ctx.restore();
    drawDurationDetails(ctx, report, palette, language, 963);
    wrappedText(
      ctx,
      report.durationNotice[language],
      80,
      1247,
      920,
      16,
      palette.muted,
    );
  }
}

async function prepareFonts(report: PosterReport, language: PosterLanguage) {
  if (!document.fonts?.ready) return;
  const characters = [
    "一二三四五六七八九十月的声音，收进这一面。反复回到旋律时间流向音乐偏爱自有形状",
    ...report.genres.map((genre) => genre.nameZh),
    ...report.insights.map((insight) => insight.title[language]),
    ...selectPosterTracks(report, 10).flatMap((track) => [
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
export async function renderPosterCanvas(
  report: PosterReport,
  options: PosterOptions,
): Promise<HTMLCanvasElement> {
  if (typeof document === "undefined")
    throw new Error("Poster rendering requires a browser.");
  await prepareFonts(report, options.language);
  const isLong = options.format === "long";
  const height = isLong ? 2880 : HEIGHT;
  const section = options.section ?? "cover";
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new Error("Canvas rendering is not available in this browser.");
  const palette = THEMES[options.theme ?? "ink"];
  const month = monthDetails(report.period);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, WIDTH, height);

  // Quiet print grain, deterministic across exports and light enough for small text.
  for (let index = 0; index < (isLong ? 10200 : 5100); index++) {
    const x = (index * 137.508) % WIDTH;
    const y = (index * 73.137) % height;
    ctx.fillStyle = index % 2 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.025)";
    ctx.fillRect(x, y, 1, 1);
  }

  wordmark(ctx, 80, 78, palette);
  ctx.textAlign = "right";
  const badge =
    report.mode === "demo"
      ? options.language === "zh"
        ? "演示数据 · 非个人记录"
        : "DEMO · NOT PERSONAL DATA"
      : options.language === "zh"
        ? "个人音乐月报"
        : "PERSONAL MUSIC REPORT";
  text(ctx, badge, 1000, 74, 15, palette.muted, SANS);
  ctx.textAlign = "left";
  line(ctx, 112, palette.line);
  if (isLong || section === "cover") {
    vinyl(ctx, report, palette, month);
    drawHeadline(ctx, report, palette, options, month);
    if (isLong) {
      line(ctx, 675, palette.line);
      drawDurationDetails(ctx, report, palette, options.language, 728);
      drawTracks(ctx, report, palette, options.language, 1000, 10);
      line(ctx, 1844, palette.line);
      drawGenreDetails(ctx, report, palette, options.language, 1897);
      line(ctx, 2255, palette.line);
      drawInsights(ctx, report, palette, options.language, 2314, 3);
    } else {
      drawTracks(ctx, report, palette, options.language);
      drawGenre(ctx, report, palette, options.language);
    }
  } else {
    drawChapter(ctx, report, palette, options.language, section);
  }
  line(ctx, height - 97, palette.line);
  tracked(
    ctx,
    "ZM / PERSONAL COLLECTION",
    80,
    height - 55,
    13,
    palette.muted,
    1.3,
  );
  ctx.textAlign = "right";
  text(
    ctx,
    `${report.period.start} — ${report.period.end}`,
    1000,
    height - 54,
    14,
    palette.text,
    MONO,
  );
  ctx.textAlign = "left";
  return canvas;
}

/** Generates a PNG preview/download URL. Caller owns URL.revokeObjectURL(url). */
export async function exportPoster(
  report: PosterReport,
  options: PosterOptions,
): Promise<PosterExport> {
  const canvas = await renderPosterCanvas(report, options);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Poster export failed.")),
      "image/png",
    );
  });
  const suffix = report.mode === "demo" ? "-demo" : "";
  return {
    blob,
    url: URL.createObjectURL(blob),
    filename: `zmusicstats-${monthDetails(report.period).key}-${options.format === "long" ? "long" : (options.section ?? "cover")}-${options.language}${suffix}.png`,
  };
}

/** Four coordinated cards. Revoke every returned URL when no longer needed. */
export async function exportPosterSeries(
  report: PosterReport,
  options: PosterOptions,
): Promise<PosterExport[]> {
  const results: PosterExport[] = [];
  try {
    for (const section of ["cover", "listening", "tracks", "genres"] as const) {
      results.push(
        await exportPoster(report, { ...options, format: "cards", section }),
      );
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
