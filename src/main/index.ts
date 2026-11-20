import { app, BrowserWindow, ipcMain, nativeImage, safeStorage, shell } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { YOUTUBE_ID_RE } from '../shared/api'
import type { CloudSettingsInput, LocalSong, SearchResult, SongRef, TaskProgress } from '../shared/types'
import { CloudClient } from './cloud/client'
import { createPlaylistSync } from './cloud/playlist-sync'
import { CloudSettingsStore } from './cloud/settings'
import { startAudioServer } from './audio-server'
import { Library } from './library'
import { defaultTools } from './media'
import { averageColor, vivid } from './color'
import { cachedLyrics, fetchLyrics } from './lyrics'
import { lookupDeezer } from './metadata'
import { Playlists } from './playlists'
import {
  addFromSearch,
  downloadMissing,
  enrichYoutubeSongs,
  importEsound,
  recordPlay,
  uploadAll,
  type TaskContext
} from './tasks'
import { radioFor, recommend, searchYoutube, streamResolver } from './youtube'

// Tests point these at fixtures; normal runs use the real locations.
if (process.env.VIBES_USER_DATA) app.setPath('userData', process.env.VIBES_USER_DATA)
const esoundDir = (): string =>
  process.env.VIBES_ESOUND_DIR || join(app.getPath('appData'), 'eSound Music')

let win: BrowserWindow | null = null

function send(channel: string, payload: LocalSong | TaskProgress): void {
  win?.webContents.send(channel, payload)
}

/** One job at a time per kind: a second click while it runs gets the running one. */
function single<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null
  return () => (running ??= fn().finally(() => (running = null)))
}

