import { useState } from "react";
import { defineWidget, type WidgetProps } from "./registry";
import { Empty } from "../components/ui";
import { fmt } from "../lib/format";
import { t } from "../i18n";

export function WeaponBreakdown({ result, running }: WidgetProps) {
  const [open, setOpen] = useState<string | undefined>(undefined);
  if (!result) return <Empty>{running ? t("results.running") : t("results.none")}</Empty>;
  if (!result.weapons.length) return <Empty>{t("weapons.none")}</Empty>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t("weapons.name")}</th>
            <th className="num">{t("weapons.count")}</th>
            <th className="num">{t("weapons.attacks")}</th>
            <th className="num">{t("weapons.hits")}</th>
            <th className="num">{t("weapons.wounds")}</th>
            <th className="num">{t("weapons.unsaved")}</th>
            <th className="num">{t("weapons.damage")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {result.weapons.map((w, i) => {
            const key = `${w.name}#${i}`;
            const isOpen = open === key;
            return [
              <tr key={key}>
                <td>{w.name}</td>
                <td className="num">{w.count}</td>
                <td className="num">{fmt(w.expectedAttacks)}</td>
                <td className="num">{fmt(w.expectedHits)}</td>
                <td className="num">{fmt(w.expectedWounds)}</td>
                <td className="num">{fmt(w.expectedUnsaved)}</td>
                <td className="num">{fmt(w.expectedDamage)}</td>
                <td>
                  {w.trace.length ? (
                    <button type="button" className="sm ghost" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : key)}>
                      {isOpen ? t("weapons.hideTrace") : t("weapons.trace")}
                    </button>
                  ) : null}
                </td>
              </tr>,
              isOpen ? (
                <tr key={`${key}-trace`}>
                  <td colSpan={8}>
                    <table className="data">
                      <tbody>
                        {w.trace.map((s, j) => (
                          <tr key={j}>
                            <td className="muted">{s.label}</td>
                            <td className="num">{fmt(s.expected)}</td>
                            <td className="muted small">{s.note ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

export const weaponBreakdownWidget = defineWidget({
  id: "core.weapon-breakdown",
  title: t("widget.weapons"),
  description: t("widget.weapons.desc"),
  inputs: ["result"],
  defaultSize: { w: 7, h: 6 },
  render: WeaponBreakdown,
});
