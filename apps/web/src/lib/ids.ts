/** Random id that works in every context (crypto.randomUUID needs a secure context). */
export function newId(prefix = ""): string {
  const c = globalThis.crypto;
  const core = c && typeof c.randomUUID === "function" ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}-${core}` : core;
}

export function nowIso(): string {
  return new Date().toISOString();
}
