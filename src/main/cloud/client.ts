// Typed client for the Worker API (src/shared/api.ts) plus the raw PUT to a
// presigned R2 URL. Retries only network failures, timeouts and 5xx — never
// 4xx, which won't change on retry. (Trimmed from velody's cloud client.)
import {
  API_PREFIX,
  type ApiError,
  type CloudSong,
  type ListPlaylistsResponse,
  type ListRequestsResponse,
  type PutRecommendationsRequest,
  type ListSongsResponse,
  type PutPlaylistsRequest,
  type UploadBeginRequest,
  type UploadBeginResponse
} from '../../shared/api'

export class CloudApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'CloudApiError'
  }
}

export interface CloudClientOptions {
  baseUrl: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Timeout for one audio upload (a few MB). */
  transferTimeoutMs?: number
  retries?: number
  retryDelayMs?: number
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return 'La nube no respondió a tiempo'
  }
  return `No se pudo conectar con la nube (${err instanceof Error ? err.message : String(err)})`
}

export class CloudClient {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string

  constructor(private readonly opts: CloudClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '') + API_PREFIX
  }

  private async send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const retries = this.opts.retries ?? 2
    const delay = this.opts.retryDelayMs ?? 500
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, delay * 2 ** (attempt - 1)))
      try {
        const res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
        if (res.status >= 500 && attempt < retries) {
          lastError = new CloudApiError(`Error de la nube ${res.status}`, res.status)
          continue
        }
        return res
      } catch (err) {
        lastError = err
      }
    }
    if (lastError instanceof CloudApiError) throw lastError
    throw new CloudApiError(describeNetworkError(lastError), 0)
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(
      this.baseUrl + path,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      },
      this.opts.timeoutMs ?? 15_000
    )
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const message =
        res.status === 401
          ? 'Token de la nube inválido'
          : ((parsed as ApiError | null)?.error ?? `Error de la nube ${res.status}`)
      throw new CloudApiError(message, res.status)
    }
    return parsed as T
  }

  async health(): Promise<void> {
    await this.api('GET', '/health')
  }

  listSongs(): Promise<ListSongsResponse> {
    return this.api('GET', '/songs')
  }

  beginUpload(id: string, req: UploadBeginRequest): Promise<UploadBeginResponse> {
    return this.api('POST', `/songs/${id}/upload`, req)
  }

  commit(id: string): Promise<CloudSong> {
    return this.api('POST', `/songs/${id}/commit`)
  }

  /** Replaces the cloud's playlists with these (the desktop is the source of truth). */
  putPlaylists(req: PutPlaylistsRequest): Promise<ListPlaylistsResponse> {
    return this.api('PUT', '/playlists', req)
  }

  /** Songs marked on the phone, waiting to be downloaded here. */
  listRequests(): Promise<ListRequestsResponse> {
    return this.api('GET', '/requests')
  }

  async putRecommendations(req: PutRecommendationsRequest): Promise<void> {
    await this.api('PUT', '/recommendations', req)
  }

  async deleteRequest(id: string): Promise<void> {
    await this.api('DELETE', `/requests/${id}`)
  }

  async failRequest(id: string, error: string): Promise<void> {
    await this.api('POST', `/requests/${id}/fail`, { error })
  }

  async putFile(url: string, data: Buffer): Promise<void> {
    const res = await this.send(
      url,
      { method: 'PUT', headers: { 'Content-Type': 'audio/mp4' }, body: new Uint8Array(data) },
      this.opts.transferTimeoutMs ?? 120_000
    )
    if (!res.ok) throw new CloudApiError(`Falló la subida a R2 (${res.status})`, res.status)
  }
}
