import { useId, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, Disc3, Library } from "lucide-react";
import type { Locale } from "../lib/report";
import { latestCompletedMonth, MAX_PERIOD_MONTHS, MIN_REPORT_MONTH, recentCompletedMonths, validatePeriodSelection, type PeriodSelectionError } from "../lib/period-selection";
import "./period-welcome.css";

const errors: Record<PeriodSelectionError, { zh: string; en: string }> = {
  empty: { zh: "请填写开始和结束月份，至少选择一个月。", en: "Enter both months. Choose at least one complete month." },
  invalid: { zh: "请输入有效月份，例如 2026-10。", en: "Enter a valid month, such as 2026-10." },
  "before-minimum": { zh: `可选范围从 ${MIN_REPORT_MONTH} 开始；这不代表账号的最早记录。`, en: `The selectable range starts at ${MIN_REPORT_MONTH}; this is not your account's first record.` },
  unfinished: { zh: "请选择已结束的月份，当月和未来月份暂不纳入。", en: "Choose completed months. The current and future months are excluded." },
  reversed: { zh: "结束月份不能早于开始月份。", en: "The end month must be the same as or later than the start month." },
  "too-long": { zh: `一次最多选择 ${MAX_PERIOD_MONTHS} 个月，请缩短时段。`, en: `Choose no more than ${MAX_PERIOD_MONTHS} months at a time.` },
};

