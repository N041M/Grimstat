import { useEffect, useMemo, useState } from "react";
import type { Snapshot } from "@grimstat/schema";
import { BOX_SETS } from "../../data/boxes";
import { boxesByYear, boxesFor, linesForFactions, modelsByDatasheet, type ResolvedBox } from "../../lib/boxes";
import { Dialog } from "../ui";
import { t } from "../../i18n";

/**
 * Putting a boxed set on the shelf.
 *
 * A box is picked, then its armies are ticked, then it is added. The tick is what a box holding two
 * forces needs: somebody who split one with a friend owns half of it, and adding the other half
 * would count models that are on somebody else's shelf.
 *
 * The three things a box's lines can be are kept apart on screen, because they ask different things
 * of the reader. A line that resolved is counted. A line the box leaves to its owner is a question
 * for them, and waits. A line naming a unit this snapshot has never heard of is the data being
 * behind, which is theirs to fix and not something to pretend about.
 */
export function BoxDialog({ open, onClose, snapshot, onAdd }: { open: boolean; onClose: () => void; snapshot: Snapshot | undefined; onAdd: (box: ResolvedBox, factionIds: readonly string[]) => void }) {
  const boxes = useMemo(() => (snapshot ? boxesFor(BOX_SETS, snapshot) : []), [snapshot]);
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const picked = boxes.find((b) => b.box.id === pickedId);
  const [ticked, setTicked] = useState<readonly string[]>([]);

  // A newly picked box starts with every army it holds ticked: one army is the common case, and a
  // reader who wants only half is the one who came here to untick something.
  useEffect(() => {
    setTicked(picked ? picked.factionIds : []);
  }, [pickedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) setPickedId(undefined);
  }, [open]);

  const factionName = (id: string): string => snapshot?.data.factions.find((f) => f.id === id)?.name ?? id;
  const totals = picked ? modelsByDatasheet(linesForFactions(picked, ticked)) : undefined;
  const models = totals ? [...totals.values()].reduce((s, v) => s + v.models, 0) : 0;

  return (
    <Dialog open={open} onClose={onClose} wide title={t("collection.box.title")} className="box-dialog">
      {!picked ? (
        <BoxList boxes={boxes} onPick={setPickedId} />
      ) : (
        <>
          <div className="box-head">
            <button type="button" className="ghost sm" onClick={() => setPickedId(undefined)}>
              {t("collection.box.back")}
            </button>
            <span className="box-source">
              {picked.box.announced}
              {" · "}
              <a href={picked.box.source} target="_blank" rel="noreferrer noopener">
                {t("collection.box.contents")}
              </a>
            </span>
          </div>
          {picked.factionIds.map((id) => (
            <section key={id} className="box-army">
              <label className="box-army-head">
                <input
                  type="checkbox"
                  checked={ticked.includes(id)}
                  onChange={(e) => setTicked((prev) => (e.target.checked ? [...prev, id] : prev.filter((f) => f !== id)))}
                />
                <span>{factionName(id)}</span>
              </label>
              <ul className="box-lines">
                {picked.lines
                  .filter((l) => l.ds?.factionId === id)
                  .map((l, i) => (
                    <li key={`${l.line.name}-${i}`}>
                      <span className="box-count mono">{l.models}</span>
                      {l.ds!.name}
                      {l.alternatives.length ? <span className="box-or">{t("collection.box.or", { units: l.alternatives.map((a) => a.name).join(", ") })}</span> : null}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          {picked.toName.length ? (
            <section className="box-aside">
              <h3>{t("collection.box.toName")}</h3>
              <ul className="box-lines">
                {picked.toName.map((l, i) => (
                  <li key={`${l.line.name}-${i}`}>
                    <span className="box-count mono">{l.models}</span>
                    {l.line.name}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {picked.unknown.length ? (
            <section className="box-aside">
              <h3>{t("collection.box.unknown")}</h3>
              <p className="muted">{picked.unknown.join(", ")}</p>
            </section>
          ) : null}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="button" className="primary" disabled={models === 0} onClick={() => onAdd(picked, ticked)}>
              {t("collection.box.add", { models })}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/**
 * The boxes, under the year each was announced in.
 *
 * Grouped by year rather than run together, because names come back: a Battleforce sold one year
 * under a name can be sold again years later with different models in it, and the year is what
 * tells a reader which of them is the one on their shelf.
 */
function BoxList({ boxes, onPick }: { boxes: readonly ResolvedBox[]; onPick: (id: string) => void }) {
  if (!boxes.length) return <p className="muted">{t("collection.box.none")}</p>;
  return (
    <>
      {boxesByYear(boxes).map((group) => (
        <section key={group.year} className="box-year">
          <h3>{group.year}</h3>
          <ul className="box-picker">
            {group.boxes.map((b) => (
              <li key={b.box.id}>
                <button type="button" onClick={() => onPick(b.box.id)}>
                  <span className="box-name">{b.box.name}</span>
                  <span className="box-meta mono">{t("collection.box.summary", { models: b.models, armies: b.factionIds.length })}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

