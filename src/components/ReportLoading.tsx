import { useId } from "react";
import type { Language as Locale } from "../lib/i18n";
import "./report-loading.css";

export type ReportLoadingPhase = "history" | "reports" | "metadata";

export interface ReportLoadingProps {
  language: Locale;
  phase: ReportLoadingPhase;
  detail?: string;
  completed?: number;
  total?: number;
  onPreview?: () => void;
  error?: string;
  onRetry?: () => void;
  onDetails?: () => void;
}

const words = {
  zh: {
    history: "正在读取全部历史",
    reports: "正在读取完整报告",
    metadata: "正在补全曲风与封面",
    waiting: "准备完成后，为你展开完整报告。",
    failed: "报告暂时未准备好",
    preview: "先查看已取得的数据",
    retry: "重新尝试",
    details: "查看读取详情",
    tracks: "首",
    months: "个月",
    progress: "读取进度",
  },
  en: {
    history: "Reading your listening history",
    reports: "Reading your full report",
    metadata: "Completing genres and artwork",
    waiting: "Your full report will appear when it’s ready.",
    failed: "Your report isn’t ready yet",
    preview: "View partial report",
    retry: "Retry",
    details: "View loading details",
    tracks: "tracks",
    months: "months",
    progress: "Loading progress",
  },
} as const;

/** A display-only loading state. Counts are supplied by the actual work, never simulated. */
export function ReportLoading({
  language,
  phase,
  detail,
  completed,
  total,
  onPreview,
  error,
  onRetry,
  onDetails,
}: ReportLoadingProps) {
  const titleId = useId();
  const t = words[language];
  const maximum = typeof total === "number" && Number.isFinite(total) && total >= 1 ? Math.floor(total) : undefined;
  const current = maximum !== undefined && typeof completed === "number" && Number.isFinite(completed) && completed >= 0
    ? Math.min(maximum, Math.floor(completed)) : undefined;
  const percentage = maximum !== undefined && current !== undefined ? current / maximum * 100 : undefined;
  const format = new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en");
  const count = current !== undefined && maximum !== undefined
    ? `${format.format(current)} / ${format.format(maximum)} ${phase === "metadata" ? t.tracks : t.months}` : undefined;
  const failed = Boolean(error);

  return (
    <section
      className={`report-loading${failed ? " is-error" : ""}`}
      lang={language === "zh" ? "zh-CN" : "en"}
      data-phase={phase}
      aria-labelledby={titleId}
    >
      <div className="report-loading-inner">
        <div
          className="report-loading-record"
          role="progressbar"
          aria-label={t.progress}
          aria-valuemin={current === undefined ? undefined : 0}
          aria-valuemax={current === undefined ? undefined : maximum}
          aria-valuenow={current}
          aria-valuetext={failed ? error : count}
        >
          <svg className="report-loading-ring" viewBox="0 0 104 104" aria-hidden="true">
            <circle className="report-loading-ring-track" cx="52" cy="52" r="49" />
            {percentage !== undefined && (
              <circle
                className="report-loading-ring-progress"
                cx="52"
                cy="52"
                r="49"
                pathLength="100"
                strokeDasharray={`${percentage} 100`}
                transform="rotate(-90 52 52)"
              />
            )}
          </svg>
          <div className="report-loading-vinyl" aria-hidden="true" />
          <span className="report-loading-label" aria-hidden="true"><svg viewBox="0 0 40 44"><path d="M6 4h28v4L11 35h18v-5h5v10H5v-4L28 9H11v5H6Z" /></svg></span>
        </div>

        <div className="report-loading-copy">
          <div className="report-loading-status" role="status" aria-live="polite" aria-atomic="true">
            <h2 id={titleId}>{failed ? t.failed : t[phase]}</h2>
            {!failed && detail && <p className="report-loading-detail">{detail}</p>}
            {count && <p className="report-loading-count">{count}</p>}
          </div>
          {failed ? <p className="report-loading-error" role="alert">{error}</p>
            : <p className="report-loading-note">{t.waiting}</p>}
          {(onPreview || onDetails || (failed && onRetry)) && (
            <div className="report-loading-actions">
              {failed && onRetry && <button type="button" className="report-loading-retry" onClick={onRetry}>{t.retry}</button>}
              {onDetails && <button type="button" className="report-loading-preview" onClick={onDetails}>{t.details}</button>}
              {onPreview && <button type="button" className="report-loading-preview" onClick={onPreview}>{t.preview}</button>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
