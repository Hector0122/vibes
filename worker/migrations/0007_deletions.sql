-- Songs deleted on one device (DELETE /songs/{id}), for the desktop to remove
-- from its own library too. It clears up to `seq` once applied.
CREATE TABLE deletions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
