// Reads the eSound desktop library (its own SQLite DB) without touching it:
// the DB is copied to a temp folder first, so a running eSound is unaffected.
import { copyFile, mkdtemp, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { YOUTUBE_ID_RE } from '../shared/api'
import type { IncomingSong } from './library'

export interface EsoundSong extends IncomingSong {
  /** eSound's cached audio for this song (fragmented mp4, audio only), if any. */
  cachedAudio: string | null
}

interface Row {
  esound_id: string
  title: string
  artists: string | null
  deezer_artist_id: string | null
  album: string | null
  youtube_id: string | null
  deezer_id: string | null
  isrc: string | null
  duration: number | null
  play_count: number | null
  is_saved: number | null
  cover: string | null
}

// provider_type 2 = Deezer. eSound leaves song_authors.is_main at 0, so the
// first linked artist stands in for the main one.
const SQL = `
select s.id esound_id, coalesce(s.display_name, s.name) title,
       (select group_concat(a.name, ', ') from song_authors sa join authors a on a.id = sa.artist_id
        where sa.track_id = s.id and sa._status != 'deleted') artists,
       (select a.provider_id from song_authors sa join authors a on a.id = sa.artist_id
        where sa.track_id = s.id and sa._status != 'deleted' and a.provider_type = 2
        order by sa.rowid limit 1) deezer_artist_id,
       r.name album, s.source_id youtube_id,
       case when s.provider_type = 2 then s.provider_id end deezer_id,
       s.isrc, s.duration, s.play_count, s.is_saved, s.thumbnail_large_url cover
from songs s left join releases r on r.id = s.album_id
where s._status != 'deleted'
`

export async function readEsoundLibrary(esoundDir: string): Promise<EsoundSong[]> {
  const db = join(esoundDir, 'sql-data', 'esound_main.db')
  if (!existsSync(db)) throw new Error(`No encontré la biblioteca de eSound en ${esoundDir}`)
  const tmp = await mkdtemp(join(tmpdir(), 'vibes-esound-'))
  try {
    await copyFile(db, join(tmp, 'db'))
    // Recent changes may still sit in the write-ahead log.
    if (existsSync(db + '-wal')) await copyFile(db + '-wal', join(tmp, 'db-wal'))
    const conn = new DatabaseSync(join(tmp, 'db'))
    try {
      const rows = conn.prepare(SQL).all() as unknown as Row[]
      return rows.flatMap((r) => (r.youtube_id && YOUTUBE_ID_RE.test(r.youtube_id) ? [toSong(r, esoundDir)] : []))
    } finally {
      conn.close()
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

function toSong(r: Row, esoundDir: string): EsoundSong {
  const cached = join(esoundDir, 'tracks', `${r.esound_id}.mp4`)
  return {
    id: r.youtube_id!,
    title: r.title,
    artists: r.artists ?? '',
    album: r.album,
    deezerId: r.deezer_id,
    deezerArtistId: r.deezer_artist_id,
    isrc: r.isrc,
    durationSec: r.duration || null,
    coverUrl: r.cover,
    saved: r.is_saved === 1,
    playCount: r.play_count ?? 0,
    cachedAudio: existsSync(cached) ? cached : null
  }
}
