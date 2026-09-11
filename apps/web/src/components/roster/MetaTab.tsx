import { useMemo, useState, type ReactNode } from "react";
import type { Roster, Snapshot } from "@grimstat/schema";
import { usePublishedField } from "../../hooks/usePublishedField";
import { closest, detachmentField, dispositionField, fieldRows, peersFor, sideBySide, tallyOf, type DetachmentFilter, type FieldCount, type FieldNote, type PlacingFilter } from "../../lib/meta";
import { fmt, fmtInt } from "../../lib/format";
import { hrefFor } from "../../router";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead, ProportionBar, SelectBox } from "../kit";
import { Badge, Empty } from "../ui";
import { UnitArt } from "../UnitArt";
import { t, tn, type I18nKey } from "../../i18n";

/** Unit | yours | share of the field (bar + %) | typical when taken | note. */
const FIELD_COLUMNS = "minmax(150px,2fr) 60px minmax(120px,1.4fr) 110px 120px";
/** Player | placing | write-up | points in common (bar + %). */
const NEAR_COLUMNS = "minmax(120px,1.4fr) 60px minmax(140px,2fr) minmax(110px,1.2fr)";
/** Unit | yours | theirs. */
const SIDE_COLUMNS = "minmax(150px,2fr) 120px 120px";
/** Name | bar | lists. */
const COUNT_COLUMNS = "minmax(140px,1.4fr) minmax(100px,2fr) 60px";

const NOTE_KEY: Record<FieldNote, I18nKey | undefined> = {
  missing: "roster.meta.note.missing",
  rare: "roster.meta.note.rare",
  more: "roster.meta.note.more",
  fewer: "roster.meta.note.fewer",
  match: "roster.meta.note.match",
  none: undefined,
};
const NOTE_TONE: Record<FieldNote, "ok" | "warn" | "danger" | "accent" | "brass" | undefined> = { missing: "warn", rare: "brass", more: "accent", fewer: "accent", match: "ok", none: undefined };

const percent = (x: number) => `${Math.round(x * 100)}%`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** A 10px mono uppercase label over a 24px mono value — the Statistics tab's tile, verbatim. */
function Tile({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="stat-tile" title={title}>
      <span className="stat-tile-label t-eyebrow">{label}</span>
      <span className="stat-tile-value">{value}</span>
    </div>
  );
}

/**
 * The list against the field: what the placing lists of its faction take, how this one differs,
 * and which of them it most resembles.
 *
 * The field is whatever the reader has imported on the Data page — published write-ups, resolved
 * against the reader's own snapshot right here. Nothing is fetched, nothing is scored: the numbers
 * are counts, and every source is a link.
 */
