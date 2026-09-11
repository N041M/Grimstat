import { useRef, useState } from "react";
import type { TerrainLayout } from "@grimstat/board";
import { BATTLE_SIZES } from "@grimstat/board";
import { parseLayoutFile, stringifyLayoutFile } from "@grimstat/adapters";
import { emptyLayout, rename } from "../../lib/layoutEdit";
import { copyLayout, deleteLayout, isBuiltIn, saveLayouts, type StoredLayout } from "../../lib/layoutStore";
import { download } from "../../lib/download";
import { newId } from "../../lib/ids";
import { t } from "../../i18n";

/**
 * Saving, loading and sharing tables.
 *
 * The four layouts that come with the app are generic and read-only; everything else is the user's.
 * Import and export exist because this project does not ship anyone else's layouts — the file format
 * carries provenance so an imported table can say whose work it is.
 */
export function LayoutLibrary({
  layout,
  library,
  editable,
  onStore,
  onLoad,
  onRefresh,
  notify,
}: {
  layout: TerrainLayout;
  library: readonly StoredLayout[];
  editable: boolean;
  onStore: (layout: TerrainLayout, asNew?: boolean) => void;
  onLoad: (layout: TerrainLayout) => void;
  onRefresh: () => void;
  notify: (text: string, kind?: "info" | "success" | "error", details?: string[]) => void;
}) {
  const [name, setName] = useState(layout.name);
  const file = useRef<HTMLInputElement>(null);

  const importFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    try {
      const { layouts, warnings } = parseLayoutFile(await chosen.text());
      // Imported layouts keep their own ids where they can, but a collision with something already
      // stored would silently replace the user's own table, so those get a fresh one.
      const taken = new Set(library.map((l) => l.layout.id));
      const safe = layouts.map((l) => (taken.has(l.id) ? { ...l, id: newId("layout") } : l));
      await saveLayouts(safe, chosen.name);
      onRefresh();
      notify(t("battle.library.imported", { n: safe.length }), "success", warnings.slice(0, 8));
    } catch (e) {
      notify(t("battle.library.importFailed"), "error", [e instanceof Error ? e.message : String(e)]);
    }
  };

  return (
    <section className="battle-section">
      <h2>{t("battle.library")}</h2>
      <label className="battle-dim wide">
        <span>{t("battle.library.name")}</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== layout.name && onStore(rename(layout, name.trim()), !editable)} />
      </label>

      <div className="battle-actions wrap">
        <button type="button" className="ghost sm" disabled={!editable} onClick={() => onStore(rename(layout, name.trim() || layout.name))}>
          {t("battle.library.save")}
        </button>
        <button type="button" className="ghost sm" onClick={() => onStore(rename(layout, name.trim() || layout.name), true)}>
          {t("battle.library.saveAs")}
        </button>
        <button type="button" className="ghost sm" onClick={() => onLoad(emptyLayout(newId("layout"), "New table", BATTLE_SIZES.strikeForce))}>
          {t("battle.library.new")}
        </button>
        <button type="button" className="ghost sm" onClick={() => onLoad(copyLayout(layout))}>
          {t("battle.library.duplicate")}
        </button>
      </div>

      <div className="battle-actions wrap">
        <button type="button" className="ghost sm" onClick={() => download(`${layout.id}.layout.json`, JSON.parse(stringifyLayoutFile([layout])))}>
          {t("battle.library.export")}
        </button>
        <button type="button" className="ghost sm" onClick={() => file.current?.click()}>
          {t("battle.library.import")}
        </button>
        <input ref={file} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void importFile(e.target.files?.[0])} />
        <button
          type="button"
          className="ghost sm"
          disabled={!editable}
          onClick={() => {
            if (!window.confirm(t("battle.library.confirmDelete", { name: layout.name }))) return;
            void deleteLayout(layout.id).then(() => {
              onRefresh();
              const fallback = library.find((l) => l.builtIn);
              if (fallback) onLoad(fallback.layout);
            });
          }}
        >
          {t("battle.library.delete")}
        </button>
      </div>

      {isBuiltIn(layout.id) ? <p className="muted small">{t("battle.library.builtIn")}</p> : null}
    </section>
  );
}
