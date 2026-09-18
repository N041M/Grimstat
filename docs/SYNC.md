# Accounts, sync and hosting — design plan

> Status: plan (18 Sep 2026). Phase 1 is live at grimstat.com and Phase 0 is built, both on 18 Sep 2026; Phases 2 to 4 are not started. Builds on the service seams in
> `apps/web/src/services/`, the record metadata in `packages/schema/src/common.ts` and the Dexie
> store in `apps/web/src/db.ts`.

## Goal

Grimstat gets its own address, an optional account, and sync of what a player made between their
devices. The same build later ships as a phone app. The source becomes private on the day the old
address closes. The app stays free. A Ko-fi link on the website is the only money involved.

The four fixed points every decision below follows from:

1. **Nothing is gated.** The entitlements package stays on `LocalAllUnlocked` for good. There is no
   plan, no trial and no feature that a donation unlocks. A player who never signs in loses nothing.
2. **The server holds only what a player made.** No snapshot, no rules text, no datasheet and no
   points table ever reaches it. A roster body carries datasheet ids, counts, wargear names and
   points, and that is the most a server row ever contains.
3. **The running cost is fixed at zero and fails closed.** Hosting sits on Cloudflare's free tier,
   which stops serving when a daily limit is reached rather than billing. The owner pays the domain
   and, once donations cover it, the Apple developer fee. Nothing in the design can produce a
   usage bill.
4. **Nothing is ever lost to sync.** A conflict moves work into a roster's History. It never deletes
   it. When sync is paused, everything keeps working on the device.

Non-goals: real-time collaboration, sharing a list between two accounts for editing, a hosted
optimiser, and any paid tier. The design doc's older "paid-tier readiness" section is superseded by
this document.

## What already exists that this reuses

| Need | Existing piece |
|---|---|
| Identity fields on records | `RecordMeta`: `ownerId`, `createdAt`, `updatedAt`, `revision` on rosters, scenarios and snapshots |
| Service seams with local no-op implementations | `services/auth.ts`, `services/sync.ts`, `services/relay.ts` |
| A full copy of a player's data as one file | `exportAll` / `importAll` in `db.ts` (the backup on the Data page) |
| Roster history, thirty revisions per roster | `saveRosterWithVersion`, `rosterVersions` |
| Points-changed detection when a roster's snapshot moves on | snapshot diff, the Armies page's "points changed" state |
| Long share links for a scenario and a roster | `lib/permalink.ts`, `lib/rosterPermalink.ts` (`#s=` and `#r=` tokens) |
| A build that deploys from `master` with the checks run first | `.github/workflows/pages.yml` |
| Store-changed notifications the pages already listen to | `notifyStoreChanged` |

## What syncs

Every Dexie table falls into one of two groups. The first is what the player made. It is small, it
changes a few times a day, and it is the only thing worth an account. The second is derived from
community sources, it is large, and every device rebuilds it from the same sources.

| Table | Syncs | Why |
|---|---|---|
| `rosters` | yes | the player's lists |
| `scenarios` | yes | saved matchups |
| `unitPresets` | yes | configured units saved by name |
| `collection` | yes | models owned and painted |
| `games` | yes | games played and in play |
| `terrainLayouts` | yes | layouts the player built or imported |
| `overrides` | yes | the player's rules overrides |
| `layouts` | yes | dashboard layouts, a few hundred bytes each |
| `publishedLists` with `origin: "hand"` | yes | lists the player pasted in |
| `settings`, listed keys only | yes | the mirror URL, the corpus URL, the theme |
| `rosterVersions` | no | thirty full copies per roster is too much for a free tier, and history stays per device. A conflict's loser is written here on the device that kept the winner |
| `publishedLists` with `origin: "corpus"` | no | the corpus relay refills it |
| `snapshots` | no | 20 MB per game system and Games Workshop data. Rebuilt from the same sources on every device |
| `sourceFiles`, `publishedResolved` | no | derived and refetchable |
| `settings`, every other key | no | device state, such as the active snapshot |

The size of a synced account is a few megabytes at most. A roster is 20 to 50 KB. A finished game
with its log is about 100 KB. Everything else is smaller.

## Phase 0 — changes the app needs before any server exists

Every item here is a local change, ships without a server, and is checked by the existing tests and
the corpus regression net.

### Stable snapshot ids

A snapshot's id is `snap_<yyyymmdd>_<8 hex of the checksum>` (`packages/snapshot/src/build.ts`).
The date is the build date, so two devices fetching the same three source refs on different days
produce different ids for identical data, and a synced roster would arrive pinned to a snapshot the
other device does not have.

