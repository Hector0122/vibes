// Offline: songs downloaded to the phone and the last copy of your cloud library,
// so the app opens and plays without internet. Everything lives in the app's
// document folder (the system doesn't clean it up; uninstalling the app does):
//   vibes/songs/{id}.m4a   downloaded audio
//   vibes/downloads.json   { id: sha256 } of each downloaded copy
//   vibes/library.json     the last song list + playlists seen in the cloud
//   vibes/books.json       where each audiobook was left
//   vibes/podcasts.json    where each podcast episode was left
//   vibes/episodes/{id}.mp3  podcast episodes downloaded to the phone
//   vibes/episodes.json    those episodes and their show, to list and play them offline
import { Directory, File, Paths } from 'expo-file-system'
import type { CloudPlaylist, CloudSong, Podcast, PodcastEpisode } from '../../src/shared/api'

/** id → sha256 of the copy on the phone (a different sha in the cloud = outdated copy). */
export type Downloads = Record<string, string>

export interface Snapshot {
  songs: CloudSong[]
  playlists: CloudPlaylist[]
  savedAt: number
}

const root = (): Directory => new Directory(Paths.document, 'vibes')
const songsDir = (): Directory => new Directory(root(), 'songs')
const songFile = (id: string): File => new File(songsDir(), `${id}.m4a`)
const downloadsFile = (): File => new File(root(), 'downloads.json')
const snapshotFile = (): File => new File(root(), 'library.json')

function ensure(dir: Directory): void {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
}

async function readJson<T>(f: File): Promise<T | null> {
  try {
    return f.exists ? (JSON.parse(await f.text()) as T) : null
  } catch {
    return null // a damaged file is the same as none: it gets rewritten
  }
}

async function writeJson(f: File, value: unknown): Promise<void> {
  ensure(root())
  await f.write(JSON.stringify(value))
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  const s = await readJson<Snapshot>(snapshotFile())
  return s && Array.isArray(s.songs)
    ? { ...s, playlists: Array.isArray(s.playlists) ? s.playlists : [] }
    : null
}

export const saveSnapshot = (s: Snapshot): Promise<void> => writeJson(snapshotFile(), s)

/** The downloads index, without entries whose file is gone. */
export async function loadDownloads(): Promise<Downloads> {
  const d = (await readJson<Downloads>(downloadsFile())) ?? {}
  return Object.fromEntries(Object.entries(d).filter(([id]) => songFile(id).exists))
}

export const saveDownloads = (d: Downloads): Promise<void> => writeJson(downloadsFile(), d)

/** A file:// URI the player can open, or null when the song isn't on the phone. */
export function localUri(id: string): string | null {
  const f = songFile(id)
  return f.exists ? f.uri : null
}

/** Downloads one song from its signed URL. Only a complete file takes the song's place. */
export async function downloadSong(url: string, song: CloudSong): Promise<void> {
  ensure(songsDir())
  const part = new File(songsDir(), `${song.id}.part`)
  if (part.exists) part.delete()
  try {
    await File.downloadFileAsync(url, part, { idempotent: true })
    if (song.size > 0 && part.size !== song.size) throw new Error('La descarga quedó incompleta')
    part.moveSync(songFile(song.id), { overwrite: true })
  } catch (e) {
    if (part.exists) part.delete()
    throw e
  }
}

export function deleteSong(id: string): void {
  const f = songFile(id)
  if (f.exists) f.delete()
}

/** Bytes free on the phone, or null if it can't be read. */
export function freeSpace(): number | null {
  try {
    return Paths.availableDiskSpace
  } catch {
    return null
  }
}

/** What was playing, to pick up where you left off (also what the widget plays). */
export interface Session {
  current: CloudSong
  time: number
  queueIds: string[]
  shuffle: boolean
  savedAt: number
}

const sessionFile = (): File => new File(root(), 'session.json')

export async function loadSession(): Promise<Session | null> {
  const s = await readJson<Session>(sessionFile())
  return s && s.current && typeof s.current.id === 'string' && Array.isArray(s.queueIds) ? s : null
}

export const saveSession = (s: Session): Promise<void> => writeJson(sessionFile(), s)

/** Download settings, kept on the phone. */
export interface Prefs {
  /** Automatic downloads (kept playlists) wait for Wi-Fi; manual ones ask first. */
  wifiOnly: boolean
  /** Playlists whose songs are downloaded automatically, new ones included. */
  keep: string[]
}

