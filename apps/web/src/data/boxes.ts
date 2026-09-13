/**
 * What comes in a boxed set.
 *
 * No data source this app reads knows this. Wahapedia's tables are abilities, datasheets, factions
 * and stratagems; the Munitorum Field Manual is points; BattleScribe's catalogues are roster data.
 * The community schema effort that set out to cover every game entity settles on faction, unit,
 * weapon and game version. None of them describe what is physically in a box, because the question
 * belongs to a shop rather than to a game.
 *
 * So this list is read off the publisher's own announcements, one box at a time, and every entry
 * carries the article it was read from. A box whose contents were not stated in full is not guessed
 * at: the line says what the announcement said, and `units` covers the entries written as "a Krieg
 * Command Squad" rather than as a number of models.
 *
 * A line is named as the datasheets name it, which is not always as the announcement does: a box
 * saying "Sternguard Veterans" is a Sternguard Veteran Squad, and one saying "Chaos Terminators"
 * means the Chaos Terminator Squad, the bare name being Emperor's Children's and World Eaters'. The
 * names below were checked against a full snapshot; a unit that is simply not in one is left as the
 * announcement wrote it and reported when it cannot be placed.
 *
 * The list itself is not here. It is `public/boxes.json`, read at runtime, so a box added or
 * corrected is a data change rather than a code change and does not need the app rebuilt to take
 * effect. This file describes the shape that file has to be in, and checks it when it is read:
 * boxes are typed in by hand from announcements, and a typo in one of them should be a message
 * naming the line, not a screen that renders half a catalogue.
 */

import { z } from "zod";

export interface BoxLine {
  /**
   * The unit as the datasheets name it. Resolved against the loaded snapshot rather than stored as
   * an id, because a box outlives any one snapshot.
   */
  readonly name: string;
  /** Models of that datasheet, where the announcement gives a number of models. */
  readonly models?: number;
  /**
   * Whole units, where it gives a number of units instead ("a Krieg Command Squad"). How many
   * models that is comes from the datasheet's own composition, which is where the answer lives.
   */
  readonly units?: number;
  /**
   * The other datasheets this kit builds. One sprue, one model, several things it could become, so
   * the count belongs to whichever one was actually built.
   */
  readonly or?: readonly string[];
  /**
   * The box gives the models but does not decide what they are, and the list of what they could be
   * is open rather than a choice of two or three. A box of Tau drones is the case: the sprues build
   * shield, gun or marker drones in whatever mix was glued, and only the person who glued them
   * knows. The count is theirs to label when they add the box, and until they do it belongs to no
   * datasheet — which is why this is not the same as a line whose unit is missing from the data.
   */
  readonly ownerNames?: true;
}

export type BoxKind = "combat-patrol" | "battleforce" | "starter";

export interface BoxSet {
  readonly id: string;
  /**
   * As the box is sold. Names come back: a Battleforce called Tyranid Swarm has been sold more than
   * once with different models inside, so a name alone does not say which box somebody owns and the
   * date has to be shown beside it.
   */
  readonly name: string;
  readonly kind: BoxKind;
  /**
   * When the contents below were published, as YYYY, YYYY-MM or YYYY-MM-DD.
   *
   * As precise as the source is and no more. A box announced last month has the day it was
   * announced on; one from 2004 has the year somebody remembers it by, and inventing a day for it
   * would be inventing a fact. Sorting and grouping only read the year, so a year is enough.
   *
   * It is the announcement rather than the release, because that is the date on the page the
   * contents were read from. A box usually reaches shops within a month or two of it.
   */
  readonly announced: string;
  readonly lines: readonly BoxLine[];
  /** Where the contents were read from. */
  readonly source: string;
}

/**
 * What `boxes.json` has to hold.
 *
 * A line must count something — models outright, or units for the datasheet to size — and a line
 * left to its owner has to count models, since with no datasheet there is nothing to ask how big a
 * unit is. Both rules are here rather than in a comment because the file is typed by hand.
 */
export const BoxLineSchema = z
  .object({
    name: z.string().min(1),
    models: z.number().int().positive().optional(),
    units: z.number().int().positive().optional(),
    or: z.array(z.string().min(1)).optional(),
    ownerNames: z.literal(true).optional(),
  })
  .refine((l) => l.models !== undefined || l.units !== undefined, { message: "a line has to count models or units" })
  .refine((l) => !l.ownerNames || l.models !== undefined, { message: "a line left to its owner has to count models" });

export const BoxSetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  kind: z.enum(["combat-patrol", "battleforce", "starter"]),
  announced: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/),
  lines: z.array(BoxLineSchema).min(1),
  source: z.string().url(),
});

export const BoxFileSchema = z.object({ boxes: z.array(BoxSetSchema) });

/** Where the list lives, under whatever path the app is served from. */
export const BOXES_URL = `${import.meta.env.BASE_URL}boxes.json`.replace(/\/{2,}/g, "/");
