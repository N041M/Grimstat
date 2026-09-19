import { useCallback, useEffect, useRef, useState } from "react";
import { auth, type DeviceInfo } from "../services/auth";
import { sync } from "../services/sync";
import { useAuthUser, useSyncState } from "../hooks/useAccount";
import { SITE_URL } from "../components/shell";
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

export function ProfilePage() {
  const { notify } = useApp();
  const user = useAuthUser();
  const state = useSyncState();
  const { confirm, dialog } = useConfirm();
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "finishing">("idle");
  /** The code typed from the email, for a device the link cannot reach: the app on a home screen. */
  const [typed, setTyped] = useState("");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [handle, setHandle] = useState("");
  const [savingHandle, setSavingHandle] = useState(false);
  const finishing = useRef<string | undefined>(undefined);
  useEffect(() => setHandle(user.handle ?? ""), [user.handle]);
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

  const send = async (again = false): Promise<void> => {
    setPhase("sending");
    try {
      await auth().start(email);
      setPhase("sent");
      if (again) notify(t("profile.resent"), "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
      setPhase(again ? "sent" : "idle");
    }
  };

  /** The same sign-in as the link's, with the code typed rather than carried. */
  const finishTyped = async (): Promise<void> => {
    const code = typed.trim();
    if (!code) return;
    setPhase("finishing");
    try {
      const u = await auth().finish(code);
      setTyped("");
      notify(t("profile.welcome", { email: u.displayName }), "success");
      setPhase("idle");
    } catch (e) {
      if (e instanceof SignInDeclined) {
        notify(t("profile.declined"), "info");
        setPhase("idle");
      } else {
        notify(e instanceof Error ? e.message : String(e), "error");
        setPhase("sent");
      }
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

  const saveHandle = async (next: string): Promise<void> => {
    setSavingHandle(true);
    try {
      const u = await auth().setHandle(next);
      notify(u.handle ? t("profile.handleSaved", { url: `${SITE_URL}/u/${u.handle}` }) : t("profile.handleCleared"), "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSavingHandle(false);
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
              <>
                <p className="data-note">{t("profile.checkEmail", { email: email.trim() })}</p>
                <form
                  className="field-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void finishTyped();
                  }}
                >
                  <label className="grow">
                    <span className="t-meta">{t("profile.code")}</span>
                    <input type="text" inputMode="text" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} placeholder="abcd-efgh" value={typed} onChange={(e) => setTyped(e.target.value)} />
                  </label>
                  <button type="submit" className="primary" disabled={!typed.trim()}>
                    {t("profile.signInWithCode")}
                  </button>
                </form>
                <p className="data-note">{t("profile.homeScreenCode")}</p>
                <div className="data-actions">
                  <button type="button" onClick={() => void send(true)}>
                    {t("profile.resend")}
                  </button>
                  <button type="button" className="ghost" onClick={() => setPhase("idle")}>
                    {t("profile.changeEmail")}
                  </button>
                </div>
              </>
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
                <button type="submit" className="primary" disabled={phase === "sending" || !email.trim()}>
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

            <section aria-labelledby="profile-page-h">
              <PanelHead id="profile-page-h" title={t("profile.pageTitle")} />
              {user.handle ? (
                <p className="data-note">
                  {t("profile.pageAt")}{" "}
                  <a href={hrefFor("u", user.handle)}>
                    grimstat.com/u/{user.handle}
                  </a>
                </p>
              ) : (
                <p className="data-note">{t("profile.noHandle")}</p>
              )}
              <form
                className="field-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveHandle(handle);
                }}
              >
                <label className="grow">
                  <span className="t-meta">{t("profile.handle")}</span>
                  <input type="text" value={handle} maxLength={20} autoComplete="off" spellCheck={false} onChange={(e) => setHandle(e.target.value)} disabled={savingHandle} />
                </label>
                <button type="submit" disabled={savingHandle || handle.trim() === (user.handle ?? "")}>
                  {t("profile.setHandle")}
                </button>
                {user.handle ? (
                  <button type="button" className="ghost" disabled={savingHandle} onClick={() => void saveHandle("")}>
                    {t("profile.clearHandle")}
                  </button>
                ) : null}
              </form>
              <p className="data-note">{t("profile.handleHint")}</p>
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
