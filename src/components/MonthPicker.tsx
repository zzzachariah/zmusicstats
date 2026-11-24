import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "./Modal";
import type { Language } from "../lib/i18n";
import "./months.css";

export function MonthPicker({ language, selected, demo, onClose, onApply }: {
  language: Language; selected: string[]; demo: boolean; onClose: () => void; onApply: (months: string[]) => void;
}) {
  const zh = language === "zh";
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, setYear] = useState(Number(selected.at(-1)?.slice(0, 4)) || currentYear);
  const [draft, setDraft] = useState(() => new Set(selected));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const allowed = months.filter(m => demo ? ["2026-09", "2026-10"].includes(m) : m <= currentMonth);
  const toggle = (month: string) => setDraft(previous => {
    const next = new Set(previous);
    if (next.has(month)) next.delete(month); else next.add(month);
    return next;
  });
  return <Modal title={zh ? "收藏一段时光" : "Choose your listening months"}
    subtitle={zh ? "可以跨年多选。应用后合并所选月份，至少选择一个月。" : "Select across years. Choose at least one month to build your report."}
    closeLabel={zh ? "关闭" : "Close"} onClose={onClose}>
    <div className="month-picker-year">
      <button className="icon-button" aria-label={zh ? "上一年" : "Previous year"} disabled={demo || year <= 2000} onClick={() => setYear(year - 1)}><ChevronLeft size={20} /></button>
      <select aria-label={zh ? "年份" : "Year"} value={year} disabled={demo} onChange={event => setYear(Number(event.target.value))}>
        {Array.from({length: currentYear - 1999}, (_, i) => currentYear - i).map(value => <option key={value}>{value}</option>)}
      </select>
      <button className="icon-button" aria-label={zh ? "下一年" : "Next year"} disabled={demo || year >= currentYear} onClick={() => setYear(year + 1)}><ChevronRight size={20} /></button>
    </div>
    <div className="month-grid">
      {months.map((month, i) => <button key={month} className={draft.has(month) ? "selected" : ""} aria-pressed={draft.has(month)} disabled={!allowed.includes(month)} onClick={() => toggle(month)}>
        <span>{zh ? `${i + 1} 月` : new Intl.DateTimeFormat("en", {month:"short"}).format(new Date(year, i, 15))}</span>
        <Check size={14} aria-hidden="true" />
      </button>)}
    </div>
    <div className="month-picker-tools">
      <button className="text-button" onClick={() => setDraft(new Set([...draft, ...allowed]))}>{zh ? "全选本年" : "Select this year"}</button>
      <button className="text-button" onClick={() => setDraft(new Set())}>{zh ? "清空选择" : "Clear selection"}</button>
      <span aria-live="polite">{zh ? `已选 ${draft.size} 个月` : `${draft.size} selected`}</span>
    </div>
    {draft.size > 0 && <p className="selected-month-list">{[...draft].sort().join(" · ")}</p>}
    <p className="scope-note">{draft.size === 0 ? (zh ? "请选择至少一个月份后应用。" : "Choose at least one month to apply.") : demo ? (zh ? "演示报告提供 2026 年 9 月和 10 月。" : "Demo reports cover September and October 2026.") : (zh ? "可选择历史月份；实际能读取的范围取决于音乐平台。空白结果会单独标明。" : "Historical availability depends on each platform. Missing results will be shown separately.")}</p>
    <button className="button primary month-apply" disabled={draft.size === 0} onClick={() => onApply([...draft].sort())}>{zh ? "应用所选月份" : "Apply selected months"}</button>
  </Modal>;
}
