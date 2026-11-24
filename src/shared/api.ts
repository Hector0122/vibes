// Contract between the Vibes clients (desktop, later mobile) and the Worker.
// A song is identified by its YouTube video id; its audio lives in R2 at
// songs/{id}.m4a and its metadata in D1.

export const API_PREFIX = '/v1'
export const PRESIGN_EXPIRES_SECONDS = 15 * 60
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/
export const SHA256_RE = /^[0-9a-f]{64}$/
/** One song file; long DJ sets aside, 100 MB is far above any m4a track. */
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024
/** An audiobook file can be one long .m4b (R2 takes up to 5 GB in a single PUT). */
export const MAX_BOOK_BYTES = 2 * 1024 * 1024 * 1024
/** Uploaded covers (audiobooks): POST /covers with the image as the body. */
export const MAX_COVER_BYTES = 5 * 1024 * 1024
export const COVER_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
/** Served without the token (the lock screen loads artwork by plain URL): the random name is the secret. */
export const COVER_NAME_RE = /^[A-Za-z0-9_-]{22}\.(jpg|png|webp)$/
export interface UploadCoverResponse {
  coverUrl: string
}

export interface SongMeta {
  title: string
  artists: string
  album: string | null
  deezerId: string | null
  deezerArtistId: string | null
  isrc: string | null
  durationSec: number | null
  coverUrl: string | null
  /** Set on audiobook chapters (uploaded from the phone): the book's name. Kept out of the music. */
  book?: string | null
  /** 1-based order of the chapter in its book. */
  chapter?: number | null
}

export interface CloudSong extends SongMeta {
  id: string
  size: number
  sha256: string
  updatedAt: number
}

export interface ApiError {
  error: string
}

export interface ListSongsResponse {
  songs: CloudSong[]
}

export interface UploadBeginRequest {
  meta: SongMeta
  size: number
  sha256: string
}

/** url is null when R2 already holds this exact file: go straight to commit. */
export interface UploadBeginResponse {
  url: string | null
  expiresAt: number
}

export interface StreamResponse {
  url: string
  expiresAt: number
}

/** Returns an error message, or null when the metadata is valid. */
export function validateMeta(m: unknown): string | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'meta must be an object'
  const meta = m as Record<string, unknown>
  if (typeof meta.title !== 'string' || !meta.title.trim() || meta.title.length > 300) {
    return 'Invalid title'
  }
  if (typeof meta.artists !== 'string' || meta.artists.length > 500) return 'Invalid artists'
  for (const k of ['album', 'deezerId', 'deezerArtistId', 'isrc', 'coverUrl'] as const) {
    const v = meta[k]
    if (v !== null && (typeof v !== 'string' || v.length > 1000)) return `Invalid ${k}`
  }
  const d = meta.durationSec
  if (d !== null && (typeof d !== 'number' || !Number.isFinite(d) || d < 0)) {
    return 'Invalid durationSec'
  }
  if (meta.book != null && (typeof meta.book !== 'string' || !meta.book.trim() || meta.book.length > 300)) {
    return 'Invalid book'
  }
  const c = meta.chapter
  if (c != null && (!Number.isInteger(c) || (c as number) < 1 || (c as number) > 100_000)) {
    return 'Invalid chapter'
  }
  return null
}

/** Only the known fields, so a client can't stash arbitrary data in D1. */
export function pickMeta(m: SongMeta): SongMeta {
  return {
    title: m.title.trim(),
    artists: m.artists,
    album: m.album,
    deezerId: m.deezerId,
    deezerArtistId: m.deezerArtistId,
    isrc: m.isrc,
    durationSec: m.durationSec,
    coverUrl: m.coverUrl,
    // Only on audiobook chapters, so songs keep their exact shape.
    ...(m.book ? { book: m.book.trim(), chapter: m.chapter ?? null } : {})
  }
}

// Playlists: made on the desktop, mirrored to the cloud so the phone can show them.
// The desktop sends the whole set each time (PUT /playlists replaces it).

export const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_PLAYLISTS = 500
export const MAX_PLAYLIST_SONGS = 10_000
export const MAX_PLAYLIST_NAME = 100

export interface CloudPlaylist {
  id: string
  name: string
  /** Song ids (YouTube ids), in order. May name songs that aren't in the cloud yet. */
  songIds: string[]
  createdAt: number
  updatedAt: number
}

export interface ListPlaylistsResponse {
  playlists: CloudPlaylist[]
}

