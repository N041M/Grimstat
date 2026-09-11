import { Fragment } from "react";
import type { Datasheet, Snapshot, WeaponProfile } from "@grimstat/schema";
import { UnitArt } from "../UnitArt";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead } from "../kit";
import { abilityGroups, characteristic, characteristicText, CHARACTERISTICS, ledBy, pointsLines, sizeBounds, supportedBy, unitFigures, wargearPrices, weaponGroups, type AbilityBucket, type CharacteristicKey, type WeaponGroup } from "../../lib/codex";
import { ap, dice, fmtInt, skill } from "../../lib/format";
import { keywordsToText } from "../../lib/keywordParser";
import { hrefFor } from "../../router";
import { factionName, pointsText, SheetFlags, sizeText } from "./shared";
import { t, tn, type I18nKey } from "../../i18n";

/* ---------- column templates ---------- */

/** Model | M T Sv Inv W Ld OC. */
const PROFILE_COLUMNS = "minmax(160px, 2fr) repeat(7, minmax(48px, 0.6fr))";
/** Weapon | range | A | skill | S | AP | D | keywords. */
const WEAPON_COLUMNS = "minmax(180px, 2fr) 62px 52px 52px 44px 50px 58px minmax(180px, 2.4fr)";

export const STAT_COL: Record<CharacteristicKey, I18nKey> = { M: "codex.col.M", T: "codex.col.T", Sv: "codex.col.Sv", InvSv: "codex.col.InvSv", W: "codex.col.W", Ld: "codex.col.Ld", OC: "codex.col.OC" };
export const STAT_TITLE: Record<CharacteristicKey, I18nKey> = { M: "codex.stat.M", T: "codex.stat.T", Sv: "codex.stat.Sv", InvSv: "codex.stat.InvSv", W: "codex.stat.W", Ld: "codex.stat.Ld", OC: "codex.stat.OC" };
const BUCKET_KEY: Record<AbilityBucket, I18nKey> = { core: "codex.abil.core", faction: "codex.abil.faction", datasheet: "codex.abil.datasheet", wargear: "codex.abil.wargear", other: "codex.abil.other" };

/* ---------- parts ---------- */

function Section({ title, aside, children, className }: { title: string; aside?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`codex-section ${className ?? ""}`.trim()}>
      <PanelHead title={title} aside={aside ? <span className="t-meta">{aside}</span> : undefined} />
      {children}
    </section>
  );
}

function ProfileTable({ ds }: { ds: Datasheet }) {
  return (
    <div className="codex-table">
      <GridTable columns={PROFILE_COLUMNS} label={t("codex.sec.profile")}>
        <GridHead>
          <GridHeadCell>{t("codex.col.model")}</GridHeadCell>
          {CHARACTERISTICS.map((c) => (
            <GridHeadCell key={c.key} align="end">
              <span title={t(STAT_TITLE[c.key])}>{t(STAT_COL[c.key])}</span>
            </GridHeadCell>
          ))}
        </GridHead>
        {ds.models.map((m) => (
          <GridRow key={m.id}>
            <GridCell className="codex-strong">
              {m.name}
              {m.baseSize ? <span className="codex-tag">{m.baseSize}</span> : null}
            </GridCell>
            {CHARACTERISTICS.map((c) => {
              const v = characteristic(m, c.key);
              return (
                <GridCell key={c.key} align="end" mono tone={v === null ? "faint" : undefined}>
                  {characteristicText(c.key, v)}
                </GridCell>
              );
            })}
          </GridRow>
        ))}
      </GridTable>
    </div>
  );
}

function reach(w: WeaponProfile): string {
  return w.kind === "melee" ? t("codex.melee") : `${w.range ?? "–"}"`;
}

