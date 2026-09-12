import { useRef, useState } from "react";
import type { TerrainLayout } from "@grimstat/board";
import { BATTLE_SIZES } from "@grimstat/board";
import { parseLayoutFile, stringifyLayoutFile } from "@grimstat/adapters";
import { copyLayout, emptyLayout, isBuiltIn, rename } from "../../lib/layoutEdit";
import { isPublished } from "../../lib/layoutFetch";
import { deleteLayout, saveLayouts, type StoredLayout } from "../../lib/layoutStore";
import { download } from "../../lib/download";
import { newId } from "../../lib/ids";
import { Badge, useConfirm } from "../ui";
import { t } from "../../i18n";

/**
 * Saving, loading and sharing tables.
 *
 * The four layouts that come with the app are generic and read-only; everything else is the user's.
 * Import and export exist because this project does not ship anyone else's layouts — the file format
 * carries provenance so an imported table can say whose work it is.
 *
 * Mount this keyed by the layout's id: the name field is a draft of *this* layout's name, and a draft
 * that outlived a switch to another layout would rename the wrong one on the next save.
 */
export function LayoutLibrary({
  layout,
  library,
  editable,
  dirty,
  onStore,
  onLoad,
  onRefresh,
  notify,
}: {
  layout: TerrainLayout;
  library: readonly StoredLayout[];
  /** Whether this layout may be saved in place — a shipped one may not. */
  editable: boolean;
  /** Whether the table differs from what the library has stored under this id. */
  dirty: boolean;
  onStore: (layout: TerrainLayout, asNew?: boolean) => void;
  /** Put another layout on the table. `force` skips the unsaved-changes check, for after a delete. */
  onLoad: (layout: TerrainLayout, force?: boolean) => void;
  onRefresh: () => void;
  notify: (text: string, kind?: "info" | "success" | "error", details?: string[]) => void;
}) {
  const [name, setName] = useState(layout.name);
  const file = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();
  const typed = name.trim() || layout.name;
  /** The field is a draft: nothing is stored until one of the save buttons is pressed. */
  const renamed = typed !== layout.name;

  const importFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    try {
      const { layouts, warnings } = parseLayoutFile(await chosen.text());
      // Imported layouts keep their own ids where they can, but a collision with something already
      // stored would silently replace the user's own table, so those get a fresh one.
      const taken = new Set(library.map((l) => l.layout.id));
      // The file name is provenance too: it is what the user will recognise when the layout is
      // exported again a year from now.
      const safe = layouts.map((l) => ({ ...l, id: taken.has(l.id) ? newId("layout") : l.id, provenance: { ...l.provenance, importedFrom: l.provenance?.importedFrom ?? chosen.name } }));
      await saveLayouts(safe, chosen.name);
      onRefresh();
      notify(t("battle.library.imported", { n: safe.length }), "success", warnings.slice(0, 8));
      // What was just imported is what the user wants to look at.
      if (safe[0]) onLoad(safe[0]);
    } catch (e) {
      notify(t("battle.library.importFailed"), "error", [e instanceof Error ? e.message : String(e)]);
    }
  };

  return (
    <section className="battle-section">
      <div className="battle-section-head">
        <h2>{t("battle.library")}</h2>
        {dirty ? <Badge tone="warn">{t("battle.library.unsaved")}</Badge> : null}
      </div>
      <label className="battle-dim wide">
        <span>{t("battle.library.name")}</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="battle-actions wrap">
        <button type="button" className={`sm ${(dirty || renamed) && editable ? "primary" : "ghost"}`} disabled={!editable} onClick={() => onStore(rename(layout, typed))}>
          {t("battle.library.save")}
        </button>
        <button type="button" className="ghost sm" onClick={() => onStore(rename(layout, typed), true)}>
          {t("battle.library.saveAs")}
        </button>
        <button type="button" className="ghost sm" onClick={() => onLoad(emptyLayout(newId("layout"), t("battle.library.newName"), BATTLE_SIZES.strikeForce))}>
          {t("battle.library.new")}
        </button>
        <button type="button" className="ghost sm" onClick={() => onLoad(copyLayout(layout))}>
          {t("battle.library.duplicate")}
        </button>
      </div>

      <div className="battle-actions wrap">
        <button type="button" className="ghost sm" onClick={() => download(`${layout.id}.layout.json`, stringifyLayoutFile([layout]))}>
          {t("battle.library.export")}
        </button>
        <button type="button" className="ghost sm" onClick={() => file.current?.click()}>
          {t("battle.library.import")}
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            // Choosing the same file twice should import it twice.
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="ghost sm danger"
          disabled={!editable}
          onClick={() => {
            void (async () => {
              if (!(await confirm({ title: t("battle.library.confirmDelete", { name: layout.name }), confirmLabel: t("common.delete"), danger: true }))) return;
              await deleteLayout(layout.id);
              onRefresh();
              const fallback = library.find((l) => l.builtIn);
              if (fallback) onLoad(fallback.layout, true);
            })();
          }}
        >
          {t("battle.library.delete")}
        </button>
      </div>

      {isBuiltIn(layout.id) ? <p className="muted small">{t("battle.library.builtIn")}</p> : null}
      {isPublished(layout.id) ? <p className="muted small">{t("battle.library.publishedNote")}</p> : null}
      {dialog}
    </section>
  );
}
