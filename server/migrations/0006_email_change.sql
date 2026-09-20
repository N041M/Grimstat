-- Changing the address an account signs in with. The code goes to the new address, so using it is
-- what proves the address is the owner's; the old one is told that the change was asked for, which
-- is the only warning anyone gets if a session has been taken.
--
-- Shaped like `logins`: a hash of a one-time code, spent in one statement, and a row the purge
-- takes within the day.
CREATE TABLE email_changes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  new_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX email_changes_user ON email_changes (user_id, created_at);
CREATE INDEX email_changes_created ON email_changes (created_at);
