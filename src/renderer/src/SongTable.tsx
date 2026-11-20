import { useEffect, useRef, useState } from 'react'
import type { LocalSong, Playlist } from '../../shared/types'
import {
  AlertIcon,
  CloseIcon,
  CloudCheckIcon,
  DownloadIcon,
  Equalizer,
  MusicIcon,
  PlayIcon,
  PlusIcon
} from './icons'

/** Drag payload: a library song id. */
export const SONG_MIME = 'application/x-vibes-song'

const duration = (s: number | null): string =>
  s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

interface Props {
  songs: LocalSong[]
  currentId: string | null
  playing: boolean
  onPlay: (id: string) => void
  /** "+" menu on each row: add the song to one of these playlists. */
  playlists?: Playlist[]
  onAddTo?: (playlistId: string, songId: string) => void
  /** Rows can be dragged to reorder (a playlist). */
  onMove?: (from: number, to: number) => void
  /** "×" on each row (a playlist). */
  onRemove?: (songId: string) => void
}

/** The song list: number/equalizer, cover + title, album, length, status, actions. Rows drag onto playlists. */
export function SongTable(p: Props): React.JSX.Element {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  return (
    <div className="px-6 pb-8">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/5 bg-[#0f0d14]/90 px-2 py-2 text-xs font-medium tracking-wider text-neutral-500 uppercase backdrop-blur">
        <span className="grid flex-1 grid-cols-[2.5rem_minmax(0,1.6fr)_minmax(0,1fr)_3.5rem] gap-4">
          <span className="text-center">#</span>
          <span>Título</span>
          <span>Álbum</span>
          <span className="text-right">Dur.</span>
        </span>
        <span className="w-8" />
        <span className="w-8" />
      </div>
      <ul className="mt-1">
        {p.songs.map((s, i) => {
          const isCurrent = s.id === p.currentId
          return (
            <li
              key={s.id}
              data-testid="song-row"
              draggable={!!s.file}
              onDragStart={(e) => {
                e.dataTransfer.setData(SONG_MIME, s.id)
                e.dataTransfer.setData('text/plain', `${s.title} — ${s.artists}`)
                e.dataTransfer.effectAllowed = 'copyMove'
                if (p.onMove) setDragFrom(i)
              }}
              onDragEnd={() => {
                setDragFrom(null)
                setDropAt(null)
              }}
              onDragOver={(e) => {
                if (!p.onMove || dragFrom === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropAt(i)
              }}
              onDrop={(e) => {
                if (!p.onMove || dragFrom === null) return
                e.preventDefault()
                if (dragFrom !== i) p.onMove(dragFrom, i)
                setDragFrom(null)
                setDropAt(null)
              }}
              className={`group relative flex items-center gap-2 rounded-lg transition hover:bg-white/5 ${
                isCurrent ? 'bg-white/[0.07]' : ''
              } ${dragFrom === i ? 'opacity-40' : ''}`}
            >
              {dropAt === i && dragFrom !== null && dragFrom !== i && (
                <span
                  className={`pointer-events-none absolute inset-x-2 h-0.5 rounded bg-pink-400 ${dragFrom < i ? '-bottom-px' : '-top-px'}`}
                />
              )}
              <button
                data-testid="song"
                disabled={!s.file}
                onClick={() => p.onPlay(s.id)}
                className="grid flex-1 grid-cols-[2.5rem_minmax(0,1.6fr)_minmax(0,1fr)_3.5rem] items-center gap-4 rounded-lg py-1.5 pl-2 text-left disabled:cursor-default disabled:opacity-45"
              >
                <span className="flex justify-center text-sm text-neutral-500">
                  {isCurrent ? (
                    <Equalizer active={p.playing} />
                  ) : (
                    <>
                      <span className={s.file ? 'group-hover:hidden' : ''}>{i + 1}</span>
                      {s.file && <PlayIcon className="hidden h-4 w-4 text-white group-hover:block" />}
                    </>
                  )}
                </span>
                <span className="flex min-w-0 items-center gap-3">
                  {s.coverUrl ? (
                    <img
                      src={s.coverUrl}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className="h-10 w-10 shrink-0 rounded-md object-cover shadow-md shadow-black/40"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-800">
                      <MusicIcon className="h-4 w-4 text-neutral-500" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className={`block truncate ${isCurrent ? 'font-medium text-pink-400' : ''}`}>{s.title}</span>
                    <span className="block truncate text-sm text-neutral-400">{s.artists}</span>
                  </span>
                </span>
                <span className="overflow-hidden text-sm text-ellipsis whitespace-nowrap text-neutral-400">
                  {s.album ?? ''}
                </span>
                <span className="text-right text-sm text-neutral-400 tabular-nums">{duration(s.durationSec)}</span>
              </button>
              <span className="flex w-8 justify-center">
                <SongStatus song={s} />
              </span>
              <span className="relative flex w-8 justify-center">
                {p.onRemove ? (
                  <button
                    className="icon p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label="Quitar de la playlist"
                    title="Quitar de la playlist"
                    onClick={() => p.onRemove!(s.id)}
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                ) : (
                  p.onAddTo &&
                  s.file && (
                    <>
                      <button
                        className={`icon p-1 group-hover:opacity-100 focus-visible:opacity-100 ${menuFor === s.id ? 'opacity-100' : 'opacity-0'}`}
                        aria-label="Agregar a playlist"
                        title="Agregar a playlist"
                        onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                      >
                        <PlusIcon className="h-4 w-4" />
                      </button>
                      {menuFor === s.id && (
                        <AddMenu
                          playlists={p.playlists ?? []}
                          onPick={(pl) => {
                            p.onAddTo!(pl, s.id)
                            setMenuFor(null)
                          }}
                          onClose={() => setMenuFor(null)}
                        />
                      )}
                    </>
                  )
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AddMenu({
  playlists,
  onPick,
  onClose
}: {
  playlists: Playlist[]
  onPick: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Next tick, so the click that opened the menu doesn't close it.
    const t = setTimeout(() => document.addEventListener('mousedown', away))
    document.addEventListener('keydown', esc)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Agregar a playlist"
      className="absolute top-full right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl bg-neutral-900 py-1 shadow-2xl shadow-black/60 ring-1 ring-white/10"
    >
      <p className="px-3 py-1.5 text-[11px] font-semibold tracking-widest text-neutral-500 uppercase">
        Agregar a playlist
      </p>
      {playlists.length === 0 ? (
        <p className="px-3 py-2 text-sm text-neutral-400">Crea una playlist en la barra lateral.</p>
      ) : (
        playlists.map((pl) => (
          <button
            key={pl.id}
            role="menuitem"
            className="block w-full truncate px-3 py-2 text-left text-sm text-neutral-200 hover:bg-white/10"
            onClick={() => onPick(pl.id)}
          >
            {pl.name}
          </button>
        ))
      )}
    </div>
  )
}

function SongStatus({ song }: { song: LocalSong }): React.JSX.Element | null {
  if (song.error)
    return (
      <span title={song.error}>
        <AlertIcon className="h-4 w-4 text-red-400" />
      </span>
    )
  if (!song.file)
    return (
      <span title="Sin audio: usa “Descargar faltantes”">
        <DownloadIcon className="h-4 w-4 text-neutral-500" />
      </span>
    )
  if (song.uploaded)
    return (
      <span title="En tu nube">
        <CloudCheckIcon className="h-4 w-4 text-violet-400" />
      </span>
    )
  return null
}
