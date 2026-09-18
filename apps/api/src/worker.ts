/**
 * The Cloudflare entry. The Worker is the same one that serves the site's files: a request for a
 * file never reaches this code, and only /api and /l do (`run_worker_first` in the web app's
 * wrangler.jsonc). Bindings are stable for the life of the isolate, so the app is built once.
 * The nightly cron runs the purge.
 *
 * Bindings and settings, in wrangler.jsonc and the dashboard:
 *   DB                          the D1 database
 *   AUTH_RL, API_RL, LINKS_RL   rate-limit bindings, one per kind of request
 *   APP_URL                     where the app is served from, for the links in emails
 *   APP_ORIGINS                 other origins the app runs from, comma-separated: the phone app's
 *   MAIL_FROM                   the sender, such as "Grimstat <hello@grimstat.com>"
 *   RESEND_API_KEY              secret
 *   IP_SALT                     secret, any long random string
 */
import { createApp } from "./app";
import { d1Db, type D1Like } from "./db";
import type { Deps } from "./deps";
import { bindingLimiter, type RateLimitBinding } from "./limits";
import { resendMailer, unconfiguredMailer } from "./mail";
import { purge } from "./purge";

interface Env {
  DB: D1Like;
  AUTH_RL?: RateLimitBinding;
  API_RL?: RateLimitBinding;
  LINKS_RL?: RateLimitBinding;
  APP_URL: string;
  APP_ORIGINS?: string;
  MAIL_FROM: string;
  RESEND_API_KEY?: string;
  IP_SALT?: string;
}

let deps: Deps | undefined;
let app: ReturnType<typeof createApp> | undefined;

function depsFrom(env: Env): Deps {
  deps ??= {
    db: d1Db(env.DB),
    mail: env.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : unconfiguredMailer,
    appUrl: env.APP_URL.replace(/\/$/, ""),
    extraOrigins: (env.APP_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    ipSalt: env.IP_SALT ?? "unsalted",
    limiter: bindingLimiter({ auth: env.AUTH_RL, api: env.API_RL, links: env.LINKS_RL }),
    now: () => new Date(),
  };
  return deps;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    app ??= createApp(depsFrom(env));
    return app.fetch(request);
  },
  scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): void {
    ctx.waitUntil(purge(depsFrom(env)));
  },
};
