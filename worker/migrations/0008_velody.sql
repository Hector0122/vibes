-- Songs sent to Velody (the practice app) from the desktop or the phone. Velody
-- lists them, downloads the audio (GET /songs/{id}/stream), separates it and
-- removes the row; the user can also take one back before that.
CREATE TABLE velody_sends (
  id TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);
