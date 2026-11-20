-- "Recomendado para ti", computed on the desktop: one row, the whole set as JSON
-- ({ basedOn: string[], results: SearchHit[] }).
CREATE TABLE recommendations (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
