import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { calculateGenres, type Locale, type RankedTrack } from "../lib/report";
import { PlatformIcon } from "./PlatformIcon";
import { TimePerspective, listeningHours } from "./TimePerspective";
import { resolveTrackListeningTime } from "../lib/listening-time";
import "./track-details.css";

export interface TrackDetailsProps { track: RankedTrack; language: Locale }
type TrackWithMonths = RankedTrack & { firstSeenMonth?: string; lastSeenMonth?: string };
interface Position { left: number; top: number; diameter: number; originX: number; originY: number; revealRadius: number }

function knownNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function trackLength(seconds: number): string {
  const wholeSeconds = Math.floor(seconds), minutes = Math.floor(wholeSeconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(wholeSeconds % 60).padStart(2, "0")}` : `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function monthLabel(value: string | undefined, language: Locale): string | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { year: "numeric", month: language === "zh" ? "long" : "short", timeZone: "UTC" }).format(new Date(`${value}-15T12:00:00Z`));
}

function VinylIcon({ expanded = false }: { expanded?: boolean }) {
  return <svg viewBox={expanded ? "4 4 26 26" : "0 0 34 34"} fill="none" aria-hidden="true">
    <circle className="track-details-disc" cx="17" cy="17" r="12.5" />
    <circle className="track-details-groove" cx="17" cy="17" r="9.5" />
    <circle className="track-details-groove" cx="17" cy="17" r="6.5" />
    <circle className="track-details-label" cx="17" cy="17" r="4.5" />
    <path className="track-details-z" transform="translate(17 17) scale(.1667)" d="M-14-18h28v4l-23 27h18v-5h5v10h-29v-4l23-27h-17v5h-5Z" />
    <circle className="track-details-orbit" cx="17" cy="17" r="15.5" pathLength="100" transform="rotate(-90 17 17)" />
  </svg>;
}

