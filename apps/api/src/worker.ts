/**
 * The Cloudflare entry. The Worker is the same one that serves the site's files: a request for a
 * file never reaches this code, and only /api and /l do (`run_worker_first` in the web app's
 * wrangler.jsonc). Bindings are stable for the life of the isolate, so the app is built once.
 *
 * Bindings and settings, in wrangler.jsonc and the dashboard:
 *   DB              the D1 database
 *   APP_URL         where the app is served from, for the links in emails
 *   MAIL_FROM       the sender, such as "Grimstat <hello@grimstat.com>"
 *   RESEND_API_KEY  secret
 *   IP_SALT         secret, any long random string
 */
import { createApp } from "./app";
import { d1Db, type D1Like } from "./db";
import { resendMailer, unconfiguredMailer } from "./mail";

interface Env {
  DB: D1Like;
  APP_URL: string;
  MAIL_FROM: string;
  RESEND_API_KEY?: string;
  IP_SALT?: string;
}

let app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    app ??= createApp({
      db: d1Db(env.DB),
      mail: env.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : unconfiguredMailer,
      appUrl: env.APP_URL.replace(/\/$/, ""),
      ipSalt: env.IP_SALT ?? "unsalted",
      now: () => new Date(),
    });
    return app.fetch(request);
  },
};
