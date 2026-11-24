import { useId, useMemo, useState, type CSSProperties } from "react";
import { calculateGenres, type GenreSlice, type Locale, type RankedTrack } from "../lib/report";
import { stableGenreColor } from "../lib/unified-tracks";
import { calculateGenreListeningTimes, resolveTrackListeningTime, type GenreListeningTime } from "../lib/listening-time";
import { TimePerspective, listeningHours } from "./TimePerspective";
import "./charts.css";

export interface DonutSegment {
  key: string;
  label: string;
  percentage: number;
  color: string;
}

function segmentHitPath(start: number, percentage: number): string {
  const point = (percent: number) => {
    const angle = percent * Math.PI / 50 - Math.PI / 2;
    return `${(120 + Math.cos(angle) * 91).toFixed(3)} ${(120 + Math.sin(angle) * 91).toFixed(3)}`;
  };
  if (percentage >= 99.999) return `M ${point(start)} A 91 91 0 1 1 ${point(start + 50)} A 91 91 0 1 1 ${point(start + 100)}`;
  return `M ${point(start)} A 91 91 0 ${percentage > 50 ? 1 : 0} 1 ${point(start + percentage)}`;
}

/** Shared SVG artwork; interactive controls remain ordinary keyboard-accessible buttons. */
export function ChartRing({ segments, selected, value, label, detail, title, description, onSelect, onPreview }: {
  segments: DonutSegment[];
  selected: string | null;
  value: string;
  label: string;
  detail: string;
  title: string;
  description: string;
  onSelect?: (key: string) => void;
  onPreview?: (key: string | null) => void;
}) {
  const id = useId();
  let offset = 0;
  return (
    <div className="zm-donut-plot">
      <svg className="zm-donut-svg" viewBox="0 0 240 240" role={onSelect ? "group" : "img"} aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-description`}>{description}</desc>
        <g aria-hidden="true">
          <circle className="zm-donut-outer-guide" cx="120" cy="120" r="113" />
          <circle className="zm-donut-track" cx="120" cy="120" r="91" />
          <circle className="zm-donut-groove" cx="120" cy="120" r="69" />
          <circle className="zm-donut-groove" cx="120" cy="120" r="65" />
        </g>
        {segments.map((segment) => {
            const percentage = Math.max(0, Math.min(segment.percentage, 100 - offset));
            const angle = (offset + percentage / 2) * Math.PI / 50 - Math.PI / 2;
            const start = offset;
            offset += percentage;
            const active = selected === segment.key;
            const gap = segments.length > 1 ? Math.min(0.85, percentage / 4) : 0;
            return (
              <g key={segment.key} className={onSelect ? "zm-donut-interactive" : undefined}
                role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined}
                aria-label={onSelect ? `${segment.label}, ${segment.percentage.toFixed(1)}%` : undefined}
                aria-hidden={onSelect ? undefined : true}
                onMouseEnter={onPreview ? () => onPreview(segment.key) : undefined}
                onMouseLeave={onPreview ? () => onPreview(null) : undefined}
                onFocus={onPreview ? () => onPreview(segment.key) : undefined}
                onBlur={onPreview ? () => onPreview(null) : undefined}
                onClick={onSelect ? () => onSelect(segment.key) : undefined}
                onKeyDown={onSelect ? (event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(segment.key); }
                  if (event.key === "Escape") { onPreview?.(null); event.currentTarget.blur(); }
                } : undefined}>
                <g className={`zm-donut-segment${active ? " is-selected" : ""}${selected && !active ? " is-muted" : ""}`}
                  style={{ "--segment-x": `${Math.cos(angle) * 4}px`, "--segment-y": `${Math.sin(angle) * 4}px` } as CSSProperties}>
                  <circle cx="120" cy="120" r="91" fill="none" pathLength="100" stroke={segment.color}
                    strokeWidth={active ? 31 : 27} strokeDasharray={`${Math.max(0, percentage - gap)} ${100 - percentage + gap}`}
                    strokeDashoffset={-start - gap / 2} transform="rotate(-90 120 120)" />
                </g>
                {onSelect ? <path className="zm-donut-hit-area" d={segmentHitPath(start, percentage)} fill="none" stroke="transparent" strokeWidth="40" /> : null}
              </g>
            );
          })}
        <circle className="zm-donut-spindle" cx="120" cy="177" r="2" aria-hidden="true" />
      </svg>
      <div className={`zm-donut-center${onSelect && selected ? " is-detail" : ""}`} aria-hidden="true">
        <span className="zm-donut-center-label">{label}</span>
        <strong>{value}</strong>
        <span className="zm-donut-center-detail">{detail}</span>
      </div>
    </div>
  );
}

export interface GenreDonutProps {
  genres: GenreSlice[];
  language: Locale;
  known: number;
  total: number;
  tracks?: RankedTrack[];
  timeTracks?: RankedTrack[];
  /** Taste-page detail card. Overview stays compact by default. */
  showTrackDetails?: boolean;
}

const EMPTY_TRACKS: RankedTrack[] = [];

function finiteDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function songLength(seconds: number): string {
  const value = Math.round(seconds);
  const minutes = Math.floor(value / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}` : `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

function listeningTime(seconds: number, zh: boolean): string {
  const value = Math.round(seconds);
  if (value >= 3600) return zh ? `${Math.floor(value / 3600)} 小时 ${Math.floor(value % 3600 / 60)} 分` : `${Math.floor(value / 3600)} h ${Math.floor(value % 3600 / 60)} min`;
  if (value >= 60) return zh ? `${Math.floor(value / 60)} 分 ${value % 60} 秒` : `${Math.floor(value / 60)} min ${value % 60} sec`;
  return zh ? `${value} 秒` : `${value} sec`;
}

function GenreTrackArtwork({ track, color }: { track: RankedTrack; color: string }) {
  const [failedUrl, setFailedUrl] = useState("");
  return <span className="zm-genre-track-art" style={{ "--genre-ink": color } as CSSProperties} aria-hidden="true">
    <span className="zm-genre-track-record" />
    {track.artworkUrl && track.artworkUrl !== failedUrl ? <img src={track.artworkUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(track.artworkUrl ?? "")} /> : null}
  </span>;
}

function GenreTracksCard({ genre, tracks, time, language }: { genre: DonutSegment; tracks: RankedTrack[]; time?: GenreListeningTime; language: Locale }) {
  const zh = language === "zh";
  const id = useId();
  return <aside className="zm-genre-tracks-card slide-scroll-area" style={{ "--genre-ink": genre.color } as CSSProperties} aria-labelledby={id} tabIndex={0}>
    <div className="zm-genre-tracks-eyebrow"><span>{zh ? "这一曲风的常听前三" : "YOUR TOP THREE IN THIS GENRE"}</span><span aria-hidden="true">↗</span></div>
    <div className="zm-genre-tracks-title"><h3 id={id}>{genre.label}</h3><span>{genre.percentage.toFixed(1)}<small>%</small></span></div>
    {time && <div className="genre-time-total"><TimePerspective key={genre.key} time={time} seed={`genre:${genre.key}`} language={language} title={zh ? "这一曲风的收听时长" : "Time in this genre"}/></div>}
    <ol className="zm-genre-track-list">
      {tracks.map((track, index) => {
        const time = resolveTrackListeningTime(track);
        const count = finiteDuration(track.count) ? track.count : null;
        const countsBySource = Object.entries(track.sourceCounts).filter((entry): entry is [string, number] => finiteDuration(entry[1]));
        const sourceNames: Record<string, string> = { netease: zh ? "网易云" : "NetEase", qq: "QQ", apple: "Apple Music" };
        const countLabel = count !== null
          ? `${track.countIsPartial ? "≥ " : ""}${count.toLocaleString(zh ? "zh-CN" : "en")} ${zh ? "次播放" : "plays"}`
          : countsBySource.length ? countsBySource.map(([source, value]) => `${sourceNames[source] ?? source} ${track.countIsPartial ? "≥ " : ""}${value.toLocaleString(zh ? "zh-CN" : "en")}`).join(" · ") + (zh ? " 次" : " plays")
            : zh ? "播放次数未提供" : "Play count unavailable";
        return <li key={`${track.platforms.join(",")}:${track.id}`} className="zm-genre-track-row">
          <span className="zm-genre-track-rank" aria-label={zh ? `第 ${index + 1} 首` : `Number ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
          <GenreTrackArtwork track={track} color={genre.color} />
          <div className="zm-genre-track-copy">
            <strong title={track.title}>{track.title}</strong>
            <span className="zm-genre-track-artist" title={track.artist}>{track.artist}</span>
            <div className="zm-genre-track-metadata">
              <span className="zm-genre-track-count">{countLabel}</span>
              {finiteDuration(track.listenSeconds) ? <span className="zm-genre-track-timing">{zh ? "实际收听 " : "Actually listened · "}{listeningTime(track.listenSeconds, zh)}</span> : null}
              {time.kind === "estimated" && time.seconds !== null ? <span className="zm-genre-track-timing" title={time.notice[language]}>{zh ? "估算收听 " : "Estimated listening · "}≈ {listeningHours(time.seconds, language)}</span> : null}
              {finiteDuration(track.durationSeconds) && track.durationSeconds > 0 ? <span className="zm-genre-track-timing">{zh ? "歌长 " : "Track length · "}{songLength(track.durationSeconds)}</span> : null}
            </div>
          </div>
        </li>;
      })}
    </ol>
    {!tracks.length ? <p className="zm-genre-track-empty">{zh ? "这一曲风的歌曲明细尚未返回。" : "Track details for this genre have not arrived yet."}</p> : null}
    <p className="zm-genre-tracks-note">{zh ? "按已获取播放次数排序，保留来源口径。悬停或点选其他曲风可切换。" : "Ordered by available play counts, retaining source definitions. Hover or select another genre to explore."}</p>
  </aside>;
}

