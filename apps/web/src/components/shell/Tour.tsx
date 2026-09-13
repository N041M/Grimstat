import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { db, getSetting, setSetting } from "../../db";
import { useApp } from "../../state/AppContext";
import { navigate } from "../../router";
import { isLastStep, placeCard, shouldAutoOpen, stepAt, TOUR_FOCUS_DELAY_MS, TOUR_SCREEN_COUNT, TOUR_SEEN_KEY, type CardPlacement, type Rect } from "../../lib/tour";
import { trapTab } from "../ui";
import { t } from "../../i18n";

/** The rail item a step points at. There is none on a phone, where navigation lives in a drawer. */
function railItem(route: string | undefined): HTMLElement | null {
  return route ? document.querySelector<HTMLElement>(`.rail [data-route="${route}"]`) : null;
}

/** The control a step is about, once the screen holding it is on. */
function focusItem(name: string | undefined): HTMLElement | null {
  return name ? document.querySelector<HTMLElement>(`[data-tour="${name}"]`) : null;
}

function rectOf(el: HTMLElement | null): Rect | undefined {
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : undefined;
}

/** How far the hole in the dimmed page is opened out around the control it is showing. */
const SPOT_PAD = 4;

/**
 * The tour of the app: one card at a time, each opening a screen and pointing at the rail item that
 * leads back to it.
 *
 * It opens by itself on a device that has never run the app (see `shouldAutoOpen`), and afterwards
 * from the About screen or the command palette. Reaching the end, skipping, or pressing Escape all
 * record that it has been seen, so it greets somebody once and then stays out of the way.
 *
 * The page behind is dimmed and cannot be worked while the tour is up: the steps drive the address
 * themselves, and a click that changed screen underneath would leave the card describing something
 * else. Clicking the dimmed page does nothing, rather than closing the tour, because a tour is a
 * sequence and losing it to a stray click halfway through is no help to anybody.
 */
