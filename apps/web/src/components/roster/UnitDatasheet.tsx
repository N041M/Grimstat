import { Fragment } from "react";
import type { Datasheet, Snapshot, WeaponProfile } from "@grimstat/schema";
import { abilityGroups, characteristic, characteristicText, CHARACTERISTICS, weaponGroups, type AbilityBucket } from "../../lib/codex";
import { abilityText } from "../../lib/glossary";
import { hrefFor } from "../../router";
import { STAT_COL, STAT_TITLE, weaponLine } from "../codex/shared";
import { KeywordChips, KeywordRefs, RuleRef } from "../RuleRef";
import { t, type I18nKey } from "../../i18n";

/**
 * The datasheet a unit in an army was built from, read-only, in a column narrow enough for the
 * inspector. The codex prints the same thing as a page; here the weapon tables become one line of
 * characteristics per profile so a phone-width panel can still carry them.
 */

const BUCKET_KEY: Record<AbilityBucket, I18nKey> = { core: "codex.abil.core", faction: "codex.abil.faction", datasheet: "codex.abil.datasheet", wargear: "codex.abil.wargear", other: "codex.abil.other" };

function Weapons({ ds, kind, snapshot }: { ds: Datasheet; kind: WeaponProfile["kind"]; snapshot: Snapshot }) {
  const groups = weaponGroups(ds, kind);
  if (!groups.length) return <p className="small muted insp-note">{t(kind === "ranged" ? "codex.noRanged" : "codex.noMelee")}</p>;
  return (
    <ul className="uds-weapons">
      {groups.map((g) => (
        <li key={g.name}>
          <span className="uds-weapon-name">{g.name}</span>
          {g.profiles.map((p) => (
            <Fragment key={p.profile.id}>
              <span className="uds-weapon-line">
                {p.label ? <em>{p.label} · </em> : null}
                {weaponLine(p.profile)}
              </span>
              {p.profile.keywords.length ? (
                <span className="uds-weapon-kw">
                  <KeywordRefs keywords={p.profile.keywords} snapshot={snapshot} empty="" />
                </span>
              ) : null}
            </Fragment>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function UnitDatasheet({ ds, snapshot }: { ds: Datasheet; snapshot: Snapshot }) {
  const { groups } = abilityGroups(ds, snapshot);
  const inline = groups.filter((g) => g.bucket === "core" || g.bucket === "faction");
  const listed = groups.filter((g) => g.bucket !== "core" && g.bucket !== "faction");
  return (
    <div className="uds">
      <table className="uds-profile">
        <thead>
          <tr>
            <th>{t("codex.col.model")}</th>
            {CHARACTERISTICS.map((c) => (
              <th key={c.key} className="num">
                <span title={t(STAT_TITLE[c.key])}>{t(STAT_COL[c.key])}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ds.models.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              {CHARACTERISTICS.map((c) => (
                <td key={c.key} className="num mono">
                  {characteristicText(c.key, characteristic(m, c.key))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h5 className="uds-h">{t("codex.sec.ranged")}</h5>
      <Weapons ds={ds} kind="ranged" snapshot={snapshot} />
      <h5 className="uds-h">{t("codex.sec.melee")}</h5>
      <Weapons ds={ds} kind="melee" snapshot={snapshot} />

      {inline.map((g) => (
        <Fragment key={g.bucket}>
          <h5 className="uds-h">{t(BUCKET_KEY[g.bucket])}</h5>
          <div className="chips">
            {g.abilities.map((a) => (
              <RuleRef key={a.id} className="chip" term={a.name} name={a.name} text={abilityText(snapshot, a)} />
            ))}
          </div>
        </Fragment>
      ))}
      {listed.map((g) => (
        <Fragment key={g.bucket}>
          <h5 className="uds-h">{t(BUCKET_KEY[g.bucket])}</h5>
          <ul className="uds-abil">
            {g.abilities.map((a) => (
              <li key={a.id}>
                <span className="uds-abil-name">{a.name}</span>
                {a.text ? <p className="uds-abil-text">{a.text}</p> : null}
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
      {ds.damagedProfile ? (
        <p className="uds-abil-text">
          <strong>{t("codex.damaged", { threshold: ds.damagedProfile.threshold })}</strong> {ds.damagedProfile.description}
        </p>
      ) : null}

      <h5 className="uds-h">{t("codex.sec.keywords")}</h5>
      <div className="chips">
        <KeywordChips names={[...ds.keywords, ...ds.factionKeywords]} snapshot={snapshot} />
      </div>

      <p className="uds-link">
        <a href={hrefFor("codex", ds.id)}>{t("roster.inspector.openCodex")}</a>
      </p>
    </div>
  );
}

