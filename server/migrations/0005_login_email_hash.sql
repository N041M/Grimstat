-- The sign-in rows are what the per-address hourly limit counts, so they outlive the account they
-- belong to: deleting them would hand the address a fresh allowance every time an account was made
-- and deleted. That left the address itself on the server for up to a day after an erasure.
--
-- Counting on a hash of the address instead lets the address be cleared at once and the row stay.
-- Rows written before this migration carry an empty hash and are not counted, so for the hour the
-- limit looks back an address may get a second allowance. Every row is replaced within the day the
-- purge keeps them, and the limit is exact again from then on.
ALTER TABLE logins ADD COLUMN email_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX logins_email_hash ON logins (email_hash, created_at);
