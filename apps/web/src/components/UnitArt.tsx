import { UNIT_ART_CREDITS, unitArtFor, unitArtPath } from "../lib/unitArt";

/**
 * A unit's picture: the silhouette for what its keywords say it is, drawn in the current text colour
 * so it takes whatever tint the row or the side gives it. Decorative by default — the name beside it
 * carries the meaning — unless a `title` makes it the only thing said.
 */
export function UnitArt({ keywords, className, title }: { keywords: readonly string[]; className?: string; title?: string }) {
  const id = unitArtFor(keywords);
  const d = unitArtPath(id);
  if (!d) return null;
  return (
    <svg className={`unit-art ${className ?? ""}`.trim()} viewBox="0 0 512 512" width="18" height="18" fill="currentColor" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} focusable="false" data-art={id}>
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}

export { UNIT_ART_CREDITS };