export type PutPlaylistsRequest = ListPlaylistsResponse

/** Returns an error message, or null when the whole set is valid. */
export function validatePlaylists(body: unknown): string | null {
  const list = (body as { playlists?: unknown } | null)?.playlists
  if (!Array.isArray(list)) return 'playlists must be an array'
  if (list.length > MAX_PLAYLISTS) return 'Too many playlists'
  const seen = new Set<string>()
  for (const p of list as Record<string, unknown>[]) {
    if (!p || typeof p !== 'object') return 'Invalid playlist'
    if (typeof p.id !== 'string' || !PLAYLIST_ID_RE.test(p.id) || seen.has(p.id)) return 'Invalid playlist id'
    seen.add(p.id)
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > MAX_PLAYLIST_NAME) {
      return 'Invalid playlist name'
    }
    if (!Array.isArray(p.songIds) || p.songIds.length > MAX_PLAYLIST_SONGS) return 'Invalid songIds'
    if (!p.songIds.every((s) => typeof s === 'string' && YOUTUBE_ID_RE.test(s))) return 'Invalid songIds'
    for (const k of ['createdAt', 'updatedAt'] as const) {
      if (!Number.isSafeInteger(p[k]) || (p[k] as number) < 0) return `Invalid ${k}`
    }
  }
  return null
}

// Adding songs from the phone. The phone searches Deezer through the Worker
// (no API key; 30-second previews) and marks songs; the desktop app, when open,
// finds each marked song on YouTube with yt-dlp, downloads and uploads it, and
// clears the mark. Recommendations (from the desktop) are marked by YouTube id.

export const MAX_QUERY = 200
export const MAX_REQUESTS = 500
/** A marked song: its YouTube id, or "dz" + its Deezer id (found on YouTube later). */
export const REQUEST_ID_RE = /^(?:[A-Za-z0-9_-]{11}|dz\d{1,20})$/
export const deezerRequestId = (deezerId: string | number): string => `dz${deezerId}`

export interface SearchHit {
  /** YouTube id, or "dz" + Deezer id. */
  id: string
  title: string
  artists: string
  durationSec: number | null
  coverUrl: string | null
  deezerId: string | null
  /** A 30-second clip (Deezer), when there is one. Not stored. */
  previewUrl?: string | null
}

export interface SearchResponse {
  /** inCloud: already in your library; requested: already marked. */
  results: (SearchHit & { inCloud: boolean; requested: boolean })[]
}

export interface SongRequest extends SearchHit {
  /** pending: waiting for the desktop; failed: the desktop couldn't get it (see error). */
  status: 'pending' | 'failed'
  error: string | null
  createdAt: number
}

export interface ListRequestsResponse {
  requests: SongRequest[]
}

/** Returns an error message, or null when the hit can be marked. */
export function validateHit(h: unknown): string | null {
  if (!h || typeof h !== 'object') return 'Invalid song'
  const x = h as Record<string, unknown>
  if (typeof x.id !== 'string' || !REQUEST_ID_RE.test(x.id)) return 'Invalid song id'
  if (typeof x.title !== 'string' || !x.title.trim() || x.title.length > 300) return 'Invalid title'
  if (typeof x.artists !== 'string' || x.artists.length > 500) return 'Invalid artists'
  if (x.coverUrl != null && (typeof x.coverUrl !== 'string' || x.coverUrl.length > 1000)) return 'Invalid coverUrl'
  if (x.deezerId != null && (typeof x.deezerId !== 'string' || !/^\d{1,20}$/.test(x.deezerId))) return 'Invalid deezerId'
  const d = x.durationSec
  if (d != null && (typeof d !== 'number' || !Number.isFinite(d) || d < 0)) return 'Invalid durationSec'
  return null
}

// "Recomendado para ti" on the phone: the desktop computes it (YouTube mixes of
// library songs, with yt-dlp) and uploads it; the phone shows it and marks songs.

export const MAX_RECOMMENDATIONS = 60

export interface PutRecommendationsRequest {
  /** Titles of the library songs the suggestions came from. */
  basedOn: string[]
  results: SearchHit[]
}

export interface RecommendationsResponse {
  basedOn: string[]
  results: SearchResponse['results']
  /** When the desktop last sent them; null = never. */
  updatedAt: number | null
}

