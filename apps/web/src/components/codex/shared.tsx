import { useEffect, useId, useState, type ReactNode } from "react";
import type { Datasheet, Snapshot, WeaponProfile } from "@grimstat/schema";
import type { ModelBounds, PickerGroup } from "../../lib/roster";
import { ALL_FACTIONS, filterCount, NO_FILTERS, SHEET_TYPES, type CharacteristicKey, type CodexFaction, type CodexFilters, type CodexKeyword, type SheetType } from "../../lib/codex";
import { ap, dice, fmtInt, skill } from "../../lib/format";
import { Badge, Icon, Popover, Switch, numOrNull } from "../ui";
import { RuleRef } from "../RuleRef";
import { ruleFor } from "../../lib/glossary";
import { t, tn, type I18nKey } from "../../i18n";

/** What the Codex screen's parts say in common: sizes, points, a weapon on one line, the flags. */

/** The characteristics under their column letter, and under their name in full. */
export const STAT_COL: Record<CharacteristicKey, I18nKey> = { M: "codex.col.M", T: "codex.col.T", Sv: "codex.col.Sv", InvSv: "codex.col.InvSv", W: "codex.col.W", Ld: "codex.col.Ld", OC: "codex.col.OC" };
export const STAT_TITLE: Record<CharacteristicKey, I18nKey> = { M: "codex.stat.M", T: "codex.stat.T", Sv: "codex.stat.Sv", InvSv: "codex.stat.InvSv", W: "codex.stat.W", Ld: "codex.stat.Ld", OC: "codex.stat.OC" };

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

/**
 * The badges a sheet wears under its name, each opening what it means.
 *
 * Support is a core ability, so its flag opens the rule the game system printed for it. The rest name
 * no rule any source carries, and this app does not write Games Workshop's rules for them. What it can
 * say is what it does with the flag itself, which is what the army checks act on.
 */
export function SheetFlags({ ds, snapshot }: { ds: Datasheet; snapshot: Snapshot }) {
  const flags: Array<{ key: string; label: string; tone?: "accent" | "brass"; text?: string }> = [];
  if (ds.isEpicHero) flags.push({ key: "epic", label: t("codex.flag.epicHero"), tone: "accent", text: t("codex.flagText.epicHero") });
  else if (ds.isCharacter) flags.push({ key: "char", label: t("codex.flag.character"), text: t("codex.flagText.character") });
  if (ds.isBattleline) flags.push({ key: "bl", label: t("codex.flag.battleline"), text: t("codex.flagText.battleline") });
  if (ds.isSupport) flags.push({ key: "sup", label: t("codex.flag.support"), text: ruleFor(snapshot, "SUPPORT")?.text });
  // The flag says only that the model carries a unit. How much it carries is a paragraph of prose in
  // the data, up to 854 characters in a real snapshot, so it opens on the flag instead of sitting in it.
  if (ds.transportCapacity) flags.push({ key: "tr", label: t("codex.flag.transport"), text: ds.transportCapacity });
  if (ds.isLegends) flags.push({ key: "leg", label: t("codex.flag.legends"), tone: "brass", text: t("codex.flagText.legends") });
  if (!flags.length) return null;
  return (
    <div className="codex-band-flags">
      {flags.map((f) =>
        f.text ? (
          <RuleRef key={f.key} className={`badge ${f.tone ?? ""}`.trim()} term={f.label} name={f.label} text={f.text} />
        ) : (
          <Badge key={f.key} tone={f.tone}>
            {f.label}
          </Badge>
        ),
      )}
    </div>
  );
}

const TYPE_KEY: Record<SheetType, I18nKey> = {
  character: "roster.section.character",
  battleline: "roster.section.battleline",
  transport: "roster.section.transport",
  fortification: "codex.filter.fortification",
  other: "roster.section.other",
};

/** One small numeric threshold, under the abbreviation the datasheet cards use for it. */
function StatFilter({ stat, value, onChange, max }: { stat: "M" | "T" | "W" | "OC"; value: number | undefined; onChange: (v: number | undefined) => void; max: number }) {
  return (
    <label className="codex-filter-stat">
      <span className="codex-filter-stat-key">{t(STAT_COL[stat])}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={1}
        value={value ?? ""}
        aria-label={t("codex.filter.statAtLeast", { stat: t(STAT_TITLE[stat]) })}
        onChange={(e) => onChange(numOrNull(e.target.value) ?? undefined)}
      />
    </label>
  );
}

/** Saves run the other way, so they are picked as they are written: 3+ admits 3+ and 2+. */
const SAVES = [2, 3, 4, 5, 6] as const;

