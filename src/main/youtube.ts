// Searching YouTube with yt-dlp (no API key): `ytsearchN:<query>` with
// --flat-playlist lists the videos without resolving each one, so a search
// takes a second or two. Titles are cleaned into song + artist.
import { YOUTUBE_ID_RE } from '../shared/api'
import type { Recommendations, SearchResult } from '../shared/types'
import { run, type Tools } from './media'

export const SEARCH_LIMIT = 20
const MAX_QUERY = 200

export function searchArgs(query: string, limit = SEARCH_LIMIT): string[] {
  // `--` ends the options, so a query starting with "-" is still just a query.
  return ['--flat-playlist', '--dump-json', '--no-warnings', '--ignore-config', '--', `ytsearch${limit}:${query}`]
}

// "(Official Video)", "[Lyrics]", "(Video Oficial)", "(Audio)", "(HD)", "(Visualizer)"…
const NOISE =
  /\s*[([](?:official|oficial|video|vídeo|audio|lyrics?|letra|visualizer|hd|hq|4k|mv|music video)(?:[^)\]]*)[)\]]/gi

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// "A, B", "A & B", "A feat. B", "A ft B", "A x B": a list of artists, not a song name.
const ARTIST_LIST = /,|&|\s(?:feat\.?|ft\.?|x)\s/i

/**
 * "Artist - Song (Official Video)" → { artists: "Artist", title: "Song" }.
 * Many channels write it the other way ("daño - Peso Pluma & Tito Double P"),
 * so the sides swap when the right one has the channel's name, or (no channel
 * to go by) when only the right one looks like a list of artists. With no dash,
 * the channel is the artist.
 */
