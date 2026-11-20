// The phone's client for your Worker (contract: ../../src/shared/api.ts).
// Read-only for now: health, the list of songs, and a signed URL to stream one.
// No React Native imports, so it is tested against the real Worker with Vitest.
import { API_PREFIX, type CloudSong, type ListSongsResponse, type StreamResponse } from '../../src/shared/api'

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'CloudError'
  }
}

export interface Cloud {
  health(): Promise<void>
  listSongs(): Promise<CloudSong[]>
  /** A signed R2 URL, valid for 15 minutes. */
  streamUrl(id: string): Promise<string>
}

/** "https://x.workers.dev/" → "https://x.workers.dev"; '' when it isn't an https URL. */
export function normalizeUrl(raw: string): string {
  const s = raw.trim().replace(/\/+$/, '')
  try {
    const u = new URL(s)
    return u.protocol === 'https:' ? s : ''
  } catch {
    return ''
  }
}

export function createCloud(opts: { url: string; token: string; fetch?: typeof fetch; timeoutMs?: number }): Cloud {
  const base = normalizeUrl(opts.url)
  if (!base) throw new CloudError('La URL debe empezar con https://', 0)
  const doFetch = opts.fetch ?? globalThis.fetch

  async function call<T>(path: string): Promise<T> {
    let res: Response
    try {
      res = await doFetch(`${base}${API_PREFIX}${path}`, {
        headers: { authorization: `Bearer ${opts.token.trim()}` },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000)
      })
    } catch {
      throw new CloudError('No se pudo conectar con la nube. Revisa tu internet y la URL.', 0)
    }
    if (res.status === 401) throw new CloudError('Token de la nube inválido', 401)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new CloudError(body?.error ?? `La nube respondió ${res.status}`, res.status)
    }
    return (await res.json()) as T
  }

  return {
    health: () => call<unknown>('/health').then(() => undefined),
    listSongs: () => call<ListSongsResponse>('/songs').then((r) => r.songs),
    streamUrl: (id) => call<StreamResponse>(`/songs/${encodeURIComponent(id)}/stream`).then((r) => r.url)
  }
}
