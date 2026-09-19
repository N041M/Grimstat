import { describe, expect, it } from "vitest";
import { signInEmail } from "./signInEmail";

describe("the sign-in email", () => {
  const mail = signInEmail("https://grimstat.com/#/profile?code=ab12-cd34", "ab12-cd34");
  it("puts the code in the subject and on a line of its own", () => {
    expect(mail.subject).toBe("ab12-cd34 is your Grimstat sign-in code");
    expect(mail.text.split("\n")).toContain("    ab12-cd34");
    expect(mail.text).toContain("https://grimstat.com/#/profile?code=ab12-cd34");
  });
  it("sets the code large in the HTML form and links the browser in", () => {
    expect(mail.html).toContain(">ab12-cd34</p>");
    expect(mail.html).toContain('href="https://grimstat.com/#/profile?code=ab12-cd34"');
  });
  it("escapes what it is given", () => {
    expect(signInEmail("https://x/?a=1&b=<2>", "a<b").html).toContain("a&lt;b");
    expect(signInEmail("https://x/?a=1&b=<2>", "a<b").html).toContain('href="https://x/?a=1&amp;b=&lt;2&gt;"');
  });
});