The id becomes `snap_<12 hex of the checksum>`. The checksum already covers the canonical, sorted
data and nothing else, so the same sources give the same id everywhere. The build date stays in
`createdAt`. A Dexie migration (v11) re-keys existing snapshots and rewrites `snapshotId` on
rosters, scenarios, games and presets. `publishedResolved` is derived and is dropped in the same
migration, as v9 did.

When a synced roster names a snapshot the device does not hold, the Armies page shows the roster
with its stored name and points and one line, "Fetch data to open this list". Fetching the
sources rebuilds the snapshot. If the sources have moved on, the result has a different id and the
existing points-changed flow takes over.

### An outbox and tombstones, written by the store itself

Writes to synced tables happen in many places (`CollectionPage`, `ScenariosPage`, `layoutStore`,
`OverridesPage` and more), so sync bookkeeping cannot depend on call sites remembering to do it.
A Dexie middleware (`db.use`, the DBCore hook) watches every mutation on a synced table and, in the
same transaction, writes to two new tables:

- `outbox`: `store`, `id`, `updatedAt`. One row per record with unsent changes. A second change to
  the same record replaces the row.
- `tombstones`: `store`, `id`, `deletedAt`. Written on delete. Pruned ninety days after the server
  has confirmed the delete.

Records written by the sync layer itself bypass the middleware, so a pull never re-enters the outbox.

Every synced table gets `updatedAt` where it lacks one. `settings` gets it per key. `overrides` and
`layouts` already carry it. `ownerId` is added to the tables outside the schema package
(`collection`, `unitPresets`, `terrainLayouts`, `games` already has it, `layouts`, `overrides`).

### The backup becomes the sync payload

`exportAll` already writes every synced table. The record shape the server accepts is exactly the
record shape the bundle holds, so one Zod schema per store in `packages/schema` describes both, and
the server validates with the same code the app does. The bundle keeps carrying snapshots and roster
versions because a backup is for a player's own device.

### Who owns a record

Records written while signed out carry `ownerId: "local"`, as today. On the first sign-in the whole
store is adopted in one transaction: every `"local"` record takes the account's id and enters the
outbox, so the first push carries everything. Signing out leaves the data on the device. The store
belongs to one account. Signing in with a different account on a device that already holds an
adopted store asks once, "This device holds another account's lists. Export them first?", then
replaces the store.

## Phase 1 — the domain and the site

The site moves from GitHub Pages to a Cloudflare Workers static site under its own domain, deployed
by the same workflow with `VITE_BASE=/`. The Wahapedia copy that `pages.yml` places in the site and
the recogniser's files come along unchanged. Cloudflare serves static files with no bandwidth charge,
so the 30 MB build costs nothing to serve.

Short links come with the site. The relay seam gets a real implementation: `POST /api/links` with a
long token returns an eight-character id, and `/l/<id>` opens the app at the corresponding `#s=` or
`#r=` link. Links are rows in D1 rather than KV, because KV allows one thousand writes a day on the
free tier and links would be the first thing to run out. Links made without an account expire after
ninety days. Links made from an account last as long as the account.

### Closing the old address

IndexedDB is per origin. A player's lists at `n041m.github.io` cannot be read at the new domain.
So the two addresses run side by side for a while, and the last Pages build carries one banner:
"Grimstat has moved to <domain>. This address closes on <date>. Export your data on the Data page
and import it there." Four weeks is enough for anyone who plays monthly. On the closing date the
repository goes private, GitHub Pages stops on its own, and the source is no longer public.

Checklist for that day:

- The repository is private. Actions on a private repository get 2,000 minutes a month rather than
  unlimited. CI plus the two weekly crawls fit, and the Pages workflow is deleted.
- `grimstat-wahapedia` and `grimstat-corpus` stay public. The app fetches raw files from them.
- The crawler's user agent in `packages/adapters/src/competitive/minihq.ts` names the GitHub
  repository. It names the website instead.
- The README's line about running the source locally to audit it is no longer true. The site's
  privacy page says what the server holds instead, which is the list under "What syncs".
- The About page's "version" line keeps the commit id. Nothing else in the app points at the
  repository.

## Phase 2 — accounts and sync

### The server

`apps/api` is a Hono application in TypeScript, in the workspace, importing `@grimstat/schema`. It
runs on Cloudflare Workers with a D1 binding in production and on Node with SQLite in tests and
as the fallback host. One small interface (`prepare`, `batch`, `first`, `all`) covers both, so a move
to a fixed-price VPS is an adapter and an afternoon. The Worker deploys with `wrangler` from the
same GitHub Actions run that deploys the site, after the checks.

