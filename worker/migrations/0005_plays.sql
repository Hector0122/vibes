-- Plays counted on the phone, waiting for the desktop (which keeps the counts
-- that drive recommendations). The desktop reads them and clears up to `seq`.
CREATE TABLE plays (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  played_at INTEGER NOT NULL
);
