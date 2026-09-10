import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Datasheet, Roster, Snapshot } from "@grimstat/schema";
import type { UnitCost } from "@grimstat/resolver";
import { armyComposition, sortStatRows, type ArmyStatRow, type StatSort, type StatSortCol } from "../../lib/armyStats";
import type { UnitSection } from "../../lib/roster";
import { fmt, fmtInt } from "../../lib/format";
import { STAT_TARGET_IDS, TARGET_DETAIL, useArmyStats, type StatTargetId } from "../../hooks/useArmyStats";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead, ProportionBar, SelectBox } from "../kit";
import { Empty } from "../ui";
import { t, tn, type I18nKey } from "../../i18n";

const SECTION_KEY: Record<UnitSection, I18nKey> = {
  character: "roster.section.character",
  battleline: "roster.section.battleline",
  transport: "roster.section.transport",
  other: "roster.section.other",
  allied: "roster.section.allied",
};

const TARGET_KEY: Record<StatTargetId, I18nKey> = {
  "guardsman-like": "roster.stats.target.light",
  "horde-like": "roster.stats.target.horde",
  "marine-like": "roster.stats.target.power",
  "terminator-like": "roster.stats.target.elite",
  "light-vehicle": "roster.stats.target.lightVehicle",
  "heavy-tank": "roster.stats.target.heavyTank",
};

/** Role | Units | Models | Points | Share of the list (bar + %). */
const ROLE_COLUMNS = "minmax(140px,1.6fr) 74px 78px 82px minmax(120px,1.2fr)";
/** Target | bar | damage | per 100 pts. */
const OUTPUT_COLUMNS = "minmax(120px,1fr) minmax(80px,2fr) 92px 92px";
/** Unit | Points | Models | Wounds | OC | damage per 100 pts | Durability. */
const UNIT_COLUMNS = "minmax(120px,2.4fr) 62px 62px 66px 48px 84px 92px";

/** Points read as bare digits ("970 / 2000"), exactly as the header bar sets them. */
const plain = (v: number) => String(Math.round(v));

/** A 10px mono uppercase label over a 24px mono value. */
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

/** The quiet "solving 3 units" count; nothing at all once the worker has caught up. */
function Pending({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="stat-pending" role="status" aria-live="polite">
      {tn(n, "roster.stats.solving.one", "roster.stats.solving.many")}
    </span>
  );
}

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  datasheets: Map<string, Datasheet>;
  costById: Map<string, UnitCost>;
  /** Select a unit and hand the reader back to the units list with the inspector open. */
  onSelectUnit: (id: string) => void;
}

/**
 * Armies → Statistics: the army as a whole. Composition and keywords are pure arithmetic over the
 * roster; Output, Durability and the details table's last two columns come from the simulation
 * worker (see `useArmyStats`) and stream in behind the first paint.
 */
