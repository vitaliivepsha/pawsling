-- One row per Telegram user: best Night Shift waves and total campaign stars.
-- *_at is when the current best was reached; on a tie the earlier player ranks higher.
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  night INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  night_at INTEGER NOT NULL DEFAULT 0,
  stars_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_night ON players (night DESC, night_at ASC);
CREATE INDEX IF NOT EXISTS idx_stars ON players (stars DESC, stars_at ASC);
