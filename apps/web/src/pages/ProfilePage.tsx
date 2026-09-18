import { useCallback, useEffect, useRef, useState } from "react";
import { auth, type DeviceInfo, type UserInfo } from "../services/auth";
import { sync, type SyncState } from "../services/sync";
import { SignInDeclined } from "../lib/accountService";
import { fmtRelative } from "../lib/format";
import { hrefFor, navigate, useRouteInfo } from "../router";
import { PageHeader } from "../components/shell";
import { useConfirm } from "../components/ui";
import { PanelHead } from "../components/kit";
import { useApp } from "../state/AppContext";
import { t } from "../i18n";

/** The time a paused sync resumes, as the reader's clock shows it. */
export function fmtResume(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function useAuthUser(): UserInfo {
  const [user, setUser] = useState(() => auth().currentUser());
  useEffect(() => auth().subscribe(setUser), []);
  return user;
}

function useSyncState(): SyncState {
  const [state, setState] = useState(() => sync().state());
  useEffect(() => {
    setState(sync().state());
    return sync().subscribe(setState);
  }, []);
  return state;
}

export function ProfilePage() {
  const { notify } = useApp();
  const user = useAuthUser();
  const state = useSyncState();
  const { confirm, dialog } = useConfirm();
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "finishing">("idle");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const finishing = useRef<string | undefined>(undefined);
  const code = useRouteInfo().query.get("code");

  // The sign-in link lands here with `?code=`, whether the page was open already or not. The code
  // is used once and taken off the address.
  useEffect(() => {
    if (!code || finishing.current === code) return;
    finishing.current = code;
    setPhase("finishing");
    void (async () => {
      try {
        const u = await auth().finish(code);
        notify(t("profile.welcome", { email: u.displayName }), "success");
      } catch (e) {
        if (e instanceof SignInDeclined) notify(t("profile.declined"), "info");
        else notify(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setPhase("idle");
        navigate("profile", true);
      }
    })();
  }, [code, notify]);

  const loadDevices = useCallback(async () => {
    if (user.anonymous) {
      setDevices([]);
      return;
    }
    try {
      setDevices(await auth().devices());
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  }, [user.anonymous, notify]);
  useEffect(() => void loadDevices(), [loadDevices]);

  const send = async (): Promise<void> => {
    setPhase("sending");
    try {
      await auth().start(email);
      setPhase("sent");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
      setPhase("idle");
    }
  };

  const remove = async (): Promise<void> => {
    if (!(await confirm({ title: t("profile.deleteTitle"), body: t("profile.deleteBody", { email: user.displayName }), confirmLabel: t("profile.delete"), danger: true }))) return;
    try {
      await auth().deleteAccount();
      notify(t("profile.deleted"), "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const statusLine = (): string => {
    switch (state.status) {
      case "syncing":
        return t("sync.syncing");
      case "paused":
        return t("sync.paused", { time: state.pausedUntil ? fmtResume(state.pausedUntil) : "" });
      case "error":
        return t("sync.error", { error: state.error ?? "" });
      default:
        return state.lastSyncedAt ? t("profile.lastSynced", { when: fmtRelative(state.lastSyncedAt) }) : t("profile.neverSynced");
    }
  };

  return (
    <>
      <PageHeader title={t("profile.title")} subtitle={user.anonymous ? t("page.sub.profile.out") : t("page.sub.profile.in", { email: user.displayName })} />
      <div className="page-body profile-page">
        {user.anonymous ? (
          <section className="about-card" aria-labelledby="profile-signin-h">
            <h2 className="t-eyebrow" id="profile-signin-h">
              {t("profile.signIn")}
            </h2>
            <p className="about-card-body prose">{t("profile.what")}</p>
            {phase === "finishing" ? (
              <p className="data-note">{t("profile.finishing")}</p>
            ) : phase === "sent" ? (
              <p className="data-note">{t("profile.checkEmail")}</p>
            ) : (
              <form
                className="field-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label className="grow">
                  <span className="t-meta">{t("profile.email")}</span>
                  <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={phase === "sending"} />
                </label>
                <button type="submit" className="primary" data-tour="profile-signin" disabled={phase === "sending" || !email.trim()}>
                  {phase === "sending" ? t("profile.sending") : t("profile.sendLink")}
                </button>
              </form>
            )}
          </section>
        ) : (
          <>
            <section aria-labelledby="profile-sync-h">
              <PanelHead id="profile-sync-h" title={t("profile.syncTitle")} aside={<span className="t-meta">{statusLine()}</span>} />
              <div className="data-actions">
                <button type="button" disabled={state.status === "syncing"} onClick={() => void sync().syncNow()}>
                  {t("profile.syncNow")}
                </button>
                <button type="button" onClick={() => void auth().signOut()}>
                  {t("profile.signOut")}
                </button>
              </div>
            </section>

            <section aria-labelledby="profile-devices-h">
              <PanelHead id="profile-devices-h" title={t("profile.devicesTitle")} />
              <ul className="profile-devices">
                {devices.map((d) => (
                  <li key={d.id}>
                    <span className="grow">
                      <strong>{d.deviceName}</strong> {d.current ? <span className="badge accent">{t("profile.thisDevice")}</span> : null}
                      <span className="small muted"> · {t("profile.lastSeen", { when: fmtRelative(d.lastSeenAt) })}</span>
                    </span>
                    {d.current ? null : (
                      <button
                        type="button"
                        className="sm"
                        onClick={() =>
                          void auth()
                            .signOutDevice(d.id)
                            .then(loadDevices)
                            .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e), "error"))
                        }
                      >
                        {t("profile.signOutDevice")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="profile-data-h">
              <PanelHead id="profile-data-h" title={t("profile.dataTitle")} />
              <p className="data-note">
                {t("profile.backup")} <a href={hrefFor("data")}>{t("nav.data")}</a>
              </p>
              <p className="data-note">
                {t("profile.privacy")} <a href={hrefFor("about")}>{t("nav.about")}</a>
              </p>
              <div className="data-actions">
                <button type="button" className="danger" onClick={() => void remove()}>
                  {t("profile.delete")}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
      {dialog}
    </>
  );
}
