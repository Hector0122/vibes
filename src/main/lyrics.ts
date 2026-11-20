// Lyrics from LRCLIB (lrclib.net: free, no key). Synced lyrics come as LRC
// ("[01:02.34] line"); they are only used when the matched recording is about
// as long as ours, otherwise the timing would drift and plain text is shown.
// VIBES_LRCLIB_URL points tests at a fake server.
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { YOUTUBE_ID_RE } from '../shared/api'
import type { LyricLine, Lyrics, SongRef } from '../shared/types'
import { fold } from './metadata'

/** How far (s) a recording's length may be from ours for its timestamps to be trusted. */
export const SYNC_TOLERANCE = 15

/** "[mm:ss.xx] text" lines → sorted lines; a line may carry several timestamps; tags like [ar:…] are skipped. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\]/g)]
    if (stamps.length === 0) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2].replace(':', '.')), text })
  }
  return out.sort((a, b) => a.t - b.t)
}

export { currentLine } from '../shared/lyrics'

export interface LrclibRecord {
  trackName: string
  artistName: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

/** The best record for our song: same artist and title, synced and closest in length first. */
export function pickLyrics(
  records: LrclibRecord[],
  title: string,
  artists: string,
  durationSec: number | null
): Lyrics | null {
  const t = fold(title)
  const ours = ` ${fold(artists)} `
  const matching = records.filter((r) => {
    const name = fold(r.artistName ?? '')
    const rt = fold(r.trackName ?? '')
    return !!name && ours.includes(` ${name} `) && (rt === t || ` ${rt} `.includes(` ${t} `) || ` ${t} `.includes(` ${rt} `))
  })
  if (matching.length === 0) return null
  const off = (r: LrclibRecord): number =>
    durationSec != null && r.duration ? Math.abs(r.duration - durationSec) : 0
  const syncable = matching.filter((r) => r.syncedLyrics && off(r) <= SYNC_TOLERANCE).sort((a, b) => off(a) - off(b))
  if (syncable.length) {
    const lines = parseLrc(syncable[0].syncedLyrics!)
    if (lines.length) return { synced: lines, plain: syncable[0].plainLyrics ?? null, instrumental: false }
  }
  const withText = matching.filter((r) => r.plainLyrics || r.syncedLyrics).sort((a, b) => off(a) - off(b))
  if (withText.length) {
    const r = withText[0]
    const plain = r.plainLyrics || parseLrc(r.syncedLyrics!).map((l) => l.text).join('\n')
    return { synced: null, plain, instrumental: false }
  }
  if (matching.some((r) => r.instrumental)) return { synced: null, plain: null, instrumental: true }
  return null
}

export async function fetchLyrics(
  song: { title: string; artists: string; durationSec: number | null },
  fetchImpl: typeof fetch = fetch,
  base = process.env.VIBES_LRCLIB_URL || 'https://lrclib.net'
): Promise<Lyrics | null> {
  const artist = song.artists.split(/,|&|\s(?:feat\.?|ft\.?|x|y)\s/i)[0]?.trim() ?? ''
  const q = new URLSearchParams({ track_name: song.title, artist_name: artist })
  const res = await fetchImpl(`${base}/api/search?${q}`, {
    headers: { 'user-agent': 'Vibes/0.1 (desktop music player)' },
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`)
  return pickLyrics((await res.json()) as LrclibRecord[], song.title, song.artists, song.durationSec)
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
