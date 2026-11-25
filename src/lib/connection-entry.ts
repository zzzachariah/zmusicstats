/** Resume the step the user chose; authorizing an account never advances onboarding. */
export function restoredConnectionEntry(pending: string | null, hasSavedMonths: boolean): "connections" | "period" | "report" {
  if (pending === "period") return "period";
  if (pending || !hasSavedMonths) return "connections";
  return "report";
}
