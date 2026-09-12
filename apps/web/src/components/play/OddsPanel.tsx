import { useEffect, useMemo, useRef, useState } from "react";
import type { Scenario, ScenarioContext, Snapshot } from "@grimstat/schema";
import { simClient } from "../../worker/client";
import { useWorkerTask } from "../../hooks/useWorkerTask";
import { idleReason } from "../../hooks/useSimulation";
import { cloneUnit, defaultContext, newScenario } from "../../lib/scenario";
import { fmt, pct } from "../../lib/format";
import { PHASE_LABEL } from "./labels";
import { t } from "../../i18n";
import type { PlayContext, PlayFoe, PlayUnit } from "./types";

/**
 * One attack, solved: pick a unit of yours and a unit of theirs and see what the attack is worth
 * before the dice are picked up.
 *
 * The number a player wants at the table is not the expected damage on its own, it is that damage
 * against the wounds the target has left right now, so the headline pairs them and the last line
 * says whether the attack is enough. The scenario is built from the two units the page already
 * resolved and run in the same worker the calculator uses, so the answer here and the answer on the
 * Calculator screen are the same answer.
 */

type SolvePhase = ScenarioContext["phase"];
type RangeBand = ScenarioContext["rangeBand"];

const runOdds = (scenario: Scenario, snapshot: Snapshot | undefined) => simClient().run(scenario, snapshot);

/** P(damage >= k) read off the damage distribution: the chance the attack covers what is left. */
function pAtLeast(pmf: readonly number[], k: number): number {
  if (k <= 0) return 1;
  let sum = 0;
  for (let i = k; i < pmf.length; i++) sum += pmf[i] ?? 0;
  return Math.max(0, Math.min(1, sum));
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="odds-metric">
      <span className="odds-metric-label">{label}</span>
      <span className="odds-metric-value num">{value}</span>
      {note ? <span className="odds-metric-note small muted">{note}</span> : null}
    </div>
  );
}

