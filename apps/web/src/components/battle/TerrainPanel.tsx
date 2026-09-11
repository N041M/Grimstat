import { useEffect, useRef, useState } from "react";
import type { BattleSizeId, TerrainLayout, TerrainPiece, TerrainTrait } from "@grimstat/board";
import { BATTLE_SIZES, BREACHERS, CLIMBERS, TERRAIN_AREA_PRESETS, box, crater, ruin, wedge } from "@grimstat/board";
import { Badge } from "../ui";
import {
  EDIT_STEP,
  addObjective,
  addPiece,
  centre,
  duplicatePiece,
  edgeOffsetsOf,
  extent,
  freeId,
  isSymmetric,
  layoutIssues,
  mirror,
  moveObjective,
  placeByEdges,
  removeObjective,
  removePiece,
  resizePiece,
  rotatePiece,
  setSize,
  setStoreys,
  setTrait,
  snapPoint,
  updatePiece,
} from "../../lib/layoutEdit";
import { t, type I18nKey } from "../../i18n";

/** The traits worth a checkbox. The rest are set by what a piece *is*, not by hand. */
const EDITABLE_TRAITS: readonly TerrainTrait[] = ["obscuring", "light-cover", "heavy-cover", "impassable", "difficult", "breachable", "scalable", "defensible", "transparent"];

/**
 * An 11th-edition terrain area: obscuring, two storeys, climbable by models on their own feet.
 * Sensible defaults rather than a rules claim — every trait is a checkbox below.
 */
const AREA_TRAITS: readonly TerrainTrait[] = ["obscuring", "heavy-cover", "scalable", "breachable"];

const SIZES: readonly { id: BattleSizeId; label: I18nKey }[] = [
  { id: "incursion", label: "battle.size.incursion" },
  { id: "strikeForce", label: "battle.size.strikeForce" },
  { id: "onslaught", label: "battle.size.onslaught" },
];

const sizeIdOf = (layout: TerrainLayout): BattleSizeId | "" => SIZES.find((s) => BATTLE_SIZES[s.id].width === layout.size.width && BATTLE_SIZES[s.id].depth === layout.size.depth)?.id ?? "";

export type LayoutChange = (change: (layout: TerrainLayout) => TerrainLayout) => void;

/**
 * The terrain editor.
 *
 * This project ships four generic layouts and nothing else — published and community layouts belong
 * to the people who made them. What it can offer instead is the means to build your own table and to
 * import theirs, which is what this panel and the layout file format are for.
 *
 * Every control edits through the pure functions in `layoutEdit`, and every edit is expressed as a
 * function of the layout *as it will be when applied*, not as it was when this rendered. The panel has
 * no rules of its own, and an edit is always a whole new layout — which is what makes "mirror the
 * table" a single call and undo a stack of old layouts.
 */
