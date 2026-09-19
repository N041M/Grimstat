/**
 * The one small interface the server reads and writes through.
 *
 * It exists so the same code runs on Cloudflare's D1 in production and on Node's own SQLite in
 * tests and as the fallback host. Both are SQLite underneath, so the SQL is the same and only the
 * calls differ. `batch` runs its statements as one transaction: all of them or none.
 */
export interface Stmt {
  sql: string;
  params: unknown[];
}

export interface Db {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  first<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  /** Runs a statement and says how many rows it changed. */
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  batch(stmts: Stmt[]): Promise<void>;
}

/** The parts of Cloudflare's D1 binding this server calls. Declared here so no global types are needed. */
export interface D1Like {
  prepare(sql: string): D1StmtLike;
  batch(stmts: D1StmtLike[]): Promise<unknown>;
}
export interface D1StmtLike {
  bind(...params: unknown[]): D1StmtLike;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export function d1Db(d1: D1Like): Db {
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      return (await d1.prepare(sql).bind(...params).all<T>()).results;
    },
    async first<T>(sql: string, ...params: unknown[]) {
      return (await d1.prepare(sql).bind(...params).first<T>()) ?? undefined;
    },
    async run(sql: string, ...params: unknown[]) {
      const res = await d1.prepare(sql).bind(...params).run();
      return { changes: res.meta?.changes ?? 0 };
    },
    async batch(stmts: Stmt[]) {
      if (!stmts.length) return;
      await d1.batch(stmts.map((s) => d1.prepare(s.sql).bind(...s.params)));
    },
  };
}

/** The parts of `node:sqlite`'s DatabaseSync this server calls. */
export interface SqliteLike {
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): { changes: number | bigint } };
  exec(sql: string): void;
}

export function sqliteDb(sqlite: SqliteLike): Db {
  const bind = (params: unknown[]) => params.map((p) => (p === undefined ? null : p));
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    async first<T>(sql: string, ...params: unknown[]) {
      return (sqlite.prepare(sql).get(...bind(params)) as T | undefined) ?? undefined;
    },
    async run(sql: string, ...params: unknown[]) {
      return { changes: Number(sqlite.prepare(sql).run(...bind(params)).changes) };
    },
    async batch(stmts: Stmt[]) {
      if (!stmts.length) return;
      sqlite.exec("BEGIN");
      try {
        for (const s of stmts) sqlite.prepare(s.sql).run(...bind(s.params));
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

/**
 * Sets an account's `bytes` to what its rows actually hold. Takes the user id twice.
 *
 * The counter is kept up to date by the sync endpoint so a push reads one row instead of every
 * record, which means it can drift when a write fails after the counter has moved. This puts it
 * back. The nightly purge runs it too, as it compresses the last of the uncompressed bodies.
 */
export const RECOUNT_BYTES = `UPDATE users
     SET bytes = (SELECT COALESCE(SUM(LENGTH(body_gz)), 0) + COALESCE(SUM(LENGTH(CAST(body AS BLOB))), 0) FROM records WHERE user_id = ?)
   WHERE id = ?`;

/**
 * Whether an error is the database refusing work for the day rather than something broken.
 * Cloudflare's free tier answers a query past its daily limit with an error, and the server turns
 * that into the pause the app knows how to wait out.
 */
export function isDailyLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /daily|limit|exceed|quota/i.test(msg) && !/syntax|no such|constraint/i.test(msg);
}
