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
   * The `data-tour` name of the control the step points at. Without one the step points at the rail
   * item for its route. A step whose control is not on screen — a picker that lives in a sheet on a
   * phone, a button a screen only shows once it has data — falls back to the rail item as well.
   */
  focus?: string;
  /**
   * A card that opens or closes the tour rather than walking one of the screens it counts through.
   * The counter on the card leaves these out, so a tour of ten screens reads 1 of 10 to 10 of 10.
   */
  bookend?: true;
  /**
   * Whether the reader may work the control this card points at. The page under the tour is dead to
   * clicks, so a card that offers an action has the blocking layer opened out around its control
   * instead of laid over it. Only the two data cards carry it: the tour is meant to be walked with
   * real data in the app, and pressing anything else — New army, Run — would put a dialog or a long
   * job over the card describing it.
   */
  act?: true;
  /** What the card says instead once the app has game data. A card that offers an action needs it. */
  loadedBodyKey?: I18nKey;
}

/**
 * How long a card that opens a screen keeps looking for the control it points at.
 *
 * A card that both opens a screen and points at a control has nothing to point at until the screen
 * has been drawn. It measures every frame until the control is there, and then stops. The limit is
 * for a screen that never shows it, which settles the card on the rail item instead.
 *
 * Three seconds rather than one: the closing card opens the data screen, which draws its stored
 * snapshots, its overrides and every tournament list on the device, and on a phone that took longer
 * than a second. The card settled on the rail while the button it is about was on screen beside it.
 */
export const TOUR_SETTLE_MS = 3000;

/**
 * The tour in reading order: a card that offers the walk, then two cards per screen, then a card
 * that closes it.
 *
 * A screen's first card lights the rail letter that opens it and says what the screen is for. The
 * cards after it move the highlight to the controls that screen is about, one at a time, each
 * saying what that control does. Most screens take one such card. The battle table takes three,
 * because it holds more than the others do. The reader clicks between them, so the highlight never
 * travels while they are still reading.
 *
 * Data comes first because the app holds no game data until somebody loads some, and every screen
 * after it is empty until they do. The rest follow the rail from top to bottom, so the run of
 * highlights reads down the column the reader is looking at.
 *
 * A card is titled with the name the thing it points at carries, so the card and the letter or the
 * button under the highlight always say the same thing.
 *
 * The data screen's card can be worked rather than only read. Pressing the button there loads the
 * data, and the nine screens after it are then walked with something on them. A reader who would
 * rather not wait carries on and the tour runs over empty screens as before.
 *
 * It closes back on the data screen, on the same button. That is the second chance for a reader who
 * carried on, and the way to fetch again for one who did not.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: "welcome", titleKey: "tour.welcome.title", bodyKey: "tour.welcome.body", bookend: true },
  { id: "data", route: "data", titleKey: "nav.data", bodyKey: "tour.data.body" },
  { id: "data-fetch", route: "data", titleKey: "data.fetchAll", bodyKey: "tour.data.fetch", loadedBodyKey: "tour.data.loaded", focus: "data-fetch", act: true },
  { id: "calculator", route: "calculator", titleKey: "nav.calculator", bodyKey: "tour.calculator.body" },
  { id: "calculator-unit", route: "calculator", titleKey: "side.attacker", bodyKey: "tour.calculator.attacker", focus: "calc-unit" },
  { id: "scenarios", route: "scenarios", titleKey: "nav.scenarios", bodyKey: "tour.scenarios.body" },
  { id: "scenarios-new", route: "scenarios", titleKey: "scenarios.new", bodyKey: "tour.scenarios.new", focus: "scenarios-new" },
  { id: "armies", route: "armies", titleKey: "nav.armies", bodyKey: "tour.armies.body" },
  { id: "armies-new", route: "armies", titleKey: "armies.new", bodyKey: "tour.armies.new", focus: "armies-new" },
  { id: "collection", route: "collection", titleKey: "nav.collection", bodyKey: "tour.collection.body" },
  { id: "collection-add", route: "collection", titleKey: "collection.add", bodyKey: "tour.collection.add", focus: "collection-add" },
  { id: "codex", route: "codex", titleKey: "nav.codex", bodyKey: "tour.codex.body" },
  { id: "codex-tabs", route: "codex", titleKey: "codex.tabs", bodyKey: "tour.codex.tabs", focus: "codex-tabs" },
  { id: "analyses", route: "analyses", titleKey: "nav.analyses", bodyKey: "tour.analyses.body" },
  { id: "analyses-run", route: "analyses", titleKey: "analyses.run", bodyKey: "tour.analyses.run", focus: "analyses-run" },
  // The table is the screen with the most on it, so it is the one screen walked in parts.
  { id: "battle", route: "battle", titleKey: "nav.battle", bodyKey: "tour.battle.body" },
  { id: "battle-tool", route: "battle", titleKey: "battle.tool", bodyKey: "tour.battle.tool", focus: "battle-tool" },
  { id: "battle-tools", route: "battle", titleKey: "battle.table.actions", bodyKey: "tour.battle.actions", focus: "battle-tools" },
  { id: "battle-layout", route: "battle", titleKey: "battle.pick.title", bodyKey: "tour.battle.layout", focus: "battle-layout" },
  { id: "play", route: "play", titleKey: "nav.play", bodyKey: "tour.play.body" },
  { id: "play-start", route: "play", titleKey: "play.setup.begin", bodyKey: "tour.play.start", focus: "play-start" },
  { id: "about", route: "about", titleKey: "nav.about", bodyKey: "tour.about.body" },
  { id: "fetch", route: "data", titleKey: "data.fetchAll", bodyKey: "tour.finish.body", loadedBodyKey: "tour.finish.loaded", focus: "data-fetch", act: true, bookend: true },
];

/** The screens the tour walks, in the order it reaches them, numbered from 1. */
const SCREEN_NUMBERS: ReadonlyMap<string, number> = new Map(
  TOUR_STEPS.filter((s) => !s.bookend && s.route !== undefined)
    .map((s) => s.route!)
    .filter((route, i, all) => all.indexOf(route) === i)
    .map((route, i) => [route, i + 1]),
);

/** How many screens the "3 of 10" counter on the card counts through. */
export const TOUR_SCREEN_COUNT = SCREEN_NUMBERS.size;

/**
 * The number the counter shows for a step. Both cards for a screen carry its number, so the counter
 * measures how far through the app the reader has come rather than how many cards are left. A
 * bookend carries no number and shows no counter.
 */
export function screenAt(index: number): number | undefined {
  const step = stepAt(index);
  return step.bookend || step.route === undefined ? undefined : SCREEN_NUMBERS.get(step.route);
}

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
/**
 * The part of a control that is inside the window, which is what the highlight can ring.
 *
 * A strip wider than the window — the Codex's views on a tablet, which scrolls along its line — was
 * ringed past the edge of the screen, so the highlight ran off and the reader saw three sides of it.
 * A control scrolled out of sight has no visible part and is not highlighted at all; the step falls
 * back to the rail item as it does for a control that is not on the screen.
 */
export function visibleRect(rect: Rect | undefined, viewport: Size, margin = 0): Rect | undefined {
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
  const left = Math.max(rect.left, margin);
  const top = Math.max(rect.top, margin);
  const right = Math.min(rect.left + rect.width, viewport.width - margin);
  const bottom = Math.min(rect.top + rect.height, viewport.height - margin);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : undefined;
}

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
