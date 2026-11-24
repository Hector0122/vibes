import { useEffect, useMemo, useRef, useState } from 'react'
import type { CloudSettingsView, LocalSong, Playlist, SearchResult, SongRef, TaskProgress, UpdateOffer } from '../../shared/types'
import { CloudSettings } from './CloudSettings'
import { Home } from './Home'
import { CloudIcon, DownloadIcon, HomeIcon, ImportIcon, LibraryIcon, ListIcon, Logo, PlusIcon, UploadIcon } from './icons'
import { Library } from './Library'
import { Player } from './Player'
import { PlaylistView } from './PlaylistView'
import { SONG_MIME } from './SongTable'

const TASK_LABEL: Record<TaskProgress['task'], string> = {
  import: 'Copiando audio de eSound',
  download: 'Descargando',
  upload: 'Subiendo a la nube'
}

/** The app's violet, used until (or when) a cover's color can't be read. */
const DEFAULT_ACCENT = '139 92 246'

// On/off switches remembered per machine; storage can be unavailable, so never fail on it.
const loadFlag = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
const saveFlag = (key: string, on: boolean): void => {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // not remembered this time
  }
}

/** A search hit / recommendation as something the player can play. */
export const toRef = (r: SearchResult): SongRef => ({
  id: r.id,
  title: r.title,
  artists: r.artists,
  album: null,
  durationSec: r.durationSec,
  coverUrl: r.coverUrl || null
})

/** What is playing when it isn't the library: a list from Inicio, a playlist, or the radio. */
interface QueueSource {
  label: string
  tracks: SongRef[]
}

