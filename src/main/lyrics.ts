// Lyrics for the desktop: LRCLIB (src/shared/lrclib.ts), cached on disk.
// VIBES_LRCLIB_URL points tests at a fake server.
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { YOUTUBE_ID_RE } from '../shared/api'
import { fetchLyrics as fetchShared } from '../shared/lrclib'
import type { Lyrics, SongRef } from '../shared/types'

export { currentLine } from '../shared/lyrics'
export { parseLrc, pickLyrics, SYNC_TOLERANCE, type LrclibRecord } from '../shared/lrclib'

export function fetchLyrics(
  song: { title: string; artists: string; durationSec: number | null },
  fetchImpl: typeof fetch = fetch,
  base = process.env.VIBES_LRCLIB_URL || 'https://lrclib.net'
): Promise<Lyrics | null> {
  return fetchShared(song, fetchImpl, base, 'Vibes/0.1 (desktop music player)')
}

const NOT_FOUND_TTL = 7 * 24 * 3600_000

/**
 * Lyrics from <dir>/<id>.json, or fetched and saved there. "No lyrics" is
 * remembered for a week (someone may add them to LRCLIB); a failed request
 * (offline) is not remembered at all.
 */
export async function cachedLyrics(
  dir: string,
  song: SongRef,
  fetcher: (s: SongRef) => Promise<Lyrics | null>,
  now = Date.now()
): Promise<Lyrics | null> {
  if (!YOUTUBE_ID_RE.test(song.id)) throw new Error('Canción inválida')
  const file = join(dir, `${song.id}.json`)
  try {
    const hit = JSON.parse(await readFile(file, 'utf-8')) as { at: number; lyrics: Lyrics | null }
    if (hit.lyrics || now - hit.at < NOT_FOUND_TTL) return hit.lyrics
  } catch {
    // not cached yet
  }
  const lyrics = await fetcher(song)
  await mkdir(dir, { recursive: true })
  await writeFile(file, JSON.stringify({ at: now, lyrics }))
  return lyrics
}
