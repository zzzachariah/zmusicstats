import { useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "motion/react";
import { ArrowLeftRight } from "lucide-react";
import { getTimeMetaphors, listeningTimeInUnit, type ListeningTime, type ListeningTimeUnit } from "../lib/listening-time";
import { createTimePerspectiveSession, timePerspectiveKey, type TimePerspectiveSelection } from "../lib/time-metaphor-history";
import type { Locale } from "../lib/report";
import "./time-perspective.css";
import { TimeScene } from "./TimeScene";

export function listeningHours(seconds: number, language: Locale): string {
  return `${(seconds / 3600).toLocaleString(language === "zh" ? "zh-CN" : "en", { maximumFractionDigits: seconds > 0 && seconds < 360 ? 3 : 1 })} ${language === "zh" ? "小时" : "h"}`;
}

const timeUnits: { id: ListeningTimeUnit; zh: string; en: string; enName: string }[] = [
  { id: "hours", zh: "小时", en: "h", enName: "Hours" },
  { id: "days", zh: "天", en: "d", enName: "Days" },
  { id: "months", zh: "月", en: "mo", enName: "Months" },
  { id: "years", zh: "年", en: "yr", enName: "Years" },
];

/** A standalone numeric display for headings and small chart centres. */
export function ListeningTimeValue({ time, language, compact = false }: {
  time: Pick<ListeningTime, "seconds" | "kind">; language: Locale; compact?: boolean;
}) {
  const [unit, setUnit] = useState<ListeningTimeUnit>("hours");
  const zh = language === "zh";
  const readings = timeUnits.map(entry => {
    const value = time.seconds === null ? null : listeningTimeInUnit(time.seconds, entry.id);
    const numeric = value === null ? "—" : value > 0 && value < 0.01
      ? value.toLocaleString(zh ? "zh-CN" : "en", { maximumSignificantDigits: 2, notation: value < 0.000001 ? "scientific" : "standard" })
      : value.toLocaleString(zh ? "zh-CN" : "en", { maximumFractionDigits: value < 10 ? 2 : 1 });
    return { ...entry, value, numeric: `${value !== null && time.kind === "estimated" ? "≈ " : ""}${numeric}` };
  });
  const selectedUnit = readings.find(entry => entry.id === unit)!;
  const nextUnit = timeUnits[(timeUnits.findIndex(entry => entry.id === unit) + 1) % timeUnits.length];
  const switchLabel = zh ? `切换为${nextUnit.zh}（当前：${selectedUnit.zh}）` : `Show ${nextUnit.enName.toLowerCase()} (currently ${selectedUnit.enName.toLowerCase()})`;
  const hasCalendarBasis = unit === "months" || unit === "years";
  return <div className={`time-unit-value${compact ? " is-compact" : ""}`}>
    <div className="time-unit-readout">
      <button type="button" className="time-unit-switch" aria-label={switchLabel} title={switchLabel} onClick={() => setUnit(nextUnit.id)}><ArrowLeftRight size={14} aria-hidden="true" /></button>
      <div className="time-unit-numbers">
        {/* Same typography as the visible value reserves the widest unit, even with hero overrides. */}
        {readings.map(reading => <strong key={reading.id} className="time-unit-number time-unit-measure" aria-hidden="true">{reading.numeric}{reading.value !== null && <span>{zh ? reading.zh : reading.en}</span>}</strong>)}
        <strong className="time-unit-number" aria-live="polite">{selectedUnit.numeric}{selectedUnit.value !== null && <span>{zh ? selectedUnit.zh : selectedUnit.en}</span>}</strong>
      </div>
    </div>
    {/* Keep the height stable as well as the width: centering must not move the switch. */}
    <small className={`time-unit-basis${hasCalendarBasis ? "" : " is-empty"}`} aria-hidden={!hasCalendarBasis}>{unit === "years" ? (zh ? "1 年按 365 天" : "1 year = 365 days") : (zh ? "1 月按 30 天" : "1 month = 30 days")}</small>
  </div>;
}

export function TimePerspective({ time, seed, language, title, compact = false, hideHours = false }: {
  time: ListeningTime; seed: string; language: Locale; title?: string; compact?: boolean; hideHours?: boolean;
}) {
  const element = useRef<HTMLElement>(null);
  const inView = useInView(element, { amount: .2 });
  const selectionKey = timePerspectiveKey(time.seconds, seed);
  const [session] = useState(() => createTimePerspectiveSession());
  const [selection, setSelection] = useState<TimePerspectiveSelection | null>(null);
  const choices = useMemo(() => getTimeMetaphors(time.seconds, seed), [time.seconds, seed]);
  // Never flash the deterministic first item before the saved rotation is consulted.
  // A changed month must not show the preceding month's comparison either.
  const metaphor = (selection?.key === selectionKey ? choices.find(choice => choice.id === selection.id) : null) ?? null;
  const pending = choices.length > 0 && !metaphor;
  const hasTime = time.seconds !== null && Number.isFinite(time.seconds) && time.seconds >= 0;

  useEffect(() => {
    // Off-screen report sections should not spend a fresh comparison on every reload.
    // The session also makes Strict Mode replay return the same selection object.
    const next = session.select(time.seconds, seed, inView);
    if (next) setSelection(next);
  }, [inView, session, time.seconds, seed]);

  function showNextPerspective() {
    const next = session.select(time.seconds, seed, true, true);
    if (next) setSelection(next);
  }
  const zh = language === "zh";
  const estimated = time.kind === "estimated";
  return <section ref={element} className={`time-perspective${compact ? " is-compact" : ""}${hideHours ? " is-inline" : ""}`} lang={zh ? "zh-CN" : "en"} aria-label={title ?? (zh ? "时间的另一种刻度" : "Another measure of time")}>
    {!hideHours && <div className="time-perspective-heading"><span>{title ?? (zh ? "音乐相伴" : "TIME WITH MUSIC")}</span><ListeningTimeValue time={time} language={language} compact={compact} /><small>{time.kind === "unknown" ? zh ? "暂无可用时长" : "Listening time unavailable" : estimated ? time.scope === "report" ? zh ? "汇总含榜单样本估算" : "Includes ranking sample estimates" : zh ? "按完整播放估算" : "Estimated full-length plays" : time.partial ? zh ? "已取得的部分时长" : "Available listening time" : zh ? "实际收听" : "Actual listening"}</small></div>}
    {metaphor ? <div className="time-perspective-story" key={`${seed}:${metaphor.id}`}>
      <TimeScene animation={metaphor.animation} />
      <div className="time-perspective-copy"><span className="time-perspective-eyebrow">{zh ? "把时间想象成" : "IMAGINE THAT TIME"}</span><p>{metaphor.text[language]}</p></div>
    </div> : pending ? <div className="time-perspective-story" aria-busy="true">
      <TimeScene animation="vinyl" />
      <div className="time-perspective-copy"><span className="time-perspective-eyebrow">{zh ? "把时间想象成" : "IMAGINE THAT TIME"}</span><p role="status">{zh ? "正在挑选新的时间想象…" : "Finding a fresh perspective…"}</p></div>
    </div> : <p className="time-perspective-unavailable">{hasTime
      ? time.seconds === 0 ? zh ? "记录时长为 0，暂不进行情景换算。" : "The recorded time is zero, so there is no comparison yet."
        : zh ? "保留原始时长；这个量级暂不做情景换算。" : "The original time is retained; no comparison fits this scale yet."
      : zh ? "取得可用时长后，这里会把数字变成画面。" : "A sense of scale will appear when listening time is available."}</p>}
    <div className="time-perspective-actions">
      {metaphor || pending ? <button type="button" className="time-perspective-next" disabled={pending} onClick={showNextPerspective} aria-label={zh ? "换一个时间比喻" : "Try another time comparison"}>{zh ? "换个比喻" : "Another perspective"}<span aria-hidden="true">↗</span></button> : null}
      {!compact && <details className="time-perspective-method"><summary>{zh ? "换算依据" : "How it is calculated"}</summary><p>{time.notice[language]}</p>{metaphor && <><p>{metaphor.formula[language]} {metaphor.assumption[language]}</p>{metaphor.source && <a href={metaphor.source.url} target="_blank" rel="noreferrer">{metaphor.source.title} ↗</a>}</>}</details>}
    </div>
    {compact && <small className="time-perspective-compact-note" title={metaphor ? `${time.notice[language]} ${metaphor.formula[language]} ${metaphor.assumption[language]}` : time.notice[language]}>{time.scope === "report" ? estimated ? zh ? "汇总含榜单样本估算" : "Includes ranking sample estimates" : zh ? "已取得的平台时长" : "Available platform listening time" : estimated ? zh ? "次数 × 歌长 · 仅已取得样本" : "Plays × track length · retrieved sample" : time.scope === "genre-sample" ? zh ? "常听样本 · 多曲风均分时长" : "Frequent songs · time shared across genres" : zh ? "依据平台提供的时长" : "Based on reported listening time"}</small>}
  </section>;
}
