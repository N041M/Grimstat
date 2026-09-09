import { currentPlan } from "@grimstat/entitlements";
import { gameSystem, manifest } from "@grimstat/game-40k-11e";
import { host } from "../plugin";
import { t } from "../i18n";

export function AboutPage() {
  const plugins = [...host.registries.manifests.values()];
  return (
    <div className="stack about">
      <div className="page-head">
        <div>
          <h1>{t("nav.about")}</h1>
          <p>{t("about.tagline")}</p>
        </div>
      </div>
      <section className="panel">
        <h2>{t("about.whatTitle")}</h2>
        <p>{t("about.what1")}</p>
        <p>{t("about.what2")}</p>
      </section>
      <section className="panel">
        <h2>{t("about.dataTitle")}</h2>
        <p>{t("about.data1")}</p>
        <p>{t("about.data2")}</p>
      </section>
      <section className="panel">
        <h2>{t("about.systemTitle")}</h2>
        <dl className="kv">
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
      <section className="panel">
        <h2>{t("about.legalTitle")}</h2>
        <p>{t("footer.disclaimer")}</p>
      </section>
    </div>
  );
}