const prefsFile = (): File => new File(root(), 'prefs.json')
export const DEFAULT_PREFS: Prefs = { wifiOnly: true, keep: [] }

export async function loadPrefs(): Promise<Prefs> {
  const p = await readJson<Partial<Prefs>>(prefsFile())
  return {
    wifiOnly: typeof p?.wifiOnly === 'boolean' ? p.wifiOnly : DEFAULT_PREFS.wifiOnly,
    keep: Array.isArray(p?.keep) ? p.keep.filter((x): x is string => typeof x === 'string') : []
  }
}

export const savePrefs = (p: Prefs): Promise<void> => writeJson(prefsFile(), p)

/** Where each audiobook was left: book name → chapter (song id) and second. */
export type BookPositions = Record<string, { id: string; time: number }>

const booksFile = (): File => new File(root(), 'books.json')

export async function loadBookPositions(): Promise<BookPositions> {
  return (await readJson<BookPositions>(booksFile())) ?? {}
}

export async function saveBookPosition(book: string, id: string, time: number): Promise<void> {
  await writeJson(booksFile(), { ...(await loadBookPositions()), [book]: { id, time } })
}

/** Where each podcast episode was left: episode id → second, its length, and when. */
export type EpisodePositions = Record<string, { time: number; duration: number; at: number }>

const episodesFile = (): File => new File(root(), 'podcasts.json')
/** Only the most recent ones are kept, so the file stays small. */
const MAX_EPISODE_POSITIONS = 500

export async function loadEpisodePositions(): Promise<EpisodePositions> {
  return (await readJson<EpisodePositions>(episodesFile())) ?? {}
}

export async function saveEpisodePosition(id: string, time: number, duration: number, at: number): Promise<void> {
  const all = { ...(await loadEpisodePositions()), [id]: { time, duration, at } }
  const kept = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_EPISODE_POSITIONS)
  await writeJson(episodesFile(), Object.fromEntries(kept))
}

// ── Podcast episodes on the phone ──────────────────────────────────────────────
// Straight from the show's server (no cloud copy). Keyed by the episode's own id.

export interface SavedEpisode {
  episode: PodcastEpisode
  show: Podcast
  savedAt: number
  /** Brought by the automatic downloads (they may remove it); by hand, it stays. */
  auto?: boolean
}

const episodesDir = (): Directory => new Directory(root(), 'episodes')
const episodeFile = (id: string): File => new File(episodesDir(), `${id}.mp3`)
const savedEpisodesFile = (): File => new File(root(), 'episodes.json')

/** The downloaded episodes whose file is there, newest download first. */
export async function loadSavedEpisodes(): Promise<SavedEpisode[]> {
  const all = (await readJson<Record<string, SavedEpisode>>(savedEpisodesFile())) ?? {}
  return Object.entries(all)
    .filter(([id]) => episodeFile(id).exists)
    .map(([, e]) => e)
    .sort((a, b) => b.savedAt - a.savedAt)
}

/** A file:// URI for a downloaded episode, or null. */
export function episodeUri(id: string): string | null {
  const f = episodeFile(id)
  return f.exists ? f.uri : null
}

/** Downloads an episode (a .part until it's whole), then lists it. */
export async function downloadEpisode(episode: PodcastEpisode, show: Podcast, at: number, auto = false): Promise<void> {
  ensure(episodesDir())
  const part = new File(episodesDir(), `${episode.id}.part`)
  try {
    await File.downloadFileAsync(episode.url, part, { idempotent: true })
    if (part.size === 0) throw new Error('La descarga quedó vacía')
    part.moveSync(episodeFile(episode.id), { overwrite: true })
  } catch (e) {
    if (part.exists) part.delete()
    throw e
  }
  const all = (await readJson<Record<string, SavedEpisode>>(savedEpisodesFile())) ?? {}
  await writeJson(savedEpisodesFile(), { ...all, [episode.id]: { episode, show, savedAt: at, ...(auto ? { auto } : {}) } })
}

export async function deleteEpisode(id: string): Promise<void> {
  const f = episodeFile(id)
  if (f.exists) f.delete()
  const all = (await readJson<Record<string, SavedEpisode>>(savedEpisodesFile())) ?? {}
  delete all[id]
  await writeJson(savedEpisodesFile(), all)
}
