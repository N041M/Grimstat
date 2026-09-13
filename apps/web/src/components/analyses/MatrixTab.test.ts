import { describe, expect, it } from "vitest";
import { shouldRunIndex, solveLabel } from "./MatrixTab";

const matrix = { cells: [] };
const index = [{ unit: "Intercessors", pointsToRemove: 80 }];

describe("shouldRunIndex", () => {
  it("waits for the matrix to stop before measuring its defenders", () => {
    expect(shouldRunIndex({ result: undefined, running: true }, { result: undefined, running: false }, 3)).toBe(false);
    expect(shouldRunIndex({ result: matrix, running: true }, { result: undefined, running: false }, 3)).toBe(false);
  });

  it("starts once a matrix result is in hand", () => {
    expect(shouldRunIndex({ result: matrix, running: false }, { result: undefined, running: false }, 3)).toBe(true);
  });

  it("leaves an index that is there, or already on its way, alone", () => {
    expect(shouldRunIndex({ result: matrix, running: false }, { result: index, running: false }, 3)).toBe(false);
    expect(shouldRunIndex({ result: matrix, running: false }, { result: undefined, running: true }, 3)).toBe(false);
  });

  it("has nothing to measure without defenders", () => {
    expect(shouldRunIndex({ result: matrix, running: false }, { result: undefined, running: false }, 0)).toBe(false);
  });

  /*
   * Cancelling clears the running flag and nothing else, so the matrix result keeps the identity it
   * had. Reading the result alone therefore never noticed the run had ended and the card stayed
   * empty beside a matrix that was still on screen.
   */
  it("fills the card again after a second run is cancelled", () => {
    // A finished matrix with its index beside it.
    let task = { result: matrix, running: false };
    let durability: { result: unknown; running: boolean } = { result: index, running: false };
    expect(shouldRunIndex(task, durability, 2)).toBe(false);
    // Run again: the card is emptied, and the matrix on screen stays until the new one arrives.
    durability = { result: undefined, running: false };
    task = { result: matrix, running: true };
    expect(shouldRunIndex(task, durability, 2)).toBe(false);
    // Cancel.
    task = { result: matrix, running: false };
    expect(shouldRunIndex(task, durability, 2)).toBe(true);
  });

  it("fills the card again after a second run fails", () => {
    const durability = { result: undefined, running: false };
    expect(shouldRunIndex({ result: matrix, running: true }, durability, 2)).toBe(false);
    expect(shouldRunIndex({ result: matrix, running: false }, durability, 2)).toBe(true);
  });
});

describe("solveLabel", () => {
  // The engine falls back to sampling on its own, and a sampled cell is formatted exactly like an
  // exact one, so the heading is the only place a reader can tell the two apart. It used to read
  // "exact solve" whatever the cells held.
  const cell = (backend: "exact" | "mc") => ({ attacker: "a", defender: "d", result: { backend } });
  const grid = (...backends: Array<"exact" | "mc">) => ({ attackers: ["a"], defenders: [], cells: [backends.map(cell)] }) as never;

  it("says the solve was exact when every cell was solved exactly", () => {
    expect(solveLabel(grid("exact", "exact"))).toBe("exact solve");
  });

  it("counts the cells that had to be sampled", () => {
    expect(solveLabel(grid("exact", "mc", "mc"))).toBe("2 of 3 cells sampled");
  });

  it("counts a grid that was sampled throughout", () => {
    expect(solveLabel(grid("mc", "mc"))).toBe("2 of 2 cells sampled");
  });

  it("says the solve was exact before a run has happened", () => {
    expect(solveLabel(undefined)).toBe("exact solve");
  });
});
