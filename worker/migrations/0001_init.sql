-- Vibes cloud library. id = YouTube video id; audio at R2 songs/{id}.m4a.
-- meta is the JSON SongMeta from src/shared/api.ts.
CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  meta TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_songs_status ON songs(status);
