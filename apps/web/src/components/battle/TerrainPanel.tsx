import { useMemo } from "react";
import type { TerrainLayout, TerrainPiece, TerrainTrait } from "@grimstat/board";
import { box, crater, ruin } from "@grimstat/board";
import { Badge } from "../ui";
import {
  addObjective,
  addPiece,
  centre,
  extent,
  freeId,
  isSymmetric,
  layoutIssues,
  mirror,
  removePiece,
  resizePiece,
  rotatePiece,
  setStoreys,
  setTrait,
  updatePiece,
} from "../../lib/layoutEdit";
import { t, type I18nKey } from "../../i18n";

/** The traits worth a checkbox. The rest are set by what a piece *is*, not by hand. */
const EDITABLE_TRAITS: readonly TerrainTrait[] = ["obscuring", "light-cover", "heavy-cover", "impassable", "difficult", "breachable", "scalable", "defensible", "transparent"];

/**
 * The terrain editor.
 *
 * This project ships four generic layouts and nothing else — published and community layouts belong
 * to the people who made them. What it can offer instead is the means to build your own table and to
 * import theirs, which is what this panel and the layout file format are for.
 *
 * Every control edits through the pure functions in `layoutEdit`, so the editor has no rules of its
 * own and an edit is always a whole new layout — which is what makes "mirror the table" a single
 * call rather than a special mode.
 */
export function TerrainPanel({
  layout,
  selectedId,
  onChange,
  onSelect,
}: {
  layout: TerrainLayout;
  selectedId?: string;
  onChange: (next: TerrainLayout) => void;
  onSelect: (id: string | undefined) => void;
}) {
  const piece = layout.pieces.find((p) => p.id === selectedId);
  const issues = useMemo(() => layoutIssues(layout), [layout]);
  const symmetric = useMemo(() => isSymmetric(layout), [layout]);

  /** New pieces land in the middle of the near half, where there is usually room to see them. */
  const dropAt = { x: layout.size.width / 2, y: layout.size.depth / 4 };
  const add = (make: (id: string) => TerrainPiece, stem: string) => {
    const id = freeId(layout, stem);
    onChange(addPiece(layout, make(id)));
    onSelect(id);
  };

  return (
    <>
      <section className="battle-section">
        <h2>{t("battle.terrain")}</h2>
        <div className="battle-actions wrap">
          <button type="button" className="ghost sm" onClick={() => add((id) => ruin(id, dropAt, 9, 6, 2), "ruin")}>
            + {t("battle.terrain.ruin")}
          </button>
          <button type="button" className="ghost sm" onClick={() => add((id) => crater(id, dropAt, 8, 6), "crater")}>
            + {t("battle.terrain.crater")}
          </button>
          <button type="button" className="ghost sm" onClick={() => add((id) => box(id, dropAt, 8, 6, 5, ["obscuring", "heavy-cover", "impassable"], [5]), "bunker")}>
            + {t("battle.terrain.bunker")}
          </button>
          <button type="button" className="ghost sm" onClick={() => add((id) => box(id, dropAt, 10, 8, 1.8, ["light-cover"], [1.8]), "hill")}>
            + {t("battle.terrain.hill")}
          </button>
        </div>

        {!piece ? (
          <p className="muted small">{t("battle.terrain.none")}</p>
        ) : (
          <>
            <div className="battle-piece-head">
              <span className="battle-piece-id">{piece.id}</span>
              <span className="muted small">
                {centre(piece).x.toFixed(1)}, {centre(piece).y.toFixed(1)}
              </span>
            </div>
            <Dimension label={t("battle.terrain.width")} value={extent(piece).width} min={0.5} step={0.5} onChange={(v) => onChange(resizePiece(layout, piece.id, v, extent(piece).depth))} />
            <Dimension label={t("battle.terrain.depth")} value={extent(piece).depth} min={0.5} step={0.5} onChange={(v) => onChange(resizePiece(layout, piece.id, extent(piece).width, v))} />
            <Dimension label={t("battle.terrain.height")} value={piece.height} min={0} step={0.5} onChange={(v) => onChange(updatePiece(layout, piece.id, (p) => ({ ...p, height: Math.max(0, v) })))} />
            <Dimension label={t("battle.terrain.storeys")} value={piece.floors.length} min={1} step={1} onChange={(v) => onChange(setStoreys(layout, piece.id, v))} />

            <fieldset className="battle-traits">
              <legend>{t("battle.terrain.traits")}</legend>
              {EDITABLE_TRAITS.map((trait) => (
                <label key={trait}>
                  <input type="checkbox" checked={piece.traits.includes(trait)} onChange={(e) => onChange(setTrait(layout, piece.id, trait, e.target.checked))} />
                  <span>{trait}</span>
                </label>
              ))}
            </fieldset>

            <div className="battle-actions">
              <button type="button" className="ghost sm" onClick={() => onChange(rotatePiece(layout, piece.id, Math.PI / 2))}>
                {t("battle.terrain.rotate")}
              </button>
              <button
                type="button"
                className="ghost sm"
                onClick={() => {
                  onChange(removePiece(layout, piece.id));
                  onSelect(undefined);
                }}
              >
                {t("battle.terrain.delete")}
              </button>
            </div>
          </>
        )}
        <p className="muted small">{t("battle.terrain.dragHint")}</p>
      </section>

      <section className="battle-section">
        <h2>{t("battle.terrain.objectives")}</h2>
        <div className="battle-actions wrap">
          <button type="button" className="ghost sm" onClick={() => onChange(addObjective(layout, { x: layout.size.width / 2, y: layout.size.depth / 2 }))}>
            + {t("battle.terrain.addObjective")}
          </button>
          <button type="button" className="ghost sm" onClick={() => onChange(mirror(layout))} title={t("battle.terrain.mirrorHint")}>
            {t("battle.terrain.mirror")}
          </button>
        </div>
        <div className="battle-coherency">
          {symmetric ? <Badge tone="ok">{t("battle.terrain.symmetric")}</Badge> : <Badge tone="warn">{t("battle.terrain.lopsided")}</Badge>}{" "}
          {issues.length === 0 ? <Badge tone="ok">{t("battle.terrain.noIssues")}</Badge> : <Badge tone="danger">{t("battle.terrain.issues", { n: issues.length })}</Badge>}
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

/** A labelled number with steppers. Inches everywhere, so no unit picker. */
function Dimension({ label, value, min, step, onChange }: { label: string; value: number; min: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="battle-dim">
      <span>{label}</span>
      <input type="number" value={Number(value.toFixed(2))} min={min} step={step} onChange={(e) => (Number.isFinite(e.target.valueAsNumber) ? onChange(e.target.valueAsNumber) : undefined)} />
    </label>
  );
}

export type { I18nKey };
