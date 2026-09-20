-- The sync server's tables. See docs/SYNC.md, "The server".
--
-- Every row belongs to one user and the server holds nothing else: an email address, hashed
-- session tokens, hashed one-time sign-in codes, the records a player made, and short links.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  handle TEXT UNIQUE,
  -- One counter per user. Every change applied takes the next value, and a device's cursor is the
  -- highest value it has seen.
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  -- What the Profile page shows and signs out by, so the token's hash never leaves the server.
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE logins (
  code_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX logins_email ON logins (email, created_at);
CREATE INDEX logins_ip ON logins (ip_hash, created_at);
CREATE INDEX logins_created ON logins (created_at);

CREATE TABLE records (
  user_id TEXT NOT NULL,
  store TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  -- Set on a deletion, with no body. The row stays so the deletion reaches every device.
  deleted_at TEXT,
  body TEXT,
  PRIMARY KEY (user_id, store, id)
);
CREATE INDEX records_seq ON records (user_id, seq);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  ip_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Set on a link made without an account. A link made from one lasts as long as the account.
  expires_at TEXT
);
CREATE INDEX links_ip ON links (ip_hash, created_at);
