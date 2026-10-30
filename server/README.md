# The server files the privacy notice is about

The privacy notice at [grimstat.com/#/privacy](https://grimstat.com/#/privacy) says what the server
holds when you have an account, why, and for how long. Those are claims about code. The code they
describe is here, so you can check them.

## What is here

| File | What it shows |
|---|---|
| `migrations/*.sql` | Every table the server has, and every column. The notice lists six kinds of row and says the server holds nothing else, so these are the files to check that against. |
| `purge.ts` | What is deleted and when. Every retention the notice prints is a line in this file. |
| `auth.ts` | Signing in, changing the sign-in address, and what closing an account does. |
| `links.ts` | Share links, with what a link stores, how long it lasts and the limits it counts. |
| `crypto.ts` | The hashing. Every "hashed" in the notice comes down to a function in this file. |
| `PrivacyPage.test.ts` | The test that holds the notice's wording to the files above. |

## Where each retention comes from

Each sentence of the notice's "How long it is kept" section comes from one place.

- A closed account is kept for 30 days. `deleteMarkedAccounts` in `purge.ts` deletes it once
  `ACCOUNT_DELETE_GRACE_DAYS` have passed. `deleteAccount` in `auth.ts` marks the account, and it
  clears your address out of the sign-in rows in the same batch of statements.
- A sign-in row is kept for a day, and no row lives longer than two. The first `DELETE` in `purge`
  removes rows older than a day. The purge runs nightly, so a row made just after one run waits for
  the run after the next.
- A device's session ends ninety days after it was last used, or a year after it was made.
  `SESSION_IDLE_DAYS` in `purge.ts` and `SESSION_LIFE` in `auth.ts` set those limits.
- The codes for changing your address are kept for a day, and the link that puts the old address
  back works for thirty days. The second and third `DELETE` in `purge` remove them, and
  `REVERT_DAYS` in `auth.ts` sets the thirty days.
- A share link made without an account is kept for ninety days. `ANON_LIFE` in `links.ts` sets the
  expiry, and the fifth `DELETE` in `purge` removes the row once it has passed. A link made from an
  account is stored with no expiry, which is what the notice means by "as long as the account".

## What is hashed

The notice says a session token, a sign-in code and a network address are stored hashed. All three
are in `crypto.ts`. `sha256` covers the session tokens and the token in the link that puts a change
of address back. `hashCode` covers the sign-in codes and the codes that confirm a change of address.
It is an HMAC keyed with a secret that the running Worker holds and the database does not. A code
carries only about forty bits, and a plain hash of it could be matched by trying every value.
`hashIp` and `hashEmail` take the same secret as a salt. A copy of the database on its own cannot be
used to sign in, and it does not name a network address.

`typable()` in the same file draws sign-in codes from a 31-character alphabet with no look-alike
characters. It throws away the last eight values of a byte instead of folding them in. 256 is not a
multiple of 31, and folding them in would make the first eight characters a ninth more likely than
the rest.

`email_hash` lets the hourly limit on sign-in emails keep counting after an account is deleted, as
migration `0005` explains. Without it, deleting and remaking an account would give the address a
fresh allowance every time. Because the limit counts the hash, the address itself can be cleared as
soon as the account closes.

## The test

`PrivacyPage.test.ts` runs in the private repository on every push. It reads these same files. It
fails if a migration adds a table the notice has no bullet for, or if a retention no longer matches
the words the notice prints. It does not run in this repository, because it also imports the app's
string table, which is not published.

## These are copies

These files were copied from the private repository at commit `7121c88` on 30 October 2026. They are
not updated automatically, so check the date before you rely on them being current. If a retention
in the live notice disagrees with a file here, the live notice describes the running server, and the
difference is a fault worth an issue.
