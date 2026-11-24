import type { MusicReport, PlatformId, RankedTrack } from "./report.ts";

interface Entry {
  track: RankedTrack;
  platform: PlatformId;
  title: string;
  core: string;
  artists: string[];
  index: number;
  rank: number;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

/** Edition labels can differ in this discovery view; they never establish a recording ID. */
function titleCore(value: string): string {
  return normalized(value.normalize("NFKC")
    .replace(/\([^)]*(?:live|remaster|version|remix|acoustic|instrumental|现场|伴奏|版本|重制|录音室)[^)]*\)/gi, "")
    .replace(/\s*[-–—:]?\s+(?:live|acoustic|instrumental|remastered(?:\s+\d{4})?|radio\s+edit|album\s+version)\s*$/i, ""));
}

function artistNames(value: string): string[] {
  const clean = value.normalize("NFKC");
  return [...new Set([clean, clean.replace(/\([^)]*\)/g, ""), ...clean.split(/[,;/、&]|\b(?:feat\.?|ft\.?|featuring|with|and)\b/gi)].map(normalized).filter(Boolean))];
}

/** Bounded optimal-string-alignment distance also handles adjacent typing swaps. */
function closeSpelling(left: string, right: string, minimum: number): number {
  const a = Array.from(left), b = Array.from(right);
  const length = Math.max(a.length, b.length);
  if (length > 180 || Math.min(a.length, b.length) < minimum) return 0;
  const limit = Math.floor(length * 0.18);
  if (Math.abs(a.length - b.length) > limit) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= a.length; i++) {
    const current = Array(b.length + 1).fill(limit + 1) as number[];
    current[0] = i;
    let rowMinimum = limit + 1;
    for (let j = Math.max(1, i - limit); j <= Math.min(b.length, i + limit); j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
      rowMinimum = Math.min(rowMinimum, current[j]);
    }
    if (rowMinimum > limit) return 0;
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length] <= limit ? 1 - previous[b.length] / length : 0;
}

function artistSimilarity(left: Entry, right: Entry): number {
  let best = 0;
  for (const a of left.artists) for (const b of right.artists) {
    if (a === b) return 1;
    const shorter = a.length <= b.length ? a : b, longer = a.length > b.length ? a : b;
    if (shorter.length >= 4 && longer.includes(shorter) && shorter.length / longer.length >= 0.5) best = Math.max(best, 0.92);
    else best = Math.max(best, closeSpelling(a, b, 5));
  }
  return best;
}

function matchScore(left: Entry, right: Entry, artistScores: Map<string, number>): number {
  if (left.platform === right.platform) return 0;
  const canonical = left.track.canonicalId?.trim();
  if (canonical && canonical === right.track.canonicalId?.trim()) return 400;
  const artistPair = [left.artists.join("\0"), right.artists.join("\0")].sort().join("\u0001");
  if (!artistScores.has(artistPair)) artistScores.set(artistPair, artistSimilarity(left, right));
  const artists = artistScores.get(artistPair)!;
  // Same-title matches are explicitly allowed here, including different credited artists.
  if (left.title === right.title) return 300 + artists * 10;
  if (artists < 0.82) return 0;
  if (left.core.length >= 2 && left.core === right.core) return 200 + artists * 10;
  const titleSimilarity = closeSpelling(left.core, right.core, 6);
  return titleSimilarity >= 0.82 ? 100 + titleSimilarity * 10 + artists : 0;
}

