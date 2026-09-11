import { UNIT_ART_CREDITS, unitArtFor, unitArtPath, type UnitArtId } from "../lib/unitArt";

/** Anything with keywords can have a picture: a datasheet, a battle unit. */
export interface UnitArtSubject {
  readonly keywords: readonly string[];
  readonly factionKeywords?: readonly string[];
}

/**
 * A unit's picture: the silhouette for what its keywords say it is, or for plain infantry, whose
 * its faction keywords say it is. Drawn in the current text colour so it takes whatever tint the
 * row or the side gives it. Decorative by default, since the name beside it carries the meaning,
 * unless a `title` makes it the only thing said. `id` draws one particular picture, as the credits do.
 */
export function UnitArt({ of, id, className, title }: { of?: UnitArtSubject; id?: UnitArtId; className?: string; title?: string }) {
  const art = id ?? unitArtFor(of?.keywords ?? [], of?.factionKeywords ?? []);
  const d = unitArtPath(art);
  if (!d) return null;
  return (
    <svg className={`unit-art ${className ?? ""}`.trim()} viewBox="0 0 512 512" width="18" height="18" fill="currentColor" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} focusable="false" data-art={art}>
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}

export { UNIT_ART_CREDITS };
