-- Two counters per user, kept by the sync endpoint so a push reads one users row instead of every
-- record the account holds. `bytes` is the size of every stored body, in bytes of JSON.
-- `day_writes` is how many records the account has written on `day`, a UTC date.
ALTER TABLE users ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN day TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN day_writes INTEGER NOT NULL DEFAULT 0;
UPDATE users SET bytes = (SELECT COALESCE(SUM(LENGTH(CAST(body AS BLOB))), 0) FROM records WHERE records.user_id = users.id);
