/** Trigger a browser download of `data` (objects are pretty-printed as JSON). */
export function download(name: string, data: unknown, type = "application/json"): void {
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open an HTML document in a new tab via a Blob URL (no inline data: URLs, so CSP-friendly). */
export function openHtmlInNewTab(html: string): boolean {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const w = window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return !!w;
}
