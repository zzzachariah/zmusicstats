import { useEffect, useRef } from "react";
import { emptyReportGesture, nextReportGesture, suspendedReportGesture, REPORT_GESTURE_IDLE_MS } from "./report-slide-gesture";

const DESKTOP_SLIDES = "(min-width: 1024px) and (min-height: 650px) and (hover: hover) and (pointer: fine)";
const SLIDE = "[data-report-slide]";
const INTERNAL_SCROLL = ".ranking-scroll-area, .slide-scroll-area";
const INTERACTIVE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-report-wheel-ignore]';
const DIALOG = 'dialog[open], [role="dialog"], [aria-modal="true"]';

/** Desktop wheel paging. Touch, keyboard, dialogs, and form fields keep native behavior. */
export function useReportSlides(enabled: boolean): void {
  const lastContextWheel = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      // Closing a dialog must not turn its remaining trackpad inertia into a
      // fresh page gesture. Observe only; native dialog scrolling stays intact.
      const observeWheel = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey && Number.isFinite(event.deltaY)
          && event.deltaY !== 0 && Math.abs(event.deltaY) > Math.abs(event.deltaX)) lastContextWheel.current = performance.now();
      };
      window.addEventListener("wheel", observeWheel, { passive: true });
      return () => window.removeEventListener("wheel", observeWheel);
    }
    const desktop = window.matchMedia(DESKTOP_SLIDES);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let gesture = emptyReportGesture();
    let gestureArea: HTMLElement | null = null;
    let transitioning = false;
    let frame = 0;
    let boundaryFrame = 0;
    const markedAreas = new Set<HTMLElement>();
    const root = document.getElementById("root");

    const reset = () => { gesture = emptyReportGesture(); gestureArea = null; transitioning = false; cancelAnimationFrame(frame); };
    const clearBoundaries = () => { for (const area of markedAreas) area.classList.remove("is-at-boundary"); markedAreas.clear(); };
    const updateBoundaries = () => {
      boundaryFrame = 0;
      if (!desktop.matches) { clearBoundaries(); return; }
      const areas = new Set(root?.querySelectorAll<HTMLElement>(INTERNAL_SCROLL) ?? []);
      for (const area of markedAreas) if (!areas.has(area)) { area.classList.remove("is-at-boundary"); markedAreas.delete(area); }
      for (const area of areas) {
        const maximum = area.scrollHeight - area.clientHeight;
        area.classList.toggle("is-at-boundary", maximum > 1 && (area.scrollTop <= 1 || area.scrollTop >= maximum - 1));
        markedAreas.add(area);
      }
    };
    const scheduleBoundaries = () => { if (!boundaryFrame) boundaryFrame = requestAnimationFrame(updateBoundaries); };
    const activate = () => {
      reset();
      if (lastContextWheel.current !== null && performance.now() - lastContextWheel.current < REPORT_GESTURE_IDLE_MS) {
        gesture = suspendedReportGesture(lastContextWheel.current);
      }
      document.documentElement.classList.toggle("report-slides-enabled", desktop.matches);
      scheduleBoundaries();
    };
    const followTransition = () => {
      cancelAnimationFrame(frame);
      transitioning = true;
      const started = performance.now();
      let lastY = window.scrollY;
      let stable = 0;
      const check = (now: number) => {
        stable = Math.abs(window.scrollY - lastY) < .5 ? stable + 1 : 0;
        lastY = window.scrollY;
        if (now - started >= 1400 || (now - started > 100 && stable >= 4)) { transitioning = false; return; }
        frame = requestAnimationFrame(check);
      };
      frame = requestAnimationFrame(check);
    };

    const onWheel = (event: WheelEvent) => {
      if (!desktop.matches || event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || event.shiftKey
        || !Number.isFinite(event.deltaY) || event.deltaY === 0 || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const now = performance.now();
      lastContextWheel.current = now;
      const target = event.target instanceof Element ? event.target : null;
      // Portals mounted outside the app root are deliberately excluded.
      if (!target || !root?.contains(target) || root.inert || target.closest(INTERACTIVE)
        || [...document.querySelectorAll<HTMLElement>(DIALOG)].some(dialog => dialog.getClientRects().length > 0)) {
        gesture = suspendedReportGesture(now);
        gestureArea = null;
        return;
      }
      if (!target.closest(SLIDE)) {
        // During a turn the stationary pointer can briefly pass over a gap.
        // Keep absorbing the same gesture there, without paging from the toolbar.
        if (transitioning || (gesture.mode === "locked" && gesture.lastAt !== null && now - gesture.lastAt < REPORT_GESTURE_IDLE_MS)) {
          event.preventDefault();
          gesture = { ...gesture, lastAt: now, mode: "locked", delta: 0, lockReason: gesture.lockReason ?? "slide" };
        } else gesture = emptyReportGesture();
        return;
      }
      const slides = [...root.querySelectorAll<HTMLElement>(SLIDE)].filter(slide => slide.getClientRects().length > 0);
      if (!slides.length) return;
      const reference = Math.min(window.innerHeight * .35, 280);
      let current = slides.findIndex(slide => { const rect = slide.getBoundingClientRect(); return rect.top <= reference && rect.bottom > reference; });
      if (current < 0) current = slides.reduce((nearest, slide, index) => Math.abs(slide.getBoundingClientRect().top) < Math.abs(slides[nearest].getBoundingClientRect().top) ? index : nearest, 0);
      const direction = event.deltaY < 0 ? -1 : 1;
      const next = slides[current + direction];
      const unit = event.deltaMode === 1 ? (parseFloat(getComputedStyle(target).lineHeight) || 16) : event.deltaMode === 2 ? window.innerHeight : 1;
      const deltaY = event.deltaY * unit;
      const fresh = gesture.lastAt === null || now - gesture.lastAt >= REPORT_GESTURE_IDLE_MS;
      if (fresh) gestureArea = null;
      const owner = target.closest<HTMLElement>(SLIDE)!;
      const areas: HTMLElement[] = [];
      // Include actual overflow containers as well as the named areas, so an
      // expanded method panel can scroll when its parent has overflow:auto.
      for (let element: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement; element && owner.contains(element); element = element.parentElement) {
        if (element.scrollHeight > element.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(element).overflowY)) areas.push(element);
        if (element === owner) break;
      }
      const room = (area: HTMLElement) => Math.max(0, direction < 0 ? area.scrollTop : area.scrollHeight - area.clientHeight - area.scrollTop);
      // Keep one gesture in its original list. Crossing a nested edge cannot
      // silently transfer the remaining inertia to the parent or next slide.
      const area = !fresh && gesture.mode === "internal" && gestureArea
        ? areas.includes(gestureArea) ? gestureArea : undefined
        : areas.find(candidate => room(candidate) > 1);
      const remaining = area ? room(area) : 0;
      const decision = nextReportGesture(gesture, {
        now, deltaY, canScrollInside: remaining > 1,
        hasAdjacentSlide: !!next, transitioning,
      });
      gesture = decision.state;
      if (decision.state.mode === "internal" && area) gestureArea = area;
      if (decision.action === "native") {
        // A single large wheel event may cross the list edge. Clamp that event
        // to the list so its unused distance cannot scroll the document.
        if (area && remaining > 1 && (area !== areas[0] || Math.abs(deltaY) >= remaining)) {
          event.preventDefault();
          area.scrollTop += direction * Math.min(Math.abs(deltaY), remaining);
          scheduleBoundaries();
        } else if (areas.length && !area && !next) {
          // Escape overscroll-behavior:contain at the first/last slide, once a
          // fresh gesture has finished scrolling the inner list.
          event.preventDefault();
          window.scrollBy({ top: deltaY, behavior: "auto" });
        }
        return;
      }
      event.preventDefault();
      if (decision.action === "advance" && next) {
        const offset = Math.max(parseFloat(getComputedStyle(next).scrollMarginTop) || 0, parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0);
        const top = next.id === "report-summary" ? 0 : Math.max(0, window.scrollY + next.getBoundingClientRect().top - offset);
        window.scrollTo({ top, behavior: reduced.matches ? "auto" : "smooth" });
        followTransition();
      }
    };
    const observer = new MutationObserver(scheduleBoundaries);
    if (root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "hidden"] });
    activate();
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", scheduleBoundaries, { passive: true });
    root?.addEventListener("scroll", scheduleBoundaries, true);
    desktop.addEventListener("change", activate);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", scheduleBoundaries);
      root?.removeEventListener("scroll", scheduleBoundaries, true);
      desktop.removeEventListener("change", activate);
      observer.disconnect(); cancelAnimationFrame(boundaryFrame);
      document.documentElement.classList.remove("report-slides-enabled");
      clearBoundaries(); reset();
    };
  }, [enabled]);
}
