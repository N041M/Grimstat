# The server files the privacy notice is about

The privacy notice is at **[grimstat.com/#/privacy](https://grimstat.com/#/privacy)**. It says what
the server holds when you have an account, why, and for how long. Those are all claims about code,
and the code they describe is here so you can check them.

The application source is private. These files are the part that concerns your data, published so
that anyone can see what the app does with it.

## What is here

| File | What it settles |
|---|---|
| `migrations/*.sql` | Every table the server has, and every column. The notice lists six kinds of row and says it holds nothing else. This is the list to check that against. |
| `purge.ts` | What is deleted and when. Every retention the notice prints is a line in here. |
| `auth.ts` | Signing in, changing the sign-in address, and what closing an account does. |
| `links.ts` | Share links: what a link stores, how long it lasts, and the limits it counts. |
| `crypto.ts` | The hashing itself. Every "hashed" in the notice resolves to a function in here. |
| `PrivacyPage.test.ts` | The test that holds the notice's wording to the files above. |

## Reading the retentions

Each sentence of the notice's "How long it is kept" section comes from one place.

- **A closed account is kept for 30 days.** `deleteMarkedAccounts` in `purge.ts`, against
  `ACCOUNT_DELETE_GRACE_DAYS`. `deleteAccount` in `auth.ts` is what marks it, and it clears your
  address out of the sign-in rows in the same statement.
- **A sign-in row is kept for a day, and no row lives longer than two.** The first `DELETE` in
  `purge`. The cutoff is a day; the purge runs nightly, so a row made just after one run waits for
  the run after the next.
- **A device's session ends ninety days after it was last used, or a year after it was made.**
  `SESSION_IDLE_DAYS` in `purge.ts` and `SESSION_LIFE` in `auth.ts`.
- **The codes for changing your address are kept for a day, and the link that puts it back works for
  thirty.** The second and third `DELETE` in `purge`, and `REVERT_DAYS` in `auth.ts`.
- **A share link made without an account is kept for ninety days.** `ANON_LIFE` in `links.ts` sets the
  expiry, and the fifth `DELETE` in `purge` removes the row once it passes. A link made from an
  account is stored with no expiry at all, which is the notice's "as long as the account".

## What is hashed

The notice says a session token, a sign-in code and a network address are stored hashed. All three
are in `crypto.ts`. `sha256` covers the tokens and codes. `hashIp` and `hashEmail` take a salt, which
is a secret the running Worker holds and the database does not. A copy of the database on its own
cannot be used to sign in, and it does not name a network address.

`typable()` in the same file draws sign-in codes from a 31-character alphabet with no look-alikes. It
throws away the last eight values of a byte instead of folding them in, because 256 is not a multiple
of 31 and folding would make the first eight characters a ninth more likely than the rest.

`email_hash` is there so the hourly limit on sign-in emails keeps counting after an account is
deleted, as migration `0005` explains. Without it, deleting and remaking an account would hand the
address a fresh allowance every time. Counting on a hash lets the address itself be cleared the
moment the account closes.

## The test

`PrivacyPage.test.ts` runs in the private repository on every push. It reads these same files and
fails if a migration adds a table the notice has no bullet for, or if a retention changes away from
the words the notice prints. It will not run in this repository, because it also imports the app's
string table, which is not published.

## These are copies

Taken from the private repository at commit `5f964d7`. They are not updated automatically yet, so
check the dates before relying on them being current. If a retention in the live notice disagrees
with a file here, the live notice is the one that describes the running server, and the difference is
a fault worth an issue.
