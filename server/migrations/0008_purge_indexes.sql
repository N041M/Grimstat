-- Indexes the nightly purge finds its rows through. Without them each of its queries reads the
-- whole table it deletes from.
--
-- The two on records are partial. A tombstone is one row in a few, and a body still held as plain
-- JSON is a row written before 0003, so a live record is in neither index and costs no extra row
-- written. The one on links holds only the links made without an account, which are the ones that
-- expire.
--
-- `sessions` gets none. Its purge asks for expired or idle sessions, and an index on `last_seen_at`
-- would cost a row written every time a session is touched, which is up to once an hour for each
-- device in use. One nightly read of each session costs less of the daily allowance than that.
CREATE INDEX records_deleted ON records (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX records_plain ON records (user_id) WHERE body IS NOT NULL;
CREATE INDEX links_expires ON links (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX email_reverts_user ON email_reverts (user_id);
