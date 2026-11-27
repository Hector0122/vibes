// Podcast search for the phone, with Podcast Index (podcastindex.org): free and open,
// but every call is signed with a key and secret, so they stay here as Worker secrets
// (PODCASTINDEX_KEY, PODCASTINDEX_SECRET) and never reach the phone.
// Auth: X-Auth-Key, X-Auth-Date (unix seconds) and Authorization = sha1(key + secret + date).
import { MAX_PODCAST_EPISODES, type Podcast, type PodcastEpisode } from '../../src/shared/api'

const API = 'https://api.podcastindex.org/api/1.0'
export const PODCAST_RESULTS = 30
const MAX_DESCRIPTION = 400

export class PodcastIndexError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export interface PodcastIndexKeys {
  key: string
  secret: string
}

async function sha1Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function call<T>(
  keys: PodcastIndexKeys,
  path: string,
  params: Record<string, string>,
  doFetch: typeof fetch,
  now: () => number
): Promise<T> {
  const date = String(Math.floor(now() / 1000))
  let res: Response
  try {
    res = await doFetch(`${API}${path}?${new URLSearchParams(params)}`, {
      headers: {
        'User-Agent': 'Vibes/1.0',
        'X-Auth-Key': keys.key,
        'X-Auth-Date': date,
        Authorization: await sha1Hex(keys.key + keys.secret + date)
      },
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    throw new PodcastIndexError('Podcast Index no respondió', 502)
  }
  if (res.status === 401 || res.status === 403) {
    throw new PodcastIndexError(
      'Podcast Index rechazó la llave (revisa PODCASTINDEX_KEY y PODCASTINDEX_SECRET)',
      502
    )
  }
  if (!res.ok) throw new PodcastIndexError(`Podcast Index respondió ${res.status}`, 502)
  const body = (await res.json().catch(() => null)) as (T & { status?: unknown }) | null
  if (!body) throw new PodcastIndexError('Podcast Index respondió algo que no se entiende', 502)
  return body
}

interface Feed {
  id?: number
  title?: string
  author?: string
  ownerName?: string
  image?: string
  artwork?: string
  dead?: number
}

interface Item {
  id?: number
  feedId?: number
  title?: string
  enclosureUrl?: string
  duration?: number | null
  datePublished?: number
  image?: string
  feedImage?: string
  description?: string
}

const toPodcast = (f: Feed): Podcast | null =>
  f.id && f.title?.trim()
    ? {
        id: String(f.id),
        title: f.title.trim(),
        author: (f.author || f.ownerName || '').trim(),
        image: f.artwork || f.image || null
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

export async function searchPodcasts(
  keys: PodcastIndexKeys,
  query: string,
  doFetch: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<Podcast[]> {
  const body = await call<{ feeds?: Feed[] }>(
    keys,
    '/search/byterm',
    { q: query, max: String(PODCAST_RESULTS) },
    doFetch,
    now
  )
  return (body.feeds ?? [])
    .filter((f) => !f.dead)
    .map(toPodcast)
    .filter((p): p is Podcast => !!p)
}

export async function podcastEpisodes(
  keys: PodcastIndexKeys,
  feedId: string,
  doFetch: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<PodcastEpisode[]> {
  const body = await call<{ items?: Item[] }>(
    keys,
    '/episodes/byfeedid',
    { id: feedId, max: String(MAX_PODCAST_EPISODES), fulltext: '' },
    doFetch,
    now
  )
  const out: PodcastEpisode[] = []
  for (const it of body.items ?? []) {
    if (!it.id || !it.title?.trim() || !it.enclosureUrl || !/^https?:\/\//i.test(it.enclosureUrl))
      continue
    out.push({
      id: String(it.id),
      podcastId: String(it.feedId ?? feedId),
      title: it.title.trim(),
      // Android blocks plain http by default; most shows serve https on the same URL.
      url: it.enclosureUrl.replace(/^http:\/\//i, 'https://'),
      durationSec: typeof it.duration === 'number' && it.duration > 0 ? it.duration : null,
      publishedAt: it.datePublished ? it.datePublished * 1000 : null,
      image: it.image || it.feedImage || null,
      description: plainText(it.description)
    })
  }
  return out.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
}