function SaveFilter({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <label className="codex-filter-stat">
      <span className="codex-filter-stat-key">{t(STAT_COL.Sv)}</span>
      <select value={value ?? ""} aria-label={t("codex.filter.svOrBetter")} onChange={(e) => onChange(numOrNull(e.target.value) ?? undefined)}>
        <option value="">{t("codex.filter.any")}</option>
        {SAVES.map((n) => (
          <option key={n} value={n}>
            {t("codex.filter.save", { n })}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A labelled band of the panel: the eyebrow, a note on the right, and the controls under both. */
function FilterSection({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <section className="codex-filter-sec">
      <div className="codex-filter-sec-head">
        <span className="t-eyebrow">{label}</span>
        {note ? <span className="codex-filter-note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** The keyword picker: type a keyword to add it, each added one a chip that takes itself off again. */
function KeywordFilter({ known, chosen, onChange }: { known: CodexKeyword[]; chosen: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  /**
   * Only a whole keyword is taken while typing. Enter settles for the one the draft starts that
   * most sheets carry, so "psy" is PSYKER rather than whichever rare keyword sorts first.
   */
  const add = (raw: string, nearest = false) => {
    const q = raw.trim().toLowerCase();
    if (!q) return;
    const starts = nearest ? known.filter((k) => k.name.toLowerCase().startsWith(q)) : [];
    const best = starts.length ? starts.reduce((a, b) => (b.count > a.count ? b : a)) : undefined;
    const word = known.find((k) => k.name.toLowerCase() === q)?.name ?? best?.name;
    if (!word || chosen.includes(word)) return;
    onChange([...chosen, word]);
    setDraft("");
  };
  return (
    <>
      <input
        type="text"
        list={listId}
        value={draft}
        placeholder={t("codex.filter.keywordsPlaceholder")}
        aria-label={t("codex.filter.keywords")}
        onChange={(e) => {
          setDraft(e.target.value);
          // A pick from the browser's own list arrives as a whole keyword, so it is taken as one.
          if (known.some((k) => k.name.toLowerCase() === e.target.value.trim().toLowerCase())) add(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          add(draft, true);
        }}
      />
      <datalist id={listId}>
        {known.map((k) => (
          <option key={k.name} value={k.name}>
            {tn(k.count, "codex.filter.keywordOn.one", "codex.filter.keywordOn.many")}
          </option>
        ))}
      </datalist>
      {chosen.length ? (
        <span className="chips codex-filter-chips">
          {chosen.map((k) => (
            <button key={k} type="button" className="chip" title={t("codex.filter.keywordOff", { name: k })} onClick={() => onChange(chosen.filter((x) => x !== k))}>
              {k}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </span>
      ) : null}
    </>
  );
}

/**
 * Holds the page still behind an open filter panel.
 *
 * On a phone the panel is most of the screen, and the list carried on scrolling under it, so a
 * flick meant to reach the bottom of the panel moved the datasheets instead. Counted rather than
 * set and unset, because on a wide screen the column's panel and the grid's can both be open, and
 * closing one must not let the page go while the other still stands over it. The class does
 * nothing above phone widths, where the panel is a small thing anchored to its button.
 */
let locks = 0;
function useHeldPage(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    locks += 1;
    document.body.classList.add("codex-filters-open");
    return () => {
      locks -= 1;
      if (locks <= 0) document.body.classList.remove("codex-filters-open");
    };
  }, [on]);
}

/**
 * Everything the codex filters on beyond the faction and the search box, behind one button that
 * says how many are on. A popover rather than a row of controls, because the same tools are drawn
 * in the context column, which is about two hundred pixels wide.
 *
 * Banded the way a datasheet is read — what the unit is, what it carries, what it costs, what its
 * profile says — and the profile band is the card's own stat line with a box under each letter, so
 * the same five abbreviations mean the same five things in both places.
 */
export function CodexFilterMenu({ filters, onFilters, keywords }: { filters: CodexFilters; onFilters: (f: CodexFilters) => void; keywords: CodexKeyword[] }) {
  const [open, setOpen] = useState(false);
  const n = filterCount(filters);
  const set = (part: Partial<CodexFilters>) => onFilters({ ...filters, ...part });
  useHeldPage(open);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t("codex.filter.title")}
      align="end"
      className="codex-filter-wrap"
      trigger={
        <>
          <button type="button" className={`codex-filter-btn ${n ? "on" : ""}`.trim()} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name="filter" />
            {t("codex.filter.button")}
            {n ? <span className="codex-filter-count">{n}</span> : null}
          </button>
          {/* What the panel stands in front of on a phone, dimmed. It takes the tap itself rather
              than letting it through, which would have opened whichever datasheet was under it. */}
          {open ? <div className="codex-filter-veil" aria-hidden="true" onClick={() => setOpen(false)} /> : null}
        </>
      }
    >
      <div className="codex-filter-panel">
        {/* In the panel's own corner rather than in the first band, which it does not belong to. */}
        <button type="button" className="ghost sm icon-btn codex-filter-x" aria-label={t("common.close")} onClick={() => setOpen(false)}>
          <Icon name="close" />
        </button>
        <FilterSection label={t("codex.filter.sec.unit")}>
          <select value={filters.type} aria-label={t("codex.filter.type")} onChange={(e) => set({ type: e.target.value as SheetType | "any" })}>
            <option value="any">{t("codex.filter.anyType")}</option>
            {SHEET_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(TYPE_KEY[k])}
              </option>
            ))}
          </select>
          <Switch checked={!filters.legends} onChange={(hide) => set({ legends: !hide })} label={t("codex.filter.hideLegends")} />
        </FilterSection>

        <FilterSection label={t("codex.filter.sec.keywords")} note={filters.keywords.length ? t("codex.filter.keywordsNote") : undefined}>
          <KeywordFilter known={keywords} chosen={filters.keywords} onChange={(keywords) => set({ keywords })} />
        </FilterSection>

        <FilterSection label={t("codex.filter.sec.points")} note={t("codex.filter.pointsNote")}>
          <div className="codex-filter-range">
            <input type="number" inputMode="numeric" min={0} max={9999} step={5} value={filters.minPoints ?? ""} aria-label={t("codex.filter.pointsFrom")} onChange={(e) => set({ minPoints: numOrNull(e.target.value) ?? undefined })} />
            <span aria-hidden="true">–</span>
            <input type="number" inputMode="numeric" min={0} max={9999} step={5} value={filters.maxPoints ?? ""} aria-label={t("codex.filter.pointsTo")} onChange={(e) => set({ maxPoints: numOrNull(e.target.value) ?? undefined })} />
          </div>
        </FilterSection>

        <FilterSection label={t("codex.filter.sec.profile")} note={t("codex.filter.profileNote")}>
          <div className="codex-filter-stats">
            <StatFilter stat="M" value={filters.minM} onChange={(minM) => set({ minM })} max={30} />
            <StatFilter stat="T" value={filters.minT} onChange={(minT) => set({ minT })} max={20} />
            <SaveFilter value={filters.maxSv} onChange={(maxSv) => set({ maxSv })} />
            <StatFilter stat="W" value={filters.minW} onChange={(minW) => set({ minW })} max={99} />
            <StatFilter stat="OC" value={filters.minOC} onChange={(minOC) => set({ minOC })} max={99} />
          </div>
          <Switch checked={filters.invuln} onChange={(invuln) => set({ invuln })} label={t("codex.filter.invuln")} />
        </FilterSection>

        <div className="codex-filter-foot">
          <span className="t-meta">{n ? tn(n, "codex.filter.on.one", "codex.filter.on.many") : t("codex.filter.none")}</span>
          <span className="codex-filter-acts">
            <button type="button" className="sm" disabled={!n} onClick={() => onFilters(NO_FILTERS)}>
              {t("codex.filter.clear")}
            </button>
            {/* The list follows every change, so this shuts the panel rather than applying anything. */}
            <button type="button" className="sm primary" onClick={() => setOpen(false)}>
              {t("codex.filter.done")}
            </button>
          </span>
        </div>
      </div>
    </Popover>
  );
}

/** The faction select, the search box and the filter button — the same set in the column and on the landing grid. */
export function CodexTools({ factions, factionId, onFaction, query, onQuery, filters, onFilters, keywords, className }: { factions: CodexFaction[]; factionId: string; onFaction: (id: string) => void; query: string; onQuery: (q: string) => void; filters: CodexFilters; onFilters: (f: CodexFilters) => void; keywords: CodexKeyword[]; className?: string }) {
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
      <CodexFilterMenu filters={filters} onFilters={onFilters} keywords={keywords} />
    </div>
  );
}

/**
 * A full-width action at the foot of the context column, drawn as a plain button. The dashed
 * `ContextNewRow` means "create something new" on the other screens, so opening the compare view
 * does not borrow it.
 */
export function ColumnAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="codex-ctx-action">
      <button type="button" onClick={onClick}>
        {label}
      </button>
    </div>
  );
}

/**
 * The no-match text, with a one-click way out of whatever narrowed the list.
 *
 * The filters are named first when any are on, because they are the reason that is behind a button
 * rather than in front of the reader, and so the easiest one to forget having set.
 */
export function NoMatch({ query, factions, factionId, onFaction, filters, onFilters }: { query: string; factions: CodexFaction[]; factionId: string; onFaction: (id: string) => void; filters: CodexFilters; onFilters: (f: CodexFilters) => void }) {
  if (filterCount(filters) > 0)
    return (
      <>
        {t("codex.noMatchFiltered")}{" "}
        <button type="button" className="sm" onClick={() => onFilters(NO_FILTERS)}>
          {t("codex.filter.clear")}
        </button>
      </>
    );
  if (factionId === ALL_FACTIONS) return <>{t("codex.noMatch")}</>;
  const faction = factions.find((f) => f.id === factionId)?.name ?? factionId;
  return (
    <>
      {t("codex.noMatchIn", { q: query.trim(), faction })}{" "}
      <button type="button" className="sm" onClick={() => onFaction(ALL_FACTIONS)}>
        {t("codex.searchAll")}
      </button>
    </>
  );
}
