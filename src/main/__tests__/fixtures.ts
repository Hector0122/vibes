// Test fixtures: a fake eSound data folder (same schema subset as the real
// esound_main.db, plus DASH-fragmented mp4 audio like eSound caches) and a
// fake yt-dlp that "downloads" a real m4a. Audio is generated with ffmpeg.
import { execFileSync } from 'child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'

export const CACHED_ID = 'aaaaaaaaaaa' // in eSound with cached audio
export const MISSING_ID = 'bbbbbbbbbbb' // in eSound, no cached audio
export const FAILING_ID = 'fffffffffff' // the fake yt-dlp fails on this one

/** A 1 s sine; `fragmented` mimics eSound's DASH cache. */
export function makeAudio(path: string, fragmented = false): void {
  execFileSync('ffmpeg', [
    '-nostdin', '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:a', 'aac', '-b:a', '64k',
    ...(fragmented ? ['-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4'] : []),
    path
  ])
}

export function makeEsoundDir(root: string): string {
  const dir = join(root, 'eSound Music')
  mkdirSync(join(dir, 'sql-data'), { recursive: true })
  mkdirSync(join(dir, 'tracks'), { recursive: true })
  const db = new DatabaseSync(join(dir, 'sql-data', 'esound_main.db'))
  db.exec(`
    CREATE TABLE songs (id TEXT PRIMARY KEY, provider_type INTEGER, provider_id TEXT, source_id TEXT,
      name TEXT, display_name TEXT, album_id TEXT, thumbnail_large_url TEXT, isrc TEXT,
      duration INTEGER, is_saved INTEGER, play_count INTEGER, _status TEXT);
    CREATE TABLE authors (id TEXT PRIMARY KEY, provider_type INTEGER, provider_id TEXT, name TEXT);
    CREATE TABLE song_authors (id TEXT PRIMARY KEY, track_id TEXT, artist_id TEXT, is_main INTEGER, _status TEXT);
    CREATE TABLE releases (id TEXT PRIMARY KEY, name TEXT);

    INSERT INTO releases VALUES ('r1', 'Plastic Beach');
    INSERT INTO authors VALUES ('a1', 2, '14', 'Gorillaz'), ('a2', 2, '777', 'Bobby Womack'),
                               ('a3', 0, 'UCxyz', 'Some Channel');
    INSERT INTO songs VALUES
      ('e1', 2, '5490699', '${CACHED_ID}', 'Stylo', NULL, 'r1', 'https://img/1.jpg', 'GB1', 270, 1, 3, 'updated'),
      ('e2', 0, 'x', '${MISSING_ID}', 'Live video', 'Live (Official)', NULL, NULL, NULL, NULL, 0, 0, 'updated'),
      ('e3', 2, '1', 'not a yt id', 'Broken', NULL, NULL, NULL, NULL, NULL, 1, 0, 'updated'),
      ('e4', 2, '2', 'ccccccccccc', 'Deleted', NULL, NULL, NULL, NULL, NULL, 1, 0, 'deleted');
    INSERT INTO song_authors VALUES ('sa1', 'e1', 'a1', 0, 'updated'), ('sa2', 'e1', 'a2', 0, 'updated'),
                                    ('sa3', 'e2', 'a3', 0, 'updated');
  `)
  db.close()
  makeAudio(join(dir, 'tracks', 'e1.mp4'), true)
  return dir
}

/** A yt-dlp stand-in: copies `audio` to the -o template, fails for FAILING_ID. */
export function makeFakeYtdlp(root: string, audio: string): string {
  const path = join(root, 'fake-yt-dlp')
  writeFileSync(
    path,
    `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; --) url="$2"; shift ;; esac
  shift
done
case "$url" in *${FAILING_ID}*) echo "ERROR: Video unavailable" >&2; exit 1 ;; esac
cp "${audio}" "$(echo "$out" | sed 's/%(ext)s/m4a/')"
`
  )
  chmodSync(path, 0o755)
  return path
}
