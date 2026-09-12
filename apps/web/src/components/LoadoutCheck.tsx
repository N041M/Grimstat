import { useMemo } from "react";
import type { Datasheet, ScenarioUnit, Snapshot } from "@grimstat/schema";
import { checkLoadout } from "@grimstat/game-40k-11e";
import { Badge } from "./ui";
import { t, tn } from "../i18n";

/**
 * Whether the unit on screen could exist, checked against the datasheet it came from.
 *
 * This sits under the weapon rows because that is where it is earned: the moment a count is typed,
 * the player wants to know whether they have just built a squad or a fantasy. The panel says three
 * different things and takes care to keep them apart — what is wrong, what is fine, and what could
 * not be read at all. The last is not a footnote: a datasheet's options are prose, some of it beyond
 * the parser, and a check that quietly treated unread rules as "no rule" would call legal loadouts
 * illegal. So the coverage is stated every time, in the same breath as the verdict.
 */
export function LoadoutCheck({ datasheet, unit, baseline }: { datasheet: Datasheet; unit: ScenarioUnit; baseline: ScenarioUnit; snapshot?: Snapshot }) {
  const check = useMemo(() => checkLoadout(datasheet, unit, { baseline }), [datasheet, unit, baseline]);
  const problems = check.problems;
  const unread = check.unread.length;

  return (
    <section className="loadout-check" aria-labelledby="loadout-check-h">
      <div className="row between">
        <h4 id="loadout-check-h" className="loadout-check-h">
          {t("loadout.title")}
        </h4>
        {problems.length ? <Badge tone="danger">{tn(problems.length, "loadout.problems.one", "loadout.problems.many")}</Badge> : <Badge tone="ok">{t("loadout.clean")}</Badge>}
      </div>

      {problems.length ? (
        <ul className="loadout-problems">
          {problems.map((p, i) => (
            <li key={`${p.code}:${p.weapon ?? i}`}>
              <span>{p.message}</span>
              {/* The line as the datasheet prints it, so the verdict can be argued with. */}
              {p.rule ? <span className="loadout-rule">{p.rule}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="loadout-coverage muted small">
        {unread ? tn(unread, "loadout.unread.one", "loadout.unread.many") : check.read ? tn(check.read, "loadout.read.one", "loadout.read.many") : t("loadout.noOptions")}
      </p>
    </section>
  );
}
