import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { CloudSettingsInput, LocalSong, TaskProgress } from '../shared/types'
import { CloudClient } from './cloud/client'
import { CloudSettingsStore } from './cloud/settings'
import { startAudioServer } from './audio-server'
import { Library } from './library'
import { defaultTools } from './media'
import { downloadMissing, importEsound, uploadAll, type TaskContext } from './tasks'

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
  const settings = new CloudSettingsStore(join(userData, 'cloud.json'), safeStorage)
  const { port } = await startAudioServer(audioDir)
  const ctx: TaskContext = {
    library,
    audioDir,
    tools: defaultTools(),
    onSong: (s) => send('song-updated', s),
    onProgress: (p) => send('progress', p)
  }

  ipcMain.handle('songs:list', () => library.list())
  ipcMain.handle('songs:audio-url', (_e, id: string) => {
    const file = library.get(id)?.file
    return file ? `http://127.0.0.1:${port}/${file}` : ''
  })
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
  ipcMain.handle('cloud:get-settings', () => settings.view())
  ipcMain.handle('cloud:save-settings', (_e, input: CloudSettingsInput) => settings.save(input))
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
}

app.on('window-all-closed', () => app.quit())
main().catch((err) => {
  console.error(err)
  app.exit(1)
})