export function GenreDonut({ genres, language, known, total, tracks = EMPTY_TRACKS, timeTracks = tracks, showTrackDetails = false }: GenreDonutProps) {
  const zh = language === "zh";
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [lastExplored, setLastExplored] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const legendId = useId();
  const genreTimes = useMemo(() => new Map(calculateGenreListeningTimes(timeTracks).map(time => [time.name.toLowerCase(), time])), [timeTracks]);
  const valid = genres.filter((genre) => !["unknown", "未识别"].includes(genre.name.trim().toLowerCase()) && Number.isFinite(genre.percentage) && genre.percentage > 0);
  const segments = valid.map((genre) => ({ key: genre.name, label: zh ? genre.nameZh : genre.nameEn ?? genre.name, percentage: genre.percentage, color: stableGenreColor(genre.name) })).sort((a, b) => b.percentage - a.percentage);
  const active = segments.some((segment) => segment.key === preview) ? preview : segments.some((segment) => segment.key === selected) ? selected
    : showTrackDetails ? segments.some((segment) => segment.key === lastExplored) ? lastExplored : segments[0]?.key ?? null : null;
  const activeSegment = segments.find((segment) => segment.key === active);
  const visibleSegments = expanded ? segments : segments.slice(0, 5);
  const topTwo = segments.slice(0, 2);
  const topShare = topTwo.reduce((sum, segment) => sum + segment.percentage, 0);
  const toggleSelection = (key: string) => setSelected((current) => current === key ? null : key);
  const previewGenre = (key: string | null) => {
    setPreview(key);
    if (showTrackDetails && key) setLastExplored(key);
  };
  const genreTracks = useMemo(() => {
    const grouped = new Map<string, RankedTrack[]>();
    if (!showTrackDetails) return grouped;
    const seen = new Set<string>();
    const sorted = [...tracks].sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || a.rank - b.rank);
    for (const track of sorted) {
      const identity = track.canonicalId?.trim() ? `recording:${track.canonicalId.trim()}` : `${[...track.platforms].sort().join(",")}:${track.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      for (const genre of calculateGenres([{ count: 1, genres: track.genres }])) {
        const key = genre.name.toLowerCase();
        const list = grouped.get(key) ?? [];
        if (list.length < 3) list.push(track);
        grouped.set(key, list);
      }
    }
    return grouped;
  }, [tracks, showTrackDetails]);
  const knownCount = Math.max(0, Math.min(Math.floor(known || 0), Math.floor(total || 0)));
  const totalCount = Math.max(0, Math.floor(total || 0));
  const hasData = knownCount > 0 && segments.length > 0;
  const coverage = totalCount ? Math.round(knownCount / totalCount * 100) : 0;
  const title = zh ? "曲风分布" : "Your genre mix";
  const description = hasData
    ? `${zh ? `已识别 ${knownCount} / ${totalCount} 首歌曲。仅已识别歌曲参与占比。` : `Genres identified for ${knownCount} of ${totalCount} songs. Shares cover identified songs only.`} ${segments.map((segment) => `${segment.label} ${segment.percentage.toFixed(1)}%`).join("; ")}`
    : zh ? "暂未取得可核实曲风，不显示比例。" : "Verified genre tags are not available yet; no shares are shown.";
  const explanation = <>
    {hasData ? <p className="zm-donut-pattern">{zh
      ? `${topTwo.map((segment) => segment.label).join("与")}${topTwo.length > 1 ? "合计" : ""}占已识别曲风的 ${topShare.toFixed(1)}%，${topShare >= 50 ? "构成这份歌单的主要底色。" : "其余曲风共同丰富了这份歌单。"}`
      : `${topTwo.map((segment) => segment.label).join(" and ")} ${topTwo.length > 1 ? "together account" : "accounts"} for ${topShare.toFixed(1)}% of the identified genre mix${topShare >= 50 ? ", shaping its main character." : ", alongside a varied mix of other genres."}`}</p> : null}
    <p className="zm-donut-footnote">{hasData
      ? zh ? `曲风识别覆盖 ${coverage}%。每首歌曲权重相同，多曲风均分；尚未识别的歌曲不计入图中。` : `${coverage}% of songs have known genres. Each song has equal weight, shared across its genres; unclassified songs are excluded.`
      : zh ? "曲风缺失不会被记成一种音乐风格。" : "Missing tags are not treated as a music genre."}</p>
    {showTrackDetails && hasData && <p className="zm-donut-footnote">{zh ? "小时数仅统计所选月份里播放超过 10 次的已取得榜单样本；多曲风均分时长。≈ 表示按次数 × 歌长估算，未扣除跳过的部分。饼图仍按歌曲数量占比。" : "Hours cover retrieved ranking samples with more than 10 plays in the selected months; time is shared across genre tags. ≈ estimates plays × track length without subtracting skips. The ring still shows song-count shares."}</p>}
  </>;
  return (
    <div className={`zm-donut-card zm-genre-donut${showTrackDetails && hasData ? " has-track-details" : ""}${hasData ? "" : " is-empty"}`} lang={zh ? "zh-CN" : "en"}>
      <div className="zm-donut-heading">
        <span>{zh ? "常听歌曲的曲风 · 播放 > 10 次" : "Genre mix · more than 10 plays"}</span>
        <span className="zm-donut-coverage">{knownCount} / {totalCount}<span className="zm-donut-sr-only">{zh ? " 首已识别" : " identified songs"}</span></span>
      </div>
      <div className="zm-donut-layout">
        <ChartRing segments={hasData ? segments : []} selected={active}
          value={hasData ? activeSegment ? `${activeSegment.percentage.toFixed(1)}%` : knownCount.toLocaleString(zh ? "zh-CN" : "en") : "—"}
          label={activeSegment?.label ?? (zh ? "曲风样本" : "GENRE SAMPLE")}
          detail={hasData ? activeSegment ? zh ? "已识别曲风中占比" : "of known genre weight" : zh ? "首已识别歌曲" : "identified songs" : zh ? "等待曲风资料" : "awaiting genre tags"}
          title={title} description={description} onSelect={hasData ? toggleSelection : undefined} onPreview={hasData ? previewGenre : undefined} />
        {hasData ? (
          <div className={`zm-donut-legend slide-scroll-area${expanded ? " is-expanded" : ""}`} id={legendId} role="group" aria-label={zh ? "选择曲风以突出显示" : "Select a genre to highlight"}>
            {visibleSegments.map((segment) => (
              <button key={segment.key} type="button" className={`zm-donut-legend-button${active === segment.key ? " is-selected" : ""}`}
                aria-pressed={selected === segment.key} onClick={() => toggleSelection(segment.key)}
                onMouseEnter={() => previewGenre(segment.key)} onMouseLeave={() => previewGenre(null)}
                onFocus={() => previewGenre(segment.key)} onBlur={() => previewGenre(null)}>
                <span className="zm-donut-swatch" style={{ "--swatch": segment.color } as CSSProperties} aria-hidden="true" />
                <span className="zm-donut-legend-name">{segment.label}</span>
                <span className="zm-donut-legend-value">{segment.percentage.toFixed(1)}<small>%</small>{showTrackDetails && genreTimes.get(segment.key.toLowerCase())?.seconds != null && <span className="zm-genre-hour-label">{genreTimes.get(segment.key.toLowerCase())?.kind === "estimated" ? "≈ " : ""}{listeningHours(genreTimes.get(segment.key.toLowerCase())!.seconds!,language)}</span>}</span>
              </button>
            ))}
            {segments.length > 5 ? <button className="zm-donut-expand" type="button" aria-expanded={expanded} aria-controls={legendId}
              onClick={() => setExpanded((current) => !current)}>{expanded ? zh ? "收起曲风" : "Show fewer genres" : zh ? "查看全部曲风" : "View all genres"}<span aria-hidden="true">{expanded ? "−" : "+"}</span></button> : null}
            <span className="zm-donut-selection" aria-live="polite">{activeSegment ? `${activeSegment.label} · ${activeSegment.percentage.toFixed(1)}%` : zh ? "悬停或轻点圆环，探索全部曲风" : "Hover or tap the ring to explore every genre"}</span>
          </div>
        ) : (
          <div className="zm-donut-empty-copy">
            <strong>{zh ? "让偏爱慢慢浮现。" : "Your taste, taking shape."}</strong>
            <p>{totalCount
              ? zh ? `已读取 ${totalCount} 首歌曲，曲风资料尚未齐备。取得可核实标签后，这里会显示分布。` : `${totalCount} songs have been read. Their genre tags are not available yet; the mix appears as verified tags arrive.`
              : zh ? "所选月份中，暂没有已读取播放次数超过 10 次的歌曲。切换月份后再看看。" : "No retrieved song has more than 10 plays in this selection yet. Try another month."}</p>
          </div>
        )}
        {showTrackDetails && hasData && activeSegment ? <GenreTracksCard genre={activeSegment} tracks={genreTracks.get(activeSegment.key.toLowerCase()) ?? EMPTY_TRACKS} time={genreTimes.get(activeSegment.key.toLowerCase())} language={language} /> : null}
      </div>
      <div className="genre-chart-static-notes">{explanation}</div>
      {showTrackDetails && hasData && <details className="genre-chart-method">
        <summary>{zh ? "图表口径与说明" : "About this chart and its estimates"}</summary>
        <div className="genre-chart-method-content slide-scroll-area" tabIndex={0}>{explanation}</div>
      </details>}
    </div>
  );
}
