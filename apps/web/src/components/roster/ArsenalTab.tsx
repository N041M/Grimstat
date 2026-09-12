import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { Roster, ScenarioUnit, Snapshot } from "@grimstat/schema";
import { unitFromRosterUnit } from "@grimstat/game-40k-11e";
import { arsenalFor, bySkill, damageTiers, defensiveProfile, perModel, saveForced, woundTable } from "../../lib/arsenal";
import { deploymentCensus, threatProfile } from "../../lib/rosterProfile";
import { ARSENAL_PHASES, attacksLabel, parseArsenalPhase, peak, phaseView, saveLabel, shareOf, type ArsenalPhase } from "../../lib/arsenalView";
import { heatColour } from "../../lib/heatmap";
import { fmt, fmtInt } from "../../lib/format";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead, PillChip, ProportionBar } from "../kit";
import { Empty } from "../ui";
import { t, tn, type I18nKey } from "../../i18n";

/* ---------- column templates ---------- */

/** Strength | bar | attacks | share. */
const STRENGTH_COLUMNS = "minmax(72px,0.7fr) minmax(110px,2.4fr) 82px 68px";
/** Toughness | 2+ … 6+ | share wounding on 4+ or better. */
const WOUND_COLUMNS = "78px repeat(5, minmax(54px, 1fr)) minmax(110px, 1.3fr)";
/** Armour | save left after AP, 2+ … 6+ and none. */
const SAVE_COLUMNS = "78px repeat(6, minmax(54px, 1fr))";
/** Unit | move | shooting reach | melee reach. */
const THREAT_COLUMNS = "minmax(140px,2.4fr) 70px 88px 78px";
/** Starts | units | points | models. */
const DEPLOY_COLUMNS = "minmax(130px,1.6fr) 74px 82px 78px";
/** T | Sv | Inv | models | wounds | share of the army's wounds. */
const DEFENCE_COLUMNS = "60px 62px 92px 76px 78px minmax(110px,1.4fr)";

const PHASE_KEY: Record<ArsenalPhase, I18nKey> = { shooting: "roster.arsenal.phase.shooting", melee: "roster.arsenal.phase.melee", both: "roster.arsenal.phase.both" };
const COUNTING_KEY: Record<ArsenalPhase, I18nKey> = { shooting: "roster.arsenal.counting.shooting", melee: "roster.arsenal.counting.melee", both: "roster.arsenal.counting.both" };

/** Inches as the profiles print them; an em dash when the unit has nothing of that kind. */
const inches = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${fmt(n, 0)}"`);

/* ---------- small parts ---------- */

/** A 10px mono uppercase label over a 24px mono value — the Statistics tab's tile, verbatim. */
function Tile({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="stat-tile" title={title}>
      <span className="stat-tile-label t-eyebrow">{label}</span>
      <span className="stat-tile-value t-metric">{value}</span>
    </div>
  );
}

function Section({ title, aside, note, children }: { title: string; aside?: ReactNode; note?: string; children: ReactNode }) {
  return (
    <section className="stat-section">
      <PanelHead title={title} aside={aside} />
      {note ? <p className="stat-note">{note}</p> : null}
      {children}
    </section>
  );
}

export interface BarRow {
  key: string;
  label: string;
  /** Bar length, 0..1. */
  fraction: number;
  value: string;
  meta?: string;
  title?: string;
}

