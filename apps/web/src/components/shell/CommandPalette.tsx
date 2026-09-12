import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Roster, Scenario } from "@grimstat/schema";
import { unitFromDatasheet } from "@grimstat/game-40k-11e";
import { db } from "../../db";
import { useApp } from "../../state/AppContext";
import { navigate } from "../../router";
import type { useTheme } from "../../theme";
import { newScenario } from "../../lib/scenario";
import { loadSampleSnapshot } from "../../lib/snapshotSource";
import { fmt, fmtInt, fmtRelative } from "../../lib/format";
import { buildGroups, flattenGroups, stepIndex, type PaletteGroupId, type PaletteItem } from "../../lib/palette";
import { trapTab } from "../ui";
import { RAIL_ENTRIES } from "./IconRail";
import { requestNew } from "./ContextColumn";
import { t } from "../../i18n";

/** Scenarios, armies and units are long lists; the palette shows the most recent / first few. */
const SCENARIO_CAP = 6;
const ARMY_CAP = 6;
const UNIT_CAP = 12;

interface Command extends PaletteItem {
  run(): void;
}

/** Some stored scenarios carry a cached headline number; show it as the hint when they do. */
function storedExpectedDamage(s: Scenario): number | undefined {
  const v = (s as Scenario & { expectedDamage?: unknown }).expectedDamage;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function CommandPalette({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const { paletteOpen, openPalette, closePalette, snapshot, replaceScenario, updateScenario, notify, refreshSnapshots, setActiveSnapshot } = useApp();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Whatever opened the palette gets focus back when it closes; a route change closes it.
  useEffect(() => {
    if (!paletteOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onRoute = () => closePalette();
    window.addEventListener("hashchange", onRoute);
    return () => {
      window.removeEventListener("hashchange", onRoute);
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus({ preventScroll: true });
    };
  }, [paletteOpen, closePalette]);

  // ⌘K / Ctrl+K anywhere; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, openPalette, closePalette]);

  // Recent scenarios and armies are read once per opening so the lists are never stale.
  useEffect(() => {
    if (!paletteOpen) return;
    setQuery("");
    setActive(0);
    let alive = true;
    const byRecent = <T extends { updatedAt: string }>(all: T[]) => all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 40);
    void db.scenarios
      .toArray()
      .then((all) => {
        if (alive) setScenarios(byRecent(all));
      })
      .catch(() => undefined);
    void db.rosters
      .toArray()
      .then((all) => {
        if (alive) setRosters(byRecent(all));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [paletteOpen]);

  const close = useCallback(() => closePalette(), [closePalette]);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    for (const e of RAIL_ENTRIES) {
      out.push({
        id: `go:${e.route}`,
        group: "goto",
        glyph: e.glyph,
        label: t(e.labelKey),
        run: () => {
          close();
          navigate(e.route);
        },
      });
    }
    for (const s of scenarios) {
      const dmg = storedExpectedDamage(s);
      out.push({
        id: `sc:${s.id}`,
        group: "scenarios",
        glyph: "›",
        label: s.name,
        hint: dmg === undefined ? fmtRelative(s.updatedAt) : t("palette.dmgHint", { v: fmt(dmg, 1) }),
        run: () => {
          close();
          void replaceScenario(s, s.snapshotId).then(() => navigate("calculator"));
        },
      });
    }
    for (const r of rosters) {
      out.push({
        id: `army:${r.id}`,
        group: "armies",
        glyph: "›",
        label: r.name,
        hint: t("ctxcol.pointsLimit", { limit: fmtInt(r.pointsLimit) }),
        run: () => {
          close();
          navigate("armies", false, r.id);
        },
      });
    }
    for (const ds of snapshot?.data.datasheets ?? []) {
      out.push({
        id: `unit:${ds.id}`,
        group: "units",
        glyph: "›",
        label: ds.name,
        hint: snapshot?.data.factions.find((f) => f.id === ds.factionId)?.name ?? ds.factionId,
        run: () => {
          close();
          if (!snapshot) return;
          try {
            const unit = unitFromDatasheet(ds, snapshot);
            const side = unit.weapons.some((w) => w.enabled && w.count > 0) ? "attacker" : "defender";
            updateScenario((s) => ({ ...s, [side]: unit, snapshotId: snapshot.id }));
            navigate("calculator");
            notify(t(side === "attacker" ? "palette.unitAsAttacker" : "palette.unitAsDefender", { name: unit.name }), "success");
          } catch (err) {
            notify(t("palette.unitFailed", { name: ds.name }), "error", [err instanceof Error ? err.message : String(err)]);
          }
        },
      });
    }
    out.push({
      id: "act:new",
      group: "actions",
      glyph: "+",
      label: t("palette.newScenario"),
      run: () => {
        close();
        void replaceScenario(newScenario()).then(() => navigate("calculator"));
      },
    });
    out.push({
      id: "act:newArmy",
      group: "actions",
      glyph: "+",
      label: t("palette.newArmy"),
      run: () => {
        close();
        requestNew("armies");
      },
    });
    out.push({
      id: "act:resolve",
      group: "actions",
      glyph: "↻",
      label: t("palette.rerunExact"),
      run: () => {
        close();
        updateScenario((s) => ({ ...s, context: { ...s.context, backend: "exact" } }));
        navigate("calculator");
      },
    });
    out.push({
      id: "act:import",
      group: "actions",
      glyph: "↓",
      label: t("palette.importData"),
      run: () => {
        close();
        navigate("data");
      },
    });
    out.push({
      id: "act:sample",
      group: "actions",
      glyph: "↓",
      label: t("palette.loadSample"),
      run: () => {
        close();
        void (async () => {
          try {
            const s = loadSampleSnapshot();
            await db.snapshots.put(s);
            await refreshSnapshots();
            await setActiveSnapshot(s.id);
            notify(t("data.sampleLoaded", { label: s.label ?? s.id }), "success");
          } catch (err) {
            notify(err instanceof Error ? err.message : String(err), "error");
          }
        })();
      },
    });
    out.push({
      id: "act:overrides",
      group: "actions",
      glyph: "›",
      label: t("palette.openOverrides"),
      run: () => {
        close();
        navigate("data", false, "overrides");
      },
    });
    out.push({
      id: "act:theme",
      group: "actions",
      glyph: theme.resolved === "dark" ? "☀" : "☾",
      label: t(theme.resolved === "dark" ? "palette.themeLight" : "palette.themeDark"),
      run: () => {
        close();
        theme.setPreference(theme.resolved === "dark" ? "light" : "dark");
      },
    });
    return out;
  }, [scenarios, rosters, snapshot, theme, close, replaceScenario, updateScenario, notify, refreshSnapshots, setActiveSnapshot]);

  const labels = useMemo<Record<PaletteGroupId, string>>(() => ({ goto: t("palette.group.goto"), scenarios: t("palette.group.scenarios"), armies: t("palette.group.armies"), units: t("palette.group.units"), actions: t("palette.group.actions") }), []);
  const groups = useMemo(() => buildGroups(commands, query, labels, { scenarios: SCENARIO_CAP, armies: ARMY_CAP, units: UNIT_CAP }), [commands, query, labels]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const activeId = flat[Math.min(active, flat.length - 1)]?.id;

  useEffect(() => {
    if (!paletteOpen) return;
    listRef.current?.querySelector<HTMLElement>(".pal-row.active")?.scrollIntoView({ block: "nearest" });
  }, [activeId, paletteOpen]);

  if (!paletteOpen) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      if (panelRef.current) trapTab(e, panelRef.current);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => stepIndex(flat.length, Math.min(i, flat.length - 1), 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => stepIndex(flat.length, Math.min(i, flat.length - 1), -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[Math.min(active, flat.length - 1)]?.run();
    }
  };

  return (
    <div className="pal-backdrop" onClick={close} role="presentation">
      <div className="pal-panel" role="dialog" aria-modal="true" aria-label={t("palette.open")} ref={panelRef} onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="pal-search">
          <span className="pal-diamond" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="pal-input"
            value={query}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            aria-activedescendant={activeId ? `pal-${activeId}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          <span className="pal-esc" aria-hidden="true">
            esc
          </span>
        </div>
        <div className="pal-results" ref={listRef} role="listbox" aria-label={t("palette.results")}>
          {groups.map((g) => (
            <div key={g.id} className="pal-group">
              <div className="pal-group-label">{g.label}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  id={`pal-${it.id}`}
                  type="button"
                  role="option"
                  aria-selected={it.id === activeId}
                  className={`pal-row ${it.id === activeId ? "active" : ""}`.trim()}
                  onMouseMove={() => setActive(flat.findIndex((f) => f.id === it.id))}
                  onClick={it.run}
                >
                  <span className="pal-glyph" aria-hidden="true">
                    {it.glyph}
                  </span>
                  <span className="pal-label">{it.label}</span>
                  {it.hint ? <span className="pal-hint">{it.hint}</span> : null}
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 ? <div className="pal-empty">{t("palette.empty")}</div> : null}
        </div>
        <div className="pal-foot">
          <span>{t("palette.footOpen")}</span>
          <span>{t("palette.footRun")}</span>
          <span>{t("palette.footSolve")}</span>
        </div>
      </div>
    </div>
  );
}
