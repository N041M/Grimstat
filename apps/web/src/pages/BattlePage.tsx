import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReachNode, Vec2, Vec3 } from "@grimstat/board";
import { reachable } from "@grimstat/board";
import { PageHeader } from "../components/shell";
import { Badge, Tabs } from "../components/ui";
import {
  BATTLE_LAYOUTS,
  anchorOf,
  chargeBetween,
  dragVerdict,
  enemyHulls,
  findUnit,
  indexOf,
  otherHulls,
  sampleBattle,
  sightBetween,
  translateUnit,
  unitsOf,
  type BattleState,
  type BattleTool,
  type BattleUnit,
  type ChargeReadout,
  type SightReadout,
} from "../lib/battle";
import type { CameraMode, DragState } from "../components/battle/BattleCanvas";
import { t, type I18nKey } from "../i18n";

/** three.js and the whole scene live behind this boundary: nobody who never opens Battle downloads it. */
const BattleCanvas = lazy(() => import("../components/battle/BattleCanvas").then((m) => ({ default: m.BattleCanvas })));

/**
 * WebGL can be missing (old hardware, a blocked context, a headless browser). Ask before drawing.
 *
 * The probe context is released immediately: a browser allows only a handful of live contexts, and
 * one leaked per page load is enough to eventually starve the table of the one it needs.
 */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const TOOLS: { id: BattleTool; label: I18nKey }[] = [
  { id: "select", label: "battle.tool.select" },
  { id: "measure", label: "battle.tool.measure" },
  { id: "sight", label: "battle.tool.sight" },
];

/**
 * The battle table: plan a matchup on a real-sized board in three dimensions.
 *
 * Planning mode — drag units, measure, check what can see what, see what a charge needs. Nothing is
 * resolved and nothing is enforced: the table explains what it thinks and lets the player decide.
 */
