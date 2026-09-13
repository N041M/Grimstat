import { describe, expect, it } from "vitest";
import { classifyPublishedText, webHref } from "./publishedLists";

describe("telling a dropped file apart", () => {
  it("reads a feed through an XML declaration and any comments in front of it", () => {
    expect(classifyPublishedText('<?xml version="1.0"?><rss version="2.0"><channel/></rss>')).toBe("feed");
    expect(classifyPublishedText("<!-- saved from a browser --><rss><channel/></rss>")).toBe("feed");
    expect(classifyPublishedText('<?xml version="1.0"?>\n<!-- one -->\n<!-- two -->\n<feed xmlns="http://www.w3.org/2005/Atom"/>')).toBe("feed");
    expect(classifyPublishedText("<!-- unclosed <rss>")).toBeUndefined();
    expect(classifyPublishedText("<!-- a --><p>A write-up</p>")).toBe("page");
    expect(classifyPublishedText("<feedback><p>x</p></feedback>")).toBe("page");
  });

  // A run of comments used to be matched by a pattern that could end each one at any later "-->",
  // so a file this size had millions of arrangements to try before it could say no. It ran on the
  // main thread for every file dropped on the Data page.
  it("turns down a long run of comments straight away", () => {
    const body = `${"<!---->".repeat(2000)}<p>A write-up</p>`;
    const started = Date.now();
    expect(classifyPublishedText(body)).toBe("page");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("the address a write-up is linked at", () => {
  it("keeps ordinary web addresses", () => {
    expect(webHref("https://example.invalid/write-up")).toBe("https://example.invalid/write-up");
    expect(webHref("http://example.invalid/write-up")).toBe("http://example.invalid/write-up");
    expect(webHref("  https://example.invalid/x  ")).toBe("https://example.invalid/x");
  });

  it("refuses anything a browser would treat as code or as a local file", () => {
    expect(webHref("javascript:alert(document.cookie)")).toBeUndefined();
    expect(webHref("  JavaScript:alert(1)")).toBeUndefined();
    expect(webHref("java\tscript:alert(1)")).toBeUndefined();
    expect(webHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(webHref("vbscript:msgbox(1)")).toBeUndefined();
    expect(webHref("file:///etc/passwd")).toBeUndefined();
    expect(webHref("/write-ups/one")).toBeUndefined();
    expect(webHref("")).toBeUndefined();
    expect(webHref(undefined)).toBeUndefined();
  });
});
