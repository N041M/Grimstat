/**
 * Units the player saved to use again.
 *
 * The app already had three ways to put a unit on screen and none of them remembered anything: a
 * datasheet resolves to its default loadout every time, an archetype is a fixed generic profile,
 * and a custom unit is typed out by hand and thrown away with the scenario. A preset is the fourth:
 * whatever is configured right now, under a name, for the picker and the analysis sets to offer.
 *
 * What is stored is the unit itself, not a reference to the sheet it came from. That is the point —
 * a reference would resolve back to the defaults and lose the loadout, which is the only thing the
 * player was trying to keep. The datasheet is recorded beside it so the preset can still say where
 * it came from and be filtered by faction.
 */

import type { ScenarioUnit, Snapshot } from "@grimstat/schema";
import type { UnitPresetRecord } from "../db";
import { cloneUnit, modelCount } from "./scenario";
import { newId, nowIso } from "./ids";

/** A new preset holding `unit` as it stands, with the datasheet it came from when it has one. */
export function newPreset(name: string, unit: ScenarioUnit, snapshot?: Snapshot): UnitPresetRecord {
  const at = nowIso();
  const datasheetId = unit.ref?.datasheetId;
  const datasheet = datasheetId && snapshot ? snapshot.data.datasheets.find((d) => d.id === datasheetId) : undefined;
  return {
    id: newId("up"),
    name: name.trim() || unit.name,
    createdAt: at,
    updatedAt: at,
    unit: cloneUnit(unit),
    ...(unit.ref ? { snapshotId: unit.ref.snapshotId } : {}),
    ...(datasheetId ? { datasheetId } : {}),
    ...(datasheet ? { factionId: datasheet.factionId } : {}),
  };
}

/** The same preset carrying `unit` instead, keeping its id and the day it was first saved. */
export function replacePresetUnit(preset: UnitPresetRecord, unit: ScenarioUnit, snapshot?: Snapshot): UnitPresetRecord {
  return { ...newPreset(preset.name, unit, snapshot), id: preset.id, createdAt: preset.createdAt };
}

/** Case- and space-insensitive name match, so saving over "My Intercessors" does not make a second one. */
export const samePresetName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export const findPresetByName = (presets: readonly UnitPresetRecord[], name: string): UnitPresetRecord | undefined => presets.find((p) => samePresetName(p.name, name));

/**
 * A name for a preset the player has not named: the unit's own name, with a number after it if that
 * is taken. Saving a second squad of Intercessors should not silently overwrite the first.
 */
export function suggestPresetName(unit: ScenarioUnit, presets: readonly UnitPresetRecord[]): string {
  const base = unit.name.trim() || "Unit";
  if (!findPresetByName(presets, base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!findPresetByName(presets, candidate)) return candidate;
  }
  return base;
}

/** The weapons a preset actually fires, by name, in the order they are listed. */
export function presetWeaponNames(unit: ScenarioUnit): string[] {
  return unit.weapons.filter((w) => w.enabled && w.count > 0).map((w) => (w.count > 1 ? `${w.count}× ${w.name}` : w.name));
}

/**
 * One line describing a preset, for the row under its name: how many models, what they carry and
 * what it costs. The weapon list is what distinguishes two presets of the same datasheet, so it is
 * the part that gets the room.
 */
export function presetSummary(preset: UnitPresetRecord): { models: number; weapons: string[]; points: number | undefined } {
  return { models: modelCount(preset.unit), weapons: presetWeaponNames(preset.unit), points: preset.unit.points };
}
