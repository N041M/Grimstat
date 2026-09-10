import { defineWidget, type WidgetProps } from "./registry";
import { Empty } from "../components/ui";
import { t } from "../i18n";

export function Warnings({ result, error }: WidgetProps) {
  const items = [...(error ? [error] : []), ...(result?.warnings ?? [])];
  if (!items.length) return <Empty>{t("warnings.none")}</Empty>;
  return (
    <ul className="small" style={{ margin: 0, paddingLeft: "1.2rem" }}>
      {items.map((w, i) => (
        <li key={i} style={error && i === 0 ? { color: "var(--danger)" } : undefined}>
          {w}
        </li>
      ))}
    </ul>
  );
}

export const warningsWidget = defineWidget({
  id: "core.warnings",
  title: t("widget.warnings"),
  description: t("widget.warnings.desc"),
  inputs: ["result"],
  defaultSize: { w: 6, h: 6 },
  render: Warnings,
});