export function MetaTab({ roster, snapshot }: { roster: Roster; snapshot: Snapshot }) {
  const { records, peers: resolved, resolved: fresh, pending, progress } = usePublishedField(snapshot);
  const [placing, setPlacing] = useState<PlacingFilter>("all");
  const [detachment, setDetachment] = useState<DetachmentFilter>("any");
  const [nearId, setNearId] = useState<string | undefined>();

  const faction = snapshot.data.factions.find((f) => f.id === roster.factionId);
  const peers = useMemo(() => peersFor(resolved, roster, { placing, detachment }), [resolved, roster, placing, detachment]);
  const mine = useMemo(() => tallyOf(roster, snapshot), [roster, snapshot]);
  const rows = useMemo(() => fieldRows(mine.tally, peers, snapshot), [mine, peers, snapshot]);
  const near = useMemo(() => closest(mine.tally, mine.points, peers, 5), [mine, peers]);
  const detachments = useMemo(() => detachmentField(peers, snapshot), [peers, snapshot]);
  const dispositions = useMemo(() => dispositionField(peers), [peers]);
  const chosen = near.find((n) => n.peer.record.id === nearId) ?? near[0];
  const side = useMemo(() => (chosen ? sideBySide(mine.tally, chosen.peer.tally, snapshot) : []), [mine, chosen, snapshot]);

  // Lists that name this faction but could not be read against this snapshot: worth saying, since
  // they are silently absent from every number below. Lists still being resolved are not counted.
  const unreadable = useMemo(() => {
    const name = faction?.name.toLowerCase();
    return (records ?? []).filter((r) => fresh.get(r.id)?.readable === false && name !== undefined && r.faction?.toLowerCase() === name).length;
  }, [records, fresh, faction]);
  const writeUps = useMemo(() => new Set(peers.map((p) => p.record.source.url ?? p.record.source.title ?? p.record.id)).size, [peers]);

  if (records === undefined) return null;
  if (records.length === 0) {
    return (
      <Empty>
        <p>{t("roster.meta.empty")}</p>
        <p>
          <a href={hrefFor("data")}>{t("roster.meta.emptyLink")}</a>
        </p>
      </Empty>
    );
  }

  return (
    <div className="meta-tab">
      <PanelHead
        title={t("roster.meta.title", { faction: faction?.name ?? roster.factionId })}
        aside={
          <span className="meta-filters">
            <SelectBox<PlacingFilter>
              label={t("roster.meta.placing")}
              value={placing}
              onChange={setPlacing}
              options={[
                { value: "all", label: t("roster.meta.placing.all") },
                { value: "top3", label: t("roster.meta.placing.top3") },
                { value: "winners", label: t("roster.meta.placing.winners") },
              ]}
            />
            <SelectBox<DetachmentFilter>
              label={t("roster.meta.detachment")}
              value={detachment}
              onChange={setDetachment}
              options={[
                { value: "any", label: t("roster.meta.detachment.any") },
                { value: "same", label: t("roster.meta.detachment.same") },
              ]}
            />
          </span>
        }
      />
      {pending ? <p className="data-note meta-resolving">{t("roster.meta.resolving", { done: fmtInt(progress ? progress.done : records.length - pending), total: fmtInt(progress ? progress.total : records.length) })}</p> : null}
      <div className="meta-tiles">
        <Tile label={t("roster.meta.tile.lists")} value={fmtInt(peers.length)} title={t("roster.meta.tile.listsTitle")} />
        <Tile label={t("roster.meta.tile.writeUps")} value={fmtInt(writeUps)} />
        <Tile label={t("roster.meta.tile.corpus")} value={fmtInt(records.length)} title={t("roster.meta.tile.corpusTitle")} />
        {unreadable ? <Tile label={t("roster.meta.tile.unreadable")} value={fmtInt(unreadable)} title={t("roster.meta.tile.unreadableTitle")} /> : null}
      </div>

      {peers.length === 0 ? (
        <Empty>{t("roster.meta.noPeers", { faction: faction?.name ?? roster.factionId })}</Empty>
      ) : (
        <>
          <section className="meta-section" aria-labelledby="meta-field-h">
            <PanelHead id="meta-field-h" title={t("roster.meta.field")} aside={<span className="t-meta">{t("roster.meta.fieldMeta")}</span>} />
            <GridTable columns={FIELD_COLUMNS} label={t("roster.meta.field")} className="meta-table">
              <GridHead>
                <GridHeadCell>{t("roster.col.unit")}</GridHeadCell>
                <GridHeadCell align="end">{t("roster.meta.col.yours")}</GridHeadCell>
                <GridHeadCell>{t("roster.meta.col.share")}</GridHeadCell>
                <GridHeadCell align="end">{t("roster.meta.col.typical")}</GridHeadCell>
                <GridHeadCell align="end">{t("roster.meta.col.note")}</GridHeadCell>
              </GridHead>
              {rows.map((r) => {
                const key = NOTE_KEY[r.note];
                const ds = snapshot.data.datasheets.find((d) => d.id === r.datasheetId);
                return (
                  <GridRow key={r.datasheetId} className={`meta-row is-${r.note}`}>
                    <GridCell className="meta-unit">
                      <UnitArt keywords={ds?.keywords ?? []} className="ut-art" />
                      {r.name}
                    </GridCell>
                    <GridCell align="end" mono tone={r.yours ? "ink" : "faint"}>
                      {r.yours ? `${r.yours}× · ${fmtInt(r.yourModels)}` : "—"}
                    </GridCell>
                    <GridCell className="meta-share">
                      <ProportionBar value={r.share} tone={r.yours ? "ink" : "dim"} title={tn(r.takenBy, "roster.meta.takenBy.one", "roster.meta.takenBy.many", { n: r.takenBy, of: peers.length })} />
                      <span className="t-meta">{percent(r.share)}</span>
                    </GridCell>
                    <GridCell align="end" mono tone="muted">
                      {r.takenBy ? t("roster.meta.typical", { units: fmt(r.typicalUnits, 1), models: fmt(r.typicalModels, 0), pts: fmtInt(r.typicalPoints) }) : "—"}
                    </GridCell>
                    <GridCell align="end">{key ? <Badge tone={NOTE_TONE[r.note]}>{t(key)}</Badge> : null}</GridCell>
                  </GridRow>
                );
              })}
            </GridTable>
          </section>

          <section className="meta-section" aria-labelledby="meta-near-h">
            <PanelHead id="meta-near-h" title={t("roster.meta.near")} aside={<span className="t-meta">{t("roster.meta.nearMeta")}</span>} />
            <GridTable columns={NEAR_COLUMNS} label={t("roster.meta.near")} className="meta-table">
              <GridHead>
                <GridHeadCell>{t("roster.meta.col.player")}</GridHeadCell>
                <GridHeadCell align="end">{t("roster.meta.col.placing")}</GridHeadCell>
                <GridHeadCell>{t("roster.meta.col.source")}</GridHeadCell>
                <GridHeadCell>{t("roster.meta.col.overlap")}</GridHeadCell>
              </GridHead>
              {near.map((n) => {
                const r = n.peer.record;
                return (
                  <GridRow key={r.id} className={`meta-row ${chosen?.peer.record.id === r.id ? "current" : ""}`.trim()} onClick={() => setNearId(r.id)} title={r.heading}>
                    <GridCell>{r.player ?? "—"}</GridCell>
                    <GridCell align="end" mono>
                      {r.placing ? ordinal(r.placing) : "—"}
                    </GridCell>
                    <GridCell tone="muted" className="meta-source">
                      {r.source.url ? (
                        <a href={r.source.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          {r.source.title ?? r.source.url}
                        </a>
                      ) : (
                        (r.source.title ?? "—")
                      )}
                    </GridCell>
                    <GridCell className="meta-share">
                      <ProportionBar value={n.overlap} tone="ink" />
                      <span className="t-meta">{percent(n.overlap)}</span>
                    </GridCell>
                  </GridRow>
                );
              })}
            </GridTable>
          </section>

          {chosen ? (
            <section className="meta-section" aria-labelledby="meta-side-h">
              <PanelHead id="meta-side-h" title={t("roster.meta.side", { player: chosen.peer.record.player ?? chosen.peer.record.heading })} aside={<span className="t-meta">{t("roster.meta.sideMeta", { yours: fmtInt(mine.points), theirs: fmtInt(chosen.peer.points) })}</span>} />
              <GridTable columns={SIDE_COLUMNS} label={t("roster.meta.side", { player: chosen.peer.record.player ?? "" })} className="meta-table">
                <GridHead>
                  <GridHeadCell>{t("roster.col.unit")}</GridHeadCell>
                  <GridHeadCell align="end">{t("roster.meta.col.yours")}</GridHeadCell>
                  <GridHeadCell align="end">{t("roster.meta.col.theirs")}</GridHeadCell>
                </GridHead>
                {side.map((r) => (
                  <GridRow key={r.datasheetId} className={`meta-row ${r.yours && r.theirs ? "is-shared" : r.yours ? "is-yours" : "is-theirs"}`}>
                    <GridCell className="meta-unit">
                      <UnitArt keywords={snapshot.data.datasheets.find((d) => d.id === r.datasheetId)?.keywords ?? []} className="ut-art" />
                      {r.name}
                    </GridCell>
                    <GridCell align="end" mono tone={r.yours ? "ink" : "faint"}>
                      {r.yours ? t("roster.meta.tally", { units: r.yours.units, models: fmtInt(r.yours.models), pts: fmtInt(r.yours.points) }) : "—"}
                    </GridCell>
                    <GridCell align="end" mono tone={r.theirs ? "ink" : "faint"}>
                      {r.theirs ? t("roster.meta.tally", { units: r.theirs.units, models: fmtInt(r.theirs.models), pts: fmtInt(r.theirs.points) }) : "—"}
                    </GridCell>
                  </GridRow>
                ))}
              </GridTable>
              {chosen.peer.warnings ? <p className="data-note">{tn(chosen.peer.warnings, "roster.meta.warnings.one", "roster.meta.warnings.many", { n: chosen.peer.warnings })}</p> : null}
            </section>
          ) : null}

          <div className="meta-pair">
            <CountTable id="meta-dets-h" title={t("roster.meta.detachments")} rows={detachments} />
            <CountTable id="meta-disp-h" title={t("roster.meta.dispositions")} rows={dispositions} />
          </div>
        </>
      )}
      <p className="data-note">{t("roster.meta.provenance")}</p>
    </div>
  );
}

function CountTable({ id, title, rows }: { id: string; title: string; rows: readonly FieldCount[] }) {
  return (
    <section className="meta-section" aria-labelledby={id}>
      <PanelHead id={id} title={title} />
      {rows.length === 0 ? (
        <p className="data-empty">{t("roster.meta.noCounts")}</p>
      ) : (
        <GridTable columns={COUNT_COLUMNS} label={title} className="meta-table">
          {rows.map((r) => (
            <GridRow key={r.name} className="meta-row">
              <GridCell>{r.name}</GridCell>
              <GridCell className="meta-share">
                <ProportionBar value={r.share} tone="mid" />
                <span className="t-meta">{percent(r.share)}</span>
              </GridCell>
              <GridCell align="end" mono>
                {fmtInt(r.lists)}
              </GridCell>
            </GridRow>
          ))}
        </GridTable>
      )}
    </section>
  );
}