export function cleanTitle(raw: string, channel: string): { title: string; artists: string } {
  const text = raw.replace(NOISE, '').replace(/\s+/g, ' ').trim() || raw.trim()
  const ch = fold(channel.replace(/\s+-\s+Topic$/i, '').replace(/VEVO$/i, ''))
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(text)
  if (dash) {
    const [left, right] = [dash[1].trim(), dash[2].trim()]
    // Whole words, so a channel named "x" doesn't match "remix".
    const hasChannel = (s: string): boolean => !!ch && ` ${fold(s)} `.includes(` ${ch} `)
    const swap = hasChannel(left)
      ? false
      : hasChannel(right) || (ARTIST_LIST.test(right) && !ARTIST_LIST.test(left))
    return swap ? { artists: right, title: left } : { artists: left, title: right }
  }
  const artists = channel
    .replace(/\s+-\s+Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim()
  return { title: text, artists }
}

interface FlatEntry {
  id?: unknown
  title?: unknown
  channel?: unknown
  uploader?: unknown
  duration?: unknown
  ie_key?: unknown
  live_status?: unknown
}

/** One JSON object per line; keeps only real, non-live videos. */
export function parseSearchOutput(stdout: string): SearchResult[] {
  const results: SearchResult[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let e: FlatEntry
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof e.id !== 'string' || !YOUTUBE_ID_RE.test(e.id)) continue // channels, playlists
    if (e.ie_key !== undefined && e.ie_key !== 'Youtube') continue
    if (e.live_status === 'is_live' || e.live_status === 'is_upcoming') continue
    if (typeof e.title !== 'string' || !e.title.trim()) continue
    const channel = typeof e.channel === 'string' ? e.channel : typeof e.uploader === 'string' ? e.uploader : ''
    results.push({
      id: e.id,
      ...cleanTitle(e.title, channel),
      durationSec: typeof e.duration === 'number' && e.duration > 0 ? Math.round(e.duration) : null,
      // mqdefault is 16:9 with no black bars (hqdefault is 4:3, letterboxed).
      coverUrl: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`
    })
  }
  return results
}

export async function searchYoutube(tools: Tools, query: string): Promise<SearchResult[]> {
  const q = query.trim().slice(0, MAX_QUERY)
  if (!q) return []
  return parseSearchOutput(await run(tools.ytdlp, searchArgs(q), 60_000))
}

// ── Recommendations ───────────────────────────────────────────────────────────
// YouTube's "Mix" for a video (playlist RD<id>) is its own radio of similar
// songs. A few songs from the library seed a few mixes; whatever the library
// doesn't have yet is recommended. No API key, and every hit is a YouTube id,
// so "Agregar" works on it directly.

export const MIX_ITEMS = 25
export const SEED_COUNT = 3
export const RECOMMEND_LIMIT = 24

export function mixArgs(id: string, items = MIX_ITEMS): string[] {
  if (!YOUTUBE_ID_RE.test(id)) throw new Error(`Invalid YouTube id: ${id}`)
  return [
    '--flat-playlist', '--dump-json', '--no-warnings', '--ignore-config',
    '--playlist-items', `1:${items}`,
    '--', `https://www.youtube.com/watch?v=${id}&list=RD${id}`
  ]
}

/** Up to `n` songs to base the mixes on, at random among the most played / recently played / newest. */
export function pickSeeds<
  T extends { id: string; file: string | null; playCount: number; addedAt: number; lastPlayedAt?: number }
>(
  songs: T[],
  n = SEED_COUNT,
  rand: () => number = Math.random
): T[] {
  const pool = songs
    .filter((s) => s.file)
    .sort(
      (a, b) =>
        b.playCount - a.playCount || (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.addedAt - a.addedAt
    )
    .slice(0, 40)
  const seeds: T[] = []
  while (seeds.length < n && pool.length) {
    seeds.push(pool.splice(Math.min(pool.length - 1, Math.floor(rand() * pool.length)), 1)[0])
  }
  return seeds
}

/**
 * True when the library already has this song under another video: its title
 * (folded) is part of a library song's title and the artist appears there too.
 * Library titles are often messy ("Radiohead - Karma Police - Arabic subtitles"),
 * hence "part of" rather than equal.
 */
export function inLibraryByName(r: { title: string; artists: string }, library: { title: string; artists: string }[]): boolean {
  const title = fold(r.title)
  const artist = fold(r.artists.split(/,|&|\s(?:feat\.?|ft\.?|x)\s/i)[0] ?? '')
  if (title.length < 3) return false
  return library.some((s) => {
    const t = ` ${fold(s.title)} `
    return t.includes(` ${title} `) && (!artist || ` ${fold(s.artists)} ${t} `.includes(` ${artist} `))
  })
}

/** A library title fit for "Porque escuchas …": no artist prefix, tags or trailing " - extra". */
export function shortTitle(title: string, artists: string): string {
  return cleanTitle(title, artists).title.split(/\s+[-–—|/]\s+/)[0].trim() || title
}

/** Takes turns between the mixes so every seed is represented; skips known and repeated songs. */
export function mergeMixes(
  mixes: SearchResult[][],
  known: Set<string>,
  limit = RECOMMEND_LIMIT,
  isKnown: (r: SearchResult) => boolean = () => false
): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set(known)
  for (let i = 0; out.length < limit && mixes.some((m) => i < m.length); i++) {
    for (const mix of mixes) {
      const r = mix[i]
      if (!r || seen.has(r.id) || isKnown(r)) continue
      seen.add(r.id)
      out.push(r)
      if (out.length === limit) break
    }
  }
  return out
}

export async function recommend(
  tools: Tools,
  library: { id: string; title: string; artists: string; file: string | null; playCount: number; addedAt: number }[],
  rand: () => number = Math.random
): Promise<Recommendations> {
  const seeds = pickSeeds(library, SEED_COUNT, rand)
  if (seeds.length === 0) return { basedOn: [], results: [] }
  // One broken mix shouldn't sink the others.
  const mixes = await Promise.all(
    seeds.map((s) => run(tools.ytdlp, mixArgs(s.id), 60_000).then(parseSearchOutput, () => null))
  )
  const ok = mixes.filter((m): m is SearchResult[] => m !== null)
  if (ok.length === 0) throw new Error('No se pudieron cargar las recomendaciones de YouTube')
  return {
    basedOn: seeds.map((s) => shortTitle(s.title, s.artists)),
    results: mergeMixes(ok, new Set(library.map((s) => s.id)), RECOMMEND_LIMIT, (r) => inLibraryByName(r, library))
  }
}

// ── Streaming without downloading (previews, radio) ───────────────────────────

export function streamArgs(id: string): string[] {
  if (!YOUTUBE_ID_RE.test(id)) throw new Error(`Invalid YouTube id: ${id}`)
  return [
    '-g', '-f', 'bestaudio[ext=m4a]/bestaudio',
    '--no-playlist', '--no-warnings', '--ignore-config',
    '--', `https://www.youtube.com/watch?v=${id}`
  ]
}

/** YouTube's direct audio URLs last ~6 h; reuse them for an hour. */
const STREAM_TTL = 3600_000

export function streamResolver(
  tools: Tools,
  now: () => number = Date.now
): (id: string) => Promise<string> {
  const cache = new Map<string, { url: Promise<string>; at: number }>()
  return (id) => {
    const hit = cache.get(id)
    if (hit && now() - hit.at < STREAM_TTL) return hit.url
    const url = run(tools.ytdlp, streamArgs(id), 60_000).then((out) => {
      const line = out.split('\n').find((l) => /^https?:\/\//.test(l.trim()))
      if (!line) throw new Error('YouTube no dio el audio de esta canción')
      return line.trim()
    })
    url.catch(() => cache.delete(id)) // a failure is retried next time
    cache.set(id, { url, at: now() })
    return url
  }
}

/** "Radio" from a song: its YouTube mix, minus the song itself and what the library has. */
export async function radioFor(
  tools: Tools,
  id: string,
  library: { id: string; title: string; artists: string }[]
): Promise<SearchResult[]> {
  const mix = parseSearchOutput(await run(tools.ytdlp, mixArgs(id), 60_000))
  return mergeMixes([mix], new Set([id, ...library.map((s) => s.id)]), MIX_ITEMS, (r) =>
    inLibraryByName(r, library)
  )
}
