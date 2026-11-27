-- Podcasts subscribed to from the phone (Podcast Index feed ids). Only the show is
-- kept: its episodes are read fresh from Podcast Index each time.
CREATE TABLE podcast_subscriptions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  image TEXT,
  subscribed_at INTEGER NOT NULL
);