export function TerrainPanel({
  layout,
  pieceId,
  objectiveId,
  canUndo,
  canRedo,
  snap,
  onSnap,
  onChange,
  onSelectPiece,
  onSelectObjective,
  onUndo,
  onRedo,
}: {
  layout: TerrainLayout;
  pieceId?: string;
  objectiveId?: string;
  canUndo: boolean;
  canRedo: boolean;
  snap: boolean;
  onSnap: (on: boolean) => void;
  onChange: LayoutChange;
  onSelectPiece: (id: string | undefined) => void;
  onSelectObjective: (id: string | undefined) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const piece = layout.pieces.find((p) => p.id === pieceId);
  const objective = layout.objectives.find((o) => o.id === objectiveId);
  const issues = layoutIssues(layout);
  const symmetric = isSymmetric(layout);
  const editorRef = useRef<HTMLDivElement>(null);

  // A piece picked on the table is edited here, and "here" is often below the fold.
  useEffect(() => {
    if (pieceId) editorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [pieceId]);

  /**
   * New pieces land in the near half, each a little away from the last so that adding four of the
   * same footprint does not look like adding one. They are selected as they arrive.
   */
  const add = (make: (id: string, at: { x: number; y: number }) => TerrainPiece, stem: string) => {
    const n = layout.pieces.length;
    const at = snapPoint({ x: layout.size.width / 2 + ((n % 5) - 2) * 3, y: layout.size.depth / 4 + ((Math.floor(n / 5) % 3) - 1) * 3 });
    const id = freeId(layout, stem);
    onChange((l) => addPiece(l, make(id, at)));
    onSelectPiece(id);
  };

  const area = (preset: (typeof TERRAIN_AREA_PRESETS)[number], flip = false) =>
    add((id, at) => (preset.shape === "wedge" ? wedge(id, at, preset.width, preset.depth, 9, AREA_TRAITS, [0, 4], CLIMBERS, flip, BREACHERS) : box(id, at, preset.width, preset.depth, 9, AREA_TRAITS, [0, 4], CLIMBERS, BREACHERS)), preset.id);

  return (
    <>
      <section className="battle-section">
        <div className="battle-section-head">
          <h2>{t("battle.terrain")}</h2>
          <div className="battle-hist" role="group" aria-label={t("battle.terrain.history")}>
            <button type="button" className="ghost sm" disabled={!canUndo} onClick={onUndo} title={t("battle.terrain.undo")} aria-label={t("battle.terrain.undo")}>
              ↶
            </button>
            <button type="button" className="ghost sm" disabled={!canRedo} onClick={onRedo} title={t("battle.terrain.redo")} aria-label={t("battle.terrain.redo")}>
              ↷
            </button>
          </div>
        </div>

        <div className="battle-toolrow">
          <select className="sm" aria-label={t("battle.terrain.size")} value={sizeIdOf(layout)} onChange={(e) => onChange((l) => setSize(l, BATTLE_SIZES[e.target.value as BattleSizeId]))}>
            {sizeIdOf(layout) === "" ? <option value="">{t("battle.size.custom", { w: layout.size.width, d: layout.size.depth })}</option> : null}
            {SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.label)}
              </option>
            ))}
          </select>
          <label>
            <input type="checkbox" checked={snap} onChange={(e) => onSnap(e.target.checked)} />
            {t("battle.terrain.snap")}
          </label>
        </div>

        {layout.pieces.length === 0 ? (
          <p className="muted small">{t("battle.terrain.noPieces")}</p>
        ) : (
          <ul className="battle-piece-list" aria-label={t("battle.terrain.pieces")}>
            {layout.pieces.map((p) => {
              const size = extent(p);
              return (
                <li key={p.id}>
                  <button type="button" className={`battle-piece-row ${p.id === pieceId ? "is-selected" : ""}`.trim()} onClick={() => onSelectPiece(p.id === pieceId ? undefined : p.id)}>
                    <span className="id">{p.id}</span>
                    <span className="meta">
                      {fmt(size.width)}×{fmt(size.depth)} · {fmt(p.height)}"{p.floors.length > 1 ? ` · ${p.floors.length}F` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {piece ? (
          <div className="battle-piece-editor" ref={editorRef}>
            <div className="battle-piece-head">
              <span className="battle-piece-id">{piece.id}</span>
              <span className="muted small">
                {fmt(centre(piece).x)}, {fmt(centre(piece).y)}
              </span>
            </div>
            <Dimension label={t("battle.terrain.width")} value={extent(piece).width} min={0.5} step={EDIT_STEP} onChange={(v) => onChange((l) => resizePiece(l, piece.id, v, extent(piece).depth))} />
            <Dimension label={t("battle.terrain.depth")} value={extent(piece).depth} min={0.5} step={EDIT_STEP} onChange={(v) => onChange((l) => resizePiece(l, piece.id, extent(piece).width, v))} />
            <Dimension label={t("battle.terrain.height")} value={piece.height} min={0} step={EDIT_STEP} onChange={(v) => onChange((l) => updatePiece(l, piece.id, (p) => ({ ...p, height: Math.max(0, v) })))} />
            <Dimension label={t("battle.terrain.storeys")} value={piece.floors.length} min={1} step={1} onChange={(v) => onChange((l) => setStoreys(l, piece.id, v))} />

            {/* The form a published layout is actually written in. Typing two of these places the
                piece exactly; the other two update so the entry can be checked against the diagram. */}
            <fieldset className="battle-edges">
              <legend>{t("battle.terrain.fromEdges")}</legend>
              <div className="battle-edge-grid">
                <Dimension label={t("battle.terrain.fromLeft")} value={edgeOffsetsOf(layout, piece).fromLeft} step={EDIT_STEP} onChange={(v) => onChange((l) => placeByEdges(l, piece.id, { fromLeft: v }))} />
                <Dimension label={t("battle.terrain.fromRight")} value={edgeOffsetsOf(layout, piece).fromRight} step={EDIT_STEP} onChange={(v) => onChange((l) => placeByEdges(l, piece.id, { fromRight: v }))} />
                <Dimension label={t("battle.terrain.fromBottom")} value={edgeOffsetsOf(layout, piece).fromBottom} step={EDIT_STEP} onChange={(v) => onChange((l) => placeByEdges(l, piece.id, { fromBottom: v }))} />
                <Dimension label={t("battle.terrain.fromTop")} value={edgeOffsetsOf(layout, piece).fromTop} step={EDIT_STEP} onChange={(v) => onChange((l) => placeByEdges(l, piece.id, { fromTop: v }))} />
              </div>
            </fieldset>

            <fieldset className="battle-traits">
              <legend>{t("battle.terrain.traits")}</legend>
              {EDITABLE_TRAITS.map((trait) => (
                <label key={trait}>
                  <input type="checkbox" checked={piece.traits.includes(trait)} onChange={(e) => onChange((l) => setTrait(l, piece.id, trait, e.target.checked))} />
                  <span>{trait}</span>
                </label>
              ))}
              {/* Who the walls and the upper floors admit decides what a tank can do here, so it is
                  shown rather than left to be inferred from a checkbox. */}
              {piece.traits.includes("breachable") || piece.traits.includes("impassable") ? <p className="muted small">{t("battle.terrain.passableBy", { who: piece.passableBy.join(", ") || t("battle.terrain.nobody") })}</p> : null}
              {piece.floors.length > 1 ? <p className="muted small">{t("battle.terrain.climbableBy", { who: piece.climbableBy.join(", ") || t("battle.terrain.anyone") })}</p> : null}
            </fieldset>

            <div className="battle-actions wrap">
              <button type="button" className="ghost sm" onClick={() => onChange((l) => rotatePiece(l, piece.id, Math.PI / 2))}>
                {t("battle.terrain.rotate")}
              </button>
              <button
                type="button"
                className="ghost sm"
                onClick={() => {
                  const out = duplicatePiece(layout, piece.id);
                  if (!out) return;
                  onChange((l) => duplicatePiece(l, piece.id)?.layout ?? l);
                  onSelectPiece(out.id);
                }}
              >
                {t("battle.terrain.duplicate")}
              </button>
              <button
                type="button"
                className="ghost sm danger"
                onClick={() => {
                  onChange((l) => removePiece(l, piece.id));
                  onSelectPiece(undefined);
                }}
              >
                {t("battle.terrain.delete")}
              </button>
            </div>
            <p className="muted small">{t("battle.terrain.edgesHint")}</p>
          </div>
        ) : null}
        <p className="battle-keys">{t("battle.terrain.keys", { mod: MOD })}</p>
      </section>

      <section className="battle-section">
        <h2>{t("battle.terrain.add")}</h2>
        <div className="battle-actions wrap">
          <button type="button" className="ghost sm" onClick={() => add((id, at) => ruin(id, at, 9, 6, 2), "ruin")}>
            + {t("battle.terrain.ruin")}
          </button>
          <button type="button" className="ghost sm" onClick={() => add((id, at) => crater(id, at, 8, 6), "crater")}>
            + {t("battle.terrain.crater")}
          </button>
          <button type="button" className="ghost sm" onClick={() => add((id, at) => box(id, at, 8, 6, 5, ["obscuring", "heavy-cover", "impassable"], [5]), "bunker")}>
            + {t("battle.terrain.bunker")}
          </button>
          <button type="button" className="ghost sm" onClick={() => add((id, at) => box(id, at, 10, 8, 1.8, ["light-cover"], [1.8]), "hill")}>
            + {t("battle.terrain.hill")}
          </button>
        </div>

        <div className="battle-presets">
          <div className="battle-presets-head">{t("battle.terrain.standard")}</div>
          {TERRAIN_AREA_PRESETS.map((preset) => (
            <div key={preset.id} className="battle-preset-row">
              <button type="button" className="ghost sm" onClick={() => area(preset)}>
                + {preset.label}
              </button>
              {preset.shape === "wedge" ? (
                <button type="button" className="ghost sm" title={t("battle.terrain.flip")} aria-label={t("battle.terrain.flip")} onClick={() => area(preset, true)}>
                  ⇄
                </button>
              ) : null}
              <span className="battle-preset-count">×{preset.count}</span>
            </div>
          ))}
          <p className="muted small">{t("battle.terrain.standardHint")}</p>
        </div>
      </section>

      <section className="battle-section">
        <div className="battle-section-head">
          <h2>{t("battle.terrain.objectives")}</h2>
          <span className="battle-badges">
            {symmetric ? <Badge tone="ok">{t("battle.terrain.symmetric")}</Badge> : <Badge tone="warn">{t("battle.terrain.lopsided")}</Badge>}{" "}
            {issues.length === 0 ? <Badge tone="ok">{t("battle.terrain.noIssues")}</Badge> : <Badge tone="danger">{t("battle.terrain.issues", { n: issues.length })}</Badge>}
          </span>
        </div>

        {layout.objectives.length ? (
          <ul className="battle-piece-list" aria-label={t("battle.terrain.objectives")}>
            {layout.objectives.map((o) => (
              <li key={o.id}>
                <button type="button" className={`battle-piece-row ${o.id === objectiveId ? "is-selected" : ""}`.trim()} onClick={() => onSelectObjective(o.id === objectiveId ? undefined : o.id)}>
                  <span className="id">{o.id}</span>
                  <span className="meta">
                    {fmt(o.at.x)}, {fmt(o.at.y)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{t("battle.terrain.noObjectives")}</p>
        )}

        {objective ? (
          <div className="battle-piece-editor">
            <div className="battle-edge-grid">
              <Dimension label={t("battle.terrain.fromLeft")} value={objective.at.x} step={EDIT_STEP} onChange={(v) => onChange((l) => moveObjective(l, objective.id, { x: v, y: objective.at.y }))} />
              <Dimension label={t("battle.terrain.fromBottom")} value={objective.at.y} step={EDIT_STEP} onChange={(v) => onChange((l) => moveObjective(l, objective.id, { x: objective.at.x, y: v }))} />
            </div>
            <div className="battle-actions">
              <button
                type="button"
                className="ghost sm danger"
                onClick={() => {
                  onChange((l) => removeObjective(l, objective.id));
                  onSelectObjective(undefined);
                }}
              >
                {t("battle.terrain.deleteObjective")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="battle-actions wrap">
          <button
            type="button"
            className="ghost sm"
            onClick={() => {
              const before = new Set(layout.objectives.map((o) => o.id));
              const next = addObjective(layout, snapPoint({ x: layout.size.width / 2, y: layout.size.depth / 2 }));
              onChange((l) => addObjective(l, snapPoint({ x: l.size.width / 2, y: l.size.depth / 2 })));
              onSelectObjective(next.objectives.find((o) => !before.has(o.id))?.id);
            }}
          >
            + {t("battle.terrain.addObjective")}
          </button>
          <button type="button" className="ghost sm" onClick={() => onChange((l) => mirror(l))} title={t("battle.terrain.mirrorHint")}>
            {t("battle.terrain.mirror")}
          </button>
        </div>
        {issues.length ? (
          <ul className="battle-problems left">
            {issues.slice(0, 6).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}

/** Inches to two decimals, with the trailing zeros gone: 11.5, not 11.50; 7, not 7.00. */
const fmt = (v: number): string => String(Math.round(v * 100) / 100);

/** The key that undoes, named the way the platform names it. */
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";

/**
 * A labelled number with steppers. Inches everywhere, so no unit picker.
 *
 * The text the user is typing is kept while the field has focus. A controlled number input that
 * re-renders from the parsed value cannot be typed into: "11." parses to 11, re-renders as "11", and
 * the decimal point never survives to become 11.5. So the field shows its own draft until it blurs,
 * and commits every intermediate value that parses — the table follows the typing live, and lands
 * exactly where the finished number says.
 */
function Dimension({ label, value, min, step, onChange }: { label: string; value: number; min?: number; step: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | undefined>();
  return (
    <label className="battle-dim">
      <span>{label}</span>
      <input
        type="number"
        value={draft ?? fmt(value)}
        min={min}
        step={step}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n) && (min === undefined || n >= min)) onChange(n);
        }}
        onBlur={() => setDraft(undefined)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
