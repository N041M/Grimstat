import { useEffect, useMemo, useState } from "react";
import { Roster, type Snapshot } from "@grimstat/schema";
import { rosterSummary } from "@grimstat/resolver";
import { api, ApiError } from "../lib/account";
import { encodeRosterPermalink, ROSTER_PERMALINK_PARAM } from "../lib/rosterPermalink";
import { battleSizeKey } from "./ArmiesPage";
import { fmtDay, fmtInt } from "../lib/format";
import { useAuthUser } from "../hooks/useAccount";
import { PageHeader } from "../components/shell";
import { Empty } from "../components/ui";
import { ProportionBar } from "../components/kit";
import { useApp } from "../state/AppContext";
import { hrefFor } from "../router";
import { t, tn } from "../i18n";

interface PublicArmy {
  roster: unknown;
  updatedAt: string;
}

interface PublicProfile {
  handle: string;
  armies: PublicArmy[];
}

/**
 * Somebody's public page: the armies they marked as shared, as the server sends them, rendered
 * here against whatever snapshot this device holds. The server sends unit ids and counts and
 * never a datasheet, so names and points come from the viewer's own data, and without any data
 * the page still shows the list with what the roster carries itself.
 */
export function PublicProfilePage({ handle }: { handle: string | undefined }) {
  const { snapshot } = useApp();
  const me = useAuthUser();
  const [state, setState] = useState<"loading" | "missing" | "error" | "ready">("loading");
  const [page, setPage] = useState<PublicProfile | undefined>(undefined);

  useEffect(() => {
    if (!handle) {
      setState("missing");
      return;
    }
    let alive = true;
    setState("loading");
    api<PublicProfile>((input, init) => fetch(input, init), "GET", `/api/u/${encodeURIComponent(handle)}`)
      .then((p) => {
        if (!alive) return;
        setPage(p);
        setState("ready");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState(e instanceof ApiError && e.status === 404 ? "missing" : "error");
      });
    return () => {
      alive = false;
    };
  }, [handle]);

  const rows = useMemo(() => {
    if (!page) return [];
    return page.armies.flatMap((a) => {
      const parsed = Roster.safeParse(a.roster);
      if (!parsed.success) return [];
      const r = parsed.data;
      const s: Snapshot | undefined = snapshot;
      const faction = s?.data.factions.find((f) => f.id === r.factionId)?.name ?? r.factionId;
      let points: number | undefined;
      if (s) {
        try {
          points = rosterSummary(r, s).points;
        } catch {
          points = undefined;
        }
      }
      return [{ r, faction, points, updatedAt: a.updatedAt }];
    });
  }, [page, snapshot]);

  const mine = !me.anonymous && me.handle !== undefined && me.handle !== null && me.handle === page?.handle;

  return (
    <>
      <PageHeader title={page?.handle ?? handle ?? ""} subtitle={state === "ready" ? tn(rows.length, "public.armies.one", "public.armies.many") : ""} />
      <div className="page-body stack">
        {state === "loading" ? <p className="data-note">{t("public.loading")}</p> : null}
        {state === "missing" ? <Empty>{t("public.missing")}</Empty> : null}
        {state === "error" ? <Empty>{t("public.error")}</Empty> : null}
        {state === "ready" && mine ? (
          <p className="data-note">
            {t("public.yours")} <a href={hrefFor("profile")}>{t("nav.profile")}</a>
          </p>
        ) : null}
        {state === "ready" && !snapshot && rows.length ? (
          <p className="data-note">
            {t("public.noData")} <a href={hrefFor("data")}>{t("nav.data")}</a>
          </p>
        ) : null}
        {state === "ready" && rows.length === 0 ? <Empty>{t("public.empty")}</Empty> : null}
        {state === "ready" && rows.length ? (
          <div className="army-cards">
            {rows.map(({ r, faction, points, updatedAt }) => (
              <article key={r.id} className="army-card">
                <div className="army-card-top">
                  <a href={`${hrefFor("armies")}?${ROSTER_PERMALINK_PARAM}=${encodeRosterPermalink({ roster: r, snapshotId: r.snapshotId })}`} className="army-card-title">
                    {r.name}
                  </a>
                </div>
                <div className="army-card-kind">
                  {faction} · {t(battleSizeKey(r.battleSize))}
                </div>
                <ProportionBar value={points === undefined ? 0 : points / Math.max(1, r.pointsLimit)} height={5} tone="ink" title={t("roster.meter.aria", { points: fmtInt(points ?? 0), limit: fmtInt(r.pointsLimit) })} />
                <div className="army-card-foot">
                  <span className="army-card-pts">
                    {points === undefined ? "–" : fmtInt(points)} / {fmtInt(r.pointsLimit)}
                  </span>
                  <span>{tn(r.units.length, "armies.unitCount.one", "armies.unitCount.many")}</span>
                  <span className="army-card-when">{fmtDay(updatedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
