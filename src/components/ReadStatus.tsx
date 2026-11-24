import { useId, useState } from "react";
import { PLATFORM_META, type Locale, type PlatformId, type PlatformInput, type ReportInput } from "../lib/report";
import "./read-status.css";

export interface ReadStatusProps {
  language: Locale;
  syncing: boolean;
  syncProgress: string;
  syncDone: number;
  syncTotal: number;
  metadataProgress: { done: number; total: number; state: "idle" | "loading" | "done" | "error" };
  inputs: ReportInput[];
  months: string[];
  issues: { month: string; provider?: string; code: string; message: string }[];
  diagnostics?: string[];
  /** Prevent retries from replacing an active directory/history workflow. */
  actionsBusy?: boolean;
  onRetry: () => void;
  onRetryMetadata: () => void;
}

const providers: PlatformId[] = ["netease", "qq", "apple"];
const fatalCodes = new Set(["READ_FAILED", "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE", "UPSTREAM_REJECTED", "UPSTREAM_INVALID_RESPONSE", "REPORT_SCHEMA_CHANGED", "PERIOD_MISMATCH", "PERIOD_UNCONFIRMED", "RATE_LIMITED", "AUTH_CREDENTIAL_MISSING", "GATEWAY_NOT_CONFIGURED", "APPLE_NOT_CONFIGURED", "APPLE_CONFIG_INVALID"]);
const words = {
  zh: {
    heading: "读取详情", selection: "所选月份", metadata: "曲风与封面", reading: "正在读取", ready: "读取已结束", waiting: "等待开始", retry: "重新读取", retryMetadata: "重试资料查询", error: "部分查询尚未完成", completed: "资料查询已结束", months: "个月", tracks: "首", monthDetails: "逐月查看", details: "详细说明", more: "显示其余", less: "收起较早月份", pending: "尚未读取", available: "已读取", empty: "空榜单", emptyNote: "榜单没有返回歌曲，不代表没有听歌。", unavailable: "平台未开放", notReady: "尚未生成", future: "月份尚未开始", failed: "需要重试", reconnect: "需要重新连接", partial: "部分榜单", recent: "最近播放 · 非月榜", unconfirmed: "榜单周期未确认", statusDetails: "查看平台状态", noDuration: "时长未提供或未确认", noSnapshot: "等待平台返回所选月份的数据。", metadataNote: "查询完成后，平台未提供的曲风与歌曲长度仍会保留为未知。", monthNote: "已读取表示取得榜单；各平台可提供的范围可能不同。", known: "榜单已返回", retained: "已保留", progress: "读取进度", remaining: "仍有资料待查询",
  },
  en: {
    heading: "Loading details", selection: "Selected months", metadata: "Genres & artwork", reading: "Reading", ready: "Reading finished", waiting: "Waiting to start", retry: "Read again", retryMetadata: "Retry metadata", error: "Some lookups are unfinished", completed: "Lookups finished", months: "months", tracks: "tracks", monthDetails: "Browse by month", details: "More details", more: "Show remaining", less: "Hide earlier months", pending: "Not read yet", available: "Read", empty: "Empty ranking", emptyNote: "No tracks were returned. This does not mean no listening.", unavailable: "Not available from platform", notReady: "Not generated yet", future: "Month has not started", failed: "Retry needed", reconnect: "Reconnect needed", partial: "Partial ranking", recent: "Recent plays · not a monthly ranking", unconfirmed: "Ranking period unverified", statusDetails: "View platform status", noDuration: "Listening time unavailable or unverified", noSnapshot: "Waiting for the selected months from your platforms.", metadataNote: "A finished lookup can still leave genres or track lengths unknown if the source does not provide them.", monthNote: "Read means a ranking was returned. Available coverage differs between platforms.", known: "rankings returned", retained: "retained", progress: "Loading progress", remaining: "More metadata still needs to be queried",
  },
} as const;