export function StatisticsTab({ roster, snapshot, datasheets, costById, onSelectUnit }: Props) {
  const [target, setTarget] = useState<StatTargetId>("marine-like");
  const [sort, setSort] = useState<StatSort>({ col: "points", dir: "desc" });

  const composition = useMemo(() => armyComposition(roster, datasheets, costById), [roster, datasheets, costById]);
  const solve = useArmyStats(roster, snapshot, composition.rows, composition.rows.length > 0);

  const rows: ArmyStatRow[] = useMemo(
    () =>
      composition.rows.map((r) => {
        const s = solve.get(r.id);
        return { ...r, damagePer100: s && r.points > 0 ? (s.damage[target] / r.points) * 100 : undefined, durability: s?.pointsToRemove };
      }),
    [composition.rows, solve, target],
  );
  const sorted = useMemo(() => sortStatRows(rows, sort), [rows, sort]);

  /** Army-wide expected damage per target archetype, summed from the same runs the table uses. */
  const output = useMemo(() => {
    const out = STAT_TARGET_IDS.map((id) => {
      let total = 0;
      for (const r of composition.rows) total += solve.get(r.id)?.damage[id] ?? 0;
      return { id, total, per100: composition.points > 0 ? (total / composition.points) * 100 : 0 };
    });
    const max = Math.max(...out.map((o) => o.total), 0);
    return out.map((o) => ({ ...o, fraction: max > 0 ? o.total / max : 0 }));
  }, [composition.rows, composition.points, solve]);

  /** Points of shooting the army absorbs, plus its two extremes. */
  const durability = useMemo(() => {
    let absorbed = 0;
    let toughest: ArmyStatRow | undefined;
    let frailest: ArmyStatRow | undefined;
    for (const r of rows) {
      if (r.durability === undefined || !Number.isFinite(r.durability)) continue;
      absorbed += r.durability;
      if (toughest?.durability === undefined || r.durability > toughest.durability) toughest = r;
      if (frailest?.durability === undefined || r.durability < frailest.durability) frailest = r;
    }
    return { absorbed, toughest, frailest };
  }, [rows]);

  const onSort = (col: StatSortCol) => setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "unit" ? "asc" : "desc" }));
  const sortOf = (col: StatSortCol) => (sort.col === col ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
  /** "—" while the worker is still solving, "∞" for a unit nothing in the attacker set can remove. */
  const num = (v: number | undefined, digits = 2) => (v === undefined ? "—" : Number.isFinite(v) ? fmt(v, digits) : "∞");
  const points = (v: number | undefined) => (v === undefined ? "—" : Number.isFinite(v) ? fmtInt(v) : "∞");

  // ↑/↓ walk the unit buttons, exactly as the units list does.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (!el.classList.contains("stat-unit-btn")) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>(".stat-unit-btn")];
    const i = all.indexOf(el);
    all[e.key === "ArrowDown" ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
  };

  if (composition.rows.length === 0) {
    return (
      <div className="army-stats">
        <Empty>{t("roster.stats.empty")}</Empty>
      </div>
    );
  }

  const targetPicker = (
    <SelectBox
      label={t("roster.stats.target")}
      value={target}
      options={STAT_TARGET_IDS.map((id) => ({ value: id, label: t(TARGET_KEY[id]) }))}
      onChange={setTarget}
      title={TARGET_DETAIL[target]}
    />
  );

  return (
    <div className="army-stats">
      {/* ---------- 1. Composition ---------- */}
      <Section title={t("roster.stats.composition")}>
        <div className="stat-tiles">
          <Tile
            label={t("roster.stats.metric.points")}
            value={`${plain(composition.points)} / ${plain(composition.limit)}`}
            title={composition.over > 0 ? t("roster.points.over", { n: fmtInt(composition.over) }) : t("roster.points.spare", { n: fmtInt(composition.spare) })}
          />
          <Tile label={t("roster.stats.metric.units")} value={fmtInt(composition.units)} />
          <Tile label={t("roster.stats.metric.models")} value={fmtInt(composition.models)} />
          <Tile label={t("roster.stats.metric.wounds")} value={fmtInt(composition.wounds)} />
          <Tile label={t("roster.stats.metric.oc")} value={fmtInt(composition.oc)} />
          <Tile label={t("roster.stats.metric.perModel")} value={fmt(composition.pointsPerModel, 1)} />
        </div>

        <GridTable columns={ROLE_COLUMNS} label={t("roster.stats.roles")} className="stat-table">
          <GridHead>
            <GridHeadCell>{t("roster.stats.col.role")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.stats.col.units")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.stats.col.models")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.stats.col.points")}</GridHeadCell>
            <GridHeadCell>{t("roster.stats.col.share")}</GridHeadCell>
          </GridHead>
          {composition.roles.map((r) => (
            <GridRow key={r.section} className="stat-row static">
              <GridCell>{t(SECTION_KEY[r.section])}</GridCell>
              <GridCell align="end" mono>
                {fmtInt(r.units)}
              </GridCell>
              <GridCell align="end" mono>
                {fmtInt(r.models)}
              </GridCell>
              <GridCell align="end" mono>
                {fmtInt(r.points)}
              </GridCell>
              <GridCell>
                <span className="stat-share">
                  <ProportionBar value={r.share} tone={r.tone} height={8} title={`${fmt(r.share * 100, 1)}%`} />
                  <span className="stat-share-pct">{fmt(r.share * 100, 1)}</span>
                </span>
              </GridCell>
            </GridRow>
          ))}
        </GridTable>
      </Section>

      {/* ---------- 2. Output ---------- */}
      <Section title={t("roster.stats.output")} aside={<Pending n={solve.pending} />} note={t("roster.stats.output.note")}>
        <GridTable columns={OUTPUT_COLUMNS} label={t("roster.stats.output.aria")} className="stat-table">
          <GridHead>
            <GridHeadCell>{t("roster.stats.col.target")}</GridHeadCell>
            <GridHeadCell>{t("roster.stats.col.relative")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.stats.col.damage")}</GridHeadCell>
            <GridHeadCell align="end">{t("roster.stats.col.damagePer100")}</GridHeadCell>
          </GridHead>
          {output.map((o) => (
            <GridRow key={o.id} className="stat-row static" title={TARGET_DETAIL[o.id]}>
              <GridCell>{t(TARGET_KEY[o.id])}</GridCell>
              <GridCell>
                <ProportionBar value={o.fraction} tone="ink" height={8} />
              </GridCell>
              <GridCell align="end" mono>
                {fmt(o.total, 1)}
              </GridCell>
              <GridCell align="end" mono tone="muted">
                {fmt(o.per100, 2)}
              </GridCell>
            </GridRow>
          ))}
        </GridTable>
      </Section>

      {/* ---------- 3. Durability ---------- */}
      <Section title={t("roster.stats.durability")} aside={<Pending n={solve.pending} />} note={t("roster.stats.durability.note")}>
        <div className="stat-tiles">
          <Tile label={t("roster.stats.metric.wounds")} value={fmtInt(composition.wounds)} />
          <Tile label={t("roster.stats.metric.absorbs")} value={durability.absorbed > 0 ? fmtInt(durability.absorbed) : "—"} title={t("roster.stats.metric.absorbsTitle")} />
        </div>
        <dl className="stat-extremes">
          <div>
            <dt className="t-eyebrow">{t("roster.stats.toughest")}</dt>
            <dd>
              <span className="stat-extreme-name">{durability.toughest?.name ?? "—"}</span>
              <span className="stat-extreme-val">{points(durability.toughest?.durability)}</span>
            </dd>
          </div>
          <div>
            <dt className="t-eyebrow">{t("roster.stats.frailest")}</dt>
            <dd>
              <span className="stat-extreme-name">{durability.frailest?.name ?? "—"}</span>
              <span className="stat-extreme-val">{points(durability.frailest?.durability)}</span>
            </dd>
          </div>
        </dl>
      </Section>

      {/* ---------- 4. Every unit in detail ---------- */}
      <Section
        title={t("roster.stats.units")}
        aside={
          <div className="stat-aside">
            <Pending n={solve.pending} />
            {targetPicker}
          </div>
        }
      >
        <div onKeyDown={onKey}>
          <GridTable columns={UNIT_COLUMNS} label={t("roster.stats.units.aria")} className="stat-table stat-units">
            <GridHead>
              <GridHeadCell sort={sortOf("unit")} onSort={() => onSort("unit")}>
                {t("roster.stats.col.unit")}
              </GridHeadCell>
              <GridHeadCell align="end" sort={sortOf("points")} onSort={() => onSort("points")}>
                {t("roster.stats.col.points")}
              </GridHeadCell>
              <GridHeadCell align="end" sort={sortOf("models")} onSort={() => onSort("models")}>
                {t("roster.stats.col.models")}
              </GridHeadCell>
              <GridHeadCell align="end" sort={sortOf("wounds")} onSort={() => onSort("wounds")}>
                {t("roster.stats.col.wounds")}
              </GridHeadCell>
              <GridHeadCell align="end" sort={sortOf("oc")} onSort={() => onSort("oc")}>
                {t("roster.stats.col.ocShort")}
              </GridHeadCell>
              <GridHeadCell align="end" sort={sortOf("damage")} onSort={() => onSort("damage")}>
                {t("roster.stats.col.damagePer100Short")}
              </GridHeadCell>
              <GridHeadCell align="end" sort={sortOf("durability")} onSort={() => onSort("durability")}>
                {t("roster.stats.col.durability")}
              </GridHeadCell>
            </GridHead>
            {sorted.map((r) => (
              <GridRow key={r.id} className="stat-row" onClick={() => onSelectUnit(r.id)}>
                <GridCell className="stat-unit">
                  <button
                    type="button"
                    className="stat-unit-btn"
                    title={t("roster.stats.rowTitle", { name: r.name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectUnit(r.id);
                    }}
                  >
                    <span className="stat-unit-name">{r.name}</span>
                    <span className="stat-unit-sub">{`${r.role || t(SECTION_KEY[r.section])} · ${tn(r.models, "roster.stats.models.one", "roster.stats.models.many")}`}</span>
                  </button>
                </GridCell>
                <GridCell align="end" mono>
                  {fmtInt(r.points)}
                </GridCell>
                <GridCell align="end" mono>
                  {fmtInt(r.models)}
                </GridCell>
                <GridCell align="end" mono>
                  {fmtInt(r.wounds)}
                </GridCell>
                <GridCell align="end" mono>
                  {fmtInt(r.oc)}
                </GridCell>
                <GridCell align="end" mono tone={r.damagePer100 === undefined ? "faint" : "ink"}>
                  {num(r.damagePer100)}
                </GridCell>
                <GridCell align="end" mono tone={r.durability === undefined ? "faint" : "muted"}>
                  {points(r.durability)}
                </GridCell>
              </GridRow>
            ))}
          </GridTable>
        </div>
        <p className="stat-keys">{t("roster.stats.units.keys")}</p>
      </Section>

      {/* ---------- 5. Keywords ---------- */}
      <Section title={t("roster.stats.keywords")} note={t("roster.stats.keywords.note")}>
        {composition.factionKeywords.length === 0 && composition.unitKeywords.length === 0 ? (
          <p className="stat-note">{t("roster.stats.keywords.none")}</p>
        ) : (
          <div className="stat-kw-groups">
            {(
              [
                { key: "roster.stats.keywords.faction", list: composition.factionKeywords },
                { key: "roster.stats.keywords.unit", list: composition.unitKeywords },
              ] as const
            ).map(({ key, list }) =>
              list.length === 0 ? null : (
                <div key={key} className="stat-kw-group">
                  <h3 className="t-eyebrow stat-kw-title">{t(key)}</h3>
                  <ul className="stat-kw-list">
                    {list.map((k) => (
                      <li key={k.name}>
                        <span className="stat-kw" title={tn(k.count, "roster.stats.keywordChip.one", "roster.stats.keywordChip.many", { name: k.name })}>
                          <span className="stat-kw-name">{k.name}</span>
                          <span className="stat-kw-count">{fmtInt(k.count)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
