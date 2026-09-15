import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Snapshot, WeaponKeyword } from "@grimstat/schema";
import { keywordToText } from "../lib/keywordParser";
import { ruleForKeyword, ruleForPrinted, withoutTitleLine } from "../lib/glossary";

/**
 * A keyword that carries its rule with it.
 *
 * A datasheet prints a keyword and leaves the rule elsewhere, so reading one means knowing every
 * keyword by heart or leaving the page. Pointing at the keyword, or tapping it, opens the rule beside
 * it. The rules text comes from the imported data. A keyword no source explains stays plain text with
 * nothing to point at.
 */

/** Long enough that a pointer crossing a row of keywords does not flash a card at each one. */
const OPEN_DELAY_MS = 140;
const CLOSE_DELAY_MS = 160;
const CARD_WIDTH = 340;
/** Below this much room under the keyword the card goes above it instead. */
const MIN_ROOM_BELOW = 180;
const EDGE = 8;

interface Placement {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

function place(rect: DOMRect): Placement {
  const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
  const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
  const below = window.innerHeight - rect.bottom - EDGE * 2;
  const above = rect.top - EDGE * 2;
  if (below >= MIN_ROOM_BELOW || below >= above) return { left, top: rect.bottom + 6, maxHeight: below };
  return { left, bottom: window.innerHeight - rect.top + 6, maxHeight: above };
}

/** Rules text as it is written: blank lines separate paragraphs, lines opening with "- " are a list. */
export function RuleText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim() !== "");
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        const bullets = lines.filter((l) => l.startsWith("- "));
        if (bullets.length === lines.length) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{l.slice(2)}</li>
              ))}
            </ul>
          );
        }
        // A paragraph that runs into a list ("…each of the following:\n- one\n- two") keeps both parts.
        const head = lines.filter((l) => !l.startsWith("- "));
        return (
          <div key={i}>
            <p>{head.join(" ")}</p>
            {bullets.length ? (
              <ul>
                {bullets.map((l, j) => (
                  <li key={j}>{l.slice(2)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * One keyword and the rule behind it. `term` is what the datasheet prints ("Sustained Hits 1"),
 * `name` what the rule is called ("Sustained Hits"), `text` the rule, and `note` a line about this
 * army's use of it. With neither a rule nor a note the keyword is printed as it stands.
 */
export function RuleRef({ term, name, text, note, className }: { term: ReactNode; name: string; text: string; note?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState<Placement | undefined>(undefined);
  const anchor = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();

  const stop = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  const reposition = useCallback(() => {
    const el = anchor.current;
    if (el) setAt(place(el.getBoundingClientRect()));
  }, []);

  const show = useCallback(
    (delay: number) => {
      stop();
      timer.current = setTimeout(() => {
        reposition();
        setOpen(true);
      }, delay);
    },
    [reposition],
  );

  const hide = useCallback((delay: number) => {
    stop();
    timer.current = setTimeout(() => {
      setOpen(false);
      setPinned(false);
    }, delay);
  }, []);

  useEffect(() => stop, []);

  // The keyword sits in tables that scroll sideways and in a page that scrolls down, so the card
  // follows its anchor rather than being dropped at the spot the pointer arrived.
  useLayoutEffect(() => {
    if (!open) return;
    const onMove = () => reposition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      stop();
      setOpen(false);
      setPinned(false);
      anchor.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (target && (anchor.current?.contains(target) || card.current?.contains(target))) return;
      stop();
      setOpen(false);
      setPinned(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  if (!text.trim() && note === undefined) return <span className={className}>{term}</span>;

  const body = withoutTitleLine(text, name);
  return (
    <>
      <button
        type="button"
        ref={anchor}
        className={`rule-ref ${className ?? ""}`.trim()}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch") show(OPEN_DELAY_MS);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch" && !pinned) hide(CLOSE_DELAY_MS);
        }}
        onFocus={() => show(0)}
        onBlur={() => {
          if (!pinned) hide(0);
        }}
        onClick={() => {
          stop();
          if (open && pinned) {
            setOpen(false);
            setPinned(false);
          } else {
            reposition();
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        {term}
      </button>
      {open && at && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={card}
              id={id}
              role="tooltip"
              className="rule-card"
              style={{ left: at.left, top: at.top, bottom: at.bottom, maxHeight: at.maxHeight, width: Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2) }}
              onPointerEnter={stop}
              onPointerLeave={(e) => {
                if (e.pointerType !== "touch" && !pinned) hide(CLOSE_DELAY_MS);
              }}
            >
              <p className="rule-card-name">{name}</p>
              {body ? (
                <div className="rule-card-text">
                  <RuleText text={body} />
                </div>
              ) : null}
              {note !== undefined ? <p className="rule-card-note">{note}</p> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Keywords printed as a row of chips, each carrying its rule. A keyword no source explains is a plain
 * chip, so a list of unit keywords looks exactly as it did.
 */
export function KeywordChips({ names, snapshot, className = "chip" }: { names: readonly string[]; snapshot: Snapshot | undefined; className?: string }) {
  return (
    <>
      {names.map((n) => {
        const rule = ruleForPrinted(snapshot, n);
        return <RuleRef key={n} className={className} term={n} name={rule?.name ?? n} text={rule?.text ?? ""} />;
      })}
    </>
  );
}

/**
 * A weapon's keyword column, each keyword carrying its rule. Reads the same as the plain text it
 * replaces: "Rapid Fire 1, Lethal Hits, Anti-vehicle 4+".
 */
export function KeywordRefs({ keywords, snapshot, empty = "–" }: { keywords: WeaponKeyword[]; snapshot: Snapshot | undefined; empty?: string }) {
  if (!keywords.length) return <>{empty}</>;
  return (
    <>
      {keywords.map((k, i) => {
        const rule = ruleForKeyword(snapshot, k);
        return (
          <span key={i}>
            {i ? ", " : ""}
            <RuleRef term={keywordToText(k)} name={rule?.name ?? keywordToText(k)} text={rule?.text ?? ""} />
          </span>
        );
      })}
    </>
  );
}
