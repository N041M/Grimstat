-- Three holes, all of them the same shape: a session token was enough on its own to do something
-- only the inbox should be able to do. Sign-in is by emailed code, so whoever holds the inbox holds
-- the account; a token sitting on a device for a year is weaker than that, and nothing below the
-- inbox should be able to take the account away or destroy it.

-- 1. Changing the address now needs a code from the address being left as well as one sent to the
--    address being taken. The first is what a stolen session cannot produce; the second is what
--    stops a typo from locking the owner out. The table is remade rather than altered because it
--    holds nothing but one-time codes, none older than a day.
DROP TABLE IF EXISTS email_changes;
CREATE TABLE email_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  new_email TEXT NOT NULL,
  -- Sent to the address the account has now. Proves the asker is the owner.
  current_code_hash TEXT NOT NULL,
  -- Sent to the address being taken. Proves it exists and is the owner's.
  new_code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX email_changes_user ON email_changes (user_id, created_at);
CREATE INDEX email_changes_created ON email_changes (created_at);

-- 2. When the address does move, the address it left gets a link that moves it back and signs every
--    device out. It is the only way back in for someone who reads the mail after the change, since
--    by then their address signs in to nothing. It needs no session for the same reason.
CREATE TABLE email_reverts (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  previous_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX email_reverts_created ON email_reverts (created_at);

-- 3. Deleting the account marks it instead of emptying it, and signing in again inside the grace
--    period brings it back. The purge does the real deletion once the period is up. A stolen session
--    could otherwise destroy every army, game and collection in one request with nothing to undo.
ALTER TABLE users ADD COLUMN deleted_at TEXT;
CREATE INDEX users_deleted ON users (deleted_at);
