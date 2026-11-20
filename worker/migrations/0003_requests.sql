-- Songs marked on the phone for the desktop to download (yt-dlp) and upload.
-- Removed by the desktop once the song is in the cloud, or by the phone to cancel.
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artists TEXT NOT NULL,
  duration_sec REAL,
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'failed')),
  error TEXT,
  created_at INTEGER NOT NULL
);
