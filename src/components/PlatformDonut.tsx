import { useMemo, useState, type CSSProperties } from "react";
import type { Locale, MusicReport } from "../lib/report";
import { ChartRing, type DonutSegment } from "./GenreDonut";
import { PlatformIcon } from "./PlatformIcon";
import { TimePerspective } from "./TimePerspective";
import { resolvePlatformListeningTime } from "../lib/listening-time";
import "./charts.css";

export interface PlatformDonutProps {
  report: MusicReport;
  language: Locale;
}

function formatSourceTime(seconds: number, language: Locale): string {
  const zh = language === "zh";
  const unit = seconds > 0 && seconds < 60 ? zh ? "秒" : "sec" : seconds > 0 && seconds < 3600 ? zh ? "分钟" : "min" : zh ? "小时" : "h";
  const value = seconds > 0 && seconds < 60 ? seconds : seconds > 0 && seconds < 3600 ? seconds / 60 : seconds / 3600;
  return `${value.toLocaleString(zh ? "zh-CN" : "en", { maximumFractionDigits: 1 })} ${unit}`;
}

export function PlatformDonut({ report, language }: PlatformDonutProps) {
  const zh = language === "zh";
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const actualTime = report.durationComparable && report.platformShares.length > 0 &&
    report.platformShares.every((share) => Number.isFinite(share.seconds) && share.seconds >= 0) &&
    report.platformShares.some((share) => share.seconds > 0);
  const sources = useMemo(() => report.platforms.map((platform) => {
    const seen = new Set<string>();
    const uniqueTracks = platform.tracks.filter((track) => {
      if (!track.id) return false;
      const key = track.canonicalId?.trim() ? `recording:${track.canonicalId.trim()}` : track.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // A monthly Top N sum is a retrieved sample, never a complete platform play total.
    const knownCounts = platform.rankingMatchesPeriod && platform.rankingCoverage !== "undated"
      ? uniqueTracks.map((track) => Object.hasOwn(track.sourceCounts, platform.id) ? track.sourceCounts[platform.id] : track.count)
        .filter((count): count is number => typeof count === "number" && Number.isFinite(count) && count >= 0)
      : [];
    const time = resolvePlatformListeningTime({...platform, tracks:uniqueTracks});
    const seconds = time.seconds;
    return {
      key: platform.id, label: zh ? platform.name : platform.nameEn, color: platform.color,
      seconds, time, plays: knownCounts.length ? knownCounts.reduce((sum, count) => sum + count, 0) : null,
      sampleCount: uniqueTracks.length,
      value: actualTime ? report.platformShares.find((share) => share.id === platform.id)?.seconds ?? 0 : uniqueTracks.length,
    };
  }), [report, zh, actualTime]);
  const total = sources.reduce((sum, source) => sum + source.value, 0);
  const segments: DonutSegment[] = sources.filter((source) => source.value > 0).map((source) => ({ ...source, percentage: total ? source.value / total * 100 : 0 }));
  const active = sources.some((source) => source.key === preview) ? preview : sources.some((source) => source.key === selected) ? selected : null;
  const activeSource = sources.find((source) => source.key === active);
  const activeShare = segments.find((segment) => segment.key === active);
  const toggleSelection = (key: string) => setSelected((current) => current === key ? null : key);
  const title = actualTime ? zh ? "实际听歌时长占比" : "Actual listening time" : zh ? "已读取曲目来源占比" : "Retrieved track sources";
  const hasData = total > 0;
  const detail = actualTime ? zh ? "小时 · 实际时长" : "hours actually listened" : zh ? "条平台曲目" : "platform track entries";
  const totalLabel = actualTime
    ? `${(total / 3600).toLocaleString(zh ? "zh-CN" : "en", { maximumFractionDigits: 1 })} ${zh ? "小时" : "hours"}`
    : `${total.toLocaleString(zh ? "zh-CN" : "en")} ${zh ? "条平台曲目" : "platform track entries"}`;
  const description = hasData
    ? `${title}. ${totalLabel}. ${segments.map((segment) => `${segment.label} ${segment.percentage.toFixed(1)}%`).join("; ")}${actualTime ? "" : zh ? "。这是曲目来源占比，不代表听歌时长。" : ". These are track-source shares, not listening-time shares."}`
    : zh ? "尚未取得曲目或可比较的时长，不显示零值占比。" : "No tracks or comparable listening time are available yet; zero shares are not shown.";
  return (
    <section className={`zm-donut-card zm-platform-donut${hasData ? "" : " is-empty"}`} aria-label={title} lang={zh ? "zh-CN" : "en"}>
      <div className="zm-donut-heading">
        <span>{title}</span>
        <span className="zm-donut-mode">{actualTime ? zh ? "实际时长" : "LISTENING TIME" : zh ? "曲目样本" : "TRACK SAMPLE"}</span>
      </div>
      <div className="zm-donut-layout">
        <ChartRing segments={segments} selected={activeShare?.key ?? null}
          value={activeSource && !activeShare ? "—" : hasData ? activeShare ? `${activeShare.percentage.toFixed(1)}%` : (actualTime ? total / 3600 : total).toLocaleString(zh ? "zh-CN" : "en", { maximumFractionDigits: actualTime ? 1 : 0 }) : "—"}
          label={activeSource?.label ?? (actualTime ? zh ? "音乐相伴" : "TIME WITH MUSIC" : zh ? "收集到的声音" : "SOUNDS COLLECTED")}
          detail={hasData ? activeShare ? actualTime ? zh ? "实际时长占比" : "share of listening time" : zh ? "曲目来源占比" : "share of retrieved tracks" : detail : zh ? "等待读取曲目" : "awaiting track samples"}
          title={title} description={description} onSelect={hasData ? toggleSelection : undefined} onPreview={hasData ? setPreview : undefined} />
        {sources.length > 0 ? (
          <div className="zm-donut-legend" role="group" aria-label={zh ? "选择平台以突出显示" : "Select a platform to highlight"}>
            {sources.map((source) => {
              const percentage = total ? source.value / total * 100 : null;
              const hoursLabel = source.seconds !== null ? `${source.time.kind === "estimated" ? "≈ " : ""}${formatSourceTime(source.seconds, language)}` : zh ? "尚未提供" : "Not available";
              const playsLabel = source.plays !== null ? `${source.plays.toLocaleString(zh ? "zh-CN" : "en")} ${zh ? "次" : "plays"}` : zh ? "尚未提供" : "Not available";
              return (
                <button type="button" key={source.key} className={`zm-donut-legend-button zm-platform-legend-button${active === source.key ? " is-selected" : ""}`}
                  aria-pressed={selected === source.key} onClick={() => toggleSelection(source.key)}
                  onMouseEnter={() => setPreview(source.key)} onMouseLeave={() => setPreview(null)}
                  onFocus={() => setPreview(source.key)} onBlur={() => setPreview(null)}>
                  <span className="zm-platform-icon-ring" style={{ "--source-ink": source.color } as CSSProperties}><PlatformIcon platform={source.key} size={20} /></span>
                  <span className="zm-donut-legend-name">{source.label}</span>
                  <span className="zm-donut-legend-value">{percentage !== null ? <>{percentage.toFixed(1)}<small>%</small></> : "—"}</span>
                  <span className="zm-platform-metrics">
                    <span><small>{source.time.kind === "estimated" ? zh ? "已读取样本 · 估算时长" : "Sample · estimated time" : zh ? "实际收听时长" : "Actual listening"}</small><strong className={source.seconds === null ? "is-missing" : undefined}>{hoursLabel}</strong></span>
                    <span><small>{zh ? "已读取榜单播放次数" : "Plays in retrieved rankings"}</small><strong className={source.plays === null ? "is-missing" : undefined}>{playsLabel}</strong></span>
                  </span>
                  <span className="zm-platform-sample-count">{source.sampleCount ? zh ? `已读取 ${source.sampleCount.toLocaleString("zh-CN")} 首曲目` : `${source.sampleCount.toLocaleString("en")} retrieved tracks` : zh ? "尚无曲目样本" : "No track sample yet"}</span>
                </button>
              );
            })}
            <span className="zm-donut-selection" aria-live="polite">{activeSource ? `${activeSource.label}${activeShare ? ` · ${activeShare.percentage.toFixed(1)}%` : ""}` : zh ? "悬停或轻点圆环，查看平台分布" : "Hover or tap the ring to explore each platform"}</span>
          </div>
        ) : (
          <div className="zm-donut-empty-copy">
            <strong>{zh ? "正在等待你的音乐。" : "Waiting for your music."}</strong>
            <p>{zh ? "尚未读取到这段时间的曲目。读取完成后会显示来源分布；若读取失败，可以重新读取所选月份。" : "No tracks have been read for this selection yet. Source shares appear when reading finishes; if reading failed, retry the selected months."}</p>
          </div>
        )}
      </div>
      <div className="platform-time-stories">{report.platforms.map(platform => {
        const seen = new Set<string>();
        const time = resolvePlatformListeningTime({...platform, tracks:platform.tracks.filter(track => {const id=track.canonicalId || track.id;if(seen.has(id))return false;seen.add(id);return true;})});
        return <TimePerspective key={platform.id} time={time} language={language} seed={`platform:${platform.id}`} title={`${zh ? platform.name : platform.nameEn}${time.scope === "platform-sample" ? zh ? " · 已读取样本" : " · retrieved sample" : ""}`} />;
      })}</div>
      <p className="zm-donut-footnote">{actualTime ? report.durationNotice[language] : hasData
        ? zh ? "实际时长尚未齐全，先看已读取的曲目来源。同一首歌在不同平台分别计数；该占比不代表听歌时长。" : "Complete listening time is unavailable, so this shows retrieved track sources. The same song counts once per platform; these shares do not represent listening time."
        : sources.some((source) => source.seconds !== null)
          ? zh ? "已知时长见各平台；曲目样本尚未返回，暂不绘制来源占比。" : "Known listening time is shown per platform. Track samples have not arrived, so no source shares are drawn."
          : zh ? "数据尚未取得，不会按零播放或零小时处理。" : "Unavailable data is not treated as zero plays or zero listening hours."}</p>
      {sources.length > 0 ? <p className="zm-donut-footnote">{zh ? "已知时长按平台独立保留；未提供不等于零。播放次数仅合计已读取月榜中的已知次数，未包含榜单之外的播放。" : "Known listening time is retained separately for each platform; unavailable does not mean zero. Play counts sum known counts in retrieved monthly rankings only, excluding plays outside those samples."}</p> : null}
    </section>
  );
}