function grams(value: string): string[] {
  const chars = Array.from(value);
  const keys = chars.slice(0, -2).map((_, index) => chars.slice(index, index + 3).join(""));
  // A middle transposition can erase every trigram in a six-letter title.
  if (chars.length <= 8) keys.push(...chars.slice(0, -1).map((_, index) => chars.slice(index, index + 2).join("")));
  return [...new Set(keys)];
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Loose, cross-platform discovery for the shared-favourites panel only.
 * Does not change monthly rankings, verify recording identities, or add source play counts.
 */
export function crossPlatformMatches(report: MusicReport): RankedTrack[] {
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const source of report.platforms) {
    // Undated Apple recent history must not become a monthly shared favourite.
    if (!source.rankingMatchesPeriod || source.rankingCoverage === "undated") continue;
    for (const track of source.tracks) {
      const title = normalized(track.title);
      const identity = `${source.id}:${track.id}`;
      if (!track.id || !title || seen.has(identity)) continue;
      seen.add(identity);
      entries.push({ track, platform: source.id, title, core: titleCore(track.title), artists: artistNames(track.artist), index: entries.length, rank: track.rank > 0 ? track.rank : entries.length + 1 });
    }
  }
  if (new Set(entries.map((entry) => entry.platform)).size < 2) return [];

  const scores = new Map<string, number>();
  const artistScores = new Map<string, number>();
  const edges: { a: number; b: number; score: number }[] = [];
  const scoreFor = (a: number, b: number) => {
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (!scores.has(key)) scores.set(key, matchScore(entries[a], entries[b], artistScores));
    return scores.get(key)!;
  };
  // Inverted indexes keep fuzzy matching away from an all-pairs pass on large histories.
  const titles = new Map<string, number[]>(), cores = new Map<string, number[]>(), canonical = new Map<string, number[]>(), titleGrams = new Map<string, number[]>();
  const append = (index: Map<string, number[]>, key: string, value: number) => {
    if (!key) return;
    const values = index.get(key) ?? [];
    values.push(value);
    index.set(key, values);
  };
  for (const entry of entries) {
    const candidates = new Set<number>([...(titles.get(entry.title) ?? []), ...(cores.get(entry.core) ?? []), ...(canonical.get(entry.track.canonicalId?.trim() ?? "") ?? [])]);
    for (const candidate of candidates) {
      if (entries[candidate].platform === entry.platform) continue;
      const score = scoreFor(candidate, entry.index);
      if (score) edges.push({ a: candidate, b: entry.index, score });
    }
    append(titles, entry.title, entry.index);
    append(cores, entry.core, entry.index);
    append(canonical, entry.track.canonicalId?.trim() ?? "", entry.index);
    if (entry.core.length >= 6) grams(entry.core).forEach((key) => append(titleGrams, key, entry.index));
  }
  const parents = entries.map((entry) => entry.index);
  const members = entries.map((entry) => [entry.index]);
  const platformBits: Record<PlatformId, number> = { netease: 1, qq: 2, apple: 4 };
  const masks = entries.map((entry) => platformBits[entry.platform]);
  const allPlatforms = masks.reduce((mask, value) => mask | value, 0);
  const find = (index: number): number => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  };
  const mergeEdges = (matches: typeof edges) => {
    matches.sort((a, b) => b.score - a.score || Math.min(entries[a.a].rank, entries[a.b].rank) - Math.min(entries[b.a].rank, entries[b.b].rank) || a.a - b.a || a.b - b.b);
    for (const edge of matches) {
      const a = find(edge.a), b = find(edge.b);
      if (a === b || (masks[a] & masks[b])) continue;
      // Every source must match every other source: no A≈B≈C chaining into unrelated songs.
      if (!members[a].every((left) => members[b].every((right) => scoreFor(left, right) > 0))) continue;
      parents[b] = a;
      members[a].push(...members[b]);
      members[b] = [];
      masks[a] |= masks[b];
    }
  };
  // Resolve stronger identities first. Fully matched groups need no fuzzy work.
  mergeEdges(edges);
  const fuzzyEdges: typeof edges = [];
  for (const entry of entries) {
    const root = find(entry.index);
    if (entry.core.length < 6 || masks[root] === allPlatforms) continue;
    const candidates = new Set<number>();
    grams(entry.core).forEach((key) => (titleGrams.get(key) ?? []).forEach((candidate) => {
      if (candidate < entry.index && !(masks[root] & masks[find(candidate)])) candidates.add(candidate);
    }));
    for (const candidate of candidates) {
      const score = scoreFor(candidate, entry.index);
      if (score) fuzzyEdges.push({ a: candidate, b: entry.index, score });
    }
  }
  mergeEdges(fuzzyEdges);

  const groups = members.filter((group) => group.length > 1).map((group) => group.map((index) => entries[index]).sort((a, b) => a.rank - b.rank || a.index - b.index));
  groups.sort((a, b) => b.length - a.length || a[0].rank - b[0].rank || a[0].index - b[0].index);
  return groups.map((group, rank) => {
    const first = group[0].track;
    const result: RankedTrack = {
      ...first,
      id: `overlap:${group.map((entry) => `${entry.platform}:${entry.track.id}`).sort().join("|")}`,
      rank: rank + 1,
      count: null,
      platforms: group.map((entry) => entry.platform),
      sourceCounts: {},
      genres: [...new Set(group.flatMap((entry) => entry.track.genres).map((genre) => genre.trim()).filter(Boolean))],
      countIsPartial: group.some((entry) => entry.track.countIsPartial),
    };
    // Loose titles can group different versions. Keep each source's observations separate.
    delete result.listenSeconds;
    const recording = first.canonicalId?.trim();
    if (!recording || !group.every((entry) => entry.track.canonicalId?.trim() === recording)) delete result.canonicalId;
    const artwork = group.find((entry) => entry.track.artworkUrl?.trim());
    if (artwork) result.artworkUrl = artwork.track.artworkUrl;
    const length = group.find((entry) => validCount(entry.track.durationSeconds) && entry.track.durationSeconds > 0);
    if (length) result.durationSeconds = length.track.durationSeconds;
    for (const entry of group) {
      const count = Object.hasOwn(entry.track.sourceCounts, entry.platform) ? entry.track.sourceCounts[entry.platform] : entry.track.count;
      result.sourceCounts[entry.platform] = validCount(count) ? count : null;
    }
    return result;
  });
}
