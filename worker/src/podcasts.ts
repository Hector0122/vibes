// Podcast search for the phone, with Apple's podcast directory (the iTunes Search API):
// free, no account or key. Search gives the shows; a lookup gives a show's latest
// episodes, each with the link to its audio on the show's own server.
import { MAX_PODCAST_EPISODES, type Podcast, type PodcastEpisode } from '../../src/shared/api'

const API = 'https://itunes.apple.com'
/** Mexico's store: Spanish-language shows come first. */
const COUNTRY = 'MX'
export const PODCAST_RESULTS = 30
const MAX_DESCRIPTION = 400

export class PodcastError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function call(path: string, params: Record<string, string>, doFetch: typeof fetch): Promise<Entry[]> {
  let res: Response
  try {
    res = await doFetch(`${API}${path}?${new URLSearchParams({ ...params, country: COUNTRY })}`, {
      headers: { 'User-Agent': 'Vibes/1.0' },
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    throw new PodcastError('Apple Podcasts no respondió', 502)
  }
  // Apple answers 403/429 when called too often.
  if (res.status === 403 || res.status === 429) {
    throw new PodcastError('Apple Podcasts está recibiendo muchas búsquedas: intenta en un minuto', 503)
  }
  if (!res.ok) throw new PodcastError(`Apple Podcasts respondió ${res.status}`, 502)
  const body = (await res.json().catch(() => null)) as { results?: Entry[] } | null
  if (!body) throw new PodcastError('Apple Podcasts respondió algo que no se entiende', 502)
  return body.results ?? []
}

/** A show (search, and the first entry of a lookup) or one of its episodes. */
interface Entry {
  wrapperType?: string
  kind?: string
  collectionId?: number
  collectionName?: string
  artistName?: string
  artworkUrl600?: string
  artworkUrl100?: string
  trackId?: number
  trackName?: string
  episodeUrl?: string
  trackTimeMillis?: number
  releaseDate?: string
  description?: string
}

const toPodcast = (e: Entry): Podcast | null =>
  e.collectionId && e.collectionName?.trim()
    ? {
        id: String(e.collectionId),
        title: e.collectionName.trim(),
        author: (e.artistName ?? '').trim(),
        image: e.artworkUrl600 || e.artworkUrl100 || null
      }
    : null

/** "<p>Hola &amp; adiós</p>" → "Hola & adiós", cut to a few lines. */
export function plainText(html: string | undefined): string {
  const s = (html ?? '')
    .replace(/<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  return s.length > MAX_DESCRIPTION ? `${s.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : s
}

export async function searchPodcasts(query: string, doFetch: typeof fetch = fetch): Promise<Podcast[]> {
  const found = await call(
    '/search',
    { media: 'podcast', entity: 'podcast', term: query, limit: String(PODCAST_RESULTS) },
    doFetch
  )
  return found.map(toPodcast).filter((p): p is Podcast => !!p)
}

export async function podcastEpisodes(showId: string, doFetch: typeof fetch = fetch): Promise<PodcastEpisode[]> {
  const found = await call(
    '/lookup',
    { id: showId, entity: 'podcastEpisode', limit: String(MAX_PODCAST_EPISODES) },
    doFetch
  )
  const show = found.find((e) => e.kind === 'podcast')
  const out: PodcastEpisode[] = []
  for (const e of found) {
    if (e.wrapperType !== 'podcastEpisode') continue
    if (!e.trackId || !e.trackName?.trim() || !e.episodeUrl || !/^https?:\/\//i.test(e.episodeUrl)) continue
    const at = e.releaseDate ? Date.parse(e.releaseDate) : NaN
    out.push({
      id: String(e.trackId),
      podcastId: String(e.collectionId ?? showId),
      title: e.trackName.trim(),
      // Android blocks plain http by default; most shows serve https on the same URL.
      url: e.episodeUrl.replace(/^http:\/\//i, 'https://'),
      durationSec: e.trackTimeMillis && e.trackTimeMillis > 0 ? Math.round(e.trackTimeMillis / 1000) : null,
      publishedAt: Number.isFinite(at) ? at : null,
      image: e.artworkUrl600 || show?.artworkUrl600 || null,
      description: plainText(e.description)
    })
  }
  return out.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
}
