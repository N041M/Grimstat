/**
 * The routes. Everything under /api answers JSON; /l/<id> answers a redirect.
 *
 * The app is built once per host from its `Deps`, and the host decides what those are: D1 and
 * Resend on Cloudflare, SQLite and the console on Node, fakes in tests.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AuthError, deleteAccount, devices, finish, sessionFor, signOut, start, type Session } from "./auth";
import { isDailyLimit } from "./db";
import type { Deps } from "./deps";
import { createLink, LinkError, LinkRequest, resolveLink } from "./links";
import { sync, SyncError, SyncRequest } from "./sync";

type Vars = { session?: Session };
type App = Hono<{ Variables: Vars }>;

const StartRequest = z.object({ email: z.string().min(3).max(254) });
const FinishRequest = z.object({ code: z.string().min(16).max(128), device: z.string().max(200).default("") });

/** Where a request came from, as the host reports it. */
function ipOf(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function bearer(c: Context): string | undefined {
  const h = c.req.header("authorization");
  return h?.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : undefined;
}

/** Midnight UTC after `now`, when Cloudflare's daily allowances start again. */
export function nextReset(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

export function createApp(deps: Deps): App {
  const app: App = new Hono<{ Variables: Vars }>();

  app.onError((err, c) => {
    if (err instanceof AuthError || err instanceof SyncError || err instanceof LinkError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: "The request was not understood.", issues: err.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    if (isDailyLimit(err)) return c.json({ error: "Sync is paused until the daily allowance resets.", pausedUntil: nextReset(deps.now()) }, 503);
    console.error(err);
    return c.json({ error: "Something went wrong on the server." }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  // ---- signing in ----

  app.post("/api/auth/start", async (c) => {
    const { email } = StartRequest.parse(await c.req.json());
    await start(deps, email, ipOf(c));
    return c.json({ ok: true });
  });

  app.post("/api/auth/finish", async (c) => {
    const { code, device } = FinishRequest.parse(await c.req.json());
    const { token, session } = await finish(deps, code, device);
    return c.json({ token, session });
  });

  // ---- everything below needs a session ----

  const signedIn = async (c: Context<{ Variables: Vars }>): Promise<Session> => {
    const session = await sessionFor(deps, bearer(c));
    if (!session) throw new AuthError(401, "Sign in to continue.");
    return session;
  };

  app.get("/api/me", async (c) => {
    const session = await signedIn(c);
    const list = await devices(deps, session.user.id);
    return c.json({ session, devices: list.map((d) => ({ ...d, current: d.id === session.id })) });
  });

  app.post("/api/auth/signout", async (c) => {
    const session = await signedIn(c);
    await signOut(deps, session.user.id, session.id);
    return c.json({ ok: true });
  });

  app.delete("/api/sessions/:id", async (c) => {
    const session = await signedIn(c);
    await signOut(deps, session.user.id, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.delete("/api/me", async (c) => {
    const session = await signedIn(c);
    await deleteAccount(deps, session.user.id);
    return c.json({ ok: true });
  });

  app.post("/api/sync", async (c) => {
    const session = await signedIn(c);
    const req = SyncRequest.parse(await c.req.json());
    return c.json(await sync(deps, session.user.id, req));
  });

  // ---- short links, with or without an account ----

  app.post("/api/links", async (c) => {
    const session = await sessionFor(deps, bearer(c));
    const req = LinkRequest.parse(await c.req.json());
    return c.json(await createLink(deps, req, session?.user.id, ipOf(c)));
  });

  app.get("/l/:id", async (c) => {
    const target = await resolveLink(deps, c.req.param("id"));
    if (!target) return c.text("This link has expired or never existed.", 404);
    return c.redirect(target, 302);
  });

  return app;
}
