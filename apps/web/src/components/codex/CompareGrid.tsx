import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Datasheet, Snapshot } from "@grimstat/schema";
import { UnitArt } from "../UnitArt";
import { Empty, Icon } from "../ui";
import { abilityGroups, bestIndices, characteristicRow, CHARACTERISTICS, COMPARE_CAP, differs, ledBy, searchDatasheets, unitFigures, weaponGroups } from "../../lib/codex";
import { fmt } from "../../lib/format";
import { keywordsToText } from "../../lib/keywordParser";
import { hrefFor } from "../../router";
import { factionName, pointsText, sizeText, weaponLine } from "./shared";
import { STAT_TITLE } from "./DatasheetCard";
import { t, tn } from "../../i18n";

/* ---------- the rows ---------- */

interface Cell {
  /** What the cell says, for the "differences only" test. */
  text: string;
  node?: ReactNode;
  mono?: boolean;
}

interface Row {
  id: string;
  label: string;
  cells: Cell[];
  best: number[];
  differs: boolean;
}

interface Section {
  id: string;
  label: string;
  rows: Row[];
}

const textRow = (id: string, label: string, texts: string[], opts: { mono?: boolean; best?: number[] } = {}): Row => ({
  id,
  label,
  cells: texts.map((text) => ({ text, mono: opts.mono })),
  best: opts.best ?? [],
  differs: differs(texts),
});

const nodeRow = (id: string, label: string, cells: Array<{ text: string; node: ReactNode }>): Row => ({ id, label, cells, best: [], differs: differs(cells.map((c) => c.text)) });

function weaponsCell(ds: Datasheet, kind: "ranged" | "melee"): { text: string; node: ReactNode } {
  const groups = weaponGroups(ds, kind);
  if (!groups.length) return { text: "", node: <span className="t-meta">{t("codex.cmp.none")}</span> };
  const text = groups.map((g) => g.profiles.map((p) => `${p.profile.name} ${weaponLine(p.profile)} ${keywordsToText(p.profile.keywords)}`).join("|")).join("|");
  return {
    text,
    node: (
      <>
        {groups.map((g) => (
          <div key={g.name} className="cmp-weapon">
            <span className="cmp-weapon-name">{g.name}</span>
            {g.profiles.map((p) => {
              const kw = keywordsToText(p.profile.keywords);
              return (
                <Fragment key={p.profile.id}>
                  <span className="cmp-weapon-line">
                    {p.label ? <em>{p.label} · </em> : null}
                    {weaponLine(p.profile)}
                  </span>
                  {kw ? <span className="cmp-weapon-kw">{kw}</span> : null}
                </Fragment>
              );
            })}
          </div>
        ))}
      </>
    ),
  };
}

function chipsCell(names: string[], titles?: Array<string | undefined>): { text: string; node: ReactNode } {
  if (!names.length) return { text: "", node: <span className="t-meta">{t("codex.cmp.none")}</span> };
  return {
    text: names.join("|"),
    node: (
      <span className="cmp-chips chips">
        {names.map((n, i) => (
          <span key={n} className="chip" title={titles?.[i]}>
            {n}
          </span>
        ))}
      </span>
    ),
  };
}

function abilitiesCell(ds: Datasheet, snapshot: Snapshot): { text: string; node: ReactNode } {
  const own = abilityGroups(ds, snapshot).groups.filter((g) => g.bucket !== "core" && g.bucket !== "faction");
  const list = own.flatMap((g) => g.abilities);
  const extra = ds.damagedProfile ? [t("codex.damaged", { threshold: ds.damagedProfile.threshold })] : [];
  if (!list.length && !extra.length) return { text: "", node: <span className="t-meta">{t("codex.cmp.none")}</span> };
  return {
    text: [...list.map((a) => a.name), ...extra].join("|"),
    node: (
      <>
        {list.map((a) => (
          <div key={a.id} className="cmp-abil">
            <span className="cmp-abil-name">{a.name}</span>
            {a.text ? (
              <span className="cmp-abil-text" title={a.text}>
                {a.text}
              </span>
            ) : null}
          </div>
        ))}
        {ds.damagedProfile ? (
          <div className="cmp-abil">
            <span className="cmp-abil-name">{t("codex.damaged", { threshold: ds.damagedProfile.threshold })}</span>
            <span className="cmp-abil-text" title={ds.damagedProfile.description}>
              {ds.damagedProfile.description}
            </span>
          </div>
        ) : null}
      </>
    ),
  };
}

