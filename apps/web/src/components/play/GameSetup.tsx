import { useEffect, useState } from "react";
import type { Roster } from "@grimstat/schema";
import { db, deleteGame, type GameRecord } from "../../db";
import type { useApp } from "../../state/AppContext";
import { newGameRecord } from "../../hooks/useGame";
import { totalsFor } from "../../lib/game";
import { fmtDay, fmtInt } from "../../lib/format";
import { PageHeader } from "../shell";
import { PanelHead } from "../kit";
import { Field, Icon, useConfirm } from "../ui";
import { t, tn } from "../../i18n";

interface Props {
  games: GameRecord[];
  onOpen: (rec: GameRecord) => void;
  notify: ReturnType<typeof useApp>["notify"];
}

/**
 * What the Play screen shows when no game is open: the form that starts one, and the games this
 * device already holds.
 *
 * A game may be tied to an army. When it is, the roster id and the snapshot that army was built
 * against are stored on the record, so the stratagems and the odds panel read the same data weeks
 * later even after the active snapshot has moved on.
 */
export function GameSetup({ games, onOpen, notify }: Props) {
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [name, setName] = useState("");
  const [rosterId, setRosterId] = useState("");
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    let alive = true;
    void db.rosters
      .toArray()
      .then((all) => {
        if (alive) setRosters(all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const start = () => {
    const roster = rosters.find((r) => r.id === rosterId);
    const label = name.trim() || t("play.setup.untitled");
    const rec = newGameRecord({ name: label, ...(roster ? { rosterId: roster.id, snapshotId: roster.snapshotId } : {}) });
    setName("");
    onOpen(rec);
    notify(t("play.setup.started", { name: label }), "success");
  };

  const remove = async (rec: GameRecord) => {
    const ok = await confirm({ title: t("play.setup.deleteTitle"), body: t("play.setup.deleteBody"), confirmLabel: t("common.delete"), danger: true });
    if (!ok) return;
    await deleteGame(rec.id);
    notify(t("play.setup.deleted", { name: rec.name || t("play.setup.untitled") }), "success");
  };

  return (
    <>
      <PageHeader title={t("play.title")} subtitle={tn(games.length, "play.setup.count.one", "play.setup.count.many", { n: games.length })} />
      <div className="page-body stack">
        <p className="page-lede">{t("play.setup.lede")}</p>

        <section className="setup-panel" aria-label={t("play.setup.start")}>
          <PanelHead title={t("play.setup.start")} />
          <form
            className="setup-form"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <Field label={t("play.setup.name")}>
              <input value={name} placeholder={t("play.setup.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("play.setup.army")} hint={rosters.length === 0 ? t("play.setup.noArmies") : t("play.setup.armyHint")}>
              <select value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
                <option value="">{t("play.setup.noArmy")}</option>
                {rosters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit" className="primary setup-start">
              {t("play.setup.begin")}
            </button>
          </form>
        </section>

        <section className="setup-panel" aria-label={t("play.setup.games")}>
          <PanelHead title={t("play.setup.games")} aside={<span className="t-meta">{fmtInt(games.length)}</span>} />
          {games.length === 0 ? (
            <p className="setup-none">{t("play.setup.none")}</p>
          ) : (
            <ul className="setup-games">
              {games.map((g) => {
                const you = totalsFor(g.state.you, g.state.secondaries).total;
                const them = totalsFor(g.state.them, g.state.secondaries).total;
                const label = g.name || t("play.setup.untitled");
                return (
                  <li key={g.id} className="setup-game">
                    <button type="button" className="setup-game-open" onClick={() => onOpen(g)}>
                      <span className="setup-game-top">
                        <span className="setup-game-name">{label}</span>
                        <span className="setup-game-score">{t("play.setup.score", { you: fmtInt(you), them: fmtInt(them) })}</span>
                      </span>
                      <span className="setup-game-meta">
                        {fmtDay(g.updatedAt)} · {g.state.over ? t("play.setup.over") : t("play.setup.inProgress", { n: g.state.round })}
                      </span>
                    </button>
                    <button type="button" className="ghost setup-game-del" aria-label={t("play.setup.deleteAria", { name: label })} onClick={() => void remove(g)}>
                      <Icon name="trash" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      {dialog}
    </>
  );
}
