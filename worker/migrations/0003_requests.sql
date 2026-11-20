-- Songs marked on the phone for the desktop to download (yt-dlp) and upload.
-- id: the YouTube id, or "dz" + the Deezer id when it was found on Deezer (the
-- desktop looks it up on YouTube). Removed by the desktop once the song is in
-- the cloud, or by the phone to cancel.
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artists TEXT NOT NULL,
  duration_sec REAL,
  cover_url TEXT,
  deezer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'failed')),
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_requests_deezer ON requests(deezer_id);
