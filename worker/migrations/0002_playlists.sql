-- Playlists mirrored from the desktop app. song_ids is a JSON array of song ids, in order;
-- position keeps the desktop's playlist order.
CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  song_ids TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
