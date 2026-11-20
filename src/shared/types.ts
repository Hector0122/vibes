import type { SongMeta } from './api'

/** A song in the desktop library. id = YouTube video id. */
export interface LocalSong extends SongMeta {
  id: string
  saved: boolean
  playCount: number
  addedAt: number
  /** Audio file name inside the app's audio folder, once it is on this machine. */
  file: string | null
  /** The current local file is in the cloud. */
  uploaded: boolean
  /** Last download/upload error, shown in the list. */
  error: string | null
  /** When it was last listened to (counted by the player). */
  lastPlayedAt?: number
}

/** A YouTube search hit, with its title already split into song + artist. */
export interface SearchResult {
  id: string
  title: string
  artists: string
  durationSec: number | null
  coverUrl: string
  /** Known when the song was found on Deezer (marked on the phone). */
  deezerId?: string | null
}

/** Songs the library doesn't have yet, from YouTube mixes of a few of its songs. */
export interface Recommendations {
  /** Titles of the library songs the mixes came from. */
  basedOn: string[]
  results: SearchResult[]
}

export interface LyricLine {
  /** Seconds from the start. */
  t: number
  text: string
}

export interface Lyrics {
  /** Timed lines, when they match this recording. */
  synced: LyricLine[] | null
  plain: string | null
  instrumental: boolean
}

/** What the player needs to know about any song, in the library or not (a preview). */
export interface SongRef {
  id: string
  title: string
  artists: string
  album: string | null
  durationSec: number | null
  coverUrl: string | null
}

export interface Playlist {
  id: string
  name: string
  /** Library song ids, in order. */
  songIds: string[]
  createdAt: number
  updatedAt: number
}

export interface ImportResult {
  added: number
  updated: number
  copied: number
  missing: number
}

export interface TaskProgress {
  task: 'import' | 'download' | 'upload'
  done: number
  total: number
  failed: number
}

export interface CloudSettingsView {
  url: string
  enabled: boolean
  /** A token is saved (its value never leaves the main process). */
  hasToken: boolean
  /** safeStorage is usable on this machine. */
  encryptionAvailable: boolean
}

export interface CloudSettingsInput {
  url: string
  enabled: boolean
  /** Omitted/empty keeps the saved token. */
  token?: string
}

export type CloudTestResult = { ok: true } | { ok: false; error: string }

export interface VibesAPI {
  listSongs(): Promise<LocalSong[]>
  /** Where to play a song from: the local file, or a YouTube stream for songs not in the library. '' if none. */
  audioUrl(id: string): Promise<string>
  importEsound(): Promise<ImportResult>
  downloadMissing(): Promise<TaskProgress>
  uploadToCloud(): Promise<TaskProgress>
  searchYoutube(query: string): Promise<SearchResult[]>
  recommend(): Promise<Recommendations>
  /** Songs like this one (its YouTube mix) that the library doesn't have. */
  radio(id: string): Promise<SearchResult[]>
  /** Adds a search hit: library → download → cloud (if set up). Rejects only if the download fails. */
  addSong(result: SearchResult): Promise<LocalSong>
  /** Lyrics for a song; null when there are none (cached on disk either way). */
  lyrics(song: SongRef): Promise<Lyrics | null>
  /** Accent color of a cover image as "r g b", or null if it can't be read. */
  coverColor(url: string): Promise<string | null>
  /** The song has really been listened to: counts one play. */
  songPlayed(id: string): Promise<void>
  listPlaylists(): Promise<Playlist[]>
  createPlaylist(name: string): Promise<Playlist>
  renamePlaylist(id: string, name: string): Promise<Playlist>
  deletePlaylist(id: string): Promise<void>
  /** Returns how many were new to the playlist. */
  addToPlaylist(id: string, songIds: string[]): Promise<number>
  removeFromPlaylist(id: string, songId: string): Promise<void>
  movePlaylistSong(id: string, from: number, to: number): Promise<void>
  getCloudSettings(): Promise<CloudSettingsView>
  saveCloudSettings(input: CloudSettingsInput): Promise<CloudSettingsView>
  testCloud(input: CloudSettingsInput): Promise<CloudTestResult>
  onSongUpdated(cb: (song: LocalSong) => void): () => void
  /** Playlists changed outside the window (edits from the phone). */
  onPlaylistsChanged(cb: () => void): () => void
  onProgress(cb: (p: TaskProgress) => void): () => void
}
