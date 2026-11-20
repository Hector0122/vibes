import {
  API_PREFIX,
  MAX_AUDIO_BYTES,
  PRESIGN_EXPIRES_SECONDS,
  SHA256_RE,
  YOUTUBE_ID_RE,
  pickMeta,
  validateMeta,
  validatePlaylists,
  type ApiError,
  type CloudPlaylist,
  type ListPlaylistsResponse,
  type PutPlaylistsRequest,
  type CloudSong,
  type ListSongsResponse,
  type SongMeta,
  type StreamResponse,
  type UploadBeginRequest,
  type UploadBeginResponse
} from '../../src/shared/api'
import { isAuthorized } from './auth'
import type { Env } from './env'
import type { Presigner } from './presign'

interface PlaylistRow {
  id: string
  name: string
  song_ids: string
  created_at: number
  updated_at: number
}

interface SongRow {
  id: string
  meta: string
  size: number
  sha256: string
  status: 'pending' | 'complete'
  updated_at: number
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError
  ) {
    super(body.error)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const fail = (status: number, error: string): never => {
  throw new HttpError(status, { error })
}

export const audioKey = (id: string): string => `songs/${id}.m4a`

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return fail(400, 'Body must be JSON')
  }
}

function toSong(row: SongRow): CloudSong {
  return {
    id: row.id,
    ...(JSON.parse(row.meta) as SongMeta),
    size: row.size,
    sha256: row.sha256,
    updatedAt: row.updated_at
  }
}

export interface App {
  fetch(request: Request, env: Env): Promise<Response>
}

export function createApp(presign: Presigner): App {
  const getSong = (env: Env, id: string): Promise<SongRow | null> =>
    env.DB.prepare('SELECT id, meta, size, sha256, status, updated_at FROM songs WHERE id = ?')
      .bind(id)
      .first<SongRow>()

  async function listSongs(env: Env): Promise<ListSongsResponse> {
    const { results } = await env.DB.prepare(
      "SELECT id, meta, size, sha256, status, updated_at FROM songs WHERE status = 'complete' ORDER BY created_at"
    ).all<SongRow>()
    return { songs: results.map(toSong) }
  }

  async function beginUpload(env: Env, id: string, request: Request): Promise<UploadBeginResponse> {
    const body = await readJson<UploadBeginRequest>(request)
    const metaError = validateMeta(body?.meta)
    if (metaError) fail(400, metaError)
    if (!Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_AUDIO_BYTES) {
      fail(400, 'Invalid size')
    }
    if (typeof body.sha256 !== 'string' || !SHA256_RE.test(body.sha256)) fail(400, 'Invalid sha256')

    const now = Date.now()
    const prev = await getSong(env, id)
    // Same content already stored: only the metadata changes, the song stays listed.
    // (S3 PUTs are all-or-nothing, so a matching size means the object is whole.)
    const sameFile =
      prev?.sha256 === body.sha256 &&
      prev.size === body.size &&
      (await env.BUCKET.head(audioKey(id)))?.size === body.size
    await env.DB.prepare(
      `INSERT INTO songs (id, meta, size, sha256, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(id) DO UPDATE SET meta = excluded.meta, size = excluded.size, sha256 = excluded.sha256,
         updated_at = excluded.updated_at, status = CASE WHEN ? THEN songs.status ELSE 'pending' END`
    )
      .bind(id, JSON.stringify(pickMeta(body.meta)), body.size, body.sha256, now, now, sameFile ? 1 : 0)
      .run()
    return {
      url: sameFile ? null : await presign('PUT', audioKey(id)),
      expiresAt: now + PRESIGN_EXPIRES_SECONDS * 1000
    }
  }

  async function commit(env: Env, id: string): Promise<CloudSong> {
    const song = (await getSong(env, id)) ?? fail(404, 'Song not found')
    const head = await env.BUCKET.head(audioKey(id))
    if (!head || head.size !== song.size) fail(409, 'Audio is missing in storage')
    const now = Date.now()
    await env.DB.prepare("UPDATE songs SET status = 'complete', updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run()
    return toSong({ ...song, status: 'complete', updated_at: now })
  }

  async function stream(env: Env, id: string): Promise<StreamResponse> {
    const song = await getSong(env, id)
    if (!song || song.status !== 'complete') fail(404, 'Song not found')
    return {
      url: await presign('GET', audioKey(id)),
      expiresAt: Date.now() + PRESIGN_EXPIRES_SECONDS * 1000
    }
  }

  async function deleteSong(env: Env, id: string): Promise<{ deleted: true }> {
    if (!(await getSong(env, id))) fail(404, 'Song not found')
    await env.BUCKET.delete(audioKey(id))
    await env.DB.prepare('DELETE FROM songs WHERE id = ?').bind(id).run()
    return { deleted: true }
  }

  async function listPlaylists(env: Env): Promise<ListPlaylistsResponse> {
    const { results } = await env.DB.prepare(
      'SELECT id, name, song_ids, created_at, updated_at FROM playlists ORDER BY position'
    ).all<PlaylistRow>()
    return {
      playlists: results.map(
        (r): CloudPlaylist => ({
          id: r.id,
          name: r.name,
          songIds: JSON.parse(r.song_ids) as string[],
          createdAt: r.created_at,
          updatedAt: r.updated_at
        })
      )
    }
  }

  /** Replaces every playlist with the desktop's set, all or nothing. */
  async function putPlaylists(env: Env, request: Request): Promise<ListPlaylistsResponse> {
    const body = await readJson<PutPlaylistsRequest>(request)
    const error = validatePlaylists(body)
    if (error) fail(400, error)
    const insert = 'INSERT INTO playlists (id, name, song_ids, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    await env.DB.batch([
      env.DB.prepare('DELETE FROM playlists'),
      ...body.playlists.map((p, i) =>
        env.DB.prepare(insert).bind(p.id, p.name.trim(), JSON.stringify(p.songIds), i, p.createdAt, p.updatedAt)
      )
    ])
    return listPlaylists(env)
  }

  async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(API_PREFIX + '/')) fail(404, 'Not found')
    const path = url.pathname.slice(API_PREFIX.length)
    const method = request.method

    if (path === '/health' && method === 'GET') return json({ ok: true })
    if (path === '/songs' && method === 'GET') return json(await listSongs(env))
    if (path === '/playlists' && method === 'GET') return json(await listPlaylists(env))
    if (path === '/playlists' && method === 'PUT') return json(await putPlaylists(env, request))
    if (path === '/playlists') return fail(405, 'Method not allowed')

    const m = /^\/songs\/([^/]+)(\/(upload|commit|stream))?$/.exec(path)
    if (!m) return fail(404, 'Not found')
    const id = m[1]
    if (!YOUTUBE_ID_RE.test(id)) fail(400, 'Invalid song id')
    const action = m[3]

    if (!action && method === 'DELETE') return json(await deleteSong(env, id))
    if (action === 'upload' && method === 'POST') return json(await beginUpload(env, id, request))
    if (action === 'commit' && method === 'POST') return json(await commit(env, id))
    if (action === 'stream' && method === 'GET') return json(await stream(env, id))
    return fail(405, 'Method not allowed')
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      // Auth before routing: an unauthenticated caller learns nothing, not
      // even which paths exist.
      if (!(await isAuthorized(request, env.API_TOKEN))) {
        return json({ error: 'Unauthorized' }, 401)
      }
      try {
        return await route(request, env)
      } catch (err) {
        if (err instanceof HttpError) return json(err.body, err.status)
        console.error(err)
        return json({ error: 'Internal error' }, 500)
      }
    }
  }
}
