// Lyrics on the phone: LRCLIB (shared with the desktop), saved in
// vibes/lyrics/{id}.json so they also show without internet. "No lyrics" is
// remembered for a week; a failed request (offline) is not remembered at all.
import { Directory, File, Paths } from 'expo-file-system'
import type { CloudSong } from '../../src/shared/api'
import { fetchLyrics } from '../../src/shared/lrclib'
import type { Lyrics } from '../../src/shared/types'

const NOT_FOUND_TTL = 7 * 24 * 3600_000
const dir = (): Directory => new Directory(Paths.document, 'vibes', 'lyrics')
const file = (id: string): File => new File(dir(), `${id}.json`)

export async function getLyrics(
  song: CloudSong,
  doFetch: typeof fetch = fetch,
  now = Date.now()
): Promise<Lyrics | null> {
  const f = file(song.id)
  try {
    if (f.exists) {
      const hit = JSON.parse(await f.text()) as { at: number; lyrics: Lyrics | null }
      if (hit.lyrics || now - hit.at < NOT_FOUND_TTL) return hit.lyrics
    }
  } catch {
    // damaged: fetch again
  }
  const lyrics = await fetchLyrics(
    song,
    doFetch,
    'https://lrclib.net',
    'Vibes (phone music player)'
  )
  try {
    const d = dir()
    if (!d.exists) d.create({ intermediates: true, idempotent: true })
    await f.write(JSON.stringify({ at: now, lyrics }))
  } catch {
    // can't save: it'll be fetched again next time
  }
  return lyrics
}
