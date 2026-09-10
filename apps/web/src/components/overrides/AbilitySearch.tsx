import { useMemo } from "react";
import type { Ability, Snapshot } from "@grimstat/schema";
import { abilityEffects } from "@grimstat/game-40k-11e";
import type { OverrideRecord } from "../../db";
import { overrideKey } from "../../lib/overrides";
import { Badge, Field } from "../ui";
import { t } from "../../i18n";

const MAX_RESULTS = 40;

export interface AbilityHit {
  ability: Ability;
  /** Datasheets (names) carrying the ability. */
  carriers: string[];
  override: OverrideRecord | undefined;
  /** Tier the engine assigns to the *effective* ability (raw text + override). */
  tier: "tier1" | "tier2" | "tier3";
}

export function tierLabel(tier: AbilityHit["tier"]): string {
  return tier === "tier1" ? t("overrides.tier.tier1") : tier === "tier2" ? t("overrides.tier.tier2") : t("overrides.tier.tier3");
}

/** Search the snapshot's abilities by name; `effective` supplies the post-override ability for the tier badge. */
export function useAbilitySearch(raw: Snapshot | undefined, effective: Snapshot | undefined, overrides: OverrideRecord[], query: string): AbilityHit[] {
  return useMemo(() => {
    if (!raw) return [];
    const q = query.trim().toLowerCase();
    const carriers = new Map<string, string[]>();
    for (const d of raw.data.datasheets) for (const id of d.abilityIds) carriers.set(id, [...(carriers.get(id) ?? []), d.name]);
    const byKey = new Map(overrides.map((o) => [o.key, o] as const));
    const eff = new Map((effective ?? raw).data.abilities.map((a) => [a.id, a] as const));
    const list = raw.data.abilities.filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
    list.sort((a, b) => {
      // exact / prefix matches first, then alphabetical
      const pa = q ? (a.name.toLowerCase() === q ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2) : 2;
      const pb = q ? (b.name.toLowerCase() === q ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2) : 2;
      return pa - pb || a.name.localeCompare(b.name);
    });
    return list.slice(0, MAX_RESULTS).map((ability) => ({ ability, carriers: carriers.get(ability.id) ?? [], override: byKey.get(overrideKey("ability", ability.id)), tier: abilityEffects(eff.get(ability.id) ?? ability).tier }));
  }, [raw, effective, overrides, query]);
}

export function AbilitySearch({ query, onQuery, hits, selectedId, onSelect }: { query: string; onQuery: (q: string) => void; hits: AbilityHit[]; selectedId: string | undefined; onSelect: (hit: AbilityHit) => void }) {
  return (
    <div className="stack">
      <Field label={t("overrides.search")} hint={t("overrides.searchHint")}>
        <input type="search" value={query} placeholder={t("overrides.searchPlaceholder")} onChange={(e) => onQuery(e.target.value)} />
      </Field>
      <div className="datasheet-list ability-list" role="listbox" aria-label={t("overrides.results")}>
        {hits.length ? (
          hits.map((h) => (
            <button key={h.ability.id} type="button" role="option" aria-selected={h.ability.id === selectedId} aria-pressed={h.ability.id === selectedId} onClick={() => onSelect(h)}>
              <span className="ability-hit">
                <span>
                  {h.ability.name}
                  {h.override ? (
                    <>
                      {" "}
                      <Badge tone="accent">{t("overrides.hasOverride")}</Badge>
                    </>
                  ) : null}
                </span>
                <span className="muted small">{h.carriers.length ? t("overrides.carriedBy", { names: h.carriers.join(", ") }) : t("overrides.carriedByNone")}</span>
              </span>
              <Badge tone={h.tier === "tier3" ? "danger" : h.tier === "tier2" ? "warn" : "ok"}>{tierLabel(h.tier)}</Badge>
            </button>
          ))
        ) : (
          <div className="empty">{t("overrides.noResults")}</div>
        )}
      </div>
    </div>
  );
}
