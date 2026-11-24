export const MIN_REPORT_MONTH = "2005-01";
export const MAX_PERIOD_MONTHS = 400;

export type PeriodSelectionError = "empty" | "invalid" | "before-minimum" | "unfinished" | "reversed" | "too-long";
export type PeriodSelection = { months: string[]; error: PeriodSelectionError | null };

function monthIndex(month: string): number | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
}

function fromIndex(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}

/** China uses UTC+8 throughout the supported range; local computer timezone is irrelevant. */
export function latestCompletedMonth(now = Date.now()): string {
  if (!Number.isFinite(now)) throw new Error("INVALID_CURRENT_TIME");
  const china = new Date(now + 8 * 60 * 60_000);
  if (!Number.isFinite(china.getTime())) throw new Error("INVALID_CURRENT_TIME");
  return fromIndex(china.getUTCFullYear() * 12 + china.getUTCMonth() - 1);
}

/** Validate before allocating. The floor is a UI bound, not the account's first listening month. */
export function validatePeriodSelection(start: string, end: string, latest = latestCompletedMonth()): PeriodSelection {
  const fail = (error: PeriodSelectionError): PeriodSelection => ({ months: [], error });
  if (!start || !end) return fail("empty");
  const first = monthIndex(start), last = monthIndex(end), maximum = monthIndex(latest);
  if (first === null || last === null || maximum === null) return fail("invalid");
  if (first < monthIndex(MIN_REPORT_MONTH)! || last < monthIndex(MIN_REPORT_MONTH)!) return fail("before-minimum");
  if (first > last) return fail("reversed");
  if (last > maximum) return fail("unfinished");
  const length = last - first + 1;
  if (length > MAX_PERIOD_MONTHS) return fail("too-long");
  return { months: Array.from({ length }, (_, offset) => fromIndex(first + offset)), error: null };
}

export function recentCompletedMonths(count: number, now = Date.now()): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PERIOD_MONTHS) return [];
  const latest = latestCompletedMonth(now), end = monthIndex(latest)!;
  const start = Math.max(monthIndex(MIN_REPORT_MONTH)!, end - count + 1);
  return start > end ? [] : validatePeriodSelection(fromIndex(start), latest, latest).months;
}
