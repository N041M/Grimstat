import { describe, expect, it } from "vitest";
import { dragsSelection, inSelection } from "./selection";

const boxed = new Set(["m1", "m2", "m3", "m4", "m5"]);

describe("pressing a model that is selected with others", () => {
  it("keeps the selection, so the drag the press starts still has five models to move", () => {
    expect(inSelection(boxed, "m3")).toBe(true);
    expect(dragsSelection(boxed, "m3")).toBe(true);
  });

  it("starts a selection of its own when the model pressed is not in it", () => {
    expect(inSelection(boxed, "m9")).toBe(false);
    expect(dragsSelection(boxed, "m9")).toBe(false);
  });

  it("moves one model on its own when there is nothing to move with it", () => {
    expect(inSelection(new Set(["m1"]), "m1")).toBe(true);
    expect(dragsSelection(new Set(["m1"]), "m1")).toBe(false);
    expect(dragsSelection(new Set(), "m1")).toBe(false);
    expect(dragsSelection(undefined, "m1")).toBe(false);
  });

  it("treats a press on a unit rather than a model as a press on nothing selected", () => {
    expect(inSelection(boxed, undefined)).toBe(false);
    expect(dragsSelection(boxed, undefined)).toBe(false);
  });
});
