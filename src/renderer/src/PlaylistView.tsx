import { useEffect, useState } from 'react'
import type { LocalSong, Playlist } from '../../shared/types'
import { ListIcon, PlayIcon, ShuffleIcon } from './icons'
import { SongTable } from './SongTable'

interface Props {
  playlist: Playlist
  /** The playlist's songs that are in the library, in order. */
  songs: LocalSong[]
  currentId: string | null
  playing: boolean
  onPlay: (id: string) => void
  onPlayAll: () => void
  onShuffleAll: () => void
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
  onMove: (from: number, to: number) => void
  onRemove: (songId: string) => void
}

/** Up to four covers in a 2×2 grid, like a mixtape. */
function Mosaic({ songs }: { songs: LocalSong[] }): React.JSX.Element {
  const covers = [...new Set(songs.map((s) => s.coverUrl).filter(Boolean))].slice(0, 4) as string[]
  return (
    <div className="grid h-40 w-40 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-2xl bg-linear-to-br from-violet-500 to-pink-500 shadow-2xl shadow-black/50">
      {covers.length < 4 ? (
        <div className="col-span-2 row-span-2 flex items-center justify-center">
          <ListIcon className="h-14 w-14 text-white/90" />
        </div>
      ) : (
        covers.map((c) => <img key={c} src={c} alt="" className="h-full w-full object-cover" />)
      )}
    </div>
  )
}

export function PlaylistView(p: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(p.playlist.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const playable = p.songs.filter((s) => s.file)

  useEffect(() => {
    setName(p.playlist.name)
    setEditing(false)
    setConfirmDelete(false)
  }, [p.playlist.id, p.playlist.name])

  const totalMin = Math.round(p.songs.reduce((a, s) => a + (s.durationSec ?? 0), 0) / 60)

  return (
    <div className="relative flex-1 overflow-y-auto">
      <header className="flex items-end gap-6 px-8 pt-10 pb-6">
        <Mosaic songs={p.songs} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-widest text-neutral-400 uppercase">Playlist</p>
          {editing ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                await p.onRename(name)
                setEditing(false)
              }}
            >
              <input
                autoFocus
                aria-label="Nombre de la playlist"
                className="mt-1 w-full max-w-xl rounded-lg bg-white/10 px-3 py-1 text-4xl font-bold tracking-tight outline-none ring-1 ring-violet-500/70"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setEditing(false)}
                onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
              />
            </form>
          ) : (
            <h1
              className="mt-1 cursor-text truncate text-4xl font-bold tracking-tight"
              title="Clic para renombrar"
              onClick={() => setEditing(true)}
            >
              {p.playlist.name}
            </h1>
          )}
          <p className="mt-2 text-sm text-neutral-400">
            {p.songs.length} {p.songs.length === 1 ? 'canción' : 'canciones'}
            {totalMin > 0 && ` · ${totalMin} min`}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              className="flex h-12 w-12 items-center justify-center rounded-full bg-linear-to-br from-violet-500 to-pink-500 text-white shadow-lg shadow-pink-500/30 transition hover:scale-105 active:scale-95 disabled:opacity-40"
              aria-label="Reproducir playlist"
              disabled={playable.length === 0}
              onClick={p.onPlayAll}
            >
              <PlayIcon className="ml-0.5 h-6 w-6" />
            </button>
            <button className="btn h-10" disabled={playable.length === 0} onClick={p.onShuffleAll}>
              <ShuffleIcon className="h-4 w-4" />
              Aleatorio
            </button>
            <button className="btn h-10" onClick={() => setEditing(true)}>
              Renombrar
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-2 text-sm text-neutral-300">
                ¿Eliminar “{p.playlist.name}”? Tus canciones se quedan en la biblioteca.
                <button className="btn h-9 bg-red-500/20 text-red-200 ring-red-500/40 hover:bg-red-500/30" onClick={p.onDelete}>
                  Sí, eliminar
                </button>
                <button className="btn h-9" onClick={() => setConfirmDelete(false)}>
                  Cancelar
                </button>
              </span>
            ) : (
              <button className="btn h-10" onClick={() => setConfirmDelete(true)}>
                Eliminar
              </button>
            )}
          </div>
        </div>
      </header>

      {p.songs.length === 0 ? (
        <div className="mx-8 rounded-2xl bg-white/[0.03] p-10 text-center text-neutral-400 ring-1 ring-white/5">
          Arrastra canciones desde tu Biblioteca hasta esta playlist en la barra lateral, o usa el botón{' '}
          <b className="text-neutral-200">+</b> de cada canción.
        </div>
      ) : (
        <SongTable
          songs={p.songs}
          currentId={p.currentId}
          playing={p.playing}
          onPlay={p.onPlay}
          onMove={p.onMove}
          onRemove={p.onRemove}
        />
      )}
    </div>
  )
}
