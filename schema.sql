CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  beard_day INTEGER NOT NULL CHECK (beard_day >= 0),
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  taken_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS photos_beard_day_idx
  ON photos (beard_day, created_at);

CREATE TABLE IF NOT EXISTS votes (
  voter_key TEXT PRIMARY KEY,
  ip_key TEXT NOT NULL,
  beard_day INTEGER NOT NULL CHECK (beard_day >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS votes_ip_key_idx ON votes (ip_key);
CREATE INDEX IF NOT EXISTS votes_beard_day_idx ON votes (beard_day);
