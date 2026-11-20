-- Playlist edits made on the phone, already applied to `playlists`, waiting for
-- the desktop to apply them to its own copy (it clears up to `seq`).
CREATE TABLE playlist_ops (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
