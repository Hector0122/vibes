import {
  API_PREFIX,
  MAX_AUDIO_BYTES,
  MAX_BOOK_BYTES,
  MAX_COVER_BYTES,
  COVER_TYPES,
  COVER_NAME_RE,
  MAX_QUERY,
  MAX_REQUESTS,
  PRESIGN_EXPIRES_SECONDS,
  SHA256_RE,
  YOUTUBE_ID_RE,
  pickMeta,
  validateMeta,
  REQUEST_ID_RE,
  validateHit,
  validateRecommendations,
  applyPlaylistOp,
  validatePlaylistOps,
  validatePlaylists,
  validatePlays,
  validatePodcast,
  PODCAST_ID_RE,
  MAX_PODCAST_SUBSCRIPTIONS,
  type ListPodcastSubscriptionsResponse,
  type Podcast,
  type ApiError,
  type CloudPlaylist,
  type ListPlaylistOpsResponse,
  type ListPlaylistsResponse,
  type PlaylistOp,
  type PostPlaylistOpsRequest,
  type ListPlaysResponse,
  type ListDeletionsResponse,
  type PostPlaysRequest,
  type PutPlaylistsRequest,
  type CloudSong,
  type ListRequestsResponse,
  type ListVelodySendsResponse,
  type VelodySend,
  type PutRecommendationsRequest,
  type RecommendationsResponse,
  type ListSongsResponse,
  type SearchHit,
  type SearchResponse,
  type SongRequest,
  type SongMeta,
  type StreamResponse,
  type UploadBeginRequest,
  type UploadBeginResponse,
  type UploadCoverResponse
} from '../../src/shared/api'
import { isAuthorized } from './auth'
import type { Env } from './env'
import type { Presigner } from './presign'
import { DeezerError, searchDeezer } from './deezer'

interface RequestRow {
  id: string
  title: string
  artists: string
  duration_sec: number | null
  cover_url: string | null
  deezer_id: string | null
  status: 'pending' | 'failed'
  error: string | null
  created_at: number
}

const toRequest = (r: RequestRow): SongRequest => ({
  id: r.id,
  title: r.title,
  artists: r.artists,
  durationSec: r.duration_sec,
  coverUrl: r.cover_url,
  deezerId: r.deezer_id,
  status: r.status,
  error: r.error,
  createdAt: r.created_at
})

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

export interface AppOptions {
  /** For calls to Deezer (tests pass a fake). */
  fetch?: typeof fetch
}

