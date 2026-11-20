// Contract between the Vibes clients (desktop, later mobile) and the Worker.
// A song is identified by its YouTube video id; its audio lives in R2 at
// songs/{id}.m4a and its metadata in D1.

export const API_PREFIX = '/v1'
export const PRESIGN_EXPIRES_SECONDS = 15 * 60
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/
export const SHA256_RE = /^[0-9a-f]{64}$/
/** One song file; long DJ sets aside, 100 MB is far above any m4a track. */
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024

export interface SongMeta {
  title: string
  artists: string
  album: string | null
  deezerId: string | null
  deezerArtistId: string | null
  isrc: string | null
  durationSec: number | null
  coverUrl: string | null
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
    coverUrl: m.coverUrl
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
