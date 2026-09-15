import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { db, getSetting, setSetting } from "../../db";
import { useApp } from "../../state/AppContext";
import { navigate } from "../../router";
import { isLastStep, placeCard, screenAt, shouldAutoOpen, stepAt, TOUR_SCREEN_COUNT, TOUR_SEEN_KEY, TOUR_SETTLE_MS, visibleRect, type CardPlacement, type Rect } from "../../lib/tour";
import { trapTab } from "../ui";
import { t } from "../../i18n";

/**
 * What a step points at when it is not pointing at a control: the rail item that opens its screen.
 *
 * A phone has no rail — navigation lives in a drawer that is closed — so the step points at the
 * title of the screen it has just opened instead. Ten cards in a row ringing the one button that
 * opens the drawer would say nothing; the title says which screen the card is about, which is what
 * the rail letter says on a wider window.
 */
function screenItem(route: string | undefined): HTMLElement | null {
  if (!route) return null;
  // Both are asked for by route, so a screen that has not been drawn yet answers with nothing and
  // the step keeps measuring. Matching whatever title happened to be on screen pointed the card at
  // the screen before it, which is the one the reader has just left.
  return document.querySelector<HTMLElement>(`.rail [data-route="${route}"]`) ?? document.querySelector<HTMLElement>(`.main-region[data-route="${route}"] .page-header-title h1`);
}

/** The control a step is about, once the screen holding it is on. */
function focusItem(name: string | undefined): HTMLElement | null {
  return name ? document.querySelector<HTMLElement>(`[data-tour="${name}"]`) : null;
}

/** How far the hole in the dimmed page is opened out around the control it is showing. */
const SPOT_PAD = 4;

/** Where an element is, clipped to the window so the highlight cannot run off the edge of it. */
function rectOf(el: HTMLElement | null): Rect | undefined {
  const r = el?.getBoundingClientRect();
  if (!r) return undefined;
  return visibleRect({ left: r.left, top: r.top, width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight }, SPOT_PAD);
}

/**
 * The blocking layer for a card that lets the reader work the control it points at: four panes
 * around the hole rather than one over the whole page. Everything else stays dead to clicks, so the
 * tour keeps its place, and the control inside the hole takes its press.
 */
function BlockAround({ hole }: { hole: Rect }) {
  const left = Math.max(0, hole.left - SPOT_PAD);
  const top = Math.max(0, hole.top - SPOT_PAD);
  const right = hole.left + hole.width + SPOT_PAD;
  const bottom = hole.top + hole.height + SPOT_PAD;
  return (
    <div aria-hidden="true">
      <div className="tour-pane" style={{ left: 0, right: 0, top: 0, height: top }} />
      <div className="tour-pane" style={{ left: 0, right: 0, top: bottom, bottom: 0 }} />
      <div className="tour-pane" style={{ left: 0, width: left, top, height: bottom - top }} />
      <div className="tour-pane" style={{ left: right, right: 0, top, height: bottom - top }} />
    </div>
  );
}

