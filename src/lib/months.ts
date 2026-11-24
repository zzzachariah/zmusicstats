import { buildReport, calculateGenres, formatPeriod, PLATFORM_META, samePeriod, validPeriod } from "./report.ts";
import type { Localized, MusicReport, PlatformId, PlatformInput, RankedTrack, ReportInput, ReportPeriod, TrackInput } from "./report.ts";

export interface MonthNotice {
  code: string;
  platform?: PlatformId;
  months: string[];
  message: Localized;
}

export interface PlatformMonthCoverage {
  id: PlatformId;
  selectedMonths: string[];
  availableMonths: string[];
  missingMonths: string[];
  durationMonths: string[];
  rankingMonths: string[];
  recentOnlyMonths: string[];
  durationComplete: boolean;
  countComparable: boolean;
}

export interface MergedMonthlyInputs {
  /** Transport representation. Use report for display: its labels and sample flags are required. */
  input: ReportInput;
  report: MusicReport;
  selectedMonths: string[];
  periodLabel: Localized;
  notices: MonthNotice[];
  coverage: PlatformMonthCoverage[];
  hasGaps: boolean;
}

function monthNumber(month: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000"))
    throw new Error(`INVALID_MONTH: ${month}`);
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
}

function monthPeriod(month: string, timeZone: string): ReportPeriod {
  monthNumber(month);
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return { start: `${month}-01`, end: date.toISOString().slice(0, 10), timeZone };
}

/** Compress consecutive selections while retaining gaps and year boundaries. */
export function formatSelectedMonths(months: readonly string[]): Localized {
  const selected = [...new Set(months)].sort();
  if (!selected.length) throw new Error("EMPTY_SELECTION: select at least one month");
  selected.forEach(monthNumber);
  if (selected.length === 1) return formatPeriod(monthPeriod(selected[0], "UTC"));
  const groups: string[][] = [];
  for (const month of selected) {
    const previous = groups.at(-1)?.at(-1);
    if (previous && monthNumber(month) === monthNumber(previous) + 1) groups.at(-1)!.push(month);
    else groups.push([month]);
  }
  const english = (month: string) => new Intl.DateTimeFormat("en", {month:"short", timeZone:"UTC"}).format(new Date(`${month}-01T12:00:00Z`));
  return {
    zh: groups.map(group => {
      const first=group[0], last=group.at(-1)!;
      const start=`${first.slice(0,4)} 年 ${Number(first.slice(5))} 月`;
      if (group.length===1) return start;
      return `${start}—${first.slice(0,4)!==last.slice(0,4) ? `${last.slice(0,4)} 年 ` : ""}${Number(last.slice(5))} 月`;
    }).join("；"),
    en: groups.map(group => {
      const first=group[0], last=group.at(-1)!;
      if (group.length===1) return `${english(first)} ${first.slice(0,4)}`;
      return first.slice(0,4)===last.slice(0,4) ? `${english(first)}–${english(last)} ${last.slice(0,4)}` : `${english(first)} ${first.slice(0,4)}–${english(last)} ${last.slice(0,4)}`;
    }).join("; "),
  };
}

function identity(track: TrackInput, id: PlatformId): string {
  return track.canonicalId?.trim() ? `recording:${track.canonicalId.trim()}` : `${id}:${track.id}`;
}

function safeCount(count: number | null): count is number {
  return count !== null && Number.isSafeInteger(count) && count >= 0;
}

function normalizedTracks(source: PlatformInput): TrackInput[] {
  const ids = new Set<string>();
  const recordings = new Set<string>();
  return source.tracks.filter((track) => {
    const key = identity(track, source.id);
    if (!track.id || !track.title || !track.artist || ids.has(track.id) || recordings.has(key)) return false;
    ids.add(track.id);
    recordings.add(key);
    return true;
  }).map((track) => ({ ...track, genres: [...track.genres], count: source.countKind === "plays" && safeCount(track.count) ? track.count : null }));
}

interface MonthlySource { month: string; source: PlatformInput; index: number }

/**
 * Aggregates monthly snapshots, never playback events. Later snapshots replace earlier ones.
 * period.start/end are bounds; periodLabel lists the exact selected set. A returned monthly
 * Top entry is a lower bound when a missing/truncated month could hide more plays.
 */
