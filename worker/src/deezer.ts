// Song search for the phone, with Deezer's public API (no key): real titles,
// album covers and a 30-second preview clip. Deezer's preview URLs are signed
// and expire after a while, so they are only used right away, never stored.
import { deezerRequestId, type SearchHit } from '../../src/shared/api'

const API = 'https://api.deezer.com'
export const SEARCH_RESULTS = 25

export class DeezerError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

interface Track {
  id?: number
  readable?: boolean
  title?: string
  duration?: number
  preview?: string
  artist?: { name?: string }
  album?: { cover_big?: string; cover_medium?: string }
}

export async function searchDeezer(query: string, doFetch: typeof fetch = fetch): Promise<SearchHit[]> {
  let res: Response
  try {
    res = await doFetch(`${API}/search?${new URLSearchParams({ q: query, limit: String(SEARCH_RESULTS) })}`, {
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    throw new DeezerError('Deezer no respondió', 502)
  }
  if (!res.ok) throw new DeezerError(`Deezer respondió ${res.status}`, 502)
  const body = (await res.json().catch(() => null)) as { data?: Track[]; error?: { message?: string } } | null
  // Deezer answers 200 with { error } when it is overloaded.
  if (!body || body.error) throw new DeezerError('Deezer está ocupado, intenta en un momento', 503)
  const out: SearchHit[] = []
  for (const t of body.data ?? []) {
    if (!t.id || !t.title || t.readable === false) continue
    out.push({
      id: deezerRequestId(t.id),
      title: t.title,
      artists: t.artist?.name ?? '',
      durationSec: typeof t.duration === 'number' && t.duration > 0 ? t.duration : null,
      coverUrl: t.album?.cover_big || t.album?.cover_medium || null,
      deezerId: String(t.id),
      previewUrl: t.preview || null
    })
  }
  return out
}