function leaderCell(ds: Datasheet, snapshot: Snapshot): { text: string; node: ReactNode } {
  const byId = new Map(snapshot.data.datasheets.map((d) => [d.id, d.name] as const));
  const all: Array<[string, string[]]> = [
    [t("codex.canLead"), ds.leaderTo.map((id) => byId.get(id) ?? id)],
    [t("codex.canSupport"), ds.supportTo.map((id) => byId.get(id) ?? id)],
    [t("codex.ledBy"), ledBy(ds, snapshot).map((d) => d.name)],
  ];
  const lines = all.filter((l) => l[1].length > 0);
  if (!lines.length) return { text: "", node: <span className="t-meta">{t("codex.cmp.none")}</span> };
  return {
    text: lines.map(([k, v]) => `${k}:${v.join(",")}`).join("|"),
    node: (
      <>
        {lines.map(([k, v]) => (
          <div key={k} className="cmp-line">
            <span className="codex-k">{k}</span> {v.join(", ")}
          </div>
        ))}
      </>
    ),
  };
}

function buildSections(sheets: Datasheet[], snapshot: Snapshot): Section[] {
  const figs = sheets.map((d) => unitFigures(d, snapshot));
  const abilities = sheets.map((d) => abilityGroups(d, snapshot).groups);
  const namesOf = (i: number, bucket: "core" | "faction") => abilities[i]!.find((g) => g.bucket === bucket)?.abilities ?? [];
  return [
    {
      id: "profile",
      label: t("codex.cmp.sec.profile"),
      rows: CHARACTERISTICS.map((def) => {
        const r = characteristicRow(sheets, def);
        return { id: r.key, label: t(STAT_TITLE[r.key]), cells: r.cells.map((text) => ({ text, mono: true })), best: r.best, differs: r.differs };
      }),
    },
    {
      id: "unit",
      label: t("codex.cmp.sec.unit"),
      rows: [
        textRow("role", t("codex.cmp.row.role"), sheets.map((d) => d.role ?? t("codex.cmp.none"))),
        textRow(
          "size",
          t("codex.cmp.row.size"),
          figs.map((f) => sizeText({ min: f.minModels, max: f.maxModels })),
          { mono: true },
        ),
        textRow(
          "points",
          t("codex.cmp.row.points"),
          figs.map((f) => pointsText(f.minPoints, f.maxPoints)),
          { mono: true, best: bestIndices(figs.map((f) => f.minPoints), "lower") },
        ),
        textRow(
          "wounds",
          t("codex.cmp.row.wounds"),
          figs.map((f) => String(f.wounds)),
          { mono: true, best: bestIndices(figs.map((f) => f.wounds), "higher") },
        ),
        textRow(
          "ppw",
          t("codex.cmp.row.ptsPerWound"),
          figs.map((f) => (f.pointsPerWound === undefined ? t("codex.cmp.none") : fmt(f.pointsPerWound, 1))),
          { mono: true, best: bestIndices(figs.map((f) => f.pointsPerWound), "lower") },
        ),
      ],
    },
    {
      id: "weapons",
      label: t("codex.cmp.sec.weapons"),
      rows: [nodeRow("ranged", t("codex.cmp.row.ranged"), sheets.map((d) => weaponsCell(d, "ranged"))), nodeRow("melee", t("codex.cmp.row.melee"), sheets.map((d) => weaponsCell(d, "melee")))],
    },
    {
      id: "abilities",
      label: t("codex.cmp.sec.abilities"),
      rows: [
        nodeRow(
          "core",
          t("codex.cmp.row.core"),
          sheets.map((_, i) => {
            const list = namesOf(i, "core");
            return chipsCell(
              list.map((a) => a.name),
              list.map((a) => a.text || undefined),
            );
          }),
        ),
        nodeRow(
          "faction",
          t("codex.cmp.row.faction"),
          sheets.map((_, i) => {
            const list = namesOf(i, "faction");
            return chipsCell(
              list.map((a) => a.name),
              list.map((a) => a.text || undefined),
            );
          }),
        ),
        nodeRow("abilities", t("codex.cmp.row.abilities"), sheets.map((d) => abilitiesCell(d, snapshot))),
        nodeRow("leader", t("codex.cmp.row.leader"), sheets.map((d) => leaderCell(d, snapshot))),
      ],
    },
    {
      id: "keywords",
      label: t("codex.cmp.sec.keywords"),
      rows: [nodeRow("keywords", t("codex.cmp.row.keywords"), sheets.map((d) => chipsCell(d.keywords))), nodeRow("factionKeywords", t("codex.sec.factionKeywords"), sheets.map((d) => chipsCell(d.factionKeywords)))],
    },
  ];
}

/* ---------- parts ---------- */

