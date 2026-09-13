import type { Route } from "../router";
import type { I18nKey } from "../i18n";

/**
 * The guided tour shown the first time somebody opens the app.
 *
 * This module holds everything about the tour that can be decided without a browser: which screens
 * it visits and in what order, whether it should open by itself, and where its card goes beside the
 * item it is pointing at. `components/shell/Tour.tsx` measures the page and draws it.
 */

/** Settings key holding `true` once the tour has been finished, skipped, or judged unnecessary. */
export const TOUR_SEEN_KEY = "tour.seen";

export interface TourStep {
  id: string;
  /** The screen the step is about. The tour opens it as the step comes up. */
  route?: Route;
  titleKey: I18nKey;
  bodyKey: I18nKey;
  /**
   * The `data-tour` name of the control the step is really about. The highlight starts on the rail
   * item, so the reader sees which screen they are on, and then moves here. A step whose control is
   * not on screen — a picker that lives in a sheet on a phone, a button a screen only shows once it
   * has data — keeps the highlight on the rail item.
   */
  focus?: string;
}

/** How long the highlight rests on the rail item before it travels to the step's control. */
export const TOUR_FOCUS_DELAY_MS = 850;

/**
 * The tour in reading order: a first card that offers the walk, then one stop per destination in
 * the rail.
 *
 * Data comes first because the app holds no game data until somebody loads some, and every screen
 * after it is empty until they do. The rest follow the rail from top to bottom, so the run of
 * highlights reads down the column the reader is looking at.
 *
 * A stop is titled with the name its rail item carries rather than with a heading of its own, so the
 * card and the letter it is pointing at always say the same thing.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: "welcome", titleKey: "tour.welcome.title", bodyKey: "tour.welcome.body" },
  { id: "data", route: "data", titleKey: "nav.data", bodyKey: "tour.data.body", focus: "data-fetch" },
  { id: "calculator", route: "calculator", titleKey: "nav.calculator", bodyKey: "tour.calculator.body", focus: "calc-unit" },
  { id: "scenarios", route: "scenarios", titleKey: "nav.scenarios", bodyKey: "tour.scenarios.body", focus: "scenarios-new" },
  { id: "armies", route: "armies", titleKey: "nav.armies", bodyKey: "tour.armies.body", focus: "armies-new" },
  { id: "collection", route: "collection", titleKey: "nav.collection", bodyKey: "tour.collection.body", focus: "collection-add" },
  { id: "codex", route: "codex", titleKey: "nav.codex", bodyKey: "tour.codex.body", focus: "codex-filter" },
  { id: "analyses", route: "analyses", titleKey: "nav.analyses", bodyKey: "tour.analyses.body", focus: "analyses-run" },
  { id: "battle", route: "battle", titleKey: "nav.battle", bodyKey: "tour.battle.body", focus: "battle-tools" },
  { id: "play", route: "play", titleKey: "nav.play", bodyKey: "tour.play.body", focus: "play-start" },
  { id: "about", route: "about", titleKey: "nav.about", bodyKey: "tour.about.body" },
];

/** Stops that name a screen, which is what the "3 / 10" counter on the card counts. */
export const TOUR_SCREEN_COUNT = TOUR_STEPS.filter((s) => s.route !== undefined).length;

export function stepAt(index: number): TourStep {
  return TOUR_STEPS[clampStep(index)]!;
}

export function clampStep(index: number): number {
  return Math.min(Math.max(Math.trunc(index), 0), TOUR_STEPS.length - 1);
}

export function isLastStep(index: number): boolean {
  return clampStep(index) === TOUR_STEPS.length - 1;
}

/**
 * Whether the tour opens by itself.
 *
 * It opens on a device that has not seen it and has nothing saved on it. Somebody who already has a
 * snapshot or an army on this device has been using the app since before the tour existed, and
 * walking them through screens they know would be the wrong greeting.
 */
export function shouldAutoOpen(seen: unknown, hasStoredWork: boolean): boolean {
  return seen !== true && !hasStoredWork;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Which side of the highlighted control the card ended up on, which is the edge its arrow is on. */
export type CardSide = "right" | "left" | "below" | "above" | "centre";

export interface CardPlacement {
  left: number;
  top: number;
  side: CardSide;
  /**
   * Where the arrow sits along the edge it is on, measured from the top of the card for a card
   * beside the control and from its left for one under or over it. The card is centred on the
   * control until one of them runs into the edge of the window, and then only the arrow can follow
   * it, so the arrow is placed rather than pinned to the middle.
   */
  arrow: number;
}

/** Space between the highlighted item and the card. */
export const CARD_GAP = 16;
/** Space the card keeps from the edges of the window. */
export const VIEWPORT_MARGIN = 12;
/** How near a corner the arrow may go before it would stop looking like part of the card. */
const ARROW_INSET = 16;

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi);
}

/** The arrow's offset along an edge of `length`, kept clear of both corners. */
function arrowAt(offset: number, length: number): number {
  return Math.round(clamp(offset, Math.min(ARROW_INSET, length / 2), Math.max(length - ARROW_INSET, length / 2)));
}

function centred(viewport: Size, card: Size, margin: number): CardPlacement {
  return {
    left: Math.round(clamp((viewport.width - card.width) / 2, margin, viewport.width - card.width - margin)),
    top: Math.round(clamp((viewport.height - card.height) / 2, margin, viewport.height - card.height - margin)),
    side: "centre",
    arrow: 0,
  };
}

/**
 * Where to put the card for a step.
 *
 * Beside the highlighted control when there is room, level with it, on the right by preference. A
 * control too wide for either side — a toolbar, a row of filters — takes the card underneath it
 * instead, and above it when there is no room below. With nothing to point at, which is a phone,
 * where navigation lives in a drawer, the card sits in the middle of the window.
 */
export function placeCard(anchor: Rect | undefined, viewport: Size, card: Size, gap = CARD_GAP, margin = VIEWPORT_MARGIN): CardPlacement {
  if (!anchor) return centred(viewport, card, margin);
  const maxLeft = viewport.width - card.width - margin;
  const maxTop = viewport.height - card.height - margin;
  const midX = anchor.left + anchor.width / 2;
  const midY = anchor.top + anchor.height / 2;
  const right = anchor.left + anchor.width + gap;
  const left = anchor.left - gap - card.width;
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - card.height;

  if (right <= maxLeft || left >= margin) {
    const side = right <= maxLeft ? "right" : "left";
    const top = clamp(midY - card.height / 2, margin, maxTop);
    return { left: Math.round(side === "right" ? right : left), top: Math.round(top), side, arrow: arrowAt(midY - top, card.height) };
  }
  if (below <= maxTop || above >= margin) {
    const side = below <= maxTop ? "below" : "above";
    const boxLeft = clamp(midX - card.width / 2, margin, maxLeft);
    return { left: Math.round(boxLeft), top: Math.round(side === "below" ? below : above), side, arrow: arrowAt(midX - boxLeft, card.width) };
  }
  return centred(viewport, card, margin);
}
