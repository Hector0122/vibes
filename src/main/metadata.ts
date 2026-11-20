// Real album covers and metadata for songs that came from YouTube, from
// Deezer's public search (no API key). A match must agree on artist and
// title; among those, the closest duration wins and live albums lose.
// VIBES_DEEZER_URL points tests at a fake server.
import type { SongMeta } from '../shared/api'

export interface DeezerTrack {
  id: number
  title: string
  title_short?: string
  duration?: number
  artist: { id: number; name: string }
  album: { title: string; cover_xl?: string; cover_big?: string }
}

export type Enrichment = Pick<SongMeta, 'coverUrl' | 'album' | 'deezerId' | 'deezerArtistId'>

export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ') // "(feat. X)", "[Remastered]"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const words = (s: string): string => ` ${fold(s)} `

// "A, B", "A & B", "A feat. B", "A x B", "A y B"
const ARTIST_SPLIT = /,|&|\s(?:feat\.?|ft\.?|x|y)\s/i
const mainArtist = (artists: string): string => artists.split(ARTIST_SPLIT)[0]?.trim() ?? ''

/** The best Deezer track for this title + artists, or null if none really is it. */
export function pickDeezerMatch(
  tracks: DeezerTrack[],
  title: string,
  artists: string,
  durationSec: number | null
): Enrichment | null {
  const t = fold(title)
  const ours = words(artists)
  const first = fold(mainArtist(artists))
  if (!t) return null
  const candidates = tracks.filter((d) => {
    const name = fold(d.artist?.name ?? '')
    const dt = fold(d.title_short || d.title || '')
    // Deezer's artist is among ours, or our main artist is (part of) Deezer's.
    const artistOk = !!name && (ours.includes(` ${name} `) || (!!first && words(d.artist.name).includes(` ${first} `)))
    const titleOk = !!dt && (dt === t || words(dt).includes(` ${t} `) || words(t).includes(` ${dt} `))
    return artistOk && titleOk && !!(d.album?.cover_xl || d.album?.cover_big)
  })
  if (candidates.length === 0) return null
  const live = (d: DeezerTrack): number => (/\blive\b|en vivo|ao vivo/i.test(d.album.title) ? 1 : 0)
  const off = (d: DeezerTrack): number =>
    durationSec != null && d.duration ? Math.abs(d.duration - durationSec) : 0
  const best = [...candidates].sort((x, y) => live(x) - live(y) || off(x) - off(y))[0]
  if (durationSec != null && best.duration && Math.abs(best.duration - durationSec) > 45) return null
  return {
    coverUrl: best.album.cover_xl || best.album.cover_big || null,
    album: best.album.title || null,
    deezerId: String(best.id),
    deezerArtistId: String(best.artist.id)
  }
}

export async function lookupDeezer(
  title: string,
  artists: string,
  durationSec: number | null,
  fetchImpl: typeof fetch = fetch,
  base = process.env.VIBES_DEEZER_URL || 'https://api.deezer.com'
): Promise<Enrichment | null> {
  const q = `${mainArtist(artists)} ${title}`.trim()
  if (!q) return null
  const res = await fetchImpl(`${base}/search?limit=10&q=${encodeURIComponent(q)}`, {
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) return null
  const body = (await res.json()) as { data?: DeezerTrack[] }
  return pickDeezerMatch(body.data ?? [], title, artists, durationSec)
}
