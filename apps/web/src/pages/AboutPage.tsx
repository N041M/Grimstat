import { currentPlan } from "@grimstat/entitlements";
import { gameSystem, manifest } from "@grimstat/game-40k-11e";
import { host } from "../plugin";
import { hrefFor } from "../router";
import { PageHeader, REPO_URL } from "../components/shell";
import { t, type I18nKey } from "../i18n";

/**
 * Build-time facts (vite.config.ts `define`). The identifiers are substituted at compile time, so
 * they are read directly — a `globalThis` lookup would not be replaced by the bundler — and each is
 * guarded with `typeof` so the module still loads anywhere nothing defines them.
 */
const TESTS = typeof __GS_TESTS__ === "number" ? String(__GS_TESTS__) : undefined;
const PACKAGES = typeof __GS_PACKAGES__ === "number" ? String(__GS_PACKAGES__) : undefined;
const BUNDLE = typeof __GS_BUNDLE__ === "string" ? __GS_BUNDLE__ : undefined;

/** The placeholder token survives untouched in dev, where there is no bundle to measure. */
function bundleLabel(): string {
  return !BUNDLE || BUNDLE.startsWith("__GS_") ? t("about.stat.devBuild") : BUNDLE;
}

const APP_VERSION = "0.1.0";

export function AboutPage() {
  const plugins = [...host.registries.manifests.values()];
  const stats: Array<{ key: I18nKey; value: string; title: string }> = [
    { key: "about.stat.tests", value: TESTS ?? "—", title: t("about.stat.testsTitle") },
    { key: "about.stat.packages", value: PACKAGES ?? "—", title: t("about.stat.packagesTitle") },
    { key: "about.stat.bundle", value: bundleLabel(), title: t("about.stat.bundleTitle") },
    { key: "about.stat.dataShipped", value: t("about.stat.zero"), title: t("about.stat.dataShippedTitle") },
  ];

  return (
    <>
      <PageHeader title={t("about.title")} subtitle={t("page.sub.about", { v: APP_VERSION })} />
      <div className="page-body about-col">
        <p className="about-lede prose">{t("about.what1")}</p>
        <p className="about-lede prose">{t("about.what2")}</p>

        <section className="about-card" aria-labelledby="about-policy-h">
          <h2 className="t-eyebrow" id="about-policy-h">
            {t("about.dataTitle")}
          </h2>
          <p className="about-card-body prose">{t("about.data1")}</p>
          <p className="about-card-body prose">{t("about.data2")}</p>
        </section>

        <div className="about-stats">
          {stats.map((s) => (
            <div key={s.key} className="about-stat" title={s.title}>
              <div className="about-stat-k">{t(s.key)}</div>
              <div className="about-stat-v">{s.value}</div>
            </div>
          ))}
        </div>

        <section className="about-card" aria-labelledby="about-getdata-h">
          <h2 className="t-eyebrow" id="about-getdata-h">
            {t("about.getDataTitle")}
          </h2>
          <ul className="about-list prose">
            <li>{t("about.getData1")}</li>
            <li>{t("about.getData2")}</li>
            <li>{t("about.getData3")}</li>
          </ul>
          <p className="about-links">
            <a href={hrefFor("data")}>{t("about.getDataLink")}</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {t("about.repoLink")}
            </a>
          </p>
        </section>

        <section className="about-card" aria-labelledby="about-system-h">
          <h2 className="t-eyebrow" id="about-system-h">
            {t("about.systemTitle")}
          </h2>
          <dl className="about-kv">
            <dt>{t("about.gameSystem")}</dt>
            <dd>
              {gameSystem.name} — {t("about.edition", { e: gameSystem.edition })} ({manifest.id}@{manifest.version})
            </dd>
            <dt>{t("about.plugins")}</dt>
            <dd>{plugins.map((p) => `${p.id}@${p.version} (${p.kind})`).join(", ")}</dd>
            <dt>{t("about.plan")}</dt>
            <dd>{currentPlan()}</dd>
          </dl>
        </section>

        <p className="about-legal prose">{t("footer.disclaimer")}</p>
      </div>
    </>
  );
}
