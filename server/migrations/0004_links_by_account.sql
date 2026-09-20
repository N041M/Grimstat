-- The links endpoint counts an account's links for the day before it makes another. Without this
-- index that count reads the whole table.
CREATE INDEX links_user ON links (user_id, created_at);
