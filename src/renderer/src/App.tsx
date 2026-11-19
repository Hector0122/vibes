import { useEffect, useMemo, useState } from 'react'
import type { LocalSong, TaskProgress } from '../../shared/types'
import { CloudSettings } from './CloudSettings'
import { Player } from './Player'

const TASK_LABEL: Record<TaskProgress['task'], string> = {
  import: 'Copiando audio de eSound',
  download: 'Descargando',
  upload: 'Subiendo a la nube'
}

export default function App(): React.JSX.Element {
  const [songs, setSongs] = useState<LocalSong[]>([])
  const [query, setQuery] = useState('')
  const [onlySaved, setOnlySaved] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const refresh = (): Promise<void> => window.api.listSongs().then(setSongs)

  useEffect(() => {
    refresh()
    const offSong = window.api.onSongUpdated((s) =>
      setSongs((prev) => prev.map((p) => (p.id === s.id ? s : p)))
    )
    const offProgress = window.api.onProgress(setProgress)
    return () => {
      offSong()
      offProgress()
    }
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return songs.filter(
      (s) =>
        (!onlySaved || s.saved) &&
        (!q || s.title.toLowerCase().includes(q) || s.artists.toLowerCase().includes(q))
    )
  }, [songs, query, onlySaved])

  const playable = visible.filter((s) => s.file)
  const current = songs.find((s) => s.id === currentId) ?? null

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

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <h1 className="mr-2 text-xl font-bold tracking-tight text-violet-400">Vibes</h1>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            runTask('Importando de eSound', async () => {
              const r = await window.api.importEsound()
              return `eSound: ${r.added} nuevas, ${r.updated} actualizadas, ${r.copied} audios copiados, ${r.missing} sin audio`
            })
          }
        >
          Importar de eSound
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            runTask('Descargando faltantes', async () => {
              const p = await window.api.downloadMissing()
              return `Descargadas ${p.done - p.failed} de ${p.total}${failedText(p)}`
            })
          }
        >
          Descargar faltantes
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            runTask('Subiendo a la nube', async () => {
              const p = await window.api.uploadToCloud()
              return `Subidas ${p.done - p.failed} de ${p.total}${failedText(p)}`
            })
          }
        >
          Subir a la nube
        </button>
        <button className="btn ml-auto" onClick={() => setShowSettings(true)}>
          Nube
        </button>
      </header>

      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        <input
          className="w-72 rounded bg-neutral-900 px-3 py-1.5 outline-none focus:ring-1 focus:ring-violet-500"
          placeholder="Buscar canción o artista"
          aria-label="Buscar"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-neutral-400">
          <input type="checkbox" checked={onlySaved} onChange={(e) => setOnlySaved(e.target.checked)} />
          Solo guardadas
        </label>
        <span className="ml-auto text-neutral-500" data-testid="status">
          {/* A progress event can arrive after the task's own reply: only show it while busy. */}
          {busy && progress
            ? `${TASK_LABEL[progress.task]}: ${progress.done}/${progress.total}${failedText(progress)}`
            : message ?? `${songs.length} canciones`}
        </span>
      </div>

      <main className="flex-1 overflow-y-auto px-2">
        {songs.length === 0 && (
          <p className="mt-20 text-center text-neutral-500">
            Tu biblioteca está vacía. Empieza con “Importar de eSound”.
          </p>
        )}
        <ul>
          {visible.map((s) => (
            <li key={s.id}>
              <button
                data-testid="song"
                disabled={!s.file}
                onClick={() => setCurrentId(s.id)}
                className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-neutral-900 disabled:cursor-default disabled:opacity-50 ${
                  s.id === currentId ? 'bg-neutral-900 text-violet-300' : ''
                }`}
              >
                {s.coverUrl ? (
                  <img src={s.coverUrl} alt="" className="h-9 w-9 rounded object-cover" />
                ) : (
                  <div className="h-9 w-9 rounded bg-neutral-800" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{s.title}</div>
                  <div className="truncate text-xs text-neutral-500">{s.artists}</div>
                </div>
                {s.error && (
                  <span className="max-w-64 truncate text-xs text-red-400" title={s.error}>
                    {s.error}
                  </span>
                )}
                <span className="w-16 text-right text-xs text-neutral-500">
                  {!s.file ? 'sin audio' : s.uploaded ? '☁ nube' : 'local'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>

      <Player song={current} queue={playable} onSelect={setCurrentId} />
      {showSettings && <CloudSettings onClose={() => setShowSettings(false)} />}
    </div>
  )
}