export function validateRecommendations(body: unknown): string | null {
  const b = body as Partial<PutRecommendationsRequest> | null
  if (!b || !Array.isArray(b.basedOn) || !Array.isArray(b.results)) return 'basedOn and results must be arrays'
  if (b.basedOn.length > 20 || !b.basedOn.every((t) => typeof t === 'string' && t.length <= 300)) return 'Invalid basedOn'
  if (b.results.length > MAX_RECOMMENDATIONS) return 'Too many results'
  for (const h of b.results) {
    const e = validateHit(h)
    if (e) return e
  }
  return null
}

// Plays counted on the phone (a song listened to for 30 s), passed to the desktop.
export const MAX_PLAYS_PER_POST = 500

export interface Play {
  id: string
  /** When it was listened to (ms). */
  at: number
}

export interface PostPlaysRequest {
  plays: Play[]
}

export interface ListPlaysResponse {
  /** seq: pass the highest one to /plays/ack once they're counted. */
  plays: (Play & { seq: number })[]
}

export function validatePlays(body: unknown): string | null {
  const list = (body as { plays?: unknown } | null)?.plays
  if (!Array.isArray(list) || list.length > MAX_PLAYS_PER_POST) return 'Invalid plays'
  for (const p of list as Record<string, unknown>[]) {
    if (!p || typeof p.id !== 'string' || !YOUTUBE_ID_RE.test(p.id)) return 'Invalid song id'
    if (!Number.isSafeInteger(p.at) || (p.at as number) <= 0) return 'Invalid at'
  }
  return null
}

// Playlist edits made on the phone. The cloud applies them right away (so the
// phone sees them) and keeps them until the desktop, the playlists' owner,
// applies them too; the desktop always takes them before sending its own set.
export type PlaylistOp =
  | { type: 'create'; id: string; name: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete'; id: string }
  | { type: 'add'; id: string; songIds: string[] }
  | { type: 'remove'; id: string; songId: string }

export interface PostPlaylistOpsRequest {
  ops: PlaylistOp[]
}

export interface ListPlaylistOpsResponse {
  ops: (PlaylistOp & { seq: number })[]
}

export const MAX_OPS_PER_POST = 100

export function validatePlaylistOps(body: unknown): string | null {
  const list = (body as { ops?: unknown } | null)?.ops
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_OPS_PER_POST) return 'Invalid ops'
  const name = (n: unknown): boolean => typeof n === 'string' && !!n.trim() && n.length <= MAX_PLAYLIST_NAME
  const song = (s: unknown): boolean => typeof s === 'string' && YOUTUBE_ID_RE.test(s)
  for (const o of list as Record<string, unknown>[]) {
    if (!o || typeof o.id !== 'string' || !PLAYLIST_ID_RE.test(o.id)) return 'Invalid playlist id'
    switch (o.type) {
      case 'create':
      case 'rename':
        if (!name(o.name)) return 'Invalid playlist name'
        break
      case 'delete':
        break
      case 'add':
        if (!Array.isArray(o.songIds) || o.songIds.length === 0 || o.songIds.length > 1000 || !o.songIds.every(song)) {
          return 'Invalid songIds'
        }
        break
      case 'remove':
        if (!song(o.songId)) return 'Invalid songId'
        break
      default:
        return 'Invalid op'
    }
  }
  return null
}

/** Applies one op to a list of playlists (the cloud's copy, or the phone's while it waits). */
export function applyPlaylistOp(list: CloudPlaylist[], op: PlaylistOp, now: number): CloudPlaylist[] {
  const touch = (p: CloudPlaylist, patch: Partial<CloudPlaylist>): CloudPlaylist => ({ ...p, ...patch, updatedAt: now })
  switch (op.type) {
    case 'create':
      return list.some((p) => p.id === op.id)
        ? list
        : [...list, { id: op.id, name: op.name.trim(), songIds: [], createdAt: now, updatedAt: now }]
    case 'rename':
      return list.map((p) => (p.id === op.id ? touch(p, { name: op.name.trim() }) : p))
    case 'delete':
      return list.filter((p) => p.id !== op.id)
    case 'add':
      return list.map((p) =>
        p.id === op.id ? touch(p, { songIds: [...p.songIds, ...[...new Set(op.songIds)].filter((s) => !p.songIds.includes(s))] }) : p
      )
    case 'remove':
      return list.map((p) => (p.id === op.id ? touch(p, { songIds: p.songIds.filter((s) => s !== op.songId) }) : p))
  }
}