function WeaponTable({ kind, groups }: { kind: WeaponProfile["kind"]; groups: WeaponGroup[] }) {
  if (!groups.length) return <p className="stat-note">{t(kind === "ranged" ? "codex.noRanged" : "codex.noMelee")}</p>;
  return (
    <div className="codex-table">
      <GridTable columns={WEAPON_COLUMNS} label={t(kind === "ranged" ? "codex.sec.ranged" : "codex.sec.melee")}>
        <GridHead>
          <GridHeadCell>{t("codex.col.weapon")}</GridHeadCell>
          <GridHeadCell align="end">{t("codex.col.range")}</GridHeadCell>
          <GridHeadCell align="end">{t("codex.col.attacks")}</GridHeadCell>
          <GridHeadCell align="end">{t(kind === "ranged" ? "codex.col.bs" : "codex.col.ws")}</GridHeadCell>
          <GridHeadCell align="end">{t("codex.col.strength")}</GridHeadCell>
          <GridHeadCell align="end">{t("codex.col.ap")}</GridHeadCell>
          <GridHeadCell align="end">{t("codex.col.damage")}</GridHeadCell>
          <GridHeadCell>{t("codex.col.keywords")}</GridHeadCell>
        </GridHead>
        {groups.map((g) => {
          // A weapon with several profiles gets a name row of its own; each profile hangs under it.
          const folded = g.profiles.length > 1 || g.profiles[0]?.label !== undefined;
          return (
            <Fragment key={g.name}>
              {folded ? (
                <GridRow className="codex-weapon-group">
                  <GridCell className="codex-strong">{g.name}</GridCell>
                  {Array.from({ length: 7 }, (_, i) => (
                    <GridCell key={i}>{null}</GridCell>
                  ))}
                </GridRow>
              ) : null}
              {g.profiles.map((p) => (
                <GridRow key={p.profile.id}>
                  <GridCell className={folded ? "codex-weapon-profile" : "codex-strong"}>{folded ? (p.label ?? p.profile.name) : g.name}</GridCell>
                  <GridCell align="end" mono>
                    {reach(p.profile)}
                  </GridCell>
                  <GridCell align="end" mono>
                    {dice(p.profile.A)}
                  </GridCell>
                  <GridCell align="end" mono>
                    {skill(p.profile.skill)}
                  </GridCell>
                  <GridCell align="end" mono>
                    {p.profile.S}
                  </GridCell>
                  <GridCell align="end" mono>
                    {ap(p.profile.AP)}
                  </GridCell>
                  <GridCell align="end" mono>
                    {dice(p.profile.D)}
                  </GridCell>
                  <GridCell tone="muted" className="codex-wrap">
                    {keywordsToText(p.profile.keywords) || "—"}
                  </GridCell>
                </GridRow>
              ))}
            </Fragment>
          );
        })}
      </GridTable>
    </div>
  );
}

