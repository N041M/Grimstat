import { useId, useState } from "react";
import type { Datasheet, Snapshot, WeaponProfile } from "@grimstat/schema";
import type { ModelBounds, PickerGroup } from "../../lib/roster";
import { ALL_FACTIONS, filterCount, NO_FILTERS, SHEET_TYPES, type CodexFaction, type CodexFilters, type CodexKeyword, type SheetType } from "../../lib/codex";
import { ap, dice, fmtInt, skill } from "../../lib/format";
import { Badge, Field, Icon, Popover, Switch, numOrNull } from "../ui";
import { t, tn, type I18nKey } from "../../i18n";

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

const TYPE_KEY: Record<SheetType, I18nKey> = {
  character: "roster.section.character",
  battleline: "roster.section.battleline",
  transport: "roster.section.transport",
  fortification: "codex.filter.fortification",
  other: "roster.section.other",
};

/** A number field that is empty when the filter is off, so "no minimum" and "0" stay different. */
function NumberFilter({ label, value, onChange, min, max, placeholder }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min: number; max: number; placeholder: string }) {
  return (
    <Field label={label} className="codex-filter-num">
      <input type="number" inputMode="numeric" min={min} max={max} step={1} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(numOrNull(e.target.value) ?? undefined)} />
    </Field>
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
    <div className="codex-filter-kw">
      <Field label={t("codex.filter.keywords")}>
        <input
          type="text"
          list={listId}
          value={draft}
          placeholder={t("codex.filter.keywordsPlaceholder")}
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
      </Field>
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
              {k} ×
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Everything the codex filters on beyond the faction and the search box, behind one button that
 * says how many are on. A popover rather than a row of controls, because the same tools are drawn
 * in the context column, which is about two hundred pixels wide.
 */
export function CodexFilterMenu({ filters, onFilters, keywords }: { filters: CodexFilters; onFilters: (f: CodexFilters) => void; keywords: CodexKeyword[] }) {
  const [open, setOpen] = useState(false);
  const n = filterCount(filters);
  const set = (part: Partial<CodexFilters>) => onFilters({ ...filters, ...part });
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t("codex.filter.title")}
      align="end"
      className="codex-filter-wrap"
      trigger={
        <button type="button" className={`codex-filter-btn ${n ? "on" : ""}`.trim()} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name="filter" />
          {t("codex.filter.button")}
          {n ? <span className="codex-filter-count">{n}</span> : null}
        </button>
      }
    >
      <div className="codex-filter-panel">
        <Field label={t("codex.filter.type")}>
          <select value={filters.type} onChange={(e) => set({ type: e.target.value as SheetType | "any" })}>
            <option value="any">{t("codex.filter.anyType")}</option>
            {SHEET_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(TYPE_KEY[k])}
              </option>
            ))}
          </select>
        </Field>
        <KeywordFilter known={keywords} chosen={filters.keywords} onChange={(keywords) => set({ keywords })} />
        <div className="codex-filter-pair">
          <NumberFilter label={t("codex.filter.pointsFrom")} value={filters.minPoints} onChange={(minPoints) => set({ minPoints })} min={0} max={9999} placeholder={t("codex.filter.any")} />
          <NumberFilter label={t("codex.filter.pointsTo")} value={filters.maxPoints} onChange={(maxPoints) => set({ maxPoints })} min={0} max={9999} placeholder={t("codex.filter.any")} />
        </div>
        <div className="codex-filter-pair">
          <NumberFilter label={t("codex.filter.minT")} value={filters.minT} onChange={(minT) => set({ minT })} min={1} max={20} placeholder={t("codex.filter.any")} />
          <NumberFilter label={t("codex.filter.minW")} value={filters.minW} onChange={(minW) => set({ minW })} min={1} max={99} placeholder={t("codex.filter.any")} />
        </div>
        <div className="codex-filter-pair">
          <NumberFilter label={t("codex.filter.maxSv")} value={filters.maxSv} onChange={(maxSv) => set({ maxSv })} min={2} max={7} placeholder={t("codex.filter.any")} />
          <NumberFilter label={t("codex.filter.minM")} value={filters.minM} onChange={(minM) => set({ minM })} min={1} max={30} placeholder={t("codex.filter.any")} />
        </div>
        <NumberFilter label={t("codex.filter.minOC")} value={filters.minOC} onChange={(minOC) => set({ minOC })} min={0} max={99} placeholder={t("codex.filter.any")} />
        <Switch checked={filters.invuln} onChange={(invuln) => set({ invuln })} label={t("codex.filter.invuln")} />
        <Switch checked={!filters.legends} onChange={(hide) => set({ legends: !hide })} label={t("codex.filter.hideLegends")} />
        <div className="codex-filter-foot">
          <span className="t-meta">{n ? tn(n, "codex.filter.on.one", "codex.filter.on.many") : t("codex.filter.none")}</span>
          <button type="button" className="sm" disabled={!n} onClick={() => onFilters(NO_FILTERS)}>
            {t("codex.filter.clear")}
          </button>
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
