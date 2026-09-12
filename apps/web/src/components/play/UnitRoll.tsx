import { useState } from "react";
import { archetypes } from "@grimstat/game-40k-11e";
import { newOpponentUnit, type OpponentUnit, type Side, type UnitFlags, type UnitState } from "../../lib/game";
import type { GameHandle } from "../../hooks/useGame";
import { num, numOrNull } from "../ui";
import { t, tn, type I18nKey } from "../../i18n";
import type { PlayContext } from "./types";

/**
 * The roll call: every unit on the table with its wounds, its models and the per-turn flags.
 *
 * This is the screen a player looks at between dice rolls, so the wound tracker is the row itself:
 * the common damage amounts are one tap, the bar shifts colour as a unit drops, and everything that
 * is used once a game (off the table, destroyed, remove) sits behind the row's own toggle. Nothing
 * here decides anything; it records what the players did, and every change goes through the game
 * handle so the log and undo stay correct.
 */

/** Damage amounts that cover most weapons. Anything else goes in the row's number field. */
const QUICK: readonly number[] = [1, 2, 3, 6];

const FLAGS: ReadonlyArray<{ key: keyof UnitFlags; label: I18nKey }> = [
  { key: "moved", label: "roll.flag.moved" },
  { key: "advanced", label: "roll.flag.advanced" },
  { key: "fellBack", label: "roll.flag.fellBack" },
  { key: "charged", label: "roll.flag.charged" },
  { key: "acted", label: "roll.flag.acted" },
];

/** Green while a unit is healthy, amber once it is bitten into, red when it is nearly gone. */
function toneFor(woundsLeft: number, total: number): "ok" | "hurt" | "low" | "gone" {
  if (woundsLeft <= 0) return "gone";
  const share = total > 0 ? woundsLeft / total : 0;
  if (share > 0.6) return "ok";
  if (share > 0.3) return "hurt";
  return "low";
}

interface RowProps {
  game: GameHandle;
  side: Side;
  id: string;
  name: string;
  profileWounds: number;
  models: number;
  woundsLeft: number;
  modelsLeft: number;
  state: UnitState;
  /** Per-turn flags are the player's own bookkeeping, so only their units carry them. */
  mine: boolean;
  onRemove?: (() => void) | undefined;
}

