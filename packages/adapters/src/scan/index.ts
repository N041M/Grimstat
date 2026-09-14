/**
 * Reading an army list out of a stream of words, wherever the words came from and in whatever order
 * they arrive.
 *
 * The names are matched against the snapshot, the numbers are read as counts or costs from each
 * unit's own price table, the wargear lands on the unit that can carry it, and the army is worked
 * out from the units rather than from a title. What the data cannot settle comes back as a question.
 */

export { tokenise, fromWords, phraseOf, integerOf } from "./tokens";
export type { Token, Box, ReadWord } from "./tokens";
export { flatten } from "./flatten";
export type { Pixels, Flattened, FlattenOptions } from "./flatten";
export { scanIndexOf, matchName, editDistance, MIN_SCORE } from "./names";
export type { ScanIndex, NameEntry, NameMatch, AnchorKind, MatchOptions } from "./names";
export { anchor, resolve } from "./anchors";
export type { Span, AnchorOptions } from "./anchors";
export { sizesOf, roleOf, canBeCount, canBeCost, multipliersBefore, costAfter } from "./numbers";
export type { UnitSizes, NumberRole, Multiplier } from "./numbers";
export { placeEvidence } from "./own";
export type { Placement, UnitAnchor, Reason } from "./own";
export { readArmy, voteFaction, detachmentsFrom, idsInFaction, sizeFor } from "./army";
export type { ArmyGuess, FactionVote, FactionResult, ReadArmy } from "./army";
export { scanList } from "./fit";
export type { Draft, ScanUnit, Question, Answers, ScanOptions } from "./fit";
