import type { Mailer } from "./deps";

/** Sends through Resend's HTTP API. No SDK, one request. */
export function resendMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send(to, subject, text) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!res.ok) throw new Error(`mail: ${res.status} ${await res.text()}`);
    },
  };
}

/** For a host with no mail service configured. Signing in fails and says so, rather than pretending. */
export const unconfiguredMailer: Mailer = {
  async send() {
    throw new Error("Mail is not configured on this server.");
  },
};