function WoundRow({ game, side, id, name, profileWounds, models, woundsLeft, modelsLeft, state, mine, onRemove }: RowProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("1");
  const target = { side, id };
  const total = Math.max(1, Math.round(profileWounds)) * Math.max(1, Math.round(models));
  const typed = Math.max(0, Math.floor(num(text, 0)));

  const damage = (n: number) => {
    if (n <= 0) return;
    game.dispatch({ kind: "damage", target, wounds: n, profileWounds, models }, "damage", tn(n, "roll.log.damage.one", "roll.log.damage.many", { name }));
  };
  const heal = (n: number) => {
    if (n <= 0) return;
    game.dispatch({ kind: "heal", target, wounds: n, profileWounds }, "damage", tn(n, "roll.log.heal.one", "roll.log.heal.many", { name }));
  };
  const setDestroyed = (on: boolean) => {
    game.dispatch({ kind: "destroy", target, destroyed: on }, "destroy", t(on ? "roll.log.destroyed" : "roll.log.restored", { name }));
  };

  if (state.destroyed) {
    return (
      <li className="roll-row roll-gone">
        <span className="roll-gone-name">{name}</span>
        <span className="roll-gone-tag small">{t("roll.destroyed")}</span>
        <button type="button" className="sm" onClick={() => setDestroyed(false)}>
          {t("roll.bringBack")}
        </button>
        {onRemove ? (
          <button type="button" className="sm ghost danger" onClick={onRemove}>
            {t("roll.remove")}
          </button>
        ) : null}
      </li>
    );
  }

  return (
    <li className="roll-row" data-tone={toneFor(woundsLeft, total)}>
      <div className="roll-top">
        <span className="roll-name">{name}</span>
        <span className="roll-count num">{t("roll.woundsShort", { left: woundsLeft, total })}</span>
      </div>
      <div className="roll-bar" role="img" aria-label={t("roll.wounds", { left: woundsLeft, total })}>
        <span style={{ width: `${Math.max(0, Math.min(1, woundsLeft / total)) * 100}%` }} />
      </div>
      <div className="roll-sub small muted">
        {t("roll.models", { alive: modelsLeft, models })}
        {state.offTable ? ` · ${t("roll.offTable")}` : ""}
      </div>

      <div className="roll-hits">
        {QUICK.map((n) => (
          <button key={n} type="button" className="roll-hit" aria-label={t("roll.damageBy", { n })} onClick={() => damage(n)}>
            -{n}
          </button>
        ))}
        <button type="button" className="roll-hit roll-back" aria-label={t("roll.healBy", { n: 1 })} onClick={() => heal(1)}>
          +1
        </button>
        <button type="button" className="roll-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t("roll.less") : t("roll.more")}
        </button>
      </div>

      {mine ? (
        <div className="roll-flags">
          {FLAGS.map((f) => {
            const on = state.flags[f.key];
            return (
              <button
                key={f.key}
                type="button"
                className={`roll-flag${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => game.dispatch({ kind: "flag", target, flag: f.key, on: !on }, "note", t(on ? "roll.log.flagOff" : "roll.log.flagOn", { name, flag: t(f.label) }))}
              >
                {t(f.label)}
              </button>
            );
          })}
        </div>
      ) : null}

      {open ? (
        <div className="roll-extra">
          <div className="roll-custom">
            <label className="roll-field">
              <span className="roll-label">{t("roll.amount")}</span>
              <input type="number" inputMode="numeric" min={0} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <button type="button" disabled={typed <= 0} onClick={() => damage(typed)}>
              {t("roll.apply")}
            </button>
            <button type="button" disabled={typed <= 0} onClick={() => heal(typed)}>
              {t("roll.heal")}
            </button>
          </div>
          <div className="roll-foot">
            <button
              type="button"
              className={`roll-flag${state.offTable ? " on" : ""}`}
              aria-pressed={state.offTable}
              onClick={() => game.dispatch({ kind: "offTable", target, off: !state.offTable }, "note", t(state.offTable ? "roll.log.onTable" : "roll.log.offTable", { name }))}
            >
              {t("roll.offTable")}
            </button>
            <button type="button" className="roll-flag" aria-pressed={false} onClick={() => setDestroyed(true)}>
              {t("roll.destroy")}
            </button>
            {onRemove ? (
              <button type="button" className="sm ghost danger" onClick={onRemove}>
                {t("roll.remove")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

interface Draft {
  name: string;
  archetypeId: string;
  models: string;
  T: string;
  Sv: string;
  W: string;
  InvSv: string;
}

const BLANK: Draft = { name: "", archetypeId: "", models: "1", T: "4", Sv: "3", W: "2", InvSv: "" };

/** The stats an archetype stands for, so the wound arithmetic matches the profile the player picked. */
function draftFromArchetype(id: string, current: Draft): Draft {
  const a = archetypes.find((x) => x.id === id);
  if (!a) return { ...current, archetypeId: "" };
  const first = a.unit.models[0];
  const count = a.unit.models.reduce((s, m) => s + m.count, 0);
  return {
    ...current,
    archetypeId: id,
    name: current.name.trim() === "" ? a.unit.name : current.name,
    models: String(Math.max(1, count)),
    T: String(first?.T ?? 4),
    Sv: String(first?.Sv ?? 3),
    W: String(first?.W ?? 1),
    InvSv: first?.InvSv === undefined || first?.InvSv === null ? "" : String(first.InvSv),
  };
}

function AddFoe({ game }: { game: GameHandle }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const add = () => {
    const name = draft.name.trim() === "" ? t("roll.untitled") : draft.name.trim();
    const base = newOpponentUnit(name);
    const unit: OpponentUnit = {
      ...base,
      models: Math.max(1, Math.floor(num(draft.models, 1))),
      T: Math.max(1, Math.floor(num(draft.T, 4))),
      Sv: Math.max(2, Math.floor(num(draft.Sv, 3))),
      W: Math.max(1, Math.floor(num(draft.W, 1))),
      InvSv: numOrNull(draft.InvSv),
      ...(draft.archetypeId ? { archetypeId: draft.archetypeId } : {}),
    };
    game.dispatch({ kind: "addOpponent", unit }, "setup", t("roll.log.added", { name }));
    setDraft(BLANK);
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="roll-add-open" onClick={() => setOpen(true)}>
        {t("roll.add")}
      </button>
    );
  }

  return (
    <form
      className="roll-add"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <label className="roll-field wide">
        <span className="roll-label">{t("roll.add.name")}</span>
        <input value={draft.name} placeholder={t("roll.add.namePlaceholder")} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="roll-field wide">
        <span className="roll-label">{t("roll.add.archetype")}</span>
        <select value={draft.archetypeId} onChange={(e) => setDraft((d) => draftFromArchetype(e.target.value, d))}>
          <option value="">{t("roll.add.typed")}</option>
          {archetypes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <div className="roll-add-stats">
        <label className="roll-field">
          <span className="roll-label">{t("roll.add.models")}</span>
          <input type="number" inputMode="numeric" min={1} value={draft.models} onChange={(e) => set({ models: e.target.value })} />
        </label>
        <label className="roll-field">
          <span className="roll-label">{t("roll.add.toughness")}</span>
          <input type="number" inputMode="numeric" min={1} value={draft.T} onChange={(e) => set({ T: e.target.value })} />
        </label>
        <label className="roll-field">
          <span className="roll-label">{t("roll.add.save")}</span>
          <input type="number" inputMode="numeric" min={2} max={7} value={draft.Sv} onChange={(e) => set({ Sv: e.target.value })} />
        </label>
        <label className="roll-field">
          <span className="roll-label">{t("roll.add.wounds")}</span>
          <input type="number" inputMode="numeric" min={1} value={draft.W} onChange={(e) => set({ W: e.target.value })} />
        </label>
        <label className="roll-field">
          <span className="roll-label">{t("roll.add.invuln")}</span>
          <input type="number" inputMode="numeric" min={2} max={6} value={draft.InvSv} placeholder={t("roll.add.none")} onChange={(e) => set({ InvSv: e.target.value })} />
        </label>
      </div>
      <div className="roll-add-actions">
        <button type="submit" className="primary">
          {t("roll.add.submit")}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setDraft(BLANK);
            setOpen(false);
          }}
        >
          {t("roll.add.cancel")}
        </button>
      </div>
    </form>
  );
}

export function UnitRoll({ ctx }: { ctx: PlayContext }) {
  const { game, mine, foes } = ctx;
  const standing = mine.filter((u) => !u.state.destroyed).length;
  const foesStanding = foes.filter((f) => !f.state.destroyed).length;

  return (
    <div className="play-roll">
      <section className="roll-section">
        <div className="roll-head">
          <h2 className="roll-title">{t("roll.mine")}</h2>
          <span className="roll-tally num">{t("roll.standing", { n: standing, total: mine.length })}</span>
        </div>
        {mine.length === 0 ? (
          <p className="roll-empty small muted">{t("roll.empty.mine")}</p>
        ) : (
          <ul className="roll-list">
            {mine.map((u) => (
              <WoundRow key={u.id} game={game} side="you" id={u.id} name={u.unit.name} profileWounds={u.profileWounds} models={u.models} woundsLeft={u.woundsLeft} modelsLeft={u.modelsLeft} state={u.state} mine />
            ))}
          </ul>
        )}
      </section>

      <section className="roll-section">
        <div className="roll-head">
          <h2 className="roll-title">{t("roll.theirs")}</h2>
          <span className="roll-tally num">{t("roll.standing", { n: foesStanding, total: foes.length })}</span>
        </div>
        {foes.length === 0 ? (
          <p className="roll-empty small muted">{t("roll.empty.foes")}</p>
        ) : (
          <ul className="roll-list">
            {foes.map((f) => (
              <WoundRow
                key={f.id}
                game={game}
                side="them"
                id={f.id}
                name={f.foe.name}
                profileWounds={f.profileWounds}
                models={f.models}
                woundsLeft={f.woundsLeft}
                modelsLeft={f.modelsLeft}
                state={f.state}
                mine={false}
                onRemove={() => game.dispatch({ kind: "removeOpponent", id: f.id }, "setup", t("roll.log.removed", { name: f.foe.name }))}
              />
            ))}
          </ul>
        )}
        <AddFoe game={game} />
      </section>
    </div>
  );
}
