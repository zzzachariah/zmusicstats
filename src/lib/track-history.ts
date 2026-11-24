import { samePeriod, validPeriod } from "./report.ts";
import type { PlatformId, RankedTrack, ReportInput } from "./report.ts";

export interface TrackHistoryBounds {
  /** Bounds of loaded monthly ranking observations, never actual playback dates. */
  firstSeenMonth: string;
  lastSeenMonth: string;
}

const providers = new Set<PlatformId>(["netease", "qq", "apple"]);

/** Keys retain source identity: `${platform}:${songId}`. Repeated observations are idempotent. */
export function buildTrackHistory(inputs: readonly ReportInput[]): Map<string, TrackHistoryBounds> {
  const history = new Map<string, TrackHistoryBounds>();
  for (const input of inputs) {
    if (!validPeriod(input.period) || !input.period.start.endsWith("-01")) continue;
    const lastDay = new Date(`${input.period.start}T00:00:00Z`);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    if (input.period.end !== lastDay.toISOString().slice(0, 10)) continue;
    const month = input.period.start.slice(0, 7);
    for (const platform of input.platforms) {
      // An undated recent Apple list remains undated even if fetched with a month selector.
      if (!providers.has(platform.id) || !samePeriod(platform.rankingPeriod, input.period)) continue;
      for (const track of platform.tracks) {
        if (typeof track.id !== "string" || !track.id.trim()) continue;
        const key = `${platform.id}:${track.id}`;
        const previous = history.get(key);
        history.set(key, {
          firstSeenMonth: previous && previous.firstSeenMonth < month ? previous.firstSeenMonth : month,
          lastSeenMonth: previous && previous.lastSeenMonth > month ? previous.lastSeenMonth : month,
        });
      }
    }
  }
  return history;
}

function sourceKeys(track: RankedTrack, history: ReadonlyMap<string, TrackHistoryBounds>): string[] {
  const keys = new Set<string>();
  const platforms = new Set(track.platforms);
  for (const platform of platforms) {
    const direct = `${platform}:${track.id}`;
    if (history.has(direct)) keys.add(direct);
    // buildReport's comparable list prefixes raw provider IDs; do not double-prefix them.
    else if (track.id.startsWith(`${platform}:`) && history.has(track.id)) keys.add(track.id);
  }
  // This existing discovery-view ID explicitly records each matched source's opaque ID.
  // It adds observation bounds for the displayed group, never sums plays or invents an identity.
  if (!keys.size && track.id.startsWith("overlap:")) {
    for (const part of track.id.slice("overlap:".length).split("|")) {
      const platform = part.slice(0, part.indexOf(":")) as PlatformId;
      if (platforms.has(platform) && history.has(part)) keys.add(part);
    }
  }
  return [...keys];
}

/** Decorate copies using source-ID evidence only; counts and all other song fields stay unchanged. */
export function withTrackHistory(tracks: readonly RankedTrack[], history: ReadonlyMap<string, TrackHistoryBounds>): RankedTrack[] {
  return tracks.map(track => {
    const observations = sourceKeys(track, history).map(key => history.get(key)!);
    if (!observations.length) return { ...track };
    return {
      ...track,
      firstSeenMonth: observations.reduce((first, item) => item.firstSeenMonth < first ? item.firstSeenMonth : first, observations[0].firstSeenMonth),
      lastSeenMonth: observations.reduce((last, item) => item.lastSeenMonth > last ? item.lastSeenMonth : last, observations[0].lastSeenMonth),
    };
  });
}
