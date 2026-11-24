// The phone's client for your Worker (contract: ../../src/shared/api.ts).
// Health, songs, playlists, a signed URL to stream (or download) one; and
// searching (Deezer) + marking songs for the computer to download.
// No React Native imports, so it is tested against the real Worker with Vitest.
import {
  type UploadCoverResponse,
  API_PREFIX,
  type CloudPlaylist,
  type CloudSong,
  type ListPlaylistsResponse,
  type ListRequestsResponse,
  type ListSongsResponse,
  type PlaylistOp,
  type Play,
  type RecommendationsResponse,
  type SearchHit,
  type SearchResponse,
  type SongRequest,
  type StreamResponse,
  type UploadBeginRequest,
  type UploadBeginResponse
} from '../../src/shared/api'

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
  listPlaylists(): Promise<CloudPlaylist[]>
  search(query: string): Promise<SearchResponse['results']>
  /** "Recomendado para ti", computed by the computer. */
  recommendations(): Promise<RecommendationsResponse>
  /** Songs marked here, waiting for the computer. */
  listRequests(): Promise<SongRequest[]>
  /** Marks a song for the computer to download. */
  request(hit: SearchHit): Promise<SongRequest>
  cancelRequest(id: string): Promise<void>
  /** Playlist edits made here; returns the playlists as they are now. */
  editPlaylists(ops: PlaylistOp[]): Promise<CloudPlaylist[]>
  /** Plays counted here, for the computer's counts. */
  sendPlays(plays: Play[]): Promise<void>
  /** A signed R2 URL, valid for 15 minutes. */
  streamUrl(id: string): Promise<string>
  /** Starts uploading a file (an audiobook chapter): where to PUT it, or null if the cloud has it. */
  beginUpload(id: string, req: UploadBeginRequest): Promise<UploadBeginResponse>
  /** The file is in the cloud: list it. */
  commit(id: string): Promise<CloudSong>
  /** Deletes a song from the cloud (the computer removes it too). */
  deleteSong(id: string): Promise<void>
  /** Stores an image (a book's cover); returns its URL, which loads without the token. */
  uploadCover(bytes: Uint8Array, type: string): Promise<string>
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

export function createCloud(opts: {
  url: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
}): Cloud {
  const base = normalizeUrl(opts.url)
  if (!base) throw new CloudError('La URL debe empezar con https://', 0)
  const doFetch = opts.fetch ?? globalThis.fetch

  async function call<T>(path: string, method = 'GET', body?: unknown, type = 'application/json'): Promise<T> {
    let res: Response
    try {
      res = await doFetch(`${base}${API_PREFIX}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${opts.token.trim()}`,
          ...(body !== undefined ? { 'content-type': type } : {})
        },
        body: body === undefined ? undefined : body instanceof Uint8Array ? (body as unknown as BodyInit) : JSON.stringify(body),
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
    // An older Worker without playlists answers 404: treat it as "none yet".
    listPlaylists: () =>
      call<ListPlaylistsResponse>('/playlists').then(
        (r) => r.playlists,
        (e: unknown) => {
          if (e instanceof CloudError && e.status === 404) return []
          throw e
        }
      ),
    search: (q) =>
      call<SearchResponse>(`/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.results),
    recommendations: () =>
      call<RecommendationsResponse>('/recommendations').catch((e: unknown) => {
        if (e instanceof CloudError && e.status === 404)
          return { basedOn: [], results: [], updatedAt: null }
        throw e
      }),
    listRequests: () =>
      call<ListRequestsResponse>('/requests').then(
        (r) => r.requests,
        (e: unknown) => {
          if (e instanceof CloudError && e.status === 404) return []
          throw e
        }
      ),
    request: (hit) =>
      call<SongRequest>('/requests', 'POST', {
        id: hit.id,
        title: hit.title,
        artists: hit.artists,
        durationSec: hit.durationSec,
        coverUrl: hit.coverUrl,
        deezerId: hit.deezerId ?? null
      }),
    cancelRequest: (id) =>
      call<unknown>(`/requests/${encodeURIComponent(id)}`, 'DELETE').then(() => undefined),
    editPlaylists: (ops) =>
      call<ListPlaylistsResponse>('/playlists/ops', 'POST', { ops }).then((r) => r.playlists),
    sendPlays: (plays) => call<unknown>('/plays', 'POST', { plays }).then(() => undefined),
    streamUrl: (id) =>
      call<StreamResponse>(`/songs/${encodeURIComponent(id)}/stream`).then((r) => r.url),
    beginUpload: (id, req) =>
      call<UploadBeginResponse>(`/songs/${encodeURIComponent(id)}/upload`, 'POST', req),
    commit: (id) => call<CloudSong>(`/songs/${encodeURIComponent(id)}/commit`, 'POST'),
    deleteSong: (id) =>
      call<unknown>(`/songs/${encodeURIComponent(id)}`, 'DELETE').then(
        () => undefined,
        (e: unknown) => {
          if (e instanceof CloudError && e.status === 404) return // already gone
          throw e
        }
      ),
    uploadCover: (bytes, type) =>
      call<UploadCoverResponse>('/covers', 'POST', bytes, type).then((r) => r.coverUrl)
  }
}
