// YouTube search for the phone, with the YouTube Data API (key in the
// YOUTUBE_API_KEY secret). One search costs ~101 of the 10,000 free daily units:
// search.list (100) for the ids, videos.list (1) for real titles and durations.
import type { SearchHit } from '../../src/shared/api'
import { cleanTitle } from '../../src/shared/title'

const API = 'https://www.googleapis.com/youtube/v3'
export const SEARCH_RESULTS = 15

export class YoutubeError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** "PT1H2M3S" → 3723; null if it isn't one. */
export function parseDuration(iso: unknown): number | null {
  const m = typeof iso === 'string' ? /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso) : null
  if (!m || iso === 'P' || iso === 'PT') return null
  const [d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0))
  return d * 86400 + h * 3600 + mi * 60 + s
}

interface VideoItem {
  id: string
  snippet?: {
    title?: string
    channelTitle?: string
    liveBroadcastContent?: string
    thumbnails?: Record<string, { url?: string } | undefined>
  }
  contentDetails?: { duration?: string }
}

export async function searchYoutube(key: string, query: string, doFetch: typeof fetch = fetch): Promise<SearchHit[]> {
  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`
    let res: Response
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(10_000) })
    } catch {
      throw new YoutubeError('YouTube no respondió', 502)
    }
    if (res.ok) return (await res.json()) as T
    const body = (await res.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null
    const reason = body?.error?.errors?.[0]?.reason ?? ''
    if (/quota/i.test(reason)) throw new YoutubeError('Se acabaron las búsquedas de hoy (límite gratis de YouTube). Mañana se renueva.', 503)
    if (res.status === 400 || res.status === 403) throw new YoutubeError('La API key de YouTube no es válida o no tiene habilitada YouTube Data API v3', 502)
    throw new YoutubeError(`YouTube respondió ${res.status}`, 502)
  }

  const found = await get<{ items?: { id?: { videoId?: string } }[] }>('search', {
    part: 'id',
    type: 'video',
    maxResults: String(SEARCH_RESULTS),
    q: query
  })
  const ids = (found.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x)
  if (ids.length === 0) return []
  const videos = await get<{ items?: VideoItem[] }>('videos', { part: 'snippet,contentDetails', id: ids.join(',') })
  const byId = new Map((videos.items ?? []).map((v) => [v.id, v]))
  const out: SearchHit[] = []
  for (const id of ids) {
    const v = byId.get(id)
    const sn = v?.snippet
    if (!sn?.title || sn.liveBroadcastContent === 'live' || sn.liveBroadcastContent === 'upcoming') continue
    const { title, artists } = cleanTitle(sn.title, sn.channelTitle ?? '')
    const t = sn.thumbnails ?? {}
    out.push({
      id,
      title,
      artists,
      durationSec: parseDuration(v?.contentDetails?.duration),
      coverUrl: (t.high ?? t.medium ?? t.default)?.url ?? null
    })
  }
  return out
}