Tables in D1:

```
users     id, email (unique), handle (unique, nullable), seq, created_at, deleted_at
sessions  token_hash, user_id, device_name, created_at, last_seen_at, expires_at
logins    code_hash, email, created_at, expires_at, used_at
records   user_id, store, id, seq, revision, updated_at, deleted_at, body   unique (user_id, store, id)
links     id, user_id (nullable), kind, body, created_at, expires_at
```

`users.seq` is a counter. Every change applied for a user takes the next value, and a device's
cursor is the highest value it has seen. There is no global sequence and no timestamp ordering on
the server side.

### Signing in

Email magic links. No passwords exist anywhere. `POST /auth/start` takes an email and a Turnstile
token, stores a hashed one-time code that lives fifteen minutes, and sends one email through Resend.
The link opens the app, which posts the code to `POST /auth/finish` and receives a session token in
the response body. The token is random, 32 bytes, stored hashed on the server and in the device's
`settings` under a key that never syncs. A session lasts a year and appears on the Profile page as a
device, where it can be signed out. Rate limits through the Workers rate-limiting binding: five
starts per email per hour, twenty per address per hour. That is what keeps the email quota from
being spent by a script.

Sign in with Apple is added only if a second social login is ever added, because Apple requires it
then and not before.

### The protocol

One endpoint does both directions, so a sync is one request.

```
POST /sync
  { cursor, changes: [ { store, id, revision, updatedAt, deletedAt?, body? } ] }
→ { cursor, applied: [ {store, id} ], rejected: [ { store, id, server: <record> } ], changes: [ <records after cursor> ] }
```

The server applies the whole request as one D1 batch. If any statement fails, nothing is written,
the device keeps its outbox, and the next sync carries the same changes. A push with `n` changes
writes `n` record rows plus one `users` row.

For each change, the server compares `updatedAt` with the stored row. A later `updatedAt` wins. An
earlier one is rejected and the server's copy comes back in `rejected`. A tombstone is a change with
`deletedAt` set and no body, and it competes on the same rule. Client clocks are clamped: an
`updatedAt` more than five minutes ahead of the server's clock is set to the server's clock before
the comparison.

On the device, a rejected roster is written into `rosterVersions` under the label "kept from this
device" before the server copy replaces it, so the History panel holds both. For every other store
the server copy replaces the local one. Pulled changes are written through the sync layer's bypass
so they do not re-enter the outbox. A pulled change that is older than a local outbox entry for the
same record is ignored, and the local one goes up on the next sync.

Sync runs thirty seconds after the last change, when the tab is hidden, when the app opens, and
when the tab becomes visible again. The status seam reports `idle`, `syncing`, `paused` (new) or
`error`, and the shell shows one line for it beside the last-synced time.

### Quotas and the pause

The daily allowance is account-wide on Cloudflare and resets at midnight UTC. Since 1 September
2026 a D1 query past the free limit returns an error. That is the behaviour this design wants.

| Limit per day | Free tier | Workers Paid, 5 USD a month |
|---|---|---|
| Requests | 100,000 | about 330,000 |
| D1 rows written | 100,000 | about 1.6 million |
| D1 rows read | 5,000,000 | about 830 million |

At ten syncs a day carrying three changed records each, one active player writes about thirty rows
and makes about twenty requests. Rows written is the binding limit, so the free tier carries about
three thousand players editing on the same day, or about a hundred thousand saved changes a day in
total. Idle accounts cost nothing.

Per-account limits enforced in the Worker: 256 KB per record body, 20 MB per account, two hundred
changes per request. A request over a limit is rejected with a message the Profile page shows.

When D1 returns its limit error, the Worker answers `503` with the next reset time. The device sets
its status to `paused`, keeps its outbox, and retries after the reset. The shell says, in the
player's local time: "Sync paused until 02:00. Everything is saved on this device and will sync
then." The About page says, once: "Sync runs on a free hosting allowance shared by everyone, about
100,000 saved changes a day. If donations cover it, the allowance grows." Those two strings are the
whole disclaimer. The upgrade is Workers Paid at 60 USD a year, which raises every number in the
table by an order of magnitude and is the first thing the Ko-fi pays for.

### The Profile page