/** label | proportional bar | mono value | optional second mono value. The compact cousin of a GridTable. */
function BarList({ rows, label, meta }: { rows: BarRow[]; label: string; meta?: boolean }) {
  return (
    <ul className="ars-barlist" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className={`ars-barrow ${meta ? "with-meta" : ""}`.trim()} title={r.title}>
          <span className="ars-barlabel mono">{r.label}</span>
          <ProportionBar value={r.fraction} tone="ink" height={8} />
          <span className="ars-barvalue mono">{r.value}</span>
          {meta ? <span className="ars-barmeta mono">{r.meta ?? "—"}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * One attack count in the wound table, tinted by its share of the counted attacks. The ramp is the
 * matrix heatmap's: a single ink at a growing opacity, so the number stays readable at every step.
 */
function HeatCell({ attacks, total, title }: { attacks: number; total: number; title?: string }) {
  const c = heatColour(attacks > 0 ? attacks : undefined, 0, total);
  return (
    <GridCell align="end" mono className="ars-heat-cell">
      <span className="ars-heat" title={title} style={{ background: c.background, color: attacks > 0 ? c.color : undefined } as CSSProperties}>
        {attacks > 0 ? attacksLabel(attacks) : "·"}
      </span>
    </GridCell>
  );
}

/**
 * Roster entries as scenario units, an attached character folded into its host exactly as the
 * Statistics tab does. A unit whose datasheet is missing from the snapshot is skipped rather than
 * throwing the whole page away.
 */
function scenarioUnits(roster: Roster, snapshot: Snapshot): ScenarioUnit[] {
  const ids = new Set(roster.units.map((u) => u.id));
  const out: ScenarioUnit[] = [];
  for (const u of roster.units) {
    const host = u.attachedTo?.unitId;
    if (host && host !== u.id && ids.has(host)) continue;
    try {
      out.push(unitFromRosterUnit(u, roster, snapshot));
    } catch {
      // datasheet missing from the snapshot; the units list already flags it
    }
  }
  return out;
}

interface Props {
  roster: Roster;
  snapshot: Snapshot;
}

/**
 * Armies → Arsenal: what the list can put out, read straight off its weapon profiles.
 *
 * Every number here is synchronous arithmetic over the roster (`lib/arsenal`, `lib/rosterProfile`)
 * — no worker, no solving — so the tab paints complete on the first frame. What it cannot know it
 * says out loud: conditional keywords are counted separately rather than folded in silently.
 */
export function ArsenalTab({ roster, snapshot }: Props) {
  // The phase switch is a reading preference, so it is remembered across armies.
  const [phase, setPhase] = usePersistedSetting<ArsenalPhase>("roster.arsenal.phase", "both", parseArsenalPhase);

  const units = useMemo(() => scenarioUnits(roster, snapshot), [roster, snapshot]);
  const summary = useMemo(() => arsenalFor(units), [units]);
  const per = useMemo(() => perModel(summary), [summary]);
  const view = useMemo(() => phaseView(summary, phase), [summary, phase]);
  const wounds = useMemo(() => woundTable(units, phase), [units, phase]);
  const saves = useMemo(() => saveForced(units, phase), [units, phase]);
  const skills = useMemo(() => bySkill(units, phase), [units, phase]);
  const tiers = useMemo(() => damageTiers(units, phase), [units, phase]);
  const defence = useMemo(() => defensiveProfile(units), [units]);
  const threat = useMemo(() => threatProfile(roster, snapshot), [roster, snapshot]);
  const deployment = useMemo(() => deploymentCensus(roster, snapshot), [roster, snapshot]);

  if (units.length === 0) {
    return (
      <div className="army-stats army-arsenal">
        <Empty>{t("roster.arsenal.empty")}</Empty>
      </div>
    );
  }

  const armed = summary.shooting.attacks + summary.melee.attacks > 0;
  const counting = <span className="t-meta">{t(COUNTING_KEY[phase])}</span>;

  const phaseSwitch = (
    <div className="ars-switch" role="group" aria-label={t("roster.arsenal.phaseAria")}>
      <span className="t-eyebrow ars-switch-label">{t("roster.arsenal.phase")}</span>
      {ARSENAL_PHASES.map((p) => (
        <PillChip key={p} label={t(PHASE_KEY[p])} on={p === phase} onChange={() => setPhase(p)} />
      ))}
    </div>
  );

  const strengthPeak = peak(view.byStrength.map((b) => b.attacks));
  const spill = tiers.filter((x) => x.key !== "1").reduce((s, x) => s + x.attacks, 0);
  const skillPeak = peak(skills.map((s) => s.attacks));
  const tierPeak = peak(tiers.map((x) => x.attacks));
  const rangePeak = peak(summary.ranges.map((r) => r.attacks));
  const bandPeak = peak(threat.bands.map((b) => b.units));
  const totalWounds = defence.reduce((s, d) => s + d.wounds, 0);

  return (
    <div className="army-stats army-arsenal">
      {/* ---------- 1. Output per model ---------- */}
      <Section title={t("roster.arsenal.perModel")} note={t("roster.arsenal.perModel.note")} aside={<span className="t-meta">{tn(summary.models, "roster.stats.models.one", "roster.stats.models.many")}</span>}>
        <div className="stat-tiles">
          <Tile label={t("roster.arsenal.metric.shootingPerModel")} value={fmt(per.shootingAttacks, 2)} />
          <Tile label={t("roster.arsenal.metric.meleePerModel")} value={fmt(per.meleeAttacks, 2)} />
          <Tile label={t("roster.arsenal.metric.shootingDamage")} value={fmt(summary.shooting.meanDamage, 2)} title={t("roster.arsenal.metric.damageTitle")} />
          <Tile label={t("roster.arsenal.metric.meleeDamage")} value={fmt(summary.melee.meanDamage, 2)} title={t("roster.arsenal.metric.damageTitle")} />
          <Tile label={t("roster.arsenal.metric.shootingTotal")} value={attacksLabel(summary.shooting.attacks)} title={t("roster.arsenal.metric.totalTitle")} />
          <Tile label={t("roster.arsenal.metric.meleeTotal")} value={attacksLabel(summary.melee.attacks)} title={t("roster.arsenal.metric.totalTitle")} />
        </div>
      </Section>

      {armed ? (
        <>
          {/* ---------- 2. Shots by strength ---------- */}
          <Section
            title={t("roster.arsenal.strength")}
            note={t("roster.arsenal.strength.note")}
            aside={
              <div className="stat-aside">
                <span className="t-meta">{t("roster.arsenal.meanStrength", { n: fmt(view.meanStrength, 1) })}</span>
                {phaseSwitch}
              </div>
            }
          >
            <GridTable columns={STRENGTH_COLUMNS} label={t("roster.arsenal.strength.aria")} className="stat-table">
              <GridHead>
                <GridHeadCell>{t("roster.arsenal.col.strength")}</GridHeadCell>
                <GridHeadCell>{t("roster.arsenal.col.relative")}</GridHeadCell>
                <GridHeadCell align="end">{t("roster.arsenal.col.attacks")}</GridHeadCell>
                <GridHeadCell align="end">{t("roster.arsenal.col.share")}</GridHeadCell>
              </GridHead>
              {view.byStrength.map((b) => (
                <GridRow key={b.key} className="stat-row static">
                  <GridCell mono>{b.key}</GridCell>
                  <GridCell>
                    <ProportionBar value={shareOf(b.attacks, strengthPeak)} tone="ink" height={8} />
                  </GridCell>
                  <GridCell align="end" mono>
                    {attacksLabel(b.attacks)}
                  </GridCell>
                  <GridCell align="end" mono tone="muted">
                    {`${fmt(shareOf(b.attacks, view.attacks) * 100, 1)}%`}
                  </GridCell>
                </GridRow>
              ))}
            </GridTable>
          </Section>

          {/* ---------- 3. What it can hurt ---------- */}
          <Section title={t("roster.arsenal.hurt")} note={t("roster.arsenal.hurt.note")} aside={counting}>
            <GridTable columns={WOUND_COLUMNS} label={t("roster.arsenal.hurt.aria")} className="stat-table">
              <GridHead>
                <GridHeadCell>{t("roster.arsenal.col.toughness")}</GridHeadCell>
                {([2, 3, 4, 5, 6] as const).map((r) => (
                  <GridHeadCell key={r} align="end">
                    {t("roster.arsenal.col.roll", { n: r })}
                  </GridHeadCell>
                ))}
                <GridHeadCell>{t("roster.arsenal.col.comfortable")}</GridHeadCell>
              </GridHead>
              {wounds.map((row) => (
                <GridRow key={row.toughness} className="stat-row static" title={t("roster.arsenal.hurt.rowTitle", { t: row.toughness, n: attacksLabel(row.comfortable), total: attacksLabel(row.attacks) })}>
                  <GridCell mono>{`T${row.toughness}`}</GridCell>
                  {([2, 3, 4, 5, 6] as const).map((r) => (
                    <HeatCell key={r} attacks={row.byRoll[r]} total={view.attacks} />
                  ))}
                  <GridCell>
                    <span className="stat-share">
                      <ProportionBar value={shareOf(row.comfortable, row.attacks)} tone="ink" height={8} />
                      {/* Cells in this table are attack counts; this column is a percentage, so it carries its sign. */}
                      <span className="stat-share-pct">{`${fmt(shareOf(row.comfortable, row.attacks) * 100, 0)}%`}</span>
                    </span>
                  </GridCell>
                </GridRow>
              ))}
            </GridTable>
          </Section>

          {/* ---------- 4. What it forces ---------- */}
          <Section title={t("roster.arsenal.forces")} note={t("roster.arsenal.forces.note")} aside={counting}>
            <GridTable columns={SAVE_COLUMNS} label={t("roster.arsenal.forces.aria")} className="stat-table">
              <GridHead>
                <GridHeadCell>{t("roster.arsenal.col.armour")}</GridHeadCell>
                {[2, 3, 4, 5, 6, 7].map((m) => (
                  <GridHeadCell key={m} align="end">
                    {saveLabel(m) ?? t("roster.arsenal.col.noSave")}
                  </GridHeadCell>
                ))}
              </GridHead>
              {saves.map((row) => (
                <GridRow key={row.save} className="stat-row static" title={t("roster.arsenal.forces.rowTitle", { save: `${row.save}+`, n: attacksLabel(row.noSave), total: attacksLabel(row.attacks) })}>
                  <GridCell mono>{`${row.save}+`}</GridCell>
                  {[2, 3, 4, 5, 6, 7].map((m) => (
                    <GridCell key={m} align="end" mono tone={m >= 7 && (row.byModified[m] ?? 0) > 0 ? "accent" : (row.byModified[m] ?? 0) > 0 ? "ink" : "faint"}>
                      {(row.byModified[m] ?? 0) > 0 ? attacksLabel(row.byModified[m]) : "·"}
                    </GridCell>
                  ))}
                </GridRow>
              ))}
            </GridTable>
          </Section>

          {/* ---------- 5. Hit rolls and damage ---------- */}
          <Section title={t("roster.arsenal.rolls")} aside={counting}>
            <div className="ars-split">
              <div className="ars-panel">
                <h3 className="t-eyebrow ars-panel-title">{t("roster.arsenal.rolls.skill")}</h3>
                <BarList
                  label={t("roster.arsenal.rolls.skill")}
                  rows={skills.map((s) => ({
                    key: String(s.skill ?? "auto"),
                    label: s.skill === null ? t("roster.arsenal.rolls.auto") : `${s.skill}+`,
                    fraction: shareOf(s.attacks, skillPeak),
                    value: attacksLabel(s.attacks),
                    title: s.skill === null ? t("roster.arsenal.rolls.autoTitle") : undefined,
                  }))}
                />
              </div>
              <div className="ars-panel">
                <h3 className="t-eyebrow ars-panel-title">{t("roster.arsenal.rolls.damage")}</h3>
                <BarList
                  meta
                  label={t("roster.arsenal.rolls.damage")}
                  rows={tiers.map((x) => ({
                    key: x.key,
                    label: x.key === "dice" ? t("roster.arsenal.rolls.damageRandom") : x.label,
                    fraction: shareOf(x.attacks, tierPeak),
                    value: attacksLabel(x.attacks),
                    meta: fmt(x.meanDamage, 1),
                  }))}
                />
                <p className="stat-note ars-inline-note">{spill > 0 ? tn(Math.round(spill), "roster.arsenal.spill.one", "roster.arsenal.spill.many") : t("roster.arsenal.spill.none")}</p>
              </div>
            </div>
          </Section>

          {/* ---------- 6. Conditional attacks ---------- */}
          <Section title={t("roster.arsenal.conditional")} note={t("roster.arsenal.conditional.note")} aside={counting}>
            {view.conditional.length === 0 ? (
              <p className="stat-note">{t("roster.arsenal.conditional.none")}</p>
            ) : (
              <div className="stat-kw-groups">
                <ul className="stat-kw-list">
                  {view.conditional.map((k) => (
                    <li key={k.name}>
                      <span className="stat-kw" title={t("roster.arsenal.conditionalTitle", { name: k.name, n: attacksLabel(k.attacks), weapons: k.weapons.join(", ") })}>
                        <span className="stat-kw-name">{k.name}</span>
                        <span className="stat-kw-count">{attacksLabel(k.attacks)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        </>
      ) : (
        <Section title={t("roster.arsenal.strength")}>
          <p className="stat-note">{t("roster.arsenal.noWeapons")}</p>
        </Section>
      )}

      {/* ---------- 7. Reach ---------- */}
      <Section title={t("roster.arsenal.reach")} note={t("roster.arsenal.reach.note")}>
        <div className="ars-split">
          <div className="ars-panel">
            <h3 className="t-eyebrow ars-panel-title">{t("roster.arsenal.reach.ranges")}</h3>
            <BarList
              label={t("roster.arsenal.reach.ranges")}
              rows={summary.ranges.map((r) => ({ key: r.label, label: r.label, fraction: shareOf(r.attacks, rangePeak), value: attacksLabel(r.attacks) }))}
            />
          </div>
          <div className="ars-panel">
            <h3 className="t-eyebrow ars-panel-title">{t("roster.arsenal.reach.bands")}</h3>
            <BarList
              meta
              label={t("roster.arsenal.reach.bands")}
              rows={threat.bands.map((b) => ({
                key: b.label,
                label: b.label,
                fraction: shareOf(b.units, bandPeak),
                value: fmtInt(b.units),
                meta: fmtInt(b.points),
                title: t("roster.arsenal.bandTitle", { label: b.label, units: tn(b.units, "roster.arsenal.units.one", "roster.arsenal.units.many"), points: fmtInt(b.points) }),
              }))}
            />
          </div>
        </div>
        <GridTable columns={THREAT_COLUMNS} label={t("roster.arsenal.reach.aria")} className="stat-table ars-threat">
          <GridHead>
            <GridHeadCell>{t("roster.arsenal.col.unit")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.arsenal.col.move")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.arsenal.col.shootingReach")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.arsenal.col.meleeReach")}</GridHeadCell>
          </GridHead>
          {threat.rows.map((r, i) => (
            <GridRow key={`${r.unit}-${i}`} className="stat-row static" title={r.unit}>
              <GridCell className="ars-unit">{r.unit}</GridCell>
              <GridCell align="end" mono tone="muted">
                {inches(r.move)}
              </GridCell>
              <GridCell align="end" mono tone={r.shooting === null ? "faint" : "ink"}>
                {inches(r.shooting)}
              </GridCell>
              <GridCell align="end" mono tone={r.melee === null ? "faint" : "ink"}>
                {inches(r.melee)}
              </GridCell>
            </GridRow>
          ))}
        </GridTable>
      </Section>

      {/* ---------- 8. Deployment ---------- */}
      <Section title={t("roster.arsenal.deployment")} note={t("roster.arsenal.deployment.note")}>
        {deployment.length === 0 ? (
          <p className="stat-note">{t("roster.arsenal.deployment.none")}</p>
        ) : (
          <GridTable columns={DEPLOY_COLUMNS} label={t("roster.arsenal.deployment.aria")} className="stat-table">
            <GridHead>
              <GridHeadCell>{t("roster.arsenal.col.deploy")}</GridHeadCell>
              <GridHeadCell align="end">{t("roster.arsenal.col.units")}</GridHeadCell>
              <GridHeadCell align="end">{t("roster.arsenal.col.points")}</GridHeadCell>
              <GridHeadCell align="end">{t("roster.arsenal.col.models")}</GridHeadCell>
            </GridHead>
            {deployment.map((d) => (
              <GridRow key={d.kind} className="stat-row static" title={d.names.join(", ")}>
                <GridCell className="mono ars-deploy">{d.kind}</GridCell>
                <GridCell align="end" mono>
                  {fmtInt(d.units)}
                </GridCell>
                <GridCell align="end" mono>
                  {fmtInt(d.points)}
                </GridCell>
                <GridCell align="end" mono tone="muted">
                  {fmtInt(d.models)}
                </GridCell>
              </GridRow>
            ))}
          </GridTable>
        )}
      </Section>

      {/* ---------- 9. Defence ---------- */}
      <Section title={t("roster.arsenal.defence")} note={t("roster.arsenal.defence.note")}>
        <GridTable columns={DEFENCE_COLUMNS} label={t("roster.arsenal.defence.aria")} className="stat-table">
          <GridHead>
            <GridHeadCell>{t("roster.arsenal.col.toughness")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.arsenal.col.save")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.arsenal.col.invuln")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.arsenal.col.models")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.arsenal.col.wounds")}</GridHeadCell>
            <GridHeadCell>{t("roster.arsenal.col.woundShare")}</GridHeadCell>
          </GridHead>
          {defence.map((d) => (
            <GridRow key={`${d.toughness}-${d.save}-${d.invuln ?? 0}`} className="stat-row static" title={d.units.join(", ")}>
              <GridCell mono>{`T${d.toughness}`}</GridCell>
              <GridCell align="end" mono>
                {`${d.save}+`}
              </GridCell>
              <GridCell align="end" mono tone={d.invuln === null ? "faint" : "ink"}>
                {d.invuln === null ? "—" : `${d.invuln}+`}
              </GridCell>
              <GridCell align="end" mono>
                {fmtInt(d.models)}
              </GridCell>
              <GridCell align="end" mono>
                {fmtInt(d.wounds)}
              </GridCell>
              <GridCell>
                <span className="stat-share">
                  <ProportionBar value={shareOf(d.wounds, totalWounds)} tone="ink" height={8} />
                  <span className="stat-share-pct">{`${fmt(shareOf(d.wounds, totalWounds) * 100, 0)}%`}</span>
                </span>
              </GridCell>
            </GridRow>
          ))}
        </GridTable>
      </Section>
    </div>
  );
}
