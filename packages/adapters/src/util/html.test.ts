import { describe, expect, it } from "vitest";
import { decodeEntities, stripHtml } from "./html";

describe("stripHtml", () => {
  it("removes tags and keyword spans", () => {
    expect(stripHtml('Add 1 to the wound roll against <span class="kwb">VEHICLE</span> units.')).toBe("Add 1 to the wound roll against VEHICLE units.");
  });
  it("turns <br> and block ends into newlines and list items into bullets", () => {
    expect(stripHtml("<b>WHEN:</b> Fight phase.<br><br><b>EFFECT:</b> Do a thing.<ul><li>one</li><li>two</li></ul>")).toBe("WHEN: Fight phase.\n\nEFFECT: Do a thing.\n\n- one\n- two");
  });
  it("decodes entities including numeric ones and nbsp", () => {
    expect(stripHtml("6&quot; &amp; 12&#34; &#x2019;s&nbsp;end")).toBe('6" & 12" ’s end');
    expect(decodeEntities("&unknown;")).toBe("&unknown;");
  });
  it("collapses whitespace and trims", () => {
    expect(stripHtml("  <p>  a   b </p>\n\n\n\n<p>c</p>  ")).toBe("a b\n\nc");
  });
  it("handles empty input", () => {
    expect(stripHtml(undefined)).toBe("");
    expect(stripHtml("")).toBe("");
  });
});

describe("entities that carry meaning in a list", () => {
  it("decodes bullets and multiplication signs", () => {
    // A wargear line is recognised by its bullet and a count by its times sign; left encoded, both
    // become part of the weapon's name.
    expect(stripHtml("<p>&bull; 2&times; Twin hail gun</p>")).toBe("• 2× Twin hail gun");
    expect(stripHtml("<p>3 &minus; 1 &plusmn; 2 &middot; 4</p>")).toBe("3 − 1 ± 2 · 4");
  });

  it("leaves an entity it does not know alone rather than mangling it", () => {
    expect(stripHtml("<p>&notanentity; &amp;</p>")).toBe("&notanentity; &");
  });
});
