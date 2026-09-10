import { en } from "./en";

export type I18nKey = keyof typeof en;

type Vars = Record<string, string | number>;

let dict: Record<I18nKey, string> = en;

/** Translate a UI string. Supports `{name}` interpolation. Unknown keys fall back to the key itself. */
export function t(key: I18nKey, vars?: Vars): string {
  let s: string = dict[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Count-aware pick between a singular and a plural key; both receive `{n}`. */
export function tn(n: number, one: I18nKey, many: I18nKey, vars?: Vars): string {
  return t(n === 1 ? one : many, { ...vars, n });
}

export function setDictionary(d: Partial<Record<I18nKey, string>>): void {
  dict = { ...en, ...d };
}