/**
 * The tour of the app: one card at a time, two cards per screen. The first points at the rail item
 * that opens the screen, the second at the control the screen is about.
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
  const { ready, tourOpen, openTour, closeTour, snapshot } = useApp();
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState<CardPlacement | undefined>(undefined);
  const [spot, setSpot] = useState<Rect | undefined>(undefined);
  // Whether the highlight ended up on the step's control rather than on the rail item. The ring is
  // drawn around a control and not around a letter, and a control that is not on screen leaves the
  // step on the rail item.
  const [onControl, setOnControl] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const current = stepAt(step);
  // The card whose control the reader has pressed, held by index rather than as a flag so moving to
  // another card clears it without an effect of its own.
  const [actedOn, setActedOn] = useState<number | undefined>(undefined);

  // A card that offers an action leaves the reader free of the card: Tab reaches the control it is
  // pointing at, and the rest of the page is not hidden from a screen reader either.
  const actRef = useRef(false);
  actRef.current = current.act === true;

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

  // A card that offers an action watches for the press, which is what frees its Next.
  useEffect(() => {
    if (!tourOpen || !current.act) return;
    const name = current.focus;
    const onClick = (e: MouseEvent) => {
      const control = focusItem(name);
      if (control && e.target instanceof Node && control.contains(e.target)) setActedOn(step);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [tourOpen, step, current.act, current.focus]);

  // Each step opens its screen. The address is replaced rather than pushed, so a tour of ten screens
  // does not bury whatever the reader was looking at under ten presses of the back button.
  useEffect(() => {
    if (!tourOpen) return;
    const route = stepAt(step).route;
    if (route) navigate(route, true);
  }, [tourOpen, step]);

  /** Places the card, and says whether the step ended up pointing at what it is about. */
  const measure = useCallback((): boolean => {
    const card = cardRef.current;
    if (!card) return false;
    const current = stepAt(step);
    const control = rectOf(focusItem(current.focus));
    const anchor = control ?? rectOf(screenItem(current.route));
    const box = card.getBoundingClientRect();
    setSpot(anchor);
    setOnControl(control !== undefined);
    setPos(placeCard(anchor, { width: window.innerWidth, height: window.innerHeight }, { width: box.width, height: box.height }));
    return current.focus ? control !== undefined : anchor !== undefined;
  }, [step]);

  useLayoutEffect(() => {
    if (!tourOpen) return;
    // Nothing under the tour is scrolled to bring a highlight into view. The screen a step opens has
    // only just been laid out, so a scroll taken on this pass lands in the wrong place and is
    // corrected a frame later, which reads as a flash behind the card. Every control a step points
    // at sits at the top of its screen, where it is already in view.
    measure();
    // The screen has not been drawn yet on this pass, and the rail is as wide as whatever it is
    // showing, so the position is taken again once the browser has drawn it. The step keeps
    // measuring until it has what it is pointing at on screen, and gives up after a moment so a
    // screen that never shows it settles on whatever it could find.
    //
    // It waits on the thing itself rather than on the element being in the document. A screen whose
    // title is the anchor has nothing to measure until that screen has been drawn, which is a frame
    // or more after the step opened it, and a control that is in the document but scrolled out of
    // sight is not something to point at either.
    const deadline = performance.now() + TOUR_SETTLE_MS;
    let frame = 0;
    const again = () => {
      const settled = measure();
      if (!settled && performance.now() < deadline) frame = requestAnimationFrame(again);
    };
    frame = requestAnimationFrame(again);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [tourOpen, step, measure]);

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
      } else if (cardRef.current && !actRef.current) trapTab(e, cardRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("tour-open");
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus({ preventScroll: true });
    };
  }, [tourOpen]);

  if (!tourOpen) return null;

  const last = isLastStep(step);
  const screen = screenAt(step);
  // A card that offers the data holds its Next until the button beside it has been pressed, so the
  // rest of the tour is walked with data in the app. Skip is how somebody leaves without it. The
  // closing card's button says Done and is never held, or there would be no way out of the tour.
  const waiting = current.act === true && !last && !snapshot && actedOn !== step;
  // The card that offers the tour. Its two buttons accept or decline rather than move through the
  // steps, and there is nothing behind it to go back to.
  const welcome = step <= 0;

  return (
    <>
      {current.act && spot ? <BlockAround hole={spot} /> : <div className="tour-block" aria-hidden="true" />}
      {spot ? (
        <div className="tour-spot" data-at={onControl ? "control" : "rail"} style={{ left: spot.left - SPOT_PAD, top: spot.top - SPOT_PAD, width: spot.width + SPOT_PAD * 2, height: spot.height + SPOT_PAD * 2 }} aria-hidden="true">
          {/* Keyed by the step, so each card gets a new ring and with it the animation from the
              start. The hole itself is not keyed, so it still travels from one card to the next. */}
          <div className="tour-ring" key={step} />
        </div>
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      {/*
        Until the card has been measured it is transparent rather than hidden. The measuring runs
        before the browser paints, so nothing is seen either way, but a `visibility: hidden` card
        cannot take focus — and the effect that gives it focus runs while the first, unplaced
        commit is still the one in the document.
      */}
      <div
        className="tour-card"
        role="dialog"
        aria-modal={!current.act}
        aria-labelledby={titleId}
        ref={cardRef}
        tabIndex={-1}
        data-side={pos?.side ?? "centre"}
        style={pos ? ({ left: pos.left, top: pos.top, "--tour-arrow": `${pos.arrow}px` } as CSSProperties) : { opacity: 0, pointerEvents: "none" }}
      >
        <div className="tour-text" aria-live="polite">
          {screen === undefined ? null : (
            <p className="tour-count mono">{t("tour.count", { n: screen, total: TOUR_SCREEN_COUNT })}</p>
          )}
          <h2 className="t-title" id={titleId}>
            {t(current.titleKey)}
          </h2>
          <p className="tour-body">{t(current.loadedBodyKey && snapshot ? current.loadedBodyKey : current.bodyKey)}</p>
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
          <button type="button" className="primary sm" disabled={waiting} onClick={last ? finish : () => setStep((i) => i + 1)}>
            {t(welcome ? "tour.start" : last ? "tour.done" : "tour.next")}
          </button>
        </div>
      </div>
    </>
  );
}
