// Offline: songs downloaded to the phone and the last copy of your cloud library,
// so the app opens and plays without internet. Everything lives in the app's
// document folder (the system doesn't clean it up; uninstalling the app does):
//   vibes/songs/{id}.m4a   downloaded audio
//   vibes/downloads.json   { id: sha256 } of each downloaded copy
//   vibes/library.json     the last song list + playlists seen in the cloud
import { Directory, File, Paths } from 'expo-file-system'
import type { CloudPlaylist, CloudSong } from '../../src/shared/api'

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