async function main(): Promise<void> {
  await app.whenReady()
  const userData = app.getPath('userData')
  const audioDir = join(userData, 'audio')
  mkdirSync(audioDir, { recursive: true })

  const library = new Library(join(userData, 'library.json'))
  await library.load()
  const playlists = new Playlists(join(userData, 'playlists.json'))
  await playlists.load()
  const settings = new CloudSettingsStore(join(userData, 'cloud.json'), safeStorage)
  const { port } = await startAudioServer(audioDir)
  // Playlists are mirrored to the cloud (for the phone) after every change.
  const playlistSync = createPlaylistSync({
    list: () => playlists.list(),
    client: async () => {
      const active = await settings.active()
      return active ? new CloudClient({ baseUrl: active.url, token: active.token, retries: 1 }) : null
    },
    onError: (err) => console.warn('No se pudieron subir las playlists:', (err as Error).message)
  })
  /** Runs a playlist change, then queues the cloud copy. */
  const changed = async <T>(job: Promise<T>): Promise<T> => {
    const out = await job
    playlistSync.schedule()
    return out
  }
  const ctx: TaskContext = {
    library,
    audioDir,
    tools: defaultTools(),
    onSong: (s) => send('song-updated', s),
    onProgress: (p) => send('progress', p),
    enrich: (title, artists, durationSec) => lookupDeezer(title, artists, durationSec)
  }

  ipcMain.handle('songs:list', () => library.list())
  // Library songs play from disk; anything else (a preview, the radio) streams from YouTube.
  const stream = streamResolver(ctx.tools)
  ipcMain.handle('songs:audio-url', async (_e, id: string) => {
    const file = library.get(id)?.file
    if (file) return `http://127.0.0.1:${port}/${file}`
    return YOUTUBE_ID_RE.test(String(id)) ? stream(String(id)).catch(() => '') : ''
  })
  ipcMain.handle('youtube:radio', (_e, id: string) => radioFor(ctx.tools, String(id), library.list()))
  ipcMain.handle('esound:import', single(() => importEsound(ctx, esoundDir())))
  ipcMain.handle('songs:download-missing', single(() => downloadMissing(ctx)))
  ipcMain.handle(
    'cloud:upload',
    single(async () => {
      const active = await settings.active()
      if (!active) throw new Error('Configura la nube primero (URL y token)')
      return uploadAll(ctx, new CloudClient({ baseUrl: active.url, token: active.token }))
    })
  )
  // Accent color of a cover ("r g b"), for tinting the UI; cached per URL.
  const colors = new Map<string, Promise<string | null>>()
  ipcMain.handle('cover:color', (_e, url: string) => {
    // https only (127.0.0.1 too, for the E2E's fake cover server).
    if (typeof url !== 'string' || !/^(https:\/\/|http:\/\/127\.0\.0\.1:)/.test(url)) return null
    let c = colors.get(url)
    if (!c) {
      c = (async () => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
          if (!res.ok) return null
          const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
          if (img.isEmpty()) return null
          return vivid(averageColor(img.resize({ width: 24, height: 24 }).toBitmap())).join(' ')
        } catch {
          colors.delete(url) // offline: try again next time
          return null
        }
      })()
      colors.set(url, c)
    }
    return c
  })
  ipcMain.handle('lyrics:get', (_e, song: SongRef) =>
    cachedLyrics(join(userData, 'lyrics'), song, (s) => fetchLyrics(s))
  )
  ipcMain.handle('songs:played', (_e, id: string) => recordPlay(ctx, String(id)))
  ipcMain.handle('youtube:recommend', () => recommend(ctx.tools, library.list()))
  ipcMain.handle('youtube:search', (_e, query: string) => searchYoutube(ctx.tools, String(query ?? '')))
  // A second click on the same song while it is being added gets the same job.
  const adding = new Map<string, Promise<LocalSong>>()
  ipcMain.handle('songs:add', (_e, result: SearchResult) => {
    const id = String(result?.id)
    let job = adding.get(id)
    if (!job) {
      job = (async () => {
        const active = await settings.active()
        const client = active ? new CloudClient({ baseUrl: active.url, token: active.token }) : null
        return addFromSearch(ctx, result, client)
      })().finally(() => adding.delete(id))
      adding.set(id, job)
    }
    return job
  })
  ipcMain.handle('playlists:list', () => playlists.list())
  ipcMain.handle('playlists:create', (_e, name: string) => changed(playlists.create(name)))
  ipcMain.handle('playlists:rename', (_e, id: string, name: string) => changed(playlists.rename(id, name)))
  ipcMain.handle('playlists:delete', (_e, id: string) => changed(playlists.remove(id)))
  ipcMain.handle('playlists:add', (_e, id: string, songIds: string[]) =>
    // Only songs that are in the library.
    changed(playlists.add(id, (Array.isArray(songIds) ? songIds : []).filter((s) => library.get(String(s)))))
  )
  ipcMain.handle('playlists:remove-song', (_e, id: string, songId: string) =>
    changed(playlists.removeSong(id, songId))
  )
  ipcMain.handle('playlists:move', (_e, id: string, from: number, to: number) =>
    changed(playlists.move(id, Number(from), Number(to)))
  )
  ipcMain.handle('cloud:get-settings', () => settings.view())
  ipcMain.handle('cloud:save-settings', async (_e, input: CloudSettingsInput) => {
    const view = await settings.save(input)
    playlistSync.schedule() // a newly set-up cloud gets the playlists right away
    return view
  })
  ipcMain.handle('cloud:test', async (_e, input: CloudSettingsInput) => {
    try {
      const r = await settings.resolve({ url: input.url, token: input.token })
      if (!r) return { ok: false, error: 'Falta la URL o el token' }
      await new CloudClient({ baseUrl: r.url, token: r.token, retries: 0 }).health()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0a0a0a',
    title: 'Vibes',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  // Links (e.g. to YouTube) open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(__dirname, '../renderer/index.html'))

  // In the background: real covers for songs added from YouTube earlier.
  enrichYoutubeSongs(ctx).catch(() => {})
  // And the cloud gets the current playlists (in case they changed while offline).
  playlistSync.schedule()
}

app.on('window-all-closed', () => app.quit())
main().catch((err) => {
  console.error(err)
  app.exit(1)
})
