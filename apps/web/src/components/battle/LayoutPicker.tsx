import { useMemo, useState } from "react";
import type { TerrainLayout } from "@grimstat/board";
import type { StoredLayout } from "../../lib/layoutStore";
import { deploymentOf, dispositionsIn, pairingOf, pickLayouts, type PickGroup } from "../../lib/layoutPick";
import { Badge } from "../ui";
import { t, type I18nKey } from "../../i18n";

const GROUP_KEY: Record<PickGroup, I18nKey> = { shipped: "battle.library.shipped", published: "battle.library.published", mine: "battle.library.yours" };
const GROUPS: readonly PickGroup[] = ["shipped", "published", "mine"];

/**
 * The table in play, and the means to change it.
 *
 * Closed, it is one line: the current layout's name and size. Open, it is a picker built for the
 * library the app now has — a search box, the three groups, and for the published cards the two
 * Force Dispositions, which is how a player looks a card up: "we rolled Take and Hold against
 * Purge the Foe" narrows the library to three cards.
 */
export function LayoutPicker({ options, current, dirty, onPick }: { options: readonly StoredLayout[]; current: TerrainLayout; dirty: boolean; onPick: (layout: TerrainLayout) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [you, setYou] = useState("");
  const [opponent, setOpponent] = useState("");

  const dispositions = useMemo(() => dispositionsIn(options), [options]);
  const groups = useMemo(() => pickLayouts(options, { query, you, opponent }), [options, query, you, opponent]);
  const shown = GROUPS.reduce((n, g) => n + groups[g].length, 0);
  const pairing = pairingOf(current.name);
  const deployment = deploymentOf(current.note);

  return (
    <section className="battle-section battle-pick">
      <div className="battle-section-head">
        <h2>{t("battle.pick.title")}</h2>
        <button type="button" className={`sm ${open ? "ghost" : ""}`.trim()} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t("battle.pick.close") : t("battle.pick.change")}
        </button>
      </div>
      <div className="battle-pick-current">
        <span className="battle-pick-name">{current.name}</span>
        {dirty ? <Badge tone="warn">{t("battle.library.unsavedShort")}</Badge> : null}
        <span className="battle-pick-meta">
          {current.size.width}×{current.size.depth}" · {t("battle.pick.pieces", { n: current.pieces.length })}
          {deployment ? ` · ${deployment}` : ""}
        </span>
      </div>

      {open ? (
        <div className="battle-pick-body">
          <input type="search" className="battle-pick-search" value={query} placeholder={t("battle.pick.search")} aria-label={t("battle.pick.search")} onChange={(e) => setQuery(e.target.value)} />
          {dispositions.length ? (
            <div className="battle-pick-pairing">
              <label>
                <span>{t("battle.pick.you")}</span>
                <select className="sm" value={you} onChange={(e) => setYou(e.target.value)}>
                  <option value="">{t("battle.pick.any")}</option>
                  {dispositions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <span className="battle-pick-vs">vs</span>
              <label>
                <span>{t("battle.pick.opponent")}</span>
                <select className="sm" value={opponent} onChange={(e) => setOpponent(e.target.value)}>
                  <option value="">{t("battle.pick.any")}</option>
                  {dispositions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {shown === 0 ? <p className="muted small">{t("battle.pick.none")}</p> : null}
          {GROUPS.map((group) =>
            groups[group].length ? (
              <div key={group} className="battle-pick-group">
                <div className="battle-presets-head">
                  {t(GROUP_KEY[group])} <span className="battle-preset-count">{groups[group].length}</span>
                </div>
                <ul className="battle-piece-list battle-pick-list" aria-label={t(GROUP_KEY[group])}>
                  {groups[group].map((l) => {
                    const p = pairingOf(l.layout.name);
                    const d = deploymentOf(l.layout.note);
                    // With a pairing chosen, the name repeats what the filter says; the card number and
                    // the deployment are what tell the three apart.
                    const label = p && (you || opponent) ? t("battle.pick.card", { n: p.card }) : l.layout.name;
                    const meta = [d, p && (you || opponent) ? undefined : `${l.layout.size.width}×${l.layout.size.depth}"`].filter(Boolean).join(" · ");
                    return (
                      <li key={l.layout.id}>
                        <button
                          type="button"
                          className={`battle-piece-row ${l.layout.id === current.id ? "is-selected" : ""}`.trim()}
                          aria-current={l.layout.id === current.id ? "true" : undefined}
                          onClick={() => {
                            onPick(l.layout);
                            setOpen(false);
                          }}
                        >
                          <span className="id">{label}</span>
                          <span className="meta">{meta}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null,
          )}
          {pairing ? <p className="muted small">{t("battle.pick.pairingHint")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
