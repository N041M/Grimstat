/**
 * The routes. Everything under /api answers JSON; /l/<id> answers a redirect.
 *
 * The app is built once per host from its `Deps`, and the host decides what those are: D1 and
 * Resend on Cloudflare, SQLite and the console on Node, fakes in tests.
 *
 * Before any route runs, a request passes four gates, in this order: the response headers that
 * every answer carries, the origin check on a request that changes something, the per-address rate
 * limit for its kind, and the size limit on its body. Each is a plain refusal with a sentence.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { AuthError, deleteAccount, devices, finish, sessionFor, signOut, start, type Session } from "./auth";
import { isDailyLimit } from "./db";
import type { Deps } from "./deps";
import type { RateBucket } from "./limits";
import { createLink, LinkError, LinkRequest, resolveLink } from "./links";
import { sync, SyncError, SyncRequest } from "./sync";

type Vars = { session?: Session };
type Env = { Variables: Vars };
type App = Hono<Env>;

const StartRequest = z.object({ email: z.string().min(3).max(254) });
const FinishRequest = z.object({ code: z.string().min(16).max(128), device: z.string().max(200).default("") });

/** Request bodies larger than these are refused before they are read. */
const BODY_SMALL = 4 * 1024;
const BODY_LINK = 32 * 1024;
const BODY_SYNC = 12 * 1024 * 1024;

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Where a request came from, as the host reports it. */
function ipOf(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** The request's JSON body, or a 400 when it is not one. */
async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new Refused(400, "The request was not understood.");
  }
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

/**
 * A browser names the page a request came from. One from another site is refused, so no other
 * site can make a visitor's browser spend this server's allowances. A request naming no origin,
 * as a command-line tool sends, passes: it carries no one's credentials but its own.
 */
function originGate(deps: Deps): MiddlewareHandler<Env> {
  const allowed = new Set([new URL(deps.appUrl).origin, ...(deps.extraOrigins ?? [])]);
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
    const site = c.req.header("sec-fetch-site");
    if (site === "cross-site") throw new Refused(403, "Requests from other sites are not accepted.");
    const origin = c.req.header("origin");
    if (origin && !allowed.has(origin)) throw new Refused(403, "Requests from other sites are not accepted.");
    return next();
  };
}

function rateGate(deps: Deps, bucket: RateBucket): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!(await deps.limiter.allow(bucket, ipOf(c)))) throw new Refused(429, "Too many requests from this address. Try again in a minute.");
    return next();
  };
}

const sized = (maxSize: number): MiddlewareHandler<Env> => bodyLimit({ maxSize, onError: (c) => c.json({ error: "The request is too large." }, 413) });

export function createApp(deps: Deps): App {
  const app: App = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof Refused || err instanceof AuthError || err instanceof SyncError || err instanceof LinkError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: "The request was not understood.", issues: err.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    if (isDailyLimit(err)) return c.json({ error: "Sync is paused until the daily allowance resets.", pausedUntil: nextReset(deps.now()) }, 503);
    console.error(err instanceof Error ? err.message : String(err));
    return c.json({ error: "Something went wrong on the server." }, 500);
  });

  // Every answer: no caching, no framing, no sniffing, nothing referred, no script in it.
  app.use("*", secureHeaders({ contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] }, referrerPolicy: "no-referrer", xFrameOptions: "DENY" }));
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/api/*", originGate(deps));
  app.use("/api/auth/*", rateGate(deps, "auth"), sized(BODY_SMALL));
  app.use("/api/links", rateGate(deps, "links"), sized(BODY_LINK));
  app.use("/api/sync", rateGate(deps, "api"), sized(BODY_SYNC));
  app.use("/api/me", rateGate(deps, "api"));
  app.use("/api/sessions/*", rateGate(deps, "api"));
  app.use("/l/*", rateGate(deps, "links"));

  app.get("/api/health", (c) => c.json({ ok: true }));

  // ---- signing in ----

  app.post("/api/auth/start", async (c) => {
    const { email } = StartRequest.parse(await readJson(c));
    await start(deps, email, ipOf(c));
    return c.json({ ok: true });
  });

  app.post("/api/auth/finish", async (c) => {
    const { code, device } = FinishRequest.parse(await readJson(c));
    const { token, session } = await finish(deps, code, device);
    return c.json({ token, session });
  });

  // ---- everything below needs a session ----

  const signedIn = async (c: Context<Env>): Promise<Session> => {
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
    const req = SyncRequest.parse(await readJson(c));
    return c.json(await sync(deps, session.user.id, req));
  });

  // ---- short links, with or without an account ----

  app.post("/api/links", async (c) => {
    const session = await sessionFor(deps, bearer(c));
    const req = LinkRequest.parse(await readJson(c));
    return c.json(await createLink(deps, req, session?.user.id, ipOf(c)));
  });

  app.get("/l/:id", async (c) => {
    const target = await resolveLink(deps, c.req.param("id"));
    if (!target) return c.text("This link has expired or never existed.", 404);
    return c.redirect(target, 302);
  });

  return app;
}