/** The search box that adds a column; a note instead once the set is full. */
function AddBox({ snapshot, exclude, onAdd }: { snapshot: Snapshot; exclude: string[]; onAdd: (id: string) => void }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => searchDatasheets(snapshot.data.datasheets, q, exclude), [snapshot, q, exclude]);
  if (exclude.length >= COMPARE_CAP)
    return (
      <div className="cmp-add">
        <p className="dock-empty">{t("codex.cmp.full", { n: COMPARE_CAP })}</p>
      </div>
    );
  return (
    <div className="cmp-add">
      <span className="t-eyebrow">{t("codex.cmp.add")}</span>
      <div className="search-wrap">
        <Icon name="search" />
        <input type="search" value={q} placeholder={t("codex.cmp.addPlaceholder")} aria-label={t("codex.cmp.add")} onChange={(e) => setQ(e.target.value)} />
      </div>
      {results.length ? (
        <ul className="cmp-add-list">
          {results.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => {
                  onAdd(d.id);
                  setQ("");
                }}
              >
                <span className="cmp-add-name">{d.name}</span>
                <span className="cmp-add-meta">{factionName(snapshot, d.factionId)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim() ? (
        <p className="dock-empty">{t("codex.noMatch")}</p>
      ) : null}
    </div>
  );
}

function ColumnHead({ ds, snapshot, onRemove, onOpen }: { ds: Datasheet; snapshot: Snapshot; onRemove: () => void; onOpen: () => void }) {
  return (
    <div className="cmp-colhead">
      <UnitArt of={ds} />
      <a className="cmp-colhead-name" href={hrefFor("codex", ds.id)} title={t("codex.cmp.open", { name: ds.name })} onClick={onOpen}>
        {ds.name}
      </a>
      <span className="cmp-colhead-meta">
        {factionName(snapshot, ds.factionId)}
        {ds.role ? ` · ${ds.role}` : ""}
      </span>
      <button type="button" className="ghost sm icon-btn cmp-colhead-x" aria-label={t("codex.cmp.remove", { name: ds.name })} title={t("codex.cmp.remove", { name: ds.name })} onClick={onRemove}>
        <Icon name="close" />
      </button>
    </div>
  );
}

interface Props {
  sheets: Datasheet[];
  snapshot: Snapshot;
  diffOnly: boolean;
  onRemove: (id: string) => void;
  onAdd: (id: string) => void;
  /** A column's name opens its sheet; the page switches back to the sheet view. */
  onOpen: () => void;
}

/**
 * The compared datasheets as columns of one grid, a row per thing a sheet says, the best value of
 * each numeric row marked. The grid scrolls inside its own box; the page never does sideways.
 */
export function CompareGrid({ sheets, snapshot, diffOnly, onRemove, onAdd, onOpen }: Props) {
  const ids = useMemo(() => sheets.map((d) => d.id), [sheets]);
  const sections = useMemo(() => buildSections(sheets, snapshot), [sheets, snapshot]);
  const total = sections.reduce((s, sec) => s + sec.rows.length, 0);
  const shown = diffOnly ? sections.map((sec) => ({ ...sec, rows: sec.rows.filter((r) => r.differs) })).filter((sec) => sec.rows.length) : sections;
  const hidden = total - shown.reduce((s, sec) => s + sec.rows.length, 0);

  if (!sheets.length) {
    return (
      <div className="cmp-wrap">
        <Empty>{t("codex.cmp.empty")}</Empty>
        <div className="cmp-add-alone">
          <AddBox snapshot={snapshot} exclude={ids} onAdd={onAdd} />
        </div>
      </div>
    );
  }

  const cols = `168px repeat(${sheets.length}, minmax(200px, 1fr)) 220px`;
  return (
    <div className="cmp-wrap">
      <div className="cmp-scroll">
        <div className="cmp" style={{ "--cmp-cols": cols } as CSSProperties} role="region" aria-label={t("codex.cmp.aria")}>
          <div className="cmp-corner" />
          {sheets.map((d) => (
            <ColumnHead key={d.id} ds={d} snapshot={snapshot} onRemove={() => onRemove(d.id)} onOpen={onOpen} />
          ))}
          <AddBox snapshot={snapshot} exclude={ids} onAdd={onAdd} />
          {shown.map((sec) => (
            <Fragment key={sec.id}>
              <div className="cmp-sec">{sec.label}</div>
              {sec.rows.map((r) => (
                <Fragment key={r.id}>
                  <div className="cmp-rowhead">{r.label}</div>
                  {r.cells.map((c, i) => (
                    <div key={i} className={`cmp-cell ${c.mono ? "mono" : ""} ${r.best.includes(i) ? "best" : ""}`.trim()}>
                      {c.node ?? c.text}
                    </div>
                  ))}
                  <div className="cmp-add-cell" />
                </Fragment>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="cmp-foot">
        <span className="cmp-legend">
          <span className="cmp-legend-sw" aria-hidden="true" />
          {t("codex.cmp.legend")}
        </span>
        <span className="t-meta">{t("codex.cmp.legendNote")}</span>
      </div>
      {diffOnly && hidden > 0 ? <p className="stat-note cmp-note">{shown.length ? tn(hidden, "codex.cmp.hidden.one", "codex.cmp.hidden.many", { n: hidden }) : t("codex.cmp.allSame")}</p> : null}
    </div>
  );
}
