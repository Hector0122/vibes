import type { LocalSong, Playlist } from '../../shared/types'
import { AlertIcon, HeartIcon, MusicIcon, PlayIcon, SearchIcon, ShuffleIcon, TrashIcon } from './icons'
import { SongTable } from './SongTable'

interface Props {
  songs: LocalSong[]
  visible: LocalSong[]
  query: string
  onQuery: (q: string) => void
  onlySaved: boolean
  onOnlySaved: (on: boolean) => void
  currentId: string | null
  playing: boolean
  onPlay: (id: string) => void
  onPlayAll: () => void
  onShuffleAll: () => void
  onOpenCloud: () => void
  onGoSearch: () => void
  playlists: Playlist[]
  onAddTo: (playlistId: string, songId: string) => void
  /** Deletes songs everywhere (the caller asks first). */
  onDelete: (songs: LocalSong[]) => void
}

/** The most common error among the songs, so one problem shows once instead of on every row. */
function topError(songs: LocalSong[]): { message: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const s of songs) if (s.error) counts.set(s.error, (counts.get(s.error) ?? 0) + 1)
  let best: { message: string; count: number } | null = null
  for (const [message, count] of counts) if (!best || count > best.count) best = { message, count }
  return best
}

export function Library(p: Props): React.JSX.Element {
  const withAudio = p.songs.filter((s) => s.file).length
  const inCloud = p.songs.filter((s) => s.uploaded).length
  const problem = topError(p.songs)
  const cloudProblem = !!problem && /nube|token/i.test(problem.message)
  // Songs that never downloaded: nothing to keep.
  const broken = p.songs.filter((s) => s.error && !s.file)

  return (
    <div className="relative flex-1 overflow-y-auto">
      <header className="px-8 pt-10 pb-6">
        <p className="text-xs font-semibold tracking-widest text-neutral-400 uppercase">Biblioteca</p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Tu música</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {p.songs.length} canciones · {withAudio} descargadas · {inCloud} en la nube
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className="flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-pink-500 text-white shadow-lg shadow-pink-500/30 transition hover:scale-105 active:scale-95 disabled:opacity-40"
            aria-label="Reproducir todo"
            title="Reproducir todo"
            disabled={withAudio === 0}
            onClick={p.onPlayAll}
          >
            <PlayIcon className="ml-0.5 h-6 w-6" />
          </button>
          <button className="btn h-10" disabled={withAudio === 0} onClick={p.onShuffleAll}>
            <ShuffleIcon className="h-4 w-4" />
            Aleatorio
          </button>
          <div className="relative ml-auto w-72">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              className="field pl-10"
              placeholder="Buscar en tu biblioteca"
              aria-label="Buscar"
              value={p.query}
              onChange={(e) => p.onQuery(e.target.value)}
            />
          </div>
          <button
            className={`btn h-9 ${p.onlySaved ? 'bg-pink-500/15 text-pink-300 ring-pink-500/40' : ''}`}
            aria-pressed={p.onlySaved}
            onClick={() => p.onOnlySaved(!p.onlySaved)}
          >
            <HeartIcon className="h-4 w-4" />
            Solo guardadas
          </button>
        </div>
      </header>

      {problem && (
        <div className="mx-8 mb-4 flex items-center gap-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200 ring-1 ring-red-500/20">
          <AlertIcon className="h-5 w-5 shrink-0 text-red-400" />
          <span className="flex-1">
            {problem.count === 1 ? '1 canción' : `${problem.count} canciones`} con error:{' '}
            <b className="font-semibold">{problem.message}</b>
          </span>
          {cloudProblem && (
            <button className="btn h-8" onClick={p.onOpenCloud}>
              Revisar la nube
            </button>
          )}
        </div>
      )}
      {broken.length > 0 && (
        <div className="mx-8 mb-4 flex items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-sm text-neutral-300 ring-1 ring-white/5">
          <span className="flex-1">
            {broken.length === 1 ? '1 canción no se pudo descargar' : `${broken.length} canciones no se pudieron descargar`}
          </span>
          <button className="btn h-8" onClick={() => p.onDelete(broken)}>
            <TrashIcon className="h-4 w-4" />
            {broken.length === 1 ? 'Eliminarla' : 'Eliminarlas'}
          </button>
        </div>
      )}

      {p.songs.length === 0 ? (
        <div className="mx-8 flex flex-col items-center gap-4 rounded-2xl bg-white/[0.03] p-12 text-center ring-1 ring-white/5">
          <MusicIcon className="h-10 w-10 text-violet-400" />
          <p className="text-neutral-300">Tu biblioteca está vacía.</p>
          <p className="text-sm text-neutral-500">Busca canciones en Inicio o usa “Importar de eSound”.</p>
          <button className="btn-accent" onClick={p.onGoSearch}>
            Buscar canciones
          </button>
        </div>
      ) : (
        <>
          <SongTable
            songs={p.visible}
            currentId={p.currentId}
            playing={p.playing}
            onPlay={p.onPlay}
            playlists={p.playlists}
            onAddTo={p.onAddTo}
            onDelete={(s) => p.onDelete([s])}
          />
          {p.visible.length === 0 && <p className="px-8 py-8 text-neutral-500">Nada coincide con tu búsqueda.</p>}
        </>
      )}
    </div>
  )
}