export function BattlePage() {
  const [state, setState] = useState<BattleState>(() => sampleBattle());
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [targetId, setTargetId] = useState<string | undefined>();
  const [tool, setTool] = useState<BattleTool>("select");
  const [view, setView] = useState<CameraMode>("orbit");
  const [drag, setDrag] = useState<DragState | undefined>();
  const [picks, setPicks] = useState<Vec3[]>([]);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [webgl] = useState(webglAvailable);

  const index = useMemo(() => indexOf(state), [state]);
  const selected = findUnit(state, selectedId);
  const target = findUnit(state, targetId);

  // Changing tool or unit invalidates whatever the previous tool was showing.
  useEffect(() => setPicks([]), [tool, selectedId]);
  useEffect(() => setTargetId(undefined), [selectedId]);

  /** Where the selected unit can go. Recomputed when it moves, not while the pointer moves. */
  const reach: readonly ReachNode[] = useMemo(() => {
    if (!selected || tool !== "select") return [];
    return reachable(anchorOf(selected), selected.move, index, {
      keywords: selected.keywords,
      enemies: enemyHulls(state, selected.side),
      blockers: otherHulls(state, selected.id),
    }).nodes;
  }, [selected, tool, index, state]);

  const upperFloor = useMemo(() => reach.filter((n) => n.at.z > 0.5).length, [reach]);

  const shot: SightReadout | undefined = useMemo(() => (selected && target && tool === "sight" ? sightBetween(selected, target, index) : undefined), [selected, target, tool, index]);
  const charge: ChargeReadout | undefined = useMemo(() => (selected && target && tool === "sight" ? chargeBetween(selected, target, state, index) : undefined), [selected, target, tool, state, index]);

  const onMove = useCallback(
    (unitId: string, to: Vec2) => {
      setState((prev) => {
        const unit = findUnit(prev, unitId);
        if (!unit) return prev;
        const anchor = anchorOf(unit);
        const moved = translateUnit(unit, { x: to.x - anchor.pos.x, y: to.y - anchor.pos.y });
        return { ...prev, units: prev.units.map((u) => (u.id === unitId ? moved : u)) };
      });
    },
    [],
  );

  /**
   * One rule for clicking a unit, wherever it is clicked: an enemy of the selected unit becomes the
   * target, anything else becomes the selection. Without the side check, the sight tool will happily
   * measure a unit's line of sight to its own side, which is never a question anyone is asking.
   */
  const pickUnit = useCallback(
    (id: string | undefined) => {
      if (!id) {
        setSelectedId(undefined);
        return;
      }
      const unit = findUnit(state, id);
      if (selected && unit && unit.side !== selected.side) setTargetId(id);
      else setSelectedId(id);
    },
    [state, selected],
  );

  /**
   * What a press on the table means, by tool.
   *
   * Under Move, a selected unit goes where you click. Dragging shows the cost as you go and is the
   * nicer gesture, but click-to-move is the one that works with a finger, with a trackpad, and for
   * anyone who would rather not hold a button down while aiming — so both exist and they share the
   * same verdict.
   *
   * The measuring tape takes two points; a third starts a new measurement.
   */
  const onTableDown = useCallback(
    (at: Vec2) => {
      if (tool === "measure") {
        setPicks((prev) => (prev.length >= 2 ? [{ x: at.x, y: at.y, z: 0 }] : [...prev, { x: at.x, y: at.y, z: 0 }]));
        return;
      }
      if (tool !== "select" || !selected) return;
      const verdict = dragVerdict(state, selected, at, index);
      if (verdict.ok) onMove(selected.id, at);
      setDrag(verdict.ok ? undefined : { unitId: selected.id, to: at, legal: false, problems: verdict.problems });
    },
    [tool, selected, state, index, onMove],
  );

  const measurePair = picks.length === 2 ? ([picks[0]!, picks[1]!] as const) : undefined;
  const { layout } = state;

  return (
    <div className="battle-page">
      <PageHeader
        title={t("battle.title")}
        subtitle={t("battle.subtitle", { layout: layout.name, w: layout.size.width, d: layout.size.depth, units: state.units.length })}
        actions={
          <>
            <select
              className="sm"
              aria-label={t("battle.layout")}
              value={layout.id}
              onChange={(e) => {
                const next = BATTLE_LAYOUTS.find((l) => l.id === e.target.value);
                if (!next) return;
                setState(sampleBattle(next));
                setSelectedId(undefined);
              }}
            >
              {BATTLE_LAYOUTS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <Tabs tabs={TOOLS.map((x) => ({ id: x.id, label: t(x.label) }))} value={tool} onChange={setTool} label={t("battle.tool")} />
            <Tabs
              tabs={[
                { id: "orbit" as const, label: t("battle.view.orbit") },
                { id: "top" as const, label: t("battle.view.top") },
              ]}
              value={view}
              onChange={setView}
              label={t("battle.view")}
            />
            <button type="button" className="ghost sm" onClick={() => setState(sampleBattle(layout))}>
              {t("battle.reset")}
            </button>
          </>
        }
      />

      <div className="battle-body">
        <div className="battle-stage">
          {webgl ? (
            <Suspense fallback={<p className="muted battle-loading">{t("battle.loading")}</p>}>
              <BattleCanvas
                state={state}
                cameraMode={view}
                selectedId={selectedId}
                reach={tool === "select" ? reach : []}
                rays={shot?.rays ?? []}
                path={charge?.path ?? []}
                measure={measurePair}
                labelsRef={labelsRef}
                onSelect={pickUnit}
                onMove={onMove}
                onDrag={setDrag}
                onTableDown={onTableDown}
              />
            </Suspense>
          ) : (
            <p className="muted battle-loading">{t("battle.noWebgl")}</p>
          )}
          <div className="battle-labels" ref={labelsRef} aria-hidden="true">
            {state.units.map((u) => (
              <div key={u.id} className={`battle-label ${u.side}`}>
                {t(u.name as I18nKey)}
              </div>
            ))}
          </div>
        </div>

        <aside className="battle-panel">
          <BattlePanel state={state} selected={selected} target={target} tool={tool} drag={drag} reach={reach} upperFloor={upperFloor} shot={shot} charge={charge} picks={picks} onPick={pickUnit} />
        </aside>
      </div>
    </div>
  );
}

function BattlePanel({
  state,
  selected,
  target,
  tool,
  drag,
  reach,
  upperFloor,
  shot,
  charge,
  picks,
  onPick,
}: {
  state: BattleState;
  selected?: BattleUnit;
  target?: BattleUnit;
  tool: BattleTool;
  drag?: DragState;
  reach: readonly ReachNode[];
  upperFloor: number;
  shot?: SightReadout;
  charge?: ChargeReadout;
  picks: readonly Vec3[];
  onPick: (id: string | undefined) => void;
}) {
  const gap = picks.length === 2 ? Math.hypot(picks[0]!.x - picks[1]!.x, picks[0]!.y - picks[1]!.y) : undefined;

  return (
    <>
      <section className="battle-section">
        <h2>{t("battle.units")}</h2>
        {(["attacker", "defender"] as const).map((side) => (
          <ul key={side} className={`battle-unit-list ${side}`}>
            {unitsOf(state, side).map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className={`battle-unit ${u.id === selected?.id ? "is-selected" : ""} ${u.id === target?.id ? "is-target" : ""}`.trim()}
                  onClick={() => onPick(u.id)}
                >
                  <span className={`battle-swatch ${side}`} aria-hidden="true" />
                  <span className="battle-unit-name">{t(u.name as I18nKey)}</span>
                  <span className="battle-unit-meta">
                    {u.models.length}× · M{u.move}"
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
        <p className="muted small">{t("battle.samplePlaceholder")}</p>
      </section>

      {tool === "select" ? (
        <section className="battle-section">
          <h2>{t("battle.selected")}</h2>
          {!selected ? (
            <p className="muted small">{t("battle.selectPrompt")}</p>
          ) : (
            <dl className="battle-readout">
              <dt>{t("battle.move")}</dt>
              <dd>{selected.move}"</dd>
              <dt>{t("battle.reach")}</dt>
              <dd>{reach.length}</dd>
              <dt>{t("battle.reachUpper")}</dt>
              <dd>{upperFloor || "—"}</dd>
              {drag ? (
                <>
                  <dt>{drag.legal ? t("battle.dragCost", { cost: (drag.cost ?? 0).toFixed(1), move: selected.move }) : t("battle.dragIllegal")}</dt>
                  <dd>
                    {drag.problems.length ? (
                      <ul className="battle-problems">
                        {drag.problems.map((p) => (
                          <li key={p}>{t(p as I18nKey)}</li>
                        ))}
                      </ul>
                    ) : (
                      <Badge tone="ok">{t("battle.measureClear")}</Badge>
                    )}
                  </dd>
                </>
              ) : null}
            </dl>
          )}
        </section>
      ) : null}

      {tool === "sight" ? (
        <section className="battle-section">
          <h2>{t("battle.target")}</h2>
          {!selected || !target || !shot ? (
            <p className="muted small">{t("battle.pickTarget")}</p>
          ) : (
            <dl className="battle-readout">
              <dt>{t("battle.distance")}</dt>
              <dd>{shot.distance.toFixed(1)}"</dd>
              <dt>{shot.visible ? t("battle.visible") : t("battle.hidden")}</dt>
              <dd>{shot.visible ? t("battle.exposure", { pct: Math.round(shot.exposure * 100) }) : t("battle.blockedBy", { ids: shot.blockers.join(", ") })}</dd>
              <dt>{t("battle.cover")}</dt>
              <dd>{t(`battle.cover.${shot.cover}` as I18nKey)}</dd>
              <dt>{t("battle.charge")}</dt>
              <dd>{charge && Number.isFinite(charge.distance) ? t("battle.chargeNeeds", { roll: charge.minimumRoll, pct: Math.round(charge.probability * 100) }) : t("battle.chargeImpossible")}</dd>
            </dl>
          )}
          <p className="muted small">{t("battle.assumedHeight")}</p>
        </section>
      ) : null}

      {tool === "measure" ? (
        <section className="battle-section">
          <h2>{t("battle.tool.measure")}</h2>
          <p className="muted small">{t("battle.measureHint")}</p>
          {gap === undefined ? null : <p className="battle-measure">{t("battle.measureResult", { d: gap.toFixed(1) })}</p>}
        </section>
      ) : null}
    </>
  );
}
