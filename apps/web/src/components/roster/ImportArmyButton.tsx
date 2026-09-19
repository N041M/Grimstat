import { useRef, useState } from "react";
import type { Roster } from "@grimstat/schema";
import { useApp } from "../../state/AppContext";
import { rostersFromJson } from "../../lib/rosterFile";
import { storeImportedArmies } from "../../lib/savedArmies";
import { Icon } from "../ui";
import { t, tn } from "../../i18n";

/**
 * A button that imports an army the app saved earlier: the JSON file one army downloads as, or the
 * "Export all" file. It opens the file picker straight away. Every army in the file is stored, an
 * army already stored under the same id is saved as a copy, and `onImported` gets the armies as
 * they were saved.
 */
export function ImportArmyButton({ className, disabled, onImported }: { className?: string; disabled?: boolean; onImported?: (saved: Roster[]) => void }) {
  const { notify } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = rostersFromJson(await file.text());
      if (!parsed) {
        notify(t("armies.jsonUnreadable"), "error");
        return;
      }
      const { saved, present } = await storeImportedArmies(parsed.rosters, (name) => t("armies.copyName", { name }));
      const details: string[] = [];
      if (parsed.skipped) details.push(tn(parsed.skipped, "armies.jsonSkipped.one", "armies.jsonSkipped.many"));
      if (present) details.push(tn(present, "armies.jsonPresent.one", "armies.jsonPresent.many"));
      notify(tn(saved.length, "armies.importedJson.one", "armies.importedJson.many"), "success", details.length ? details : undefined);
      onImported?.(saved);
    } catch {
      notify(t("armies.fileReadFailed", { name: file.name }), "error");
    } finally {
      setBusy(false);
      // Cleared so the same file can be chosen again.
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <button type="button" className={className} disabled={disabled || busy} onClick={() => input.current?.click()}>
        <Icon name="file" />
        {t("armies.importSaved")}
      </button>
      <input ref={input} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void take(e.target.files?.[0])} />
    </>
  );
}
