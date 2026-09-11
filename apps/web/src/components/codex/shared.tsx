import type { Datasheet, Snapshot, WeaponProfile } from "@grimstat/schema";
import type { ModelBounds, PickerGroup } from "../../lib/roster";
import { ALL_FACTIONS, type CodexFaction } from "../../lib/codex";
import { ap, dice, fmtInt, skill } from "../../lib/format";
import { Badge, Icon } from "../ui";
import { t, type I18nKey } from "../../i18n";

/** What the Codex screen's parts say in common: sizes, points, a weapon on one line, the flags. */

export const GROUP_KEY: Record<PickerGroup, I18nKey> = {
  character: "roster.section.character",
  battleline: "roster.section.battleline",
  transport: "roster.section.transport",
  other: "roster.section.other",
  legends: "roster.units.group.legends",
};

export function factionName(snapshot: Snapshot, id: string): string {
  return snapshot.data.factions.find((f) => f.id === id)?.name ?? id;
}

/** "5–10 models", "1 model", "10+ models". */
export function sizeText(b: ModelBounds): string {
  if (b.max === undefined) return b.min <= 1 ? t("codex.size.one", { n: 1 }) : t("codex.size.min", { min: b.min });
  if (b.min === b.max) return b.min === 1 ? t("codex.size.one", { n: 1 }) : t("codex.size.fixed", { n: b.min });
  return t("codex.size.range", { min: b.min, max: b.max });
}

/** "90 pts", "90–180 pts", or "unpriced". */
export function pointsText(min: number | undefined, max: number | undefined): string {
  if (min === undefined) return t("codex.noPoints");
  if (max === undefined || max === min) return t("codex.pts", { n: fmtInt(min) });
  return t("codex.ptsRange", { min: fmtInt(min), max: fmtInt(max) });
}

/** The profile as the calculator prints it: `24" · A2 3+ S4 AP-1 D1`. */
export function weaponLine(w: WeaponProfile): string {
  const reach = w.kind === "melee" ? t("codex.melee") : `${w.range ?? "–"}"`;
  return `${reach} · A${dice(w.A)} ${skill(w.skill)} S${w.S} AP${ap(w.AP)} D${dice(w.D)}`;
}

/** The badges a sheet wears under its name. */
export function SheetFlags({ ds }: { ds: Datasheet }) {
  const flags: Array<{ key: string; label: string; tone?: "accent" | "brass" }> = [];
  if (ds.isEpicHero) flags.push({ key: "epic", label: t("codex.flag.epicHero"), tone: "accent" });
  else if (ds.isCharacter) flags.push({ key: "char", label: t("codex.flag.character") });
  if (ds.isBattleline) flags.push({ key: "bl", label: t("codex.flag.battleline") });
  if (ds.isSupport) flags.push({ key: "sup", label: t("codex.flag.support") });
  if (ds.transportCapacity) flags.push({ key: "tr", label: t("codex.flag.transport", { cap: ds.transportCapacity }) });
  if (ds.isLegends) flags.push({ key: "leg", label: t("codex.flag.legends"), tone: "brass" });
  if (!flags.length) return null;
  return (
    <div className="codex-band-flags">
      {flags.map((f) => (
        <Badge key={f.key} tone={f.tone}>
          {f.label}
        </Badge>
      ))}
    </div>
  );
}

/** The faction select and the search box — the same pair in the context column and on the landing grid. */
export function CodexTools({ factions, factionId, onFaction, query, onQuery, className }: { factions: CodexFaction[]; factionId: string; onFaction: (id: string) => void; query: string; onQuery: (q: string) => void; className?: string }) {
  return (
    <div className={`codex-tools ${className ?? ""}`.trim()}>
      <label className="selectbox codex-faction">
        <span className="sr-only">{t("codex.faction")}</span>
        <select value={factionId} onChange={(e) => onFaction(e.target.value)}>
          <option value={ALL_FACTIONS}>{t("codex.allFactions")}</option>
          {factions.map((f) => (
            <option key={f.id} value={f.id}>
              {t("codex.factionOption", { name: f.name, n: f.count })}
            </option>
          ))}
        </select>
        <span className="selectbox-chev" aria-hidden="true">
          ⌄
        </span>
      </label>
      <div className="search-wrap codex-search">
        <Icon name="search" />
        <input type="search" value={query} placeholder={t("codex.searchPlaceholder")} aria-label={t("codex.search")} onChange={(e) => onQuery(e.target.value)} />
      </div>
    </div>
  );
}
