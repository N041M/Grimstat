import { useEffect, useMemo, useRef, useState } from "react";
import type { Roster, Snapshot } from "@grimstat/schema";
import { fromWords, scanList, type Answers, type Draft, type Question } from "@grimstat/adapters";
import { recognise, type RecogniseProgress } from "../../lib/recognise";
import { fmtInt } from "../../lib/format";
import { Field, Icon } from "../ui";
import { t } from "../../i18n";

/**
 * A list read off a picture, for the reader to check before it is saved.
 *
 * The picture on one side and the draft on the other, so checking the list means comparing it with
 * the thing it came from without leaving the screen. What the importer could not settle is asked
 * above the draft, and answering re-runs the whole read, because one answer often settles more than
 * the question it answered.
 *
 * The draft saves whether or not the questions are answered. A unit read badly is saved as it was
 * read and marked, and the roster editor is a better place to correct it than an import screen.
 */

export interface PictureImportProps {
  readonly snapshot: Snapshot;
  readonly pictures: readonly File[];
  readonly onCancel: () => void;
  readonly onSave: (roster: Roster) => void;
}

type Stage = { kind: "reading"; progress: RecogniseProgress } | { kind: "ready"; draft: Draft } | { kind: "empty" } | { kind: "failed"; message: string };

/** What a question asks, in the reader's words rather than the importer's. */
function askedOf(question: Question): string {
  switch (question.kind) {
    case "unit":
      return t("picture.ask.unit", { text: question.asked });
    case "models":
      return t("picture.ask.models", { name: question.asked });
    case "faction":
      return t("picture.ask.faction");
    case "detachment":
      return t("picture.ask.detachment");
    case "owner":
      return t("picture.ask.owner", { name: question.asked });
  }
}

function Questions({ questions, answers, onAnswer }: { questions: readonly Question[]; answers: Answers; onAnswer: (id: string, value: string) => void }) {
  if (!questions.length) return null;
  return (
    <div className="pic-questions">
      {questions.map((q) => (
        <div className="pic-question" key={q.id}>
          <span className="pic-question-ask">{askedOf(q)}</span>
          <div className="pic-question-options">
            {(q.kind === "models" ? q.options.map((n) => ({ id: String(n), label: String(n) })) : q.options).map((o) => (
              <button key={o.id} type="button" className={`pill-chip${answers[q.id] === o.id ? " on" : ""}`} onClick={() => onAnswer(q.id, o.id)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PictureImport({ snapshot, pictures, onCancel, onSave }: PictureImportProps) {
  const [stage, setStage] = useState<Stage>({ kind: "reading", progress: { done: 0, step: "loading" } });
  const [answers, setAnswers] = useState<Answers>({});
  const [name, setName] = useState("");
  const words = useRef<Awaited<ReturnType<typeof recognise>>>([]);
  const urls = useMemo(() => pictures.map((p) => URL.createObjectURL(p)), [pictures]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  // Reading the pictures happens once. Answering a question re-runs the fit over the words that were
  // already read, which is instant, rather than reading the pictures again.
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const all: Awaited<ReturnType<typeof recognise>> = [];
        for (const picture of pictures) {
          const read = await recognise(picture, { onProgress: (progress) => !stopped && setStage({ kind: "reading", progress }) });
          if (stopped) return;
          // Several pictures of one list are read in order and joined, with each picture pushed below
          // the one before so the positions never overlap.
          const below = all.reduce((low, w) => Math.max(low, w.box.y + w.box.h), 0);
          all.push(...read.map((w) => ({ ...w, box: { ...w.box, y: w.box.y + below } })));
        }
        if (stopped) return;
        words.current = all;
        const draft = scanList(snapshot, fromWords(all));
        setStage(draft.units.length ? { kind: "ready", draft } : { kind: "empty" });
      } catch (e) {
        if (!stopped) setStage({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [pictures, snapshot]);

  const answer = (id: string, value: string) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    setStage({ kind: "ready", draft: scanList(snapshot, fromWords(words.current), { answers: next, ...(name.trim() ? { name: name.trim() } : {}) }) });
  };

  if (stage.kind === "reading") {
    const percent = Math.round(stage.progress.done * 100);
    return (
      <div className="pic-reading">
        <p className="small muted">{stage.progress.step === "loading" ? t("picture.loading") : t("picture.reading", { n: percent })}</p>
        <ProgressBar done={stage.progress.done} />
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  if (stage.kind === "failed" || stage.kind === "empty") {
    return (
      <div className="stack">
        <p className="small">{stage.kind === "empty" ? t("picture.nothing") : t("picture.failed", { msg: stage.message })}</p>
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            {t("common.close")}
          </button>
        </div>
      </div>
    );
  }

  const { draft } = stage;
  const limit = draft.roster.pointsLimit;
  return (
    <div className="pic-review">
      <div className="pic-shots">
        {urls.map((url, i) => (
          <img key={url} src={url} alt={t("picture.shotAlt", { n: i + 1 })} />
        ))}
      </div>

      <div className="pic-side">
        <div className="pic-figures">
          <span className="pic-total num">{t("picture.points", { n: fmtInt(draft.total), limit: fmtInt(limit) })}</span>
          <span className="small muted">{t(`battleSize.${draft.roster.battleSize}`)}</span>
        </div>

        <Questions questions={draft.questions} answers={answers} onAnswer={answer} />

        <ul className="pic-units">
          {draft.units.map((u, i) => {
            const disagrees = u.printedCost !== undefined && u.printedCost !== u.computedCost;
            return (
              <li key={`${u.datasheetId}:${i}`} className={disagrees ? "pic-unit off" : "pic-unit"}>
                <span className="pic-unit-name">{u.models > 1 ? `${u.models} × ${u.name}` : u.name}</span>
                <span className="pic-unit-cost num">{fmtInt(u.computedCost)}</span>
                {u.wargear.length ? <span className="pic-unit-gear small muted">{u.wargear.join(", ")}</span> : null}
                {disagrees ? <span className="pic-unit-note small">{t("picture.costRead", { n: fmtInt(u.printedCost ?? 0) })}</span> : null}
              </li>
            );
          })}
        </ul>

        {draft.unplaced.length ? <p className="small muted pic-unplaced">{t("picture.unplaced", { names: draft.unplaced.join(", ") })}</p> : null}

        <Field label={t("armies.nameOptional")}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={draft.roster.name} />
        </Field>

        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="primary" onClick={() => onSave({ ...draft.roster, ...(name.trim() ? { name: name.trim() } : {}) })}>
            <Icon name="plus" />
            {t("picture.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ done }: { done: number }) {
  return (
    <div className="pic-progress" role="progressbar" aria-valuenow={Math.round(done * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(2, Math.round(done * 100))}%` }} />
    </div>
  );
}
