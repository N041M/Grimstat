/**
 * The sign-in email. The code comes first and stands on its own, because the reader on a phone
 * has the app open on another screen and is about to type it. The link is for the browser the
 * email is read in. Both forms carry the same text; the HTML form only sets the code large.
 */
export interface SignInEmail {
  subject: string;
  text: string;
  html: string;
}

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function signInEmail(link: string, code: string): SignInEmail {
  const subject = `${code} is your Grimstat sign-in code`;
  const text = ["Your sign-in code:", "", `    ${code}`, "", "Type it on the Profile page of the app. It works once and for fifteen minutes.", "", "Reading this in a browser? This link signs you in there:", link, "", "If you did not ask for it, ignore this message and nothing happens."].join("\n");
  const html = [
    '<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #1a1a1a; max-width: 480px; margin: 0 auto; padding: 24px 16px;">',
    '<p style="margin: 0 0 12px;">Your sign-in code:</p>',
    `<p style="margin: 0 0 20px; padding: 18px 20px; background: #f3f2ef; border-radius: 8px; font-family: SFMono-Regular, Menlo, Consolas, monospace; font-size: 28px; letter-spacing: 0.14em; text-align: center; white-space: nowrap;">${escape(code)}</p>`,
    '<p style="margin: 0 0 24px;">Type it on the Profile page of the app. It works once and for fifteen minutes.</p>',
    '<p style="margin: 0 0 8px;">Reading this in a browser? This link signs you in there:</p>',
    `<p style="margin: 0 0 24px;"><a href="${escape(link)}" style="display: inline-block; padding: 10px 18px; background: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 6px;">Sign in to Grimstat</a></p>`,
    '<p style="margin: 0; font-size: 13px; color: #6b6b6b;">If you did not ask for it, ignore this message and nothing happens.</p>',
    "</div>",
  ].join("\n");
  return { subject, text, html };
}