export default function App(): React.JSX.Element {
  const [songs, setSongs] = useState<LocalSong[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [onlySaved, setOnlySaved] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [shuffle, setShuffleState] = useState(() => loadFlag('vibes.shuffle'))
  const [radio, setRadioState] = useState(() => loadFlag('vibes.radio'))
  const [source, setSource] = useState<QueueSource | null>(null)
  // Every non-library song that was queued, so one that is playing keeps its title
  // and cover even after its list is closed ("Volver a mi biblioteca").
  const seen = useRef(new Map<string, SongRef>())
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [cloud, setCloud] = useState<CloudSettingsView | null>(null)
  const [velodySent, setVelodySent] = useState<Set<string>>(new Set())
  const [update, setUpdate] = useState<UpdateOffer | null>(null)
  const [updating, setUpdating] = useState<string | null>(null) // "Descargando… 40 %" / "Instalando…"
  // 'home' | 'library' | 'playlist:<id>'
  const [view, setView] = useState<string>('home')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [newName, setNewName] = useState<string | null>(null) // "Nueva playlist" input open
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const refresh = (): Promise<void> =>
    window.api.listSongs().then((list) => {
      setSongs(list)
      setLoaded(true)
    })
  const refreshCloud = (): Promise<void> => window.api.getCloudSettings().then(setCloud)
  const refreshPlaylists = (): Promise<void> => window.api.listPlaylists().then(setPlaylists)
  const clean = (err: unknown): string =>
    (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  /** Deletes songs here, in the cloud and from the playlists, after asking. */
  async function deleteSongs(list: LocalSong[]): Promise<void> {
    if (!list.length) return
    const what = list.length === 1 ? `«${list[0].title}»` : `estas ${list.length} canciones`
    if (!window.confirm(`¿Eliminar ${what}? Se borra de esta compu, de la nube (y del celular) y de tus playlists.`)) return
    try {
      const gone = await window.api.deleteSongs(list.map((s) => s.id))
      setMessage(gone.length === 1 ? 'Canción eliminada' : `${gone.length} canciones eliminadas`)
    } catch (err) {
      setMessage(clean(err))
    }
  }

  const refreshVelody = (): Promise<void> => window.api.listVelodySends().then((ids) => setVelodySent(new Set(ids)))

  /** Vibes → Velody: the song waits in the cloud until Velody downloads and separates it. */
  async function sendToVelody(song: LocalSong): Promise<void> {
    try {
      const r = await window.api.sendToVelody([song.id])
      setMessage(r.sent.length ? `Mandada a Velody: ${song.title}` : `No se mandó: ${r.skipped[0]?.reason ?? 'error'}`)
    } catch (err) {
      setMessage(clean(err))
    }
    await refreshVelody()
  }

  async function applyUpdate(): Promise<void> {
    setUpdating('Descargando… 0 %')
    try {
      await window.api.installUpdate() // the .deb build restarts on the new version from here
      if (update?.mode === 'appimage') setUpdate(null)
    } catch (err) {
      setMessage(clean(err))
    }
    setUpdating(null)
  }

  async function addToPlaylist(playlistId: string, songId: string): Promise<void> {
    const pl = playlists.find((x) => x.id === playlistId)
    try {
      const n = await window.api.addToPlaylist(playlistId, [songId])
      setMessage(n ? `Agregada a “${pl?.name}”` : `Ya estaba en “${pl?.name}”`)
    } catch (err) {
      setMessage(clean(err))
    }
    await refreshPlaylists()
  }

  useEffect(() => {
    refresh()
    refreshCloud()
    refreshPlaylists()
    void refreshVelody()
    void window.api.checkForUpdate().then(setUpdate)
    const offUpdate = window.api.onUpdateProgress((p) =>
      setUpdating(p.stage === 'download' ? `Descargando… ${p.percent} %` : 'Instalando… (escribe tu contraseña en la ventana del sistema)')
    )
    // A song that's new to the list (e.g. one marked on the phone) is added to it.
    const offSong = window.api.onSongUpdated((s) =>
      setSongs((prev) => (prev.some((p) => p.id === s.id) ? prev.map((p) => (p.id === s.id ? s : p)) : [...prev, s]))
    )
    const offRemoved = window.api.onSongsRemoved((ids) => setSongs((prev) => prev.filter((s) => !ids.includes(s.id))))
    const offProgress = window.api.onProgress(setProgress)
    const offPlaylists = window.api.onPlaylistsChanged(() => void refreshPlaylists())
    return () => {
      offUpdate()
      offSong()
      offRemoved()
      offProgress()
      offPlaylists()
    }
  }, [])

  const setShuffle = (on: boolean): void => {
    saveFlag('vibes.shuffle', on)
    setShuffleState(on)
  }
  const setRadio = (on: boolean): void => {
    saveFlag('vibes.radio', on)
    setRadioState(on)
  }

  /** Play from the library (clears any other list). */
  const playFromLibrary = (id: string): void => {
    setSource(null)
    setCurrentId(id)
  }
  /** Play `id` within a list that isn't the library (Inicio cards, playlist, radio). */
  const playFromList = (label: string, tracks: SongRef[], id: string): void => {
    for (const t of tracks) seen.current.set(t.id, t)
    setSource({ label, tracks })
    setCurrentId(id)
  }

  async function startRadio(last: SongRef): Promise<void> {
    try {
      const tracks = (await window.api.radio(last.id)).map(toRef)
      if (tracks.length) return playFromList(`Radio: parecidas a ${last.title}`, tracks, tracks[0].id)
      setMessage('La radio no encontró canciones nuevas parecidas')
    } catch {
      setMessage('No se pudo cargar la radio. ¿Estás sin internet?')
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return songs.filter(
      (s) =>
        (!onlySaved || s.saved) &&
        (!q || s.title.toLowerCase().includes(q) || s.artists.toLowerCase().includes(q))
    )
  }, [songs, query, onlySaved])

  const playable = visible.filter((s) => s.file)
  const openPlaylist = view.startsWith('playlist:') ? playlists.find((p) => `playlist:${p.id}` === view) ?? null : null
  const byId = new Map(songs.map((s) => [s.id, s]))
  const playlistSongs = (openPlaylist?.songIds ?? []).map((id) => byId.get(id)).filter((s): s is LocalSong => !!s)
  const playlistPlayable = playlistSongs.filter((s) => s.file)
  const queue: SongRef[] = source?.tracks ?? playable
  const libraryIds = new Set(songs.filter((s) => s.file).map((s) => s.id))
  const current: SongRef | null =
    songs.find((s) => s.id === currentId) ?? (currentId ? seen.current.get(currentId) : undefined) ?? null

  // The UI takes the color of the cover that is playing.
  const [accent, setAccent] = useState(DEFAULT_ACCENT)
  useEffect(() => {
    const url = current?.coverUrl
    if (!url) return setAccent(DEFAULT_ACCENT)
    let stale = false
    window.api.coverColor(url).then((c) => {
      if (!stale) setAccent(c ?? DEFAULT_ACCENT)
    })
    return () => {
      stale = true
    }
  }, [current?.coverUrl])

  async function runTask(label: string, fn: () => Promise<string>): Promise<void> {
    setBusy(true)
    setProgress(null)
    setMessage(`${label}…`)
    try {
      setMessage(await fn())
    } catch (err) {
      setMessage((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
      setProgress(null)
      await refresh()
    }
  }

  const failedText = (p: TaskProgress): string => (p.failed ? `, ${p.failed} con error` : '')
  const cloudOn = !!cloud?.enabled && !!cloud.url && cloud.hasToken

  const tools = [
    {
      label: 'Importar de eSound',
      Icon: ImportIcon,
      run: () =>
        runTask('Importando de eSound', async () => {
          const r = await window.api.importEsound()
          return `eSound: ${r.added} nuevas, ${r.updated} actualizadas, ${r.copied} audios copiados, ${r.missing} sin audio`
        })
    },
    {
      label: 'Descargar faltantes',
      Icon: DownloadIcon,
      run: () =>
        runTask('Descargando faltantes', async () => {
          const p = await window.api.downloadMissing()
          return `Descargadas ${p.done - p.failed} de ${p.total}${failedText(p)}`
        })
    },
    {
      label: 'Subir a la nube',
      Icon: UploadIcon,
      run: () =>
        runTask('Subiendo a la nube', async () => {
          const p = await window.api.uploadToCloud()
          return `Subidas ${p.done - p.failed} de ${p.total}${failedText(p)}`
        })
    }
  ]

  return (
    <div
      className="flex h-screen flex-col"
      data-accent={accent}
      style={{ '--accent': accent } as React.CSSProperties}
    >
      {update && (
        <div role="status" className="flex items-center gap-3 border-b border-white/5 bg-pink-500/10 px-4 py-2 text-sm">
          <span className="flex-1">
            {updating ?? `Hay una versión nueva de Vibes: ${update.version}`}
          </span>
          {!updating && (
            <>
              <button className="btn-accent h-8" onClick={() => void applyUpdate()}>
                {update.mode === 'deb' ? 'Actualizar' : 'Descargar'}
              </button>
              <button className="btn h-8" onClick={() => setUpdate(null)}>
                Después
              </button>
            </>
          )}
        </div>
      )}
      {/* "stage": where the full-screen "Reproduciendo ahora" opens, above everything but the player. */}
      <div id="stage" className="relative flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col gap-6 border-r border-white/5 bg-black/30 p-4">
          <div className="flex items-center gap-2.5 px-2 pt-1">
            <Logo className="h-8 w-8 drop-shadow-[0_4px_12px_rgba(236,72,153,0.35)]" />
            <span className="text-xl font-bold tracking-tight">Vibes</span>
          </div>

          <nav className="space-y-1">
            <button
              className="nav-item"
              aria-current={view === 'home' ? 'page' : undefined}
              onClick={() => setView('home')}
            >
              <HomeIcon />
              Inicio
            </button>
            <button
              className="nav-item"
              aria-label="Biblioteca"
              aria-current={view === 'library' ? 'page' : undefined}
              onClick={() => setView('library')}
            >
              <LibraryIcon />
              <span className="flex-1">Biblioteca</span>
              <span className="text-xs text-neutral-500">{songs.length}</span>
            </button>
          </nav>

          <div className="-mt-2 flex min-h-0 flex-col space-y-1">
            <div className="flex items-center justify-between px-3 pb-1">
              <p className="text-[11px] font-semibold tracking-widest text-neutral-500 uppercase">Playlists</p>
              <button
                className="icon p-1"
                aria-label="Nueva playlist"
                title="Nueva playlist"
                onClick={() => setNewName(newName === null ? '' : null)}
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            </div>
            {newName !== null && (
              <form
                className="px-1"
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    const pl = await window.api.createPlaylist(newName)
                    setNewName(null)
                    await refreshPlaylists()
                    setView(`playlist:${pl.id}`)
                  } catch (err) {
                    setMessage(clean(err))
                  }
                }}
              >
                <input
                  autoFocus
                  className="field rounded-lg py-1.5"
                  placeholder="Nombre, p. ej. Para manejar"
                  aria-label="Nombre de la nueva playlist"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setNewName(null)}
                />
              </form>
            )}
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  className={`nav-item py-1.5 ${dropTarget === pl.id ? 'bg-pink-500/20 text-white ring-1 ring-pink-400/60' : ''}`}
                  data-testid="playlist-link"
                  aria-current={view === `playlist:${pl.id}` ? 'page' : undefined}
                  onClick={() => setView(`playlist:${pl.id}`)}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(SONG_MIME)) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                    setDropTarget(pl.id)
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDropTarget(null)
                    const id = e.dataTransfer.getData(SONG_MIME)
                    if (id) addToPlaylist(pl.id, id)
                  }}
                >
                  <ListIcon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 truncate">{pl.name}</span>
                  <span className="text-xs text-neutral-500">{pl.songIds.length}</span>
                </button>
              ))}
              {playlists.length === 0 && newName === null && (
                <p className="px-3 text-xs leading-relaxed text-neutral-600">Crea una con el +</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-widest text-neutral-500 uppercase">
              Herramientas
            </p>
            {/* eSound is only for bringing an existing library in: once there is music, it goes away. */}
            {tools
              .filter((t) => t.label !== 'Importar de eSound' || (loaded && songs.length === 0))
              .map(({ label, Icon, run }) => (
              <button key={label} className="nav-item" disabled={busy} onClick={run}>
                <Icon className="h-[18px] w-[18px]" />
                {label}
              </button>
            ))}
          </div>

          <div className="mt-auto space-y-3">
            <div className="rounded-xl bg-white/5 p-3 text-xs text-neutral-400 ring-1 ring-white/5">
              <p data-testid="status" className="leading-relaxed break-words">
                {/* A progress event can arrive after the task's own reply: only show it while busy. */}
                {busy && progress
                  ? `${TASK_LABEL[progress.task]}: ${progress.done}/${progress.total}${failedText(progress)}`
                  : (message ?? `${songs.length} canciones`)}
              </p>
              {busy && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full bg-linear-to-r from-violet-500 to-pink-500 transition-all ${progress ? '' : 'w-1/3 animate-pulse'}`}
                    style={progress ? { width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` } : undefined}
                  />
                </div>
              )}
            </div>
            <button className="nav-item" aria-label="Nube" onClick={() => setShowSettings(true)}>
              <CloudIcon />
              <span className="flex-1">Nube</span>
              <span
                className={`h-2 w-2 rounded-full ${cloudOn ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400' : 'bg-neutral-600'}`}
                title={cloudOn ? 'Configurada' : 'Sin configurar'}
              />
            </button>
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Color wash behind the header, in the playing cover's color (a solid color fades smoothly; a gradient can't). */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-96 transition-colors duration-1000"
            style={{
              backgroundColor: 'rgb(var(--accent) / 0.3)',
              maskImage: 'linear-gradient(to bottom, black, transparent)'
            }}
          />
          {/* Both stay mounted so search results and recommendations survive switching. */}
          <div className={view === 'home' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <Home
              songs={songs}
              onAdded={refresh}
              currentId={currentId}
              playing={playing}
              onPlay={(label, list, id) => playFromList(label, list.map(toRef), id)}
            />
          </div>
          <div className={view === 'library' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <Library
              songs={songs}
              visible={visible}
              query={query}
              onQuery={setQuery}
              onlySaved={onlySaved}
              onOnlySaved={setOnlySaved}
              currentId={currentId}
              playing={playing}
              onPlay={playFromLibrary}
              onPlayAll={() => {
                setShuffle(false)
                if (playable[0]) playFromLibrary(playable[0].id)
              }}
              onShuffleAll={() => {
                setShuffle(true)
                const pick = playable[Math.floor(Math.random() * playable.length)]
                if (pick) playFromLibrary(pick.id)
              }}
              onOpenCloud={() => setShowSettings(true)}
              onGoSearch={() => setView('home')}
              playlists={playlists}
              onAddTo={addToPlaylist}
              onDelete={(list) => void deleteSongs(list)}
              onSendToVelody={(s) => void sendToVelody(s)}
              sentToVelody={velodySent}
            />
          </div>
          {openPlaylist && (
            <div className="flex min-h-0 flex-1 flex-col">
              <PlaylistView
                playlist={openPlaylist}
                songs={playlistSongs}
                currentId={currentId}
                playing={playing}
                onPlay={(id) => playFromList(`Playlist: ${openPlaylist.name}`, playlistPlayable, id)}
                onPlayAll={() => {
                  setShuffle(false)
                  if (playlistPlayable[0])
                    playFromList(`Playlist: ${openPlaylist.name}`, playlistPlayable, playlistPlayable[0].id)
                }}
                onShuffleAll={() => {
                  setShuffle(true)
                  const pick = playlistPlayable[Math.floor(Math.random() * playlistPlayable.length)]
                  if (pick) playFromList(`Playlist: ${openPlaylist.name}`, playlistPlayable, pick.id)
                }}
                onRename={async (name) => {
                  try {
                    await window.api.renamePlaylist(openPlaylist.id, name)
                  } catch (err) {
                    setMessage(clean(err))
                  }
                  await refreshPlaylists()
                }}
                onDelete={async () => {
                  await window.api.deletePlaylist(openPlaylist.id)
                  setView('library')
                  await refreshPlaylists()
                }}
                onMove={async (from, to) => {
                  await window.api.movePlaylistSong(openPlaylist.id, from, to)
                  await refreshPlaylists()
                }}
                onRemove={async (songId) => {
                  await window.api.removeFromPlaylist(openPlaylist.id, songId)
                  await refreshPlaylists()
                }}
              />
            </div>
          )}
        </section>
      </div>

      <Player
        song={current}
        queue={queue}
        onSelect={setCurrentId}
        shuffle={shuffle}
        onShuffle={setShuffle}
        onPlayingChange={setPlaying}
        queueLabel={source?.label ?? null}
        onExitQueue={() => setSource(null)}
        isPreview={!!current && !libraryIds.has(current.id)}
        onAdd={async () => {
          if (!current) return
          try {
            await window.api.addSong({
              id: current.id,
              title: current.title,
              artists: current.artists,
              durationSec: current.durationSec,
              coverUrl: current.coverUrl ?? ''
            })
          } catch (err) {
            setMessage((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
          } finally {
            await refresh()
          }
        }}
        radio={radio}
        onRadio={setRadio}
        onQueueEnd={startRadio}
      />
      {showSettings && (
        <CloudSettings
          onClose={() => {
            setShowSettings(false)
            refreshCloud()
          }}
        />
      )}
    </div>
  )
}