/** A non-modal detail panel, anchored outside the table so row overflow cannot clip it. */
export function TrackDetails({ track, language }: TrackDetailsProps) {
  const zh = language === "zh";
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ignoreNextFocus = useRef(false);
  const pointerActivation = useRef(false);
  const [open, setOpen] = useState(false);
  const [timeFace, setTimeFace] = useState(false);
  const [arming, setArming] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [failedArtwork, setFailedArtwork] = useState("");
  const [hoverCapable, setHoverCapable] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(min-width: 601px) and (hover: hover) and (pointer: fine)").matches);
  const instruction = hoverCapable ? zh ? "悬停查看详情" : "Hover for details" : zh ? "点击查看详情" : "Tap for details";
  const sourceNames = { netease: zh ? "网易云音乐" : "NetEase Music", qq: zh ? "QQ 音乐" : "QQ Music", apple: "Apple Music" };
  const monthTrack = track as TrackWithMonths;
  const genres = calculateGenres([{ count: 1, genres: track.genres }]).filter(genre => genre.name !== "Unknown").map(genre => zh ? genre.nameZh : genre.nameEn ?? genre.name);
  const count = knownNumber(track.count) ? `${track.countIsPartial ? "≥ " : ""}${track.count.toLocaleString(zh ? "zh-CN" : "en")}` : null;
  const time = resolveTrackListeningTime(track);

  const clearTimers = () => { clearTimeout(opening.current); clearTimeout(closing.current); };
  const show = () => {
    clearTimers(); setArming(false);
    if (!open) { setPosition(null); setOpen(true); }
  };
  const hide = (returnFocus = false) => {
    clearTimers(); setArming(false); setOpen(false); setTimeFace(false);
    if (returnFocus && trigger.current && document.activeElement !== trigger.current) {
      ignoreNextFocus.current = true;
      trigger.current.focus({ preventScroll: true });
    }
  };
  const beginHover = () => {
    clearTimers();
    if (open) return;
    setArming(true);
    // The intent delay also applies with reduced motion; it prevents accidental opens.
    opening.current = setTimeout(() => { setPosition(null); setOpen(true); setArming(false); }, 600);
  };
  const endHover = () => {
    clearTimeout(opening.current); setArming(false);
    clearTimeout(closing.current);
    const focused = document.activeElement;
    if (focused && (trigger.current?.contains(focused) || panel.current?.contains(focused))) return;
    closing.current = setTimeout(() => setOpen(false), 190);
  };
  const leaveFocus = (next: EventTarget | null) => {
    if (next instanceof Node && (trigger.current?.contains(next) || panel.current?.contains(next))) return;
    endHover();
  };

  useEffect(() => () => { clearTimeout(opening.current); clearTimeout(closing.current); }, []);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(min-width: 601px) and (hover: hover) and (pointer: fine)");
    const changed = () => setHoverCapable(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) hide();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); hide(true); }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", keyboard); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const originX = viewport?.offsetLeft ?? 0, originY = viewport?.offsetTop ?? 0;
      if (anchor.bottom < originY || anchor.top > originY + height || anchor.right < originX || anchor.left > originX + width) { setOpen(false); return; }
      const diameter = Math.max(80, Math.min(300, width - 24, height - 64));
      const anchorX = anchor.left + anchor.width / 2, anchorY = anchor.top + anchor.height / 2;
      const left = Math.max(originX + 12, Math.min(anchorX - diameter / 2, originX + width - diameter - 12));
      const top = Math.max(originY + 52, Math.min(anchorY - diameter / 2, originY + height - diameter - 12));
      const localX = anchorX - left, localY = anchorY - top;
      const next: Position = { left, top, diameter, originX: localX, originY: localY,
        revealRadius: Math.ceil(diameter / 2 + Math.hypot(localX - diameter / 2, localY - diameter / 2)) };
      setPosition(current => current && Object.keys(next).every((key) => current[key as keyof Position] === next[key as keyof Position]) ? current : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (panel.current) observer?.observe(panel.current);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [open]);

  const definition = zh ? "最早与最近上榜，仅指已取得月榜中的出现月份，不代表首次或最后一次播放。各平台次数保留原统计口径。" : "Earliest and latest mean appearances in retrieved monthly rankings, not your first or last play. Source counts retain their original definitions.";
  const style = { left: position?.left ?? 0, top: position?.top ?? 0, width: position?.diameter ?? 300, height: position?.diameter ?? 300,
    "--radial-scale": (position?.diameter ?? 300) / 300,
    "--radial-origin-x": `${position?.originX ?? 150}px`, "--radial-origin-y": `${position?.originY ?? 150}px`,
    "--radial-reveal-radius": `${position?.revealRadius ?? 150}px`, visibility: position ? "visible" : "hidden" } as CSSProperties;
  return <span className="track-details">
    <button ref={trigger} type="button" className={`track-details-trigger${arming || open ? " is-active" : ""}`} title={instruction}
      aria-label={`${instruction} · ${track.title}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") beginHover(); }}
      onPointerLeave={(event) => { if (event.pointerType !== "touch") endHover(); }}
      onPointerDown={() => { pointerActivation.current = true; }}
      onPointerCancel={() => { pointerActivation.current = false; }}
      onFocus={() => {
        if (pointerActivation.current) { pointerActivation.current = false; return; }
        if (ignoreNextFocus.current) { ignoreNextFocus.current = false; return; }
        show();
      }}
      onBlur={(event) => leaveFocus(event.relatedTarget)}
      onClick={() => { pointerActivation.current = false; open ? hide() : show(); }}
      onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); show(); requestAnimationFrame(() => panel.current?.focus()); } }}>
      <VinylIcon />
    </button>
    {open && typeof document !== "undefined" ? createPortal(
      <div ref={panel} id={id} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} aria-describedby={`${id}-definition`} tabIndex={-1}
        className={`track-details-popover${position ? " is-positioned" : ""}`} lang={zh ? "zh-CN" : "en"} style={style}
        onPointerEnter={(event) => { if (event.pointerType !== "touch") clearTimeout(closing.current); }}
        onPointerLeave={(event) => { if (event.pointerType !== "touch") endHover(); }}
        onFocus={() => clearTimeout(closing.current)} onBlur={(event) => leaveFocus(event.relatedTarget)}>
        <button type="button" className="track-details-close" aria-label={zh ? "关闭歌曲详情" : "Close track details"} onClick={() => hide(true)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
        <div className="track-details-surface">
        <div className="track-details-platter" aria-hidden="true" />
        <div className="track-details-radial-stage">
          {timeFace ? <div className="track-details-time-face">
            <h3 id={`${id}-title`} className="track-details-sr-only">{track.title}</h3>
            <span id={`${id}-definition`} className="track-details-sr-only">{time.notice[language]}</span>
            <button className="track-details-time-back" onClick={()=>setTimeFace(false)}>{zh ? "← 返回唱片详情" : "← Back to the record"}</button>
            <TimePerspective compact time={time} seed={`track:${track.platforms.join(":")}:${track.id}`} language={language} title={zh ? "这一首，陪你的时间" : "Time with this song"}/>
          </div> : <>
          <div className="track-details-center radial-reveal" title={[track.title, track.artist, track.album].filter(Boolean).join(" · ")}>
            <div className="track-details-art" aria-hidden="true"><VinylIcon expanded />{track.artworkUrl && track.artworkUrl !== failedArtwork ? <img src={track.artworkUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedArtwork(track.artworkUrl ?? "")} /> : null}</div>
            <h3 id={`${id}-title`}>{track.title}</h3><p>{track.artist}</p>
          </div>
          <div className="track-details-radial-count radial-reveal"><span className="track-details-field-label">{zh ? "已获取播放" : "RETRIEVED PLAYS"}</span><strong>{count ?? "—"}{count !== null ? <small>{zh ? "次" : "plays"}</small> : null}</strong></div>
          <div className="track-details-radial-length radial-reveal" title={time.notice[language]}><span className="track-details-field-label">{time.kind === "estimated" ? zh ? "估算收听" : "EST. TIME" : zh ? "收听时长" : "LISTENING"}</span><strong className="track-listening-hours">{time.seconds !== null ? `${time.kind === "estimated" ? "≈" : ""}${listeningHours(time.seconds,language)}` : "—"}</strong><small>{zh ? "歌长 " : "Length "}{knownNumber(track.durationSeconds) && track.durationSeconds > 0 ? trackLength(track.durationSeconds) : "—"}</small></div>
          <div className="track-details-radial-genres radial-reveal" aria-label={`${zh ? "曲风" : "Genres"}: ${genres.join(", ") || (zh ? "暂无可核实标签" : "No verified tag")}`} title={genres.join(" · ") || (zh ? "没有可核实的曲风标签，不猜测分类。" : "No verifiable genre tag is available.")}>
            <span className="track-details-field-label">{zh ? "曲风" : "GENRES"}</span>
            {genres.length ? genres.slice(0, 2).map(genre => <strong key={genre}>{genre.split(" · ").at(-1)}</strong>) : <strong className="is-unknown">{zh ? "暂无标签" : "No tag yet"}</strong>}
            {genres.length > 2 ? <small>+{genres.length - 2}</small> : null}
          </div>
          <div className="track-details-radial-months radial-reveal" title={definition}>
            <div><span className="track-details-field-label">{zh ? "最早上榜" : "EARLIEST"}</span><strong>{monthLabel(monthTrack.firstSeenMonth, language) ?? "—"}</strong></div>
            <div><span className="track-details-field-label">{zh ? "最近上榜" : "LATEST"}</span><strong>{monthLabel(monthTrack.lastSeenMonth, language) ?? "—"}</strong></div>
          </div>
          <div className="track-details-platforms radial-reveal" aria-label={zh ? "平台来源及播放次数" : "Platforms and source play counts"}>{track.platforms.map(platform => {
            const sourceCount = track.sourceCounts[platform];
            const label = `${sourceNames[platform]} · ${knownNumber(sourceCount) ? `${track.countIsPartial ? "≥ " : ""}${sourceCount.toLocaleString(zh ? "zh-CN" : "en")} ${zh ? "次" : "plays"}` : zh ? "次数未提供" : "Count unavailable"}`;
            return <span key={platform} title={label} aria-label={label}><PlatformIcon platform={platform} size={20} /></span>;
          })}</div>
          <button type="button" className="track-details-time-switch radial-reveal" onClick={()=>setTimeFace(true)}>{zh ? "时间想象 ↗" : "A sense of time ↗"}</button>
          <span id={`${id}-definition`} className="track-details-sr-only">{definition}{track.album?.trim() ? ` ${zh ? "专辑" : "Album"}: ${track.album}` : ""}</span>
          </>}
        </div>
        </div>
      </div>, document.body,
    ) : null}
  </span>;
}
