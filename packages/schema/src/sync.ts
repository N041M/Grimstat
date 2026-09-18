/**
 * The stores an account carries between devices, by the names the app's database gives them.
 *
 * The list lives here because two sides hold it: the app's store, which watches these tables for
 * changes, and the sync server, which refuses a change to any other store. A store is the player's
 * own work. Snapshots, the files they were built from, and anything worked out from them are not
 * here, because every device rebuilds those from the same sources and the server never holds game
 * data. See docs/SYNC.md.
 */
export const SYNC_STORES = ["rosters", "scenarios", "unitPresets", "collection", "games", "terrainLayouts", "overrides", "layouts", "publishedLists", "settings"] as const;
export type SyncStore = (typeof SYNC_STORES)[number];

/** The most one record's body may weigh, in bytes of JSON. A roster is 20 to 50 KB; a long game about 100 KB. */
export const SYNC_MAX_BODY_BYTES = 256 * 1024;
/** The most one account may hold on the server, in bytes of JSON. */
export const SYNC_MAX_ACCOUNT_BYTES = 20 * 1024 * 1024;
/** The most changes one sync request may carry, in either direction. */
export const SYNC_MAX_CHANGES = 200;
/** How many changes a pull hands back at once. A device asks again while `more` is set. */
export const SYNC_PAGE = 500;