export function Tour() {
  const { ready, tourOpen, openTour, closeTour } = useApp();
  const [step, setStep] = useState(0);
  // "rail" shows which screen the step is on, "focus" the control the step is about. Every step
  // starts on the rail and travels, so the reader sees the two connected.
  const [phase, setPhase] = useState<"rail" | "focus">("rail");
  const [pos, setPos] = useState<CardPlacement | undefined>(undefined);
  const [spot, setSpot] = useState<Rect | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const finish = useCallback(() => {
    closeTour();
    void setSetting(TOUR_SEEN_KEY, true).catch(() => undefined);
  }, [closeTour]);

  // The keydown handler below is set up when the tour opens, so it reads `finish` through a ref
  // rather than tearing down and setting up again on every render of the shell.
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // A first visit: nothing seen, and nothing on the device to suggest the app has been used before.
  // A device that has been used gets the flag written instead, so it is never greeted later.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void (async () => {
      const seen = await getSetting<unknown>(TOUR_SEEN_KEY).catch(() => true);
      if (seen === true || !alive) return;
      const stored = await Promise.all([db.snapshots.count(), db.rosters.count()]).catch(() => [1, 1]);
      if (!alive) return;
      if (shouldAutoOpen(seen, stored.some((n) => n > 0))) openTour();
      else void setSetting(TOUR_SEEN_KEY, true).catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, [ready, openTour]);

  useEffect(() => {
    if (tourOpen) setStep(0);
  }, [tourOpen]);

  // The travel to the step's control. The wait also covers the screen arriving: a control that is
  // not in the document when the timer fires — the battle table is still loading, a picker is in a
  // sheet on a phone — leaves the highlight on the rail item, and the next step starts over.
  useEffect(() => {
    setPhase("rail");
    if (!tourOpen) return;
    const name = stepAt(step).focus;
    if (!name) return;
    const timer = window.setTimeout(() => {
      if (focusItem(name)) setPhase("focus");
    }, TOUR_FOCUS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [tourOpen, step]);

  // Each step opens its screen. The address is replaced rather than pushed, so a tour of ten screens
  // does not bury whatever the reader was looking at under ten presses of the back button.
  useEffect(() => {
    if (!tourOpen) return;
    const route = stepAt(step).route;
    if (route) navigate(route, true);
  }, [tourOpen, step]);

  const measure = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    const current = stepAt(step);
    const anchor = (phase === "focus" ? rectOf(focusItem(current.focus)) : undefined) ?? rectOf(railItem(current.route));
    const box = card.getBoundingClientRect();
    setSpot(anchor);
    setPos(placeCard(anchor, { width: window.innerWidth, height: window.innerHeight }, { width: box.width, height: box.height }));
  }, [step, phase]);

  useLayoutEffect(() => {
    if (!tourOpen) return;
    const current = stepAt(step);
    // A tablet's rail scrolls and a screen may be taller than the window, so whatever is about to be
    // highlighted is brought into view before it is measured.
    ((phase === "focus" ? focusItem(current.focus) : null) ?? railItem(current.route))?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
    // The screen the step opened has not been laid out yet on this pass, and the rail is as wide as
    // whatever it is showing, so the position is taken again once the browser has drawn it.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [tourOpen, step, phase, measure]);

  useEffect(() => {
    if (!tourOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cardRef.current?.focus({ preventScroll: true });
    document.body.classList.add("tour-open");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // The tour is the layer on top, so Escape ends it and goes no further.
        e.stopPropagation();
        finishRef.current();
      } else if (cardRef.current) trapTab(e, cardRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("tour-open");
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus({ preventScroll: true });
    };
  }, [tourOpen]);

  if (!tourOpen) return null;

  const current = stepAt(step);
  const last = isLastStep(step);
  const welcome = current.route === undefined;

  return (
    <>
      <div className="tour-block" aria-hidden="true" />
      {spot ? <div className="tour-spot" data-phase={phase} style={{ left: spot.left - SPOT_PAD, top: spot.top - SPOT_PAD, width: spot.width + SPOT_PAD * 2, height: spot.height + SPOT_PAD * 2 }} aria-hidden="true" /> : <div className="tour-dim" aria-hidden="true" />}
      {/*
        Until the card has been measured it is transparent rather than hidden. The measuring runs
        before the browser paints, so nothing is seen either way, but a `visibility: hidden` card
        cannot take focus — and the effect that gives it focus runs while the first, unplaced
        commit is still the one in the document.
      */}
      <div
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={cardRef}
        tabIndex={-1}
        data-side={pos?.side ?? "centre"}
        style={pos ? ({ left: pos.left, top: pos.top, "--tour-arrow": `${pos.arrow}px` } as CSSProperties) : { opacity: 0, pointerEvents: "none" }}
      >
        <div className="tour-text" aria-live="polite">
          {welcome ? null : (
            <p className="tour-count mono">{t("tour.count", { n: step, total: TOUR_SCREEN_COUNT })}</p>
          )}
          <h2 className="t-title" id={titleId}>
            {t(current.titleKey)}
          </h2>
          <p className="tour-body">{t(current.bodyKey)}</p>
          {welcome ? <p className="tour-meta">{t("tour.welcome.meta")}</p> : null}
        </div>
        <div className="tour-foot">
          <button type="button" className="ghost sm" onClick={finish}>
            {t(welcome ? "tour.notNow" : "tour.skip")}
          </button>
          <span className="tour-foot-gap" />
          {welcome ? null : (
            <button type="button" className="sm" onClick={() => setStep((i) => i - 1)}>
              {t("tour.back")}
            </button>
          )}
          <button type="button" className="primary sm" onClick={last ? finish : () => setStep((i) => i + 1)}>
            {t(welcome ? "tour.start" : last ? "tour.done" : "tour.next")}
          </button>
        </div>
      </div>
    </>
  );
}