function isMonth(value: string) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
function safeCount(value: number) { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function samePeriod(a: PlatformInput["period"], b: ReportInput["period"]) {
  return a.start === b.start && a.end === b.end && a.timeZone === b.timeZone;
}

function issueDescription(issue: ReadStatusProps["issues"][number], language: Locale) {
  if (language === "zh" && issue.message) return issue.message;
  const descriptions: Record<string, [string, string]> = {
    PERIOD_UNAVAILABLE: ["平台没有开放这个月份的报告。", "This month is outside the reports offered by the platform."],
    MONTH_NOT_READY: ["平台尚未生成这个月份的报告。", "The platform has not generated this month's report yet."],
    FUTURE_MONTH: ["这个月份尚未开始。", "This month has not started yet."],
    CONNECTION_EXPIRED: ["账号连接已失效，请重新连接。", "Your account connection has expired. Reconnect to continue."],
    NOT_CONNECTED: ["请先连接这个平台的账号。", "Connect your account on this platform first."],
    UPSTREAM_TIMEOUT: ["平台响应超时，已取得的数据仍会保留。", "The platform timed out. Previously returned data is kept."],
    TOP_RANK_PARTIAL: ["目前仅取得部分榜单，可以重试以补全。", "Only part of the ranking was returned. Retry to retrieve the rest."],
    PERIOD_MISMATCH: ["返回榜单的周期与所选月份不符。", "The returned ranking belongs to a different period."],
    PERIOD_UNCONFIRMED: ["返回榜单的周期尚未确认。", "The returned ranking could not be verified for this month."],
    APPLE_RECENT_NOT_PERIOD: ["这些是最近播放，不能作为所选月份的榜单。", "These are recent plays, not a ranking for the selected month."],
    DURATION_UNAVAILABLE: ["平台未提供真实累计收听时长。", "The platform did not provide actual listening time."],
    OFFICIAL_MONTH_DURATION_UNAVAILABLE: ["平台未提供这个月份的累计收听时长。", "The platform did not provide listening time for this month."],
    DURATION_MAPPING_REQUIRED: ["平台返回的时长单位尚未确认，因此暂不计入总量。", "The source's time unit is unverified, so the value is excluded from totals."],
    DURATION_INCONSISTENT: ["平台返回的时长与榜单不一致，因此暂不采用。", "The returned listening time conflicts with the ranking and is excluded."],
    GENRE_NOT_AVAILABLE: ["榜单本身未提供曲风；歌曲资料查询会单独补全可确认的标签。", "The ranking has no genre tags. Metadata lookups separately add verifiable tags."],
    RATE_LIMITED: ["平台暂时限制读取次数，请稍后重试。", "The platform is temporarily limiting requests. Try again shortly."],
  };
  return descriptions[issue.code]?.[language === "zh" ? 0 : 1] ?? (language === "zh" ? "这份数据暂时无法取得，请重新读取。" : "This data could not be retrieved. Try reading it again.");
}

function Progress({ done, total, active, label }: { done: number; total: number; active: boolean; label: string }) {
  const maximum = safeCount(total);
  const current = Math.min(safeCount(done), maximum);
  return <div className={`read-status-meter${active ? " is-active" : ""}`} role="progressbar" aria-label={label}
    aria-valuemin={maximum ? 0 : undefined} aria-valuemax={maximum || undefined} aria-valuenow={maximum ? current : undefined}>
    <span style={{ width: maximum ? `${current / maximum * 100}%` : "0%" }} />
  </div>;
}

/** Status is derived from returned source data; this component never starts network work. */
export function ReadStatus({ language, syncing, syncProgress, syncDone, syncTotal, metadataProgress, inputs, months, issues, diagnostics = [], actionsBusy = false, onRetry, onRetryMetadata }: ReadStatusProps) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  const t = words[language];
  const locale = language === "zh" ? "zh-CN" : "en";
  const format = new Intl.NumberFormat(locale);
  const monthFormat = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" });
  const orderedMonths = [...new Set(months.filter(isMonth))].sort().reverse();
  const monthInputs = new Map<string, ReportInput>();
  for (const input of inputs) {
    const month = input.period.start.slice(0, 7);
    if (input.mode === "live" && isMonth(month) && input.period.end.startsWith(month)) monthInputs.set(month, input);
  }
  const selectedIssues = issues.filter(issue => orderedMonths.includes(issue.month));
  const knownProviders = providers.filter(provider => inputs.some(input => input.mode === "live" && (input.expectedPlatforms?.includes(provider) || input.platforms.some(platform => platform.id === provider))) || selectedIssues.some(issue => issue.provider === provider));
  const metaActive = metadataProgress.state === "loading";
  const metaIncomplete = metadataProgress.state === "error" || (metadataProgress.state === "done" && metadataProgress.done < metadataProgress.total);
  const hasFailures = selectedIssues.some(issue => fatalCodes.has(issue.code) || ["TOP_RANK_PARTIAL", "CONNECTION_EXPIRED", "NOT_CONNECTED"].includes(issue.code));
  const syncState = syncing ? t.reading : hasFailures ? t.failed : syncTotal > 0 && syncDone >= syncTotal ? t.ready : t.waiting;
  const metaState = metaActive ? t.reading : metadataProgress.state === "error" ? t.error : metaIncomplete ? t.remaining : metadataProgress.state === "done" ? t.completed : t.waiting;

  const renderPlatform = (month: string, provider: PlatformId) => {
    const input = monthInputs.get(month);
    const platform = input?.platforms.find(item => item.id === provider);
    const platformIssues = selectedIssues.filter(issue => issue.month === month && (!issue.provider || issue.provider === provider));
    const codes = new Set(platformIssues.map(issue => issue.code));
    const has = (code: string) => codes.has(code);
    const tracks = platform?.tracks.length ?? 0;
    const monthlyRanking = Boolean(platform?.rankingPeriod && input && samePeriod(platform.rankingPeriod, input.period));
    const duration = platform && input && platform.durationKind === "actual-total" && platform.coverageComplete && typeof platform.listenSeconds === "number" && Number.isFinite(platform.listenSeconds) && platform.listenSeconds >= 0 && samePeriod(platform.period, input.period) ? platform.listenSeconds : null;
    let label: string = t.pending;
    let tone = "muted";
    if (has("PERIOD_UNAVAILABLE")) label = t.unavailable;
    else if (has("MONTH_NOT_READY")) label = t.notReady;
    else if (has("FUTURE_MONTH")) label = t.future;
    else if (has("CONNECTION_EXPIRED") || has("NOT_CONNECTED")) { label = t.reconnect; tone = "error"; }
    else if (platformIssues.some(issue => fatalCodes.has(issue.code))) { label = t.failed; tone = "error"; }
    else if (platform && !monthlyRanking) { label = provider === "apple" || has("APPLE_RECENT_NOT_PERIOD") ? t.recent : t.unconfirmed; }
    else if (has("TOP_RANK_PARTIAL")) { label = t.partial; tone = "warning"; }
    else if (platform) { label = tracks > 0 ? t.available : t.empty; tone = tracks > 0 ? "ready" : "muted"; }
    const source = PLATFORM_META[provider];
    return <div className="read-status-platform" key={provider}>
      <div className="read-status-platform-top"><span className="read-status-platform-name"><i style={{ background: source.color }} />{language === "zh" ? source.name : source.nameEn}</span><span className={`read-status-badge is-${tone}`}>{label}</span></div>
      {platform && <p className="read-status-platform-note">{format.format(tracks)} {t.tracks}{tone === "error" ? ` ${t.retained}` : ""}<span aria-hidden="true"> · </span>{duration === null ? t.noDuration : `${format.format(Math.round(duration / 360) / 10)} ${language === "zh" ? "小时" : "hours"}`}</p>}
      {platform && monthlyRanking && tracks === 0 && tone !== "error" && !has("PERIOD_UNAVAILABLE") && !has("MONTH_NOT_READY") && <p className="read-status-platform-note">{t.emptyNote}</p>}
      {platformIssues.length > 0 && <details className="read-status-source-details"><summary>{t.details}</summary><ul>{platformIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issueDescription(issue, language)}</li>)}</ul></details>}
    </div>;
  };

  return <section className="read-status" lang={locale} aria-labelledby={`${id}-heading`}>
    <h3 className="read-status-title" id={`${id}-heading`}>{t.heading}</h3>
    <div className="read-status-cards">
      <div className="read-status-card">
        <div className="read-status-card-heading"><h4>{t.selection}</h4><span className={`read-status-indicator${syncing ? " is-loading" : ""}${!syncing && hasFailures ? " is-error" : ""}`} aria-hidden="true" /></div>
        <div className="read-status-count">{format.format(safeCount(syncDone))}<span> / {format.format(safeCount(syncTotal))} {t.months}</span></div>
        <Progress done={syncDone} total={syncTotal} active={syncing} label={`${t.selection} · ${t.progress}`} />
        <p className="read-status-live" role="status" aria-live="polite">{syncing && syncProgress ? syncProgress : syncState}</p>
        <button type="button" className="read-status-action" onClick={onRetry} disabled={syncing || actionsBusy}>{t.retry}<span aria-hidden="true">↗</span></button>
      </div>
      <div className="read-status-card">
        <div className="read-status-card-heading"><h4>{t.metadata}</h4><span className={`read-status-indicator${metaActive ? " is-loading" : ""}${metaIncomplete ? " is-error" : ""}`} aria-hidden="true" /></div>
        <div className="read-status-count">{format.format(safeCount(metadataProgress.done))}<span> / {format.format(safeCount(metadataProgress.total))} {t.tracks}</span></div>
        <Progress done={metadataProgress.done} total={metadataProgress.total} active={metaActive} label={`${t.metadata} · ${t.progress}`} />
        <p className="read-status-live" role="status" aria-live="polite">{metaState}</p>
        <button type="button" className="read-status-action" onClick={onRetryMetadata} disabled={metaActive || actionsBusy}>{t.retryMetadata}<span aria-hidden="true">↗</span></button>
      </div>
    </div>
    <p className="read-status-note">{t.metadataNote}</p>
    <details className="read-status-months">
      <summary><span>{t.monthDetails}</span><span className="read-status-summary-count">{format.format(orderedMonths.length)} {t.months}</span></summary>
      <p className="read-status-note">{t.monthNote}</p>
      {orderedMonths.length === 0 && <p className="read-status-note">{t.noSnapshot}</p>}
      {(showAll ? orderedMonths : orderedMonths.slice(0, 6)).map(month => {
        const input = monthInputs.get(month);
        const monthProviders = providers.filter(provider => input?.expectedPlatforms?.includes(provider) || input?.platforms.some(platform => platform.id === provider) || selectedIssues.some(issue => issue.month === month && issue.provider === provider));
        const visibleProviders = providers.filter(provider => monthProviders.includes(provider) || knownProviders.includes(provider));
        const returned = input?.platforms.filter(platform => platform.rankingPeriod && samePeriod(platform.rankingPeriod, input.period) && !selectedIssues.some(issue => issue.month === month && (!issue.provider || issue.provider === platform.id) && ["PERIOD_UNAVAILABLE", "MONTH_NOT_READY", "FUTURE_MONTH"].includes(issue.code))).length ?? 0;
        const monthFailed = selectedIssues.some(issue => issue.month === month && (fatalCodes.has(issue.code) || ["TOP_RANK_PARTIAL", "CONNECTION_EXPIRED", "NOT_CONNECTED"].includes(issue.code)));
        return <details className="read-status-month" key={month}>
          <summary><span>{monthFormat.format(new Date(`${month}-01T12:00:00Z`))}</span><span className={`read-status-month-hint${monthFailed ? " is-error" : ""}`}>{monthFailed ? t.failed : returned > 0 ? `${returned}/${visibleProviders.length} ${t.known}` : input ? t.statusDetails : t.pending}</span></summary>
          <div className="read-status-platforms">{visibleProviders.length ? visibleProviders.map(provider => renderPlatform(month, provider)) : <><p className="read-status-note">{t.noSnapshot}</p>{selectedIssues.filter(issue => issue.month === month).map((issue, index) => <p className="read-status-platform-note" key={index}>{issueDescription(issue, language)}</p>)}</>}</div>
        </details>;
      })}
      {orderedMonths.length > 6 && <button type="button" className="read-status-show-more" onClick={() => setShowAll(value => !value)} aria-expanded={showAll}>{showAll ? t.less : `${t.more} ${format.format(orderedMonths.length - 6)} ${t.months}`}</button>}
    </details>
    {diagnostics.length > 0 && <details className="read-status-diagnostics"><summary>{t.details}<span className="read-status-summary-count">{new Set(diagnostics).size}</span></summary><ul>{[...new Set(diagnostics)].map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
  </section>;
}