export function OddsPanel({ ctx }: { ctx: PlayContext }) {
  const { game, mine, foes, snapshot } = ctx;
  const [attackerId, setAttackerId] = useState("");
  const [foeId, setFoeId] = useState("");
  const [rangeBand, setRangeBand] = useState<RangeBand>("full");
  const [inCover, setInCover] = useState(false);

  // The tracked phase sets the attack up: shooting fires the guns, fight swings and assumes the
  // charge. Either can be overridden here, and moving on to a new phase sets it up again.
  const tracked: SolvePhase = game.state.phase === "fight" ? "fight" : "shooting";
  const [phase, setPhase] = useState<SolvePhase>(tracked);
  const [charged, setCharged] = useState(tracked === "fight");
  const lastTracked = useRef(tracked);
  useEffect(() => {
    if (lastTracked.current === tracked) return;
    lastTracked.current = tracked;
    setPhase(tracked);
    setCharged(tracked === "fight");
  }, [tracked]);

  const attacker: PlayUnit | undefined = mine.find((u) => u.id === attackerId) ?? mine.find((u) => !u.state.destroyed) ?? mine[0];
  const foe: PlayFoe | undefined = foes.find((f) => f.id === foeId) ?? foes.find((f) => !f.state.destroyed) ?? foes[0];

  // Every field that changes the answer, in one string; the scenario (and so the run) is rebuilt
  // only when one of them moves. Same fingerprint trick the calculator's hook uses.
  const fp = attacker && foe ? JSON.stringify([attacker.current, foe.current, phase, charged, rangeBand, inCover, snapshot?.id]) : "";
  const scenario = useMemo<Scenario | undefined>(() => {
    if (!attacker || !foe) return undefined;
    return newScenario({
      name: `${attacker.unit.name} → ${foe.unit.name}`,
      attacker: cloneUnit(attacker.current),
      defender: cloneUnit(foe.current),
      context: { ...defaultContext(), phase, charged, rangeBand, inCover },
      ...(snapshot ? { snapshotId: snapshot.id } : {}),
    });
    // fp covers every field read above; rebuilding on object identity alone would re-run the
    // worker on every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp]);

  const task = useWorkerTask(runOdds, "play.odds");
  const runRef = useRef(task.run);
  runRef.current = task.run;
  useEffect(() => {
    if (!scenario || idleReason(scenario)) return;
    const handle = window.setTimeout(() => runRef.current(scenario, snapshot), 150);
    return () => window.clearTimeout(handle);
  }, [scenario, snapshot]);

  const idle = scenario ? idleReason(scenario) : undefined;
  const fresh = !!scenario && task.ran?.[0] === scenario;
  const result = fresh ? task.result : undefined;

  // The apply field starts at the expected damage rounded to a whole wound; the player overwrites it
  // with what the dice actually did.
  const [applyText, setApplyText] = useState("");
  useEffect(() => {
    if (result) setApplyText(String(Math.max(0, Math.round(result.expectedDamage))));
  }, [result]);
  const applyWounds = Math.max(0, Math.floor(Number(applyText) || 0));

  const left = foe?.woundsLeft ?? 0;
  const enough = result ? pAtLeast(result.damagePMF, left) : undefined;
  const after = result ? Math.max(0, left - result.expectedDamage) : undefined;

  const apply = () => {
    if (!foe || !attacker || applyWounds <= 0) return;
    game.dispatch(
      { kind: "damage", target: { side: "them", id: foe.id }, wounds: applyWounds, profileWounds: foe.profileWounds, models: foe.models },
      "damage",
      t("odds.log.applied", { att: attacker.unit.name, name: foe.foe.name, n: applyWounds }),
      // Keeping the estimate beside what was applied is what lets the summary say how the dice ran.
      { amount: applyWounds, side: "them", unitId: foe.id, ...(result ? { predicted: result.expectedDamage } : {}) },
    );
  };

  if (mine.length === 0 || foes.length === 0) {
    return (
      <div className="play-odds">
        <p className="odds-empty small muted">{mine.length === 0 ? t("odds.noMine") : t("odds.noFoes")}</p>
      </div>
    );
  }

  return (
    <div className="play-odds">
      <div className="odds-picks">
        <label className="odds-field">
          <span className="odds-label">{t("odds.attacker")}</span>
          <select value={attacker?.id ?? ""} onChange={(e) => setAttackerId(e.target.value)}>
            {mine.map((u) => (
              <option key={u.id} value={u.id}>
                {u.state.destroyed ? t("odds.optionGone", { name: u.unit.name }) : u.unit.name}
              </option>
            ))}
          </select>
        </label>
        <label className="odds-field">
          <span className="odds-label">{t("odds.target")}</span>
          <select value={foe?.id ?? ""} onChange={(e) => setFoeId(e.target.value)}>
            {foes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.state.destroyed ? t("odds.optionGone", { name: f.foe.name }) : t("odds.optionLeft", { name: f.foe.name, n: f.woundsLeft })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="odds-toggles">
        <button type="button" className={`odds-chip${phase === "shooting" ? " on" : ""}`} aria-pressed={phase === "shooting"} onClick={() => setPhase("shooting")}>
          {t("odds.phase.shooting")}
        </button>
        <button type="button" className={`odds-chip${phase === "fight" ? " on" : ""}`} aria-pressed={phase === "fight"} onClick={() => setPhase("fight")}>
          {t("odds.phase.fight")}
        </button>
        <button type="button" className={`odds-chip${rangeBand === "half" ? " on" : ""}`} aria-pressed={rangeBand === "half"} onClick={() => setRangeBand(rangeBand === "half" ? "full" : "half")}>
          {t("odds.halfRange")}
        </button>
        <button type="button" className={`odds-chip${inCover ? " on" : ""}`} aria-pressed={inCover} onClick={() => setInCover(!inCover)}>
          {t("odds.cover")}
        </button>
        <button type="button" className={`odds-chip${charged ? " on" : ""}`} aria-pressed={charged} onClick={() => setCharged(!charged)}>
          {t("odds.charged")}
        </button>
      </div>
      <p className="odds-tracked small muted">{t("odds.tracked", { phase: t(PHASE_LABEL[game.state.phase]) })}</p>

      {idle ? (
        <p className="odds-idle small muted">{t(idle === "no-weapons" ? "dock.idle.noWeapons" : "dock.idle.noModels")}</p>
      ) : task.error ? (
        <p className="odds-idle small">{t("odds.error", { msg: task.error })}</p>
      ) : !result ? (
        <p className="odds-idle small muted">{t("odds.working")}</p>
      ) : (
        <>
          <div className="odds-metrics">
            <Metric label={t("odds.metric.damage")} value={fmt(result.expectedDamage, 1)} note={t("odds.metric.damageNote", { n: left })} />
            <Metric label={t("odds.metric.slain")} value={fmt(result.expectedSlain, 1)} note={t("odds.metric.slainNote", { n: foe?.modelsLeft ?? 0 })} />
            <Metric label={t("odds.metric.finish")} value={pct(enough, 0)} />
            <Metric label={t("odds.metric.kill")} value={pct(result.pKill, 0)} />
          </div>
          <p className="odds-read">{left <= 0 ? t("odds.alreadyGone") : after !== undefined && after <= 0 ? t("odds.clears", { n: left }) : t("odds.leftAfter", { n: fmt(after, 1), name: foe?.foe.name ?? "" })}</p>
        </>
      )}

      <div className="odds-apply">
        <label className="odds-field">
          <span className="odds-label">{t("odds.applyLabel")}</span>
          <input type="number" inputMode="numeric" min={0} value={applyText} onChange={(e) => setApplyText(e.target.value)} />
        </label>
        <button type="button" className="primary" disabled={!foe || applyWounds <= 0} onClick={apply}>
          {t("odds.apply", { name: foe?.foe.name ?? "" })}
        </button>
      </div>
      {task.running ? <p className="odds-tracked small muted">{t("odds.working")}</p> : null}
    </div>
  );
}