function monthLabel(month: string, language: Locale): string {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { year: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}

function MonthField({ id, name, label, value, latest, language, invalid, describedBy, onChange }: {
  id: string; name: string; label: string; value: string; latest: string; language: Locale;
  invalid: boolean; describedBy: string; onChange: (month: string) => void;
}) {
  const zh = language === "zh", year = value.slice(0,4), month = value.slice(5);
  const years = Array.from({length: Number(latest.slice(0,4)) - Number(MIN_REPORT_MONTH.slice(0,4)) + 1}, (_, index) => Number(latest.slice(0,4)) - index);
  return <div className="period-month-field" role="group" aria-labelledby={`${id}-label`}>
    <span id={`${id}-label`}>{label}</span>
    <div className="period-month-control">
      <label><select name={`${name}Year`} value={year} aria-label={`${label} · ${zh ? "年份" : "year"}`} aria-invalid={invalid} aria-describedby={describedBy}
        onChange={event=>{const nextYear=event.currentTarget.value; onChange(`${nextYear}-${nextYear === latest.slice(0,4) && month > latest.slice(5) ? latest.slice(5) : month}`);}}>
        {years.map(item=><option key={item} value={item}>{item}{zh ? " 年" : ""}</option>)}
      </select><ChevronDown size={14} aria-hidden="true" /></label>
      <label><select name={`${name}Month`} value={month} aria-label={`${label} · ${zh ? "月份" : "month"}`} aria-invalid={invalid} aria-describedby={describedBy}
        onChange={event=>onChange(`${year}-${event.currentTarget.value}`)}>
        {Array.from({length:12},(_, index)=>{const number=String(index+1).padStart(2,"0"); return <option key={number} value={number} disabled={`${year}-${number}` > latest}>{zh ? `${index+1} 月` : new Intl.DateTimeFormat("en",{month:"short",timeZone:"UTC"}).format(new Date(`2000-${number}-01T12:00:00Z`))}</option>;})}
      </select><ChevronDown size={14} aria-hidden="true" /></label>
    </div>
  </div>;
}

export function PeriodWelcome({ language, onContinue, onBack }: {
  language: Locale; onContinue: (months: string[] | null) => void; onBack: () => void;
}) {
  const zh = language === "zh", id = useId();
  const [defaults] = useState(() => recentCompletedMonths(12));
  const [start, setStart] = useState(defaults[0] ?? "");
  const [end, setEnd] = useState(defaults.at(-1) ?? "");
  const [allHistory, setAllHistory] = useState(false);
  const latest = latestCompletedMonth();
  const selection = validatePeriodSelection(start, end, latest);
  const error = allHistory ? null : selection.error;
  const chooseRecent = (count: number) => {
    const months = recentCompletedMonths(count);
    setAllHistory(false); setStart(months[0] ?? ""); setEnd(months.at(-1) ?? "");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (allHistory) { onContinue(null); return; }
    // Read the actual select values so browser autofill is validated as well.
    const form = new FormData(event.currentTarget);
    const currentStart = `${form.get("startYear") ?? ""}-${form.get("startMonth") ?? ""}`;
    const currentEnd = `${form.get("endYear") ?? ""}-${form.get("endMonth") ?? ""}`;
    const currentSelection = validatePeriodSelection(currentStart, currentEnd, latestCompletedMonth());
    setStart(currentStart); setEnd(currentEnd);
    if (!currentSelection.error && currentSelection.months.length) onContinue(currentSelection.months);
  };

  return <section className="period-welcome" lang={zh ? "zh-CN" : "en"} aria-labelledby={`${id}-title`}>
    <header className="period-welcome-heading">
      <div className="period-connection-ready"><Check size={13} aria-hidden="true" />{zh ? "连接完成 · 选择时段" : "CONNECTED · CHOOSE A PERIOD"}</div>
      <h1 id={`${id}-title`}>{zh ? <>从这段<em>时光</em>开始。</> : <>Start with a <em>chapter.</em></>}</h1>
      <p>{zh ? "选一段想回看的日子，再把听过的音乐慢慢找回来。" : "Choose the months you want to revisit. Your music will tell the rest."}</p>
    </header>

    <form className="period-selection-card" onSubmit={submit} noValidate>
      <div className="period-card-heading"><div><span className="period-card-kicker">{zh ? "你的听歌时段" : "YOUR LISTENING PERIOD"}</span><h2>{zh ? "回看多久？" : "How far back?"}</h2></div><div className="period-vinyl-mark" aria-hidden="true"><Disc3 size={26} /></div></div>
      <div className="period-presets" role="group" aria-label={zh ? "快捷选择时段" : "Quick period selection"}>
        {[3, 6, 12].map(count => <button type="button" key={count} aria-pressed={!allHistory && !selection.error && selection.months.length === count && end === latest} onClick={() => chooseRecent(count)}>{zh ? `近 ${count} 个月` : `Last ${count} months`}</button>)}
        <button type="button" className="period-all-preset" aria-pressed={allHistory} onClick={() => setAllHistory(true)}><Library size={14} aria-hidden="true" />{zh ? "全部历史" : "All history"}</button>
      </div>

      <fieldset className="period-range" disabled={allHistory}>
        <legend>{zh ? "或指定起止月份" : "Or choose a month range"}</legend>
        <MonthField id={`${id}-start`} name="start" label={zh ? "开始月份" : "From"} value={start} latest={latest} language={language} invalid={!!error} describedBy={`${id}-scope${error ? ` ${id}-error` : ""}`} onChange={setStart} />
        <MonthField id={`${id}-end`} name="end" label={zh ? "结束月份" : "To"} value={end} latest={latest} language={language} invalid={!!error} describedBy={`${id}-scope${error ? ` ${id}-error` : ""}`} onChange={setEnd} />
      </fieldset>

      <div className={`period-selection-summary${allHistory ? " is-all" : ""}`} aria-live="polite">
        <CalendarDays size={19} aria-hidden="true" /><div><strong>{allHistory ? (zh ? "全部可读取历史" : "All readable history") : error ? (zh ? "等待有效时段" : "Choose a valid period") : zh ? `已选 ${selection.months.length} 个完整月份` : `${selection.months.length} complete month${selection.months.length === 1 ? "" : "s"}`}</strong>
        <span>{allHistory ? (zh ? "按各平台返回的历史目录读取，最早月份将在读取后确认。" : "Use each platform's available history. Its earliest month will be confirmed during import.") : !error ? `${monthLabel(start, language)} — ${monthLabel(end, language)}` : zh ? "填写起止月份，或使用上方快捷选择。" : "Enter both months or use a preset above."}</span></div>
      </div>
      {error && <p className="period-range-error" id={`${id}-error`} role="alert">{errors[error][language]}</p>}
      <p className="period-scope-note" id={`${id}-scope`}>{zh ? "当月尚未结束，不纳入统计。平台可能只提供部分月份，缺失结果会单独说明。" : "The current month is excluded. Platforms may only provide some months; missing results will be identified."}</p>
      <button type="submit" className="button primary period-continue" disabled={!!error}>{zh ? "继续，开始读取" : "Continue and start reading"}<ArrowRight size={17} aria-hidden="true" /></button>
    </form>
    <button type="button" className="period-back" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />{zh ? "继续连接其他平台" : "Connect another platform"}</button>
  </section>;
}
