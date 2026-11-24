export const REPORT_GESTURE_IDLE_MS = 180;
export const REPORT_GESTURE_THRESHOLD_PX = 24;

export interface ReportGestureState {
  lastAt: number | null;
  mode: "idle" | "internal" | "document" | "locked";
  delta: number;
  direction: -1 | 1 | null;
  lockReason: "slide" | "edge" | "context" | null;
}

export const emptyReportGesture = (): ReportGestureState => ({ lastAt: null, mode: "idle", delta: 0, direction: null, lockReason: null });

/** Absorb a wheel tail that began over a dialog or another native control. */
export function suspendedReportGesture(now: number): ReportGestureState {
  return { ...emptyReportGesture(), lastAt: now, mode: "locked", lockReason: "context" };
}

/** A gesture that scrolled a list must end before it can turn the page. */
export function nextReportGesture(previous: ReportGestureState, input: {
  now: number;
  deltaY: number;
  canScrollInside: boolean;
  hasAdjacentSlide: boolean;
  transitioning: boolean;
}): { state: ReportGestureState; action: "native" | "consume" | "advance"; direction: -1 | 1 } {
  const fresh = previous.lastAt === null || input.now - previous.lastAt >= REPORT_GESTURE_IDLE_MS;
  const state: ReportGestureState = fresh ? { ...emptyReportGesture(), lastAt: input.now } : { ...previous, lastAt: input.now };
  const direction = input.deltaY < 0 ? -1 : 1;
  if (input.transitioning) {
    return { state: { ...state, mode: "locked", direction, lockReason: "slide" }, action: "consume", direction };
  }
  if (state.mode === "locked") {
    // Reversing away from a list edge is safe: it reads the same list rather
    // than turning another page. A slide-transition lock still requires idle.
    if (state.lockReason === "edge" && state.direction !== null && state.direction !== direction && input.canScrollInside) {
      return { state: { ...state, mode: "internal", direction, delta: 0, lockReason: null }, action: "native", direction };
    }
    return { state, action: "consume", direction };
  }
  if (state.mode === "document") {
    return input.hasAdjacentSlide
      ? { state: { ...state, mode: "locked", direction, lockReason: "edge" }, action: "consume", direction }
      : { state, action: "native", direction };
  }
  if (input.canScrollInside) {
    return { state: { ...state, mode: "internal", direction, delta: 0, lockReason: null }, action: "native", direction };
  }
  if (state.mode === "internal") {
    return { state: { ...state, mode: "locked", direction, lockReason: "edge" }, action: "consume", direction };
  }
  if (!input.hasAdjacentSlide) {
    return { state: { ...state, mode: "document", direction, delta: 0, lockReason: null }, action: "native", direction };
  }
  const delta = Math.sign(state.delta) === direction ? state.delta + input.deltaY : input.deltaY;
  if (Math.abs(delta) < REPORT_GESTURE_THRESHOLD_PX) {
    return { state: { ...state, direction, delta }, action: "consume", direction };
  }
  return { state: { ...state, mode: "locked", direction, delta: 0, lockReason: "slide" }, action: "advance", direction };
}