export function mergeMonthlyInputs(inputs: readonly ReportInput[], selectedMonths: readonly string[]): MergedMonthlyInputs {
  const selected = [...new Set(selectedMonths)].sort();
  if (!selected.length) throw new Error("EMPTY_SELECTION: select at least one month");
  selected.forEach(monthNumber);
  const snapshots = new Map<string, { input: ReportInput; index: number }>();
  inputs.forEach((input, index) => {
    if (!validPeriod(input.period)) return;
    const month = input.period.start.slice(0, 7);
    if (selected.includes(month) && samePeriod(input.period, monthPeriod(month, input.period.timeZone)))
      snapshots.set(month, { input, index });
  });
  const loaded = selected.flatMap((month) => snapshots.has(month) ? [snapshots.get(month)!] : []);
  const modes = new Set(loaded.map(({ input }) => input.mode));
  if (modes.size > 1) throw new Error("MIXED_MODES: demo and personal months cannot be combined");
  const zones = new Set(loaded.map(({ input }) => input.period.timeZone));
  if (zones.size > 1) throw new Error("MIXED_TIME_ZONES: monthly boundaries must use the same time zone");
  const timeZone = loaded[0]?.input.period.timeZone ?? inputs.at(-1)?.period.timeZone ?? "Asia/Shanghai";
  const period: ReportPeriod = { start: `${selected[0]}-01`, end: monthPeriod(selected.at(-1)!, timeZone).end, timeZone };
  const expected = [...new Set((loaded.length ? loaded.map(({ input }) => input) : inputs).flatMap((input) => input.expectedPlatforms ?? input.platforms.map((source) => source.id)))];
  const notices: MonthNotice[] = [];
  const addNotice = (code: string, months: string[], message: Localized, platform?: PlatformId) => notices.push({ code, months: [...months], message, ...(platform ? { platform } : {}) });
  const missingInputs = selected.filter((month) => !snapshots.has(month));
  if (missingInputs.length) addNotice("missing-months", missingInputs, {
    zh: `${missingInputs.join("、")} 尚未取得月报；缺失月份不会按零计入。`,
    en: `Monthly reports are unavailable for ${missingInputs.join(", ")}; missing months are not counted as zero.`,
  });
  const partialKeys = new Map<PlatformId, Set<string>>();
  const genreSamples = new Map<PlatformId, TrackInput[]>();
  const coverage: PlatformMonthCoverage[] = [];
  const platforms: PlatformInput[] = [];

  for (const id of expected) {
    const name = PLATFORM_META[id];
    const available: MonthlySource[] = [];
    for (const month of selected) {
      const snapshot = snapshots.get(month);
      if (!snapshot) continue;
      const sources = snapshot.input.platforms.filter((source) => source.id === id);
      if (sources.length === 1) available.push({ month, source: sources[0], index: snapshot.index });
      else if (sources.length > 1) addNotice("duplicate-platform", [month], {
        zh: `${name.name} ${month} 有重复平台记录，该月未参与合计。`,
        en: `${name.nameEn} has duplicate platform records for ${month}; that month is excluded.`,
      }, id);
    }
    const availableMonths = available.map(({ month }) => month);
    const missingMonths = selected.filter((month) => !availableMonths.includes(month));
    const durations = available.filter(({ month, source }) => samePeriod(source.period, monthPeriod(month, timeZone)) && source.durationKind === "actual-total" && source.coverageComplete && source.listenSeconds !== null && Number.isFinite(source.listenSeconds) && source.listenSeconds >= 0);
    const rankings = available.filter(({ month, source }) => samePeriod(source.rankingPeriod, monthPeriod(month, timeZone)));
    const undated = available.filter(({ source }) => !validPeriod(source.rankingPeriod));
    const definition = rankings[0]?.source.countDefinition;
    // A consistently absent definition allows addition within one provider only.
    // It remains null, so buildReport still forbids cross-provider count addition.
    const countComparable = rankings.length > 0 && rankings.every(({ source }) => source.countKind === "plays" && source.countDefinition === definition);
    const durationSum = durations.reduce((sum, { source }) => sum + source.listenSeconds!, 0);
    const durationComplete = durations.length === selected.length && Number.isFinite(durationSum);
    const entry: PlatformMonthCoverage = { id, selectedMonths: [...selected], availableMonths, missingMonths, durationMonths: durations.map(({ month }) => month), rankingMonths: rankings.map(({ month }) => month), recentOnlyMonths: undated.map(({ month }) => month), durationComplete, countComparable };
    coverage.push(entry);
    if (missingMonths.length) addNotice("missing-platform-months", missingMonths, {
      zh: `${name.name} 尚缺 ${missingMonths.join("、")}；保留已返回月榜样本，暂不合计所选月份时长。`,
      en: `${name.nameEn} is missing ${missingMonths.join(", ")}. Returned monthly ranking samples are retained; selected-month listening time is withheld.`,
    }, id);
    if (!durationComplete && available.length) addNotice("incomplete-duration", selected.filter((month) => !entry.durationMonths.includes(month)), {
      zh: `${name.name} 未取得所有所选月份的完整实际时长；不使用日均时长或缺失值补齐。`,
      en: `${name.nameEn} has no complete actual listening time for every selected month; averages and missing values are not substituted.`,
    }, id);
    if (!available.length) continue;

    // Preserve the existing single-month semantics exactly, including original ranking order.
    if (selected.length === 1) {
      platforms.push(structuredClone(available[0].source));
      continue;
    }

    let tracks: TrackInput[] = [];
    const partial = new Set<string>();
    if (rankings.length) {
      const months = rankings.map((item) => ({ ...item, tracks: normalizedTracks(item.source) }));
      const map = new Map<string, TrackInput>();
      // Newest returned metadata wins; identity never falls back to title matching.
      for (const { tracks: monthlyTracks } of [...months].sort((a, b) => b.index - a.index)) {
        for (const track of monthlyTracks) {
          const key = identity(track, id);
          if (!map.has(key)) map.set(key, { ...track, genres: [...track.genres] });
        }
      }
      for (const [key, track] of map) {
        let total = 0;
        let unknown = false;
        if (rankings.length !== selected.length) partial.add(key);
        for (const month of months) {
          const found = month.tracks.find((candidate) => identity(candidate, id) === key);
          if (found) {
            if (found.count === null) unknown = true;
            else total += found.count;
            track.genres = [...new Set([...track.genres, ...found.genres])];
          } else if (month.source.rankCoverage === "top") partial.add(key);
        }
        track.count = countComparable && !unknown && Number.isSafeInteger(total) ? total : null;
        if (track.count === null) partial.add(key);
      }
      tracks = [...map.values()].sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
      genreSamples.set(id, countComparable ? months.flatMap((month) => month.tracks) : []);
      if (rankings.length !== selected.length) addNotice("partial-ranking", selected.filter((month) => !entry.rankingMonths.includes(month)), {
        zh: `${name.name} 仅包含 ${entry.rankingMonths.join("、")} 已返回的月榜样本；标记 ≥ 的次数为已知下限。`,
        en: `${name.nameEn} includes returned monthly ranking samples from ${entry.rankingMonths.join(", ")} only. Counts marked ≥ are known lower bounds.`,
      }, id);
      if (!countComparable) addNotice("incompatible-counts", entry.rankingMonths, {
        zh: `${name.name} 的月榜次数口径不一致或并非播放次数，因此保留歌曲但不相加次数。`,
        en: `${name.nameEn} monthly counts differ in definition or are not plays; songs are retained without adding their counts.`,
      }, id);
    } else if (undated.length) {
      // A recent-history snapshot is not a monthly report, even if fetched for many months.
      const latest = [...undated].sort((a, b) => b.index - a.index)[0];
      tracks = normalizedTracks(latest.source).map((track) => ({ ...track, count: null }));
      addNotice("undated-snapshot", entry.recentOnlyMonths, {
        zh: `${name.name} 仅保留最近取得的一份无日期曲目列表，不计入月榜、曲风或播放次数合计。`,
        en: `${name.nameEn} retains only the latest undated track snapshot, excluded from monthly rankings, genres and play-count totals.`,
      }, id);
    }
    partialKeys.set(id, partial);
    platforms.push({
      id, period: { ...period }, listenSeconds: durationComplete ? durationSum : null,
      durationKind: durationComplete ? "actual-total" : "unknown", coverageComplete: durationComplete,
      tracks, rankingPeriod: rankings.length ? { ...period } : null,
      countKind: countComparable ? "plays" : "unknown", countDefinition: countComparable ? definition ?? null : null,
      rankCoverage: rankings.length === selected.length && rankings.every(({ source }) => source.rankCoverage === "complete") ? "complete" : "top",
    });
  }

  const input: ReportInput = { mode: loaded[0]?.input.mode ?? inputs.at(-1)?.mode ?? "live", period, expectedPlatforms: expected, platforms };
  const report = buildReport(input);
  const periodLabel = formatSelectedMonths(selected);
  report.periodLabel = periodLabel;
  for (const platform of report.platforms) {
    const covered = coverage.find((item) => item.id === platform.id)!;
    platform.rankingCoverage = covered.rankingMonths.length === selected.length ? "complete" : covered.rankingMonths.length ? "partial" : "undated";
    if (selected.length === 1) continue;
    for (const track of platform.tracks) track.countIsPartial ||= partialKeys.get(platform.id)?.has(identity(track, platform.id)) ?? false;
    if (platform.rankingMatchesPeriod) {
      platform.genres = calculateGenres(genreSamples.get(platform.id) ?? []);
      platform.genreScope = {
        zh: `仅基于所选月份中已返回的 ${covered.rankingMonths.join("、")} 月榜样本，按已知播放次数加权；缺月和榜外播放未知，不代表全部听歌。`,
        en: `Weighted by known plays in returned monthly ranking samples for ${covered.rankingMonths.join(", ")}. Missing months and plays outside the rankings are unknown; this is not full listening history.`,
      };
    }
  }
  if (selected.length > 1) {
    const markPartial = (track: RankedTrack) => {
      track.countIsPartial ||= track.platforms.some((id) => {
        const sourceTrack = report.platforms.find((platform) => platform.id === id)?.tracks.find((candidate) => track.canonicalId?.trim() ? candidate.canonicalId?.trim() === track.canonicalId.trim() : candidate.id === track.id || `${id}:${candidate.id}` === track.id);
        return sourceTrack?.countIsPartial ?? false;
      });
    };
    report.tracks.forEach(markPartial);
    report.overlappingTracks.forEach(markPartial);
    report.rankingNotice = {
      zh: `仅汇总所选月份中已返回的月榜样本；次数是样本中已知播放次数的合计，≥ 表示可能还有未返回的播放，不是完整播放总量。${report.rankingMode === "separate" ? "各平台次数口径未对齐，分别展示。" : "仅合并已确认的相同录音版本。"}`,
      en: `Only returned monthly ranking samples are aggregated. Counts sum known plays in those samples; ≥ means additional plays may be missing, not a complete play total. ${report.rankingMode === "separate" ? "Platform counts are not aligned and are shown separately." : "Only verified identical recordings are combined."}`,
    };
    report.durationNotice = report.totalSeconds !== null ? {
      zh: `${periodLabel.zh}的实际听歌时长合计；仅包含明确选择的月份。${report.platforms.length < 2 ? "连接第二个平台后可比较占比。" : ""}`,
      en: `Actual listening time summed for ${periodLabel.en}; only explicitly selected months are included.${report.platforms.length < 2 ? " Connect another platform to compare shares." : ""}`,
    } : {
      zh: "尚未取得所有平台、所有所选月份的完整实际时长，暂不合计或显示占比；缺失月份不按零计算。",
      en: "Complete actual listening time is unavailable for every platform and selected month. Totals and shares are withheld; missing months are not zero.",
    };
    if (report.rankingMode === "combined") {
      report.genres = calculateGenres([...genreSamples.values()].flat());
      report.genreScope = {
        zh: "仅依据所选月份中已返回月榜的已知播放次数加权，多曲风均分；缺月、榜外播放和缺失次数不参与，不能代表全部听歌。",
        en: "Weighted by known plays in returned monthly rankings for the selected months, splitting multi-genre weights equally. Missing months, omitted plays and unknown counts are excluded; this is not full listening history.",
      };
      const leading = report.genres[0];
      const insight = report.insights.find((item) => item.id === "leading-genre");
      if (insight && leading && leading.name !== "Unknown") {
        insight.title = { zh: `${leading.nameZh}，是这一期的底色。`, en: `${leading.name} sets the tone.` };
        insight.body = { zh: `${leading.nameZh}占已返回月榜样本加权曲风的 ${Math.round(leading.percentage)}%；样本之外的听歌未知。`, en: `${leading.name} accounts for ${Math.round(leading.percentage)}% of weighted genres in the returned monthly ranking sample; listening beyond the sample is unknown.` };
      } else report.insights = report.insights.filter((item) => item.id !== "leading-genre");
    }
  }
  return { input, report, selectedMonths: selected, periodLabel, notices, coverage, hasGaps: selected.some((month, index) => index > 0 && monthNumber(month) !== monthNumber(selected[index - 1]) + 1) };
}
