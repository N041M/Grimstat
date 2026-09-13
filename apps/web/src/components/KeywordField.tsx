import { useEffect, useId, useMemo, useRef, useState } from "react";
import { keywordProblems, matchKeywords, replaceToken, tokenAt } from "../lib/keywordSuggest";
import { t, type I18nKey } from "../i18n";

interface Props {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  /** Keywords offered while typing, spelled the way they are printed. */
  suggestions: readonly string[];
  /**
   * Message for a keyword none of `suggestions` matches. Leave it out where anything the player
   * types is legitimate, and the field only completes.
   */
  unknownLabel?: I18nKey;
  className?: string;
}

/**
 * The comma-separated keyword field, with the list it is drawn from.
 *
 * Typing offers the keywords that match the token under the caret, and a keyword that matches none
 * of them is named underneath with the nearest spelling that does, which is what turns "Sustaned
 * Hits 1" from a silent nothing into one click. The token being typed is never reported, so the
 * field stays quiet until a keyword is finished.
 *
 * The list sits in the flow rather than over it: these fields live inside a table that scrolls
 * sideways, and anything positioned over that is cut off at its edge.
 */
export function KeywordField({ value, onCommit, label, suggestions, unknownLabel, className }: Props) {
  const [text, setText] = useState(value);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const last = useRef(value);
  const listId = useId();

  // Follow the value when it changes elsewhere (a preset loaded, a unit replaced).
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);

  const token = useMemo(() => tokenAt(text, caret), [text, caret]);
  const matches = useMemo(() => (focused && !dismissed ? matchKeywords(token.text, suggestions) : []), [focused, dismissed, token.text, suggestions]);
  const problems = useMemo(() => {
    if (!unknownLabel) return [];
    const all = keywordProblems(text, suggestions);
    // The keyword under the caret is still being typed, so it is not yet wrong.
    return focused ? all.filter((p) => p.raw.toLowerCase() !== token.text.toLowerCase()) : all;
  }, [unknownLabel, text, suggestions, focused, token.text]);

  const commit = (next: string) => {
    last.current = next;
    setText(next);
    onCommit(next);
  };

  const sync = (el: HTMLInputElement) => setCaret(el.selectionStart ?? el.value.length);

  const put = (word: string, at: ReturnType<typeof tokenAt> = token) => {
    const next = replaceToken(text, at, word);
    commit(next.text);
    setActive(-1);
    setDismissed(true);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setDismissed(true);
      setActive(-1);
      return;
    }
    if (!matches.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if ((e.key === "Enter" || e.key === "Tab") && active >= 0) {
      e.preventDefault();
      put(matches[active]!);
    }
  };

  return (
    <div className="kw-field">
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 && matches[active] ? `${listId}-${active}` : undefined}
        className={className}
        value={text}
        onChange={(e) => {
          setDismissed(false);
          setActive(-1);
          sync(e.currentTarget);
          commit(e.currentTarget.value);
        }}
        onKeyUp={(e) => sync(e.currentTarget)}
        onClick={(e) => sync(e.currentTarget)}
        onFocus={(e) => {
          setFocused(true);
          sync(e.currentTarget);
        }}
        // The blur waits a frame so that a click on the list lands before the list goes away.
        onBlur={() => requestAnimationFrame(() => setFocused(false))}
        onKeyDown={onKeyDown}
      />
      {matches.length ? (
        <ul className="kw-list" id={listId} role="listbox" aria-label={t("editor.kw.listAria")}>
          {matches.map((m, i) => (
            <li key={m} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" className={`kw-option ${i === active ? "on" : ""}`.trim()} onMouseDown={(e) => e.preventDefault()} onClick={() => put(m)}>
                {m}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problems.length && unknownLabel ? (
        <ul className="kw-problems">
          {problems.map((p) => (
            <li key={p.raw}>
              <span>{t(unknownLabel, { raw: p.raw })}</span>
              {p.suggestion ? (
                <button type="button" className="kw-fix" title={t("editor.kw.suggestAria", { raw: p.raw, name: p.suggestion })} onClick={() => put(p.suggestion!, tokenFor(text, p.raw))}>
                  {t("editor.kw.suggest", { name: p.suggestion })}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Where in the list a keyword the player typed sits, so a correction replaces that one. */
function tokenFor(text: string, raw: string): ReturnType<typeof tokenAt> {
  const at = text.toLowerCase().indexOf(raw.toLowerCase());
  return tokenAt(text, at < 0 ? text.length : at);
}