One page, reached from the shell. Signed out it holds an email field and the button. Signed in it
holds the email, the last-synced time, the devices with a sign-out beside each, the existing export,
and "Delete account", which removes every row for the user on the server and signs the device out
while leaving its data in place. The Ko-fi link is not on this page. It lives on the About page and
in the footer, on the website only.

Strings added to `i18n/en.ts`: `profile.title`, `profile.email`, `profile.signIn`,
`profile.checkEmail`, `profile.lastSynced`, `profile.devices`, `profile.signOutDevice`,
`profile.delete`, `profile.deleteConfirm`, `sync.paused`, `sync.error`, `about.sync`,
`about.support`. Nothing in them explains a mechanism.

### Privacy

The server holds an email address, hashed session tokens, and the records under "What syncs". No
analytics, no IP logs beyond Cloudflare's own rolling ones, no third party except Resend for the
email. The privacy page says this in one paragraph. Export and deletion are the two rights the page
has to offer, and both exist.

## Phase 3 — profiles and share pages

A handle is optional and chosen on the Profile page, three to twenty characters, letters, digits and
hyphens, unique. A roster gets a `shared` flag. `/u/<handle>` is served by the Worker and lists that
account's shared rosters with name, faction, points and date, and each opens through a link like any
other. The page renders on the viewer's device against the viewer's own snapshot. The server sends
the roster body and never a datasheet, so a share page rehosts nothing.

## Phase 4 — the phone app

`apps/mobile` is a Capacitor project wrapping the same Vite build. React, Dexie, the workers and the
three.js board run in the WebView. Capacitor gives the app its own storage that iOS does not evict,
which is the reason to wrap at all. The app's origin is its own, so its database starts empty and
sync is how a player's lists arrive. That is why this phase follows Phase 2.

Android first, on Google Play, for the one-time fee. iOS waits until donations have covered a year
of the Apple fee in advance. iPhone users install the PWA from the website until then. Deep links
for `/l/<id>` and `/u/<handle>` open in the app when it is installed.

The store builds carry no donation link and no mention of one. Both stores treat a tip to the
developer inside an app as a purchase that has to go through their own payment flow.

## Money

Ko-fi, linked from the About page and the footer of the website. Ko-fi takes nothing from a one-off
donation. The link is worded as support for the work. It is not payment for anything, and no feature,
badge or data changes with it. Games Workshop's fan policy is non-commercial, and New Recruit and
BSData have run on this basis for years. Donations to a private person in Czechia can count as
income above a threshold, which is an accountant's question before the first payout.

| Item | Per year |
|---|---|
| Domain | 10 to 15 USD |
| Cloudflare free tier, Resend free tier, Turnstile | 0 |
| Google Play, once | 25 USD |
| Workers Paid, only if the allowance is outgrown | 60 USD |
| Apple Developer Program, only once donations cover it | 99 USD |

## Risks

- **Rules text on the domain.** The Wahapedia copy in the site's `public/` directory is the one
  place the site serves Games Workshop text today, unchanged from GitHub Pages. Share pages and the
  sync server must never add a second one.
- **A store listing is a bigger target than a website.** The PWA on the domain stays the path that
  cannot be taken down by a store review.
- **Snapshot mismatch across devices** is the likeliest bug class. The stable id and the "Fetch data
  to open this list" state cover it. The corpus regression net runs on every sync change.
- **Lost work in a conflict** is prevented by the History rule. The tests for Phase 2 include two
  devices editing the same roster offline and both copies surviving.
- **Magic-link email not arriving** is the support question that will come. The sign-in screen says
  to check the spam folder, and the Profile page shows the sending address.
- **A free tier changing its terms.** The API runs on Node and SQLite as well as on Workers from the
  first commit, and a Hetzner CX22 at a fixed 3.79 EUR a month is the tested fallback.
- **Going private closes the old address.** The four-week banner is the mitigation. A player who
  misses it has lost their lists unless they made a backup, and the banner says so.

## Order of work

| Phase | Work | Effort |
|---|---|---|
| 0 | Stable snapshot ids, outbox and tombstones middleware, `updatedAt` and `ownerId` everywhere, adoption on sign-in | 1 week |
| 1 | Domain, Cloudflare static site, links in D1, the closing banner on Pages | 3 days |
| 2 | Magic-link auth, the sync endpoint, quotas and the pause, Profile page, privacy page, nightly D1 export to R2 | 3 to 4 weeks |
| 3 | Handles, shared rosters, `/u/<handle>` | 1 to 2 weeks |
| 4 | Capacitor, Android listing, deep links | 2 weeks plus review |

Open before Phase 1 starts: the domain name, and the closing date for the old address.
