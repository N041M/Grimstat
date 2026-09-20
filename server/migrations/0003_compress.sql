-- Bodies are stored compressed from here on. A new or rewritten record has its JSON gzipped into
-- `body_gz` and nothing in `body`. Rows written before this are read from `body` until the nightly
-- purge has compressed them, a batch a night, and set their owners' size counters to the
-- compressed sizes. `shared` is what the public page selects by, since a compressed body cannot
-- be read in SQL.
ALTER TABLE records ADD COLUMN body_gz BLOB;
ALTER TABLE records ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
UPDATE records SET shared = 1 WHERE store = 'rosters' AND body IS NOT NULL AND json_extract(body, '$.shared') = 1;
