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
  audioUrl(id: string): Promise<string>
  importEsound(): Promise<ImportResult>
  downloadMissing(): Promise<TaskProgress>
  uploadToCloud(): Promise<TaskProgress>
  getCloudSettings(): Promise<CloudSettingsView>
  saveCloudSettings(input: CloudSettingsInput): Promise<CloudSettingsView>
  testCloud(input: CloudSettingsInput): Promise<CloudTestResult>
  onSongUpdated(cb: (song: LocalSong) => void): () => void
  onProgress(cb: (p: TaskProgress) => void): () => void
}