export function createApp(presign: Presigner, opts: AppOptions = {}): App {
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
    const max = body.meta.book ? MAX_BOOK_BYTES : MAX_AUDIO_BYTES
    if (!Number.isSafeInteger(body.size) || body.size <= 0 || body.size > max) {
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
    await env.DB.batch([
      env.DB.prepare('DELETE FROM songs WHERE id = ?').bind(id),
      env.DB.prepare('DELETE FROM velody_sends WHERE id = ?').bind(id),
      // So the other device removes it too.
      env.DB.prepare('INSERT INTO deletions (id, deleted_at) VALUES (?, ?)').bind(id, Date.now())
    ])
    return { deleted: true }
  }

  async function uploadCover(env: Env, request: Request, url: URL): Promise<UploadCoverResponse> {
    const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
    const ext = COVER_TYPES[type] ?? fail(400, 'Cover must be JPEG, PNG or WebP')
    const body = await request.arrayBuffer()
    if (body.byteLength === 0 || body.byteLength > MAX_COVER_BYTES) fail(400, 'Invalid cover size')
    const rand = crypto.getRandomValues(new Uint8Array(16))
    const name = `${btoa(String.fromCharCode(...rand)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 22)}.${ext}`
    await env.BUCKET.put(`covers/${name}`, body, { httpMetadata: { contentType: type } })
    return { coverUrl: `${url.origin}${API_PREFIX}/covers/${name}` }
  }

  /** Public (no token): only an exact random name gets anything back. */
  async function getCover(env: Env, name: string): Promise<Response> {
    const obj = COVER_NAME_RE.test(name) ? await env.BUCKET.get(`covers/${name}`) : null
    if (!obj) return json({ error: 'Not found' }, 404)
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    })
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

  async function search(env: Env, url: URL): Promise<SearchResponse> {
    const q = (url.searchParams.get('q') ?? '').trim()
    if (!q || q.length > MAX_QUERY) fail(400, 'Escribe qué buscar')
    let hits: SearchHit[]
    try {
      hits = await searchDeezer(q, opts.fetch ?? fetch)
    } catch (e) {
      if (e instanceof DeezerError) fail(e.status, e.message)
      throw e
    }
    return { results: await flag(env, hits) }
  }

  /** Adds whether each hit is already in the cloud, or already marked (by id or by Deezer id). */
  async function flag(env: Env, hits: SearchHit[]): Promise<SearchResponse['results']> {
    if (hits.length === 0) return []
    const ids = hits.map((h) => h.id)
    const dz = hits.map((h) => h.deezerId).filter((d): d is string => !!d)
    const q = (n: number): string => Array(Math.max(n, 1)).fill('?').join(',')
    const none = dz.length ? dz : ['']
    const inCloud = await env.DB.prepare(
      `SELECT id, json_extract(meta, '$.deezerId') AS dz FROM songs
       WHERE status = 'complete' AND (id IN (${q(ids.length)}) OR json_extract(meta, '$.deezerId') IN (${q(none.length)}))`
    )
      .bind(...ids, ...none)
      .all<{ id: string; dz: string | null }>()
    const requested = await env.DB.prepare(
      `SELECT id, deezer_id AS dz FROM requests WHERE id IN (${q(ids.length)}) OR deezer_id IN (${q(none.length)})`
    )
      .bind(...ids, ...none)
      .all<{ id: string; dz: string | null }>()
    const has = (rows: { id: string; dz: string | null }[], h: SearchHit): boolean =>
      rows.some((r) => r.id === h.id || (!!h.deezerId && r.dz === h.deezerId))
    return hits.map((h) => ({ ...h, inCloud: has(inCloud.results, h), requested: has(requested.results, h) }))
  }

  async function getRecommendations(env: Env): Promise<RecommendationsResponse> {
    const row = await env.DB.prepare('SELECT data, updated_at FROM recommendations WHERE id = 1').first<{
      data: string
      updated_at: number
    }>()
    if (!row) return { basedOn: [], results: [], updatedAt: null }
    const data = JSON.parse(row.data) as PutRecommendationsRequest
    // Songs added since (from the phone or the computer) drop out.
    const results = (await flag(env, data.results)).filter((h) => !h.inCloud)
    return { basedOn: data.basedOn, results, updatedAt: row.updated_at }
  }

  async function putRecommendations(env: Env, request: Request): Promise<RecommendationsResponse> {
    const body = await readJson<PutRecommendationsRequest>(request)
    const invalid = validateRecommendations(body)
    if (invalid) fail(400, invalid)
    const data: PutRecommendationsRequest = {
      basedOn: body.basedOn,
      results: body.results.map((h) => ({
        id: h.id,
        title: h.title.trim(),
        artists: h.artists,
        durationSec: h.durationSec,
        coverUrl: h.coverUrl,
        deezerId: h.deezerId ?? null
      }))
    }
    await env.DB.prepare(
      'INSERT INTO recommendations (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    )
      .bind(JSON.stringify(data), Date.now())
      .run()
    return getRecommendations(env)
  }

  async function listRequests(env: Env): Promise<ListRequestsResponse> {
    const { results } = await env.DB.prepare(
      'SELECT id, title, artists, duration_sec, cover_url, deezer_id, status, error, created_at FROM requests ORDER BY created_at'
    ).all<RequestRow>()
    return { requests: results.map(toRequest) }
  }

  /** Marks a song for the desktop. Marking it again (e.g. after it failed) puts it back in line. */
  async function addRequest(env: Env, request: Request): Promise<SongRequest> {
    const hit = await readJson<SearchHit>(request)
    const invalid = validateHit(hit)
    if (invalid) fail(400, invalid)
    const [flagged] = await flag(env, [hit])
    if (flagged.inCloud) fail(409, 'Ya está en tu nube')
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM requests').first<{ n: number }>()
    const exists = await env.DB.prepare('SELECT id FROM requests WHERE id = ?').bind(hit.id).first()
    if (!exists && (count?.n ?? 0) >= MAX_REQUESTS) fail(429, 'Tienes demasiadas canciones pendientes')
    const now = Date.now()
    await env.DB.prepare(
      `INSERT INTO requests (id, title, artists, duration_sec, cover_url, deezer_id, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?)
       ON CONFLICT(id) DO UPDATE SET status = 'pending', error = NULL`
    )
      .bind(hit.id, hit.title.trim(), hit.artists, hit.durationSec ?? null, hit.coverUrl ?? null, hit.deezerId ?? null, now)
      .run()
    const row = await env.DB.prepare(
      'SELECT id, title, artists, duration_sec, cover_url, deezer_id, status, error, created_at FROM requests WHERE id = ?'
    )
      .bind(hit.id)
      .first<RequestRow>()
    return toRequest(row!)
  }

  async function failRequest(env: Env, id: string, request: Request): Promise<{ ok: true }> {
    const body = await readJson<{ error?: unknown }>(request)
    const error = String(body?.error ?? 'Error').slice(0, 500)
    const r = await env.DB.prepare("UPDATE requests SET status = 'failed', error = ? WHERE id = ?").bind(error, id).run()
    if (!r.meta.changes) fail(404, 'Request not found')
    return { ok: true }
  }

  async function deleteRequest(env: Env, id: string): Promise<{ deleted: true }> {
    await env.DB.prepare('DELETE FROM requests WHERE id = ?').bind(id).run()
    return { deleted: true }
  }

  /** Phone edits: applied to the cloud's playlists now, and kept for the desktop. */
  async function addPlaylistOps(env: Env, request: Request): Promise<ListPlaylistsResponse> {
    const body = await readJson<PostPlaylistOpsRequest>(request)
    const invalid = validatePlaylistOps(body)
    if (invalid) fail(400, invalid)
    const now = Date.now()
    let list = (await listPlaylists(env)).playlists
    for (const op of body.ops) list = applyPlaylistOp(list, op, now)
    const insert = 'INSERT INTO playlists (id, name, song_ids, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    await env.DB.batch([
      env.DB.prepare('DELETE FROM playlists'),
      ...list.map((p, i) =>
        env.DB.prepare(insert).bind(p.id, p.name, JSON.stringify(p.songIds), i, p.createdAt, p.updatedAt)
      ),
      ...body.ops.map((op) =>
        env.DB.prepare('INSERT INTO playlist_ops (op, created_at) VALUES (?, ?)').bind(JSON.stringify(op), now)
      )
    ])
    return { playlists: list }
  }

  async function listPlaylistOps(env: Env): Promise<ListPlaylistOpsResponse> {
    const { results } = await env.DB.prepare('SELECT seq, op FROM playlist_ops ORDER BY seq LIMIT 1000').all<{
      seq: number
      op: string
    }>()
    return { ops: results.map((r) => ({ ...(JSON.parse(r.op) as PlaylistOp), seq: r.seq })) }
  }

  async function ackPlaylistOps(env: Env, request: Request): Promise<{ ok: true }> {
    const body = await readJson<{ upTo?: unknown }>(request)
    if (!Number.isSafeInteger(body?.upTo)) fail(400, 'Invalid upTo')
    await env.DB.prepare('DELETE FROM playlist_ops WHERE seq <= ?').bind(body.upTo).run()
    return { ok: true }
  }

  async function addPlays(env: Env, request: Request): Promise<{ added: number }> {
    const body = await readJson<PostPlaysRequest>(request)
    const invalid = validatePlays(body)
    if (invalid) fail(400, invalid)
    if (body.plays.length) {
      await env.DB.batch(
        body.plays.map((p) => env.DB.prepare('INSERT INTO plays (id, played_at) VALUES (?, ?)').bind(p.id, p.at))
      )
    }
    return { added: body.plays.length }
  }

  async function listPlays(env: Env): Promise<ListPlaysResponse> {
    const { results } = await env.DB.prepare('SELECT seq, id, played_at FROM plays ORDER BY seq LIMIT 1000').all<{
      seq: number
      id: string
      played_at: number
    }>()
    return { plays: results.map((r) => ({ seq: r.seq, id: r.id, at: r.played_at })) }
  }

  async function ackPlays(env: Env, request: Request): Promise<{ ok: true }> {
    const body = await readJson<{ upTo?: unknown }>(request)
    if (!Number.isSafeInteger(body?.upTo)) fail(400, 'Invalid upTo')
    await env.DB.prepare('DELETE FROM plays WHERE seq <= ?').bind(body.upTo).run()
    return { ok: true }
  }

  async function listDeletions(env: Env): Promise<ListDeletionsResponse> {
    const { results } = await env.DB.prepare('SELECT seq, id FROM deletions ORDER BY seq LIMIT 1000').all<{
      seq: number
      id: string
    }>()
    return { deletions: results }
  }

  async function ackDeletions(env: Env, request: Request): Promise<{ ok: true }> {
    const body = await readJson<{ upTo?: unknown }>(request)
    if (!Number.isSafeInteger(body?.upTo)) fail(400, 'Invalid upTo')
    await env.DB.prepare('DELETE FROM deletions WHERE seq <= ?').bind(body.upTo).run()
    return { ok: true }
  }

  async function listVelodySends(env: Env): Promise<ListVelodySendsResponse> {
    // Only songs still complete in the cloud: Velody downloads them right after listing.
    const { results } = await env.DB.prepare(
      `SELECT v.id, v.sent_at, s.meta FROM velody_sends v JOIN songs s ON s.id = v.id
       WHERE s.status = 'complete' ORDER BY v.sent_at, v.id`
    ).all<{ id: string; sent_at: number; meta: string }>()
    return {
      sends: results.map((r) => {
        const meta = JSON.parse(r.meta) as SongMeta
        return { id: r.id, title: meta.title, artists: meta.artists, durationSec: meta.durationSec ?? null, sentAt: r.sent_at }
      })
    }
  }

  /** Sending again keeps its place in line. Audiobook chapters aren't music to practise. */
  async function sendToVelody(env: Env, id: string): Promise<VelodySend> {
    const song = await getSong(env, id)
    if (!song || song.status !== 'complete') return fail(404, 'Song not found')
    const meta = JSON.parse(song.meta) as SongMeta
    if (meta.book) fail(400, 'Los audiolibros no se mandan a Velody')
    await env.DB.prepare('INSERT INTO velody_sends (id, sent_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(id, Date.now())
      .run()
    return (await listVelodySends(env)).sends.find((x) => x.id === id)!
  }

  async function unsendToVelody(env: Env, id: string): Promise<{ deleted: true }> {
    await env.DB.prepare('DELETE FROM velody_sends WHERE id = ?').bind(id).run()
    return { deleted: true }
  }

  // ── Podcast subscriptions (the phone searches Apple's directory itself) ──

  async function listPodcastSubs(env: Env): Promise<ListPodcastSubscriptionsResponse> {
    const { results } = await env.DB.prepare(
      'SELECT id, title, author, image, subscribed_at FROM podcast_subscriptions ORDER BY subscribed_at DESC'
    ).all<{ id: string; title: string; author: string; image: string | null; subscribed_at: number }>()
    return {
      podcasts: results.map((r) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        image: r.image,
        subscribedAt: r.subscribed_at
      }))
    }
  }

  /** Subscribing again only refreshes the show's title and picture. */
  async function subscribePodcast(env: Env, id: string, request: Request): Promise<ListPodcastSubscriptionsResponse> {
    const body = await readJson<Podcast>(request)
    const err = validatePodcast(body)
    if (err) fail(400, err)
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM podcast_subscriptions WHERE id != ?')
      .bind(id)
      .first<{ n: number }>()
    if ((count?.n ?? 0) >= MAX_PODCAST_SUBSCRIPTIONS) fail(400, 'Demasiadas suscripciones')
    await env.DB.prepare(
      `INSERT INTO podcast_subscriptions (id, title, author, image, subscribed_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, author = excluded.author, image = excluded.image`
    )
      .bind(id, body.title.trim(), body.author, body.image ?? null, Date.now())
      .run()
    return listPodcastSubs(env)
  }

  async function unsubscribePodcast(env: Env, id: string): Promise<ListPodcastSubscriptionsResponse> {
    await env.DB.prepare('DELETE FROM podcast_subscriptions WHERE id = ?').bind(id).run()
    return listPodcastSubs(env)
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
    if (path === '/playlists/ops' && method === 'POST') return json(await addPlaylistOps(env, request))
    if (path === '/playlists/ops' && method === 'GET') return json(await listPlaylistOps(env))
    if (path === '/playlists/ops/ack' && method === 'POST') return json(await ackPlaylistOps(env, request))
    if (path === '/playlists') return fail(405, 'Method not allowed')
    if (path === '/plays' && method === 'POST') return json(await addPlays(env, request))
    if (path === '/plays' && method === 'GET') return json(await listPlays(env))
    if (path === '/plays/ack' && method === 'POST') return json(await ackPlays(env, request))
    if (path === '/covers' && method === 'POST') return json(await uploadCover(env, request, url))
    if (path === '/deletions' && method === 'GET') return json(await listDeletions(env))
    if (path === '/deletions/ack' && method === 'POST') return json(await ackDeletions(env, request))
    if (path === '/search' && method === 'GET') return json(await search(env, url))
    if (path === '/recommendations' && method === 'GET') return json(await getRecommendations(env))
    if (path === '/recommendations' && method === 'PUT') return json(await putRecommendations(env, request))
    if (path === '/requests' && method === 'GET') return json(await listRequests(env))
    if (path === '/requests' && method === 'POST') return json(await addRequest(env, request))

    if (path === '/podcasts/subscriptions' && method === 'GET') return json(await listPodcastSubs(env))
    const ps = /^\/podcasts\/subscriptions\/([^/]+)$/.exec(path)
    if (ps) {
      if (!PODCAST_ID_RE.test(ps[1])) fail(400, 'Invalid podcast id')
      if (method === 'PUT') return json(await subscribePodcast(env, ps[1], request))
      if (method === 'DELETE') return json(await unsubscribePodcast(env, ps[1]))
      return fail(405, 'Method not allowed')
    }

    if (path === '/velody' && method === 'GET') return json(await listVelodySends(env))
    const vs = /^\/velody\/([^/]+)$/.exec(path)
    if (vs) {
      if (!YOUTUBE_ID_RE.test(vs[1])) fail(400, 'Invalid song id')
      if (method === 'PUT') return json(await sendToVelody(env, vs[1]))
      if (method === 'DELETE') return json(await unsendToVelody(env, vs[1]))
      return fail(405, 'Method not allowed')
    }

    const rq = /^\/requests\/([^/]+)(\/fail)?$/.exec(path)
    if (rq) {
      if (!REQUEST_ID_RE.test(rq[1])) fail(400, 'Invalid song id')
      if (!rq[2] && method === 'DELETE') return json(await deleteRequest(env, rq[1]))
      if (rq[2] && method === 'POST') return json(await failRequest(env, rq[1], request))
      return fail(405, 'Method not allowed')
    }

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
      const cover = /^\/v1\/covers\/([^/]+)$/.exec(new URL(request.url).pathname)
      if (cover && request.method === 'GET') return getCover(env, cover[1])
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