function Abilities({ ds, snapshot }: { ds: Datasheet; snapshot: Snapshot }) {
  const { groups, missing } = abilityGroups(ds, snapshot);
  const inline = groups.filter((g) => g.bucket === "core" || g.bucket === "faction");
  const listed = groups.filter((g) => g.bucket !== "core" && g.bucket !== "faction");
  return (
    <div className="codex-abil">
      {inline.map((g) => (
        <p key={g.bucket} className="codex-abil-line">
          <span className="t-eyebrow">{t(BUCKET_KEY[g.bucket])}</span>
          <span className="chips">
            {g.abilities.map((a) => (
              <span key={a.id} className="chip" title={a.text || undefined}>
                {a.name}
              </span>
            ))}
          </span>
        </p>
      ))}
      {listed.map((g) => (
        <div key={g.bucket}>
          {g.bucket !== "datasheet" ? <h3 className="codex-h3">{t(BUCKET_KEY[g.bucket])}</h3> : null}
          <ul className="codex-abil-list">
            {g.abilities.map((a) => (
              <li key={a.id}>
                <span className="codex-abil-name">{a.name}</span>
                {a.text ? <p className="codex-abil-text">{a.text}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {ds.damagedProfile ? (
        <div className="codex-damaged">
          <strong>{t("codex.damaged", { threshold: ds.damagedProfile.threshold })}</strong> {ds.damagedProfile.description}
        </div>
      ) : null}
      {!groups.length && !ds.damagedProfile ? <p className="stat-note codex-note">{t("codex.abil.none")}</p> : null}
      {missing.length ? <p className="stat-note codex-note">{t("codex.abil.missing", { n: missing.length, ids: missing.join(", ") })}</p> : null}
    </div>
  );
}

function SheetLinks({ sheets }: { sheets: Datasheet[] }) {
  return (
    <>
      {sheets.map((d, i) => (
        <Fragment key={d.id}>
          {i ? ", " : ""}
          <a href={hrefFor("codex", d.id)}>{d.name}</a>
        </Fragment>
      ))}
    </>
  );
}

function Aside({ ds, snapshot }: { ds: Datasheet; snapshot: Snapshot }) {
  const byId = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));
  const leads = ds.leaderTo.map((id) => byId.get(id)).filter((d): d is Datasheet => d !== undefined);
  const supports = ds.supportTo.map((id) => byId.get(id)).filter((d): d is Datasheet => d !== undefined);
  const led = ledBy(ds, snapshot);
  const supported = supportedBy(ds, snapshot);
  const lines = pointsLines(ds, snapshot);
  const gear = wargearPrices(ds, snapshot);
  return (
    <div className="codex-aside">
      <div>
        <h3 className="codex-h3">{t("codex.sec.composition")}</h3>
        {ds.composition.length ? (
          <ul>
            {ds.composition.map((c, i) => (
              <li key={i}>{c.description}</li>
            ))}
          </ul>
        ) : (
          <p>{sizeText(sizeBounds(ds))}</p>
        )}
      </div>
      {ds.loadout ? (
        <div>
          <h3 className="codex-h3">{t("codex.sec.loadout")}</h3>
          <p>{ds.loadout}</p>
        </div>
      ) : null}
      {ds.wargearOptions.length ? (
        <div>
          <h3 className="codex-h3">{t("codex.sec.wargear")}</h3>
          <ul>
            {ds.wargearOptions.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {ds.transportCapacity ? (
        <div>
          <h3 className="codex-h3">{t("codex.sec.transport")}</h3>
          <p>{ds.transportCapacity}</p>
        </div>
      ) : null}
      {leads.length || supports.length || led.length || supported.length ? (
        <div>
          <h3 className="codex-h3">{t("codex.sec.leader")}</h3>
          {leads.length ? (
            <p>
              <span className="codex-k">{t("codex.canLead")}</span> <SheetLinks sheets={leads} />
            </p>
          ) : null}
          {supports.length ? (
            <p>
              <span className="codex-k">{t("codex.canSupport")}</span> <SheetLinks sheets={supports} />
            </p>
          ) : null}
          {led.length ? (
            <p>
              <span className="codex-k">{t("codex.ledBy")}</span> <SheetLinks sheets={led} />
            </p>
          ) : null}
          {supported.length ? (
            <p>
              <span className="codex-k">{t("codex.supportedBy")}</span> <SheetLinks sheets={supported} />
            </p>
          ) : null}
        </div>
      ) : null}
      <div>
        <h3 className="codex-h3">{t("codex.sec.points")}</h3>
        {lines.length ? (
          lines.map((l, i) => (
            <table key={i} className="codex-points">
              {l.label ? <caption>{l.label}</caption> : null}
              <tbody>
                {l.tiers.map((tier) => (
                  <tr key={tier.models}>
                    <td>{tn(tier.models, "codex.size.one", "codex.size.fixed", { n: tier.models })}</td>
                    <td>{t("codex.pts", { n: fmtInt(tier.points) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))
        ) : (
          <p>{t("codex.noPoints")}</p>
        )}
        {gear.length ? (
          <table className="codex-points">
            <caption>{t("codex.wargearPrices")}</caption>
            <tbody>
              {gear.map((g) => (
                <tr key={g.item}>
                  <td>{g.item}</td>
                  <td>{t("codex.wargearPrice", { n: fmtInt(g.points) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}

function Keywords({ ds }: { ds: Datasheet }) {
  return (
    <div className="codex-keywords">
      <div>
        <h3 className="codex-h3">{t("codex.sec.keywords")}</h3>
        <div className="chips">
          {ds.keywords.length ? (
            ds.keywords.map((k) => (
              <span key={k} className="chip">
                {k}
              </span>
            ))
          ) : (
            <span className="t-meta">—</span>
          )}
        </div>
      </div>
      <div>
        <h3 className="codex-h3">{t("codex.sec.factionKeywords")}</h3>
        <div className="chips">
          {ds.factionKeywords.length ? (
            ds.factionKeywords.map((k) => (
              <span key={k} className="chip">
                {k}
              </span>
            ))
          ) : (
            <span className="t-meta">—</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One datasheet laid out as a codex page: the name band with its points, the profile line, the
 * two weapon tables, then abilities beside composition / wargear / leader / points, and the
 * keyword line at the foot. Full-bleed under the page header, like the Statistics tab.
 */
export function DatasheetCard({ ds, snapshot }: { ds: Datasheet; snapshot: Snapshot }) {
  const fig = unitFigures(ds, snapshot);
  const bounds = sizeBounds(ds);
  return (
    <article className="codex-sheet" aria-label={ds.name}>
      <header className="codex-band">
        <UnitArt of={ds} className="codex-band-art" />
        <div className="codex-band-title">
          <div className="t-eyebrow">
            {factionName(snapshot, ds.factionId)}
            {ds.role ? ` · ${ds.role}` : ""}
          </div>
          <h2>{ds.name}</h2>
          <SheetFlags ds={ds} />
        </div>
        <div className="codex-band-points">
          <span className="t-metric">{pointsText(fig.minPoints, fig.maxPoints)}</span>
          <span className="t-meta">
            {sizeText(bounds)} · {t("codex.unitWounds", { n: fig.wounds })}
          </span>
        </div>
      </header>

      <Section title={t("codex.sec.profile")}>
        <ProfileTable ds={ds} />
      </Section>
      <Section title={t("codex.sec.ranged")}>
        <WeaponTable kind="ranged" groups={weaponGroups(ds, "ranged")} />
      </Section>
      <Section title={t("codex.sec.melee")}>
        <WeaponTable kind="melee" groups={weaponGroups(ds, "melee")} />
      </Section>

      <div className="codex-columns">
        <Section title={t("codex.sec.abilities")}>
          <Abilities ds={ds} snapshot={snapshot} />
        </Section>
        <section className="codex-section codex-side">
          <Aside ds={ds} snapshot={snapshot} />
        </section>
      </div>

      <Keywords ds={ds} />
    </article>
  );
}
