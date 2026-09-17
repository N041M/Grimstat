/**
 * How many models a datasheet's unit is made of, read from its printed composition.
 *
 * The reading itself lives in the resolver, beside the other composition readers, so the importers
 * can use it too. It is re-exported here because the army rules and the loadout check ask for it by
 * this name, and the two would otherwise have to import each other.
 */
export { compositionBounds, profileBounds } from "@grimstat/resolver";
export type { ProfileBounds } from "@grimstat/resolver";
