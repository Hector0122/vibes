import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SongRef } from '../../shared/types'
import {
  CloseIcon,
  MusicIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PrevIcon,
  RadioIcon,
  ShuffleIcon,
  VolumeIcon
} from './icons'
import { NowPlaying } from './NowPlaying'
import { isListened, pickNext, pickPrev, remember } from '../../shared/queue'

const fmt = (sec: number): string =>
  Number.isFinite(sec) ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : '0:00'

const VOLUME_KEY = 'vibes.volume'
const loadVolume = (): number => {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY))
    return localStorage.getItem(VOLUME_KEY) !== null && v >= 0 && v <= 1 ? v : 1
  } catch {
    return 1
  }
}

interface Props {
  song: SongRef | null
  queue: SongRef[]
  onSelect: (id: string) => void
  shuffle: boolean
  onShuffle: (on: boolean) => void
  onPlayingChange: (playing: boolean) => void
  /** Where the queue comes from when it isn't the library ("Radio: parecidas a …"). */
  queueLabel: string | null
  onExitQueue: () => void
  /** The song isn't in the library: it streams, and can be added. */
  isPreview: boolean
  onAdd: () => Promise<void>
  radio: boolean
  onRadio: (on: boolean) => void
  /** The queue ran out while the radio is on: the app brings songs like this one. */
  onQueueEnd: (last: SongRef) => void
}

export function Player({
  song,
  queue,
  onSelect,
  shuffle,
  onShuffle,
  onPlayingChange,
  queueLabel,
  onExitQueue,
  isPreview,
  onAdd,
  radio,
  onRadio,
  onQueueEnd
}: Props): React.JSX.Element {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlayingState] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(loadVolume)
  const [muted, setMuted] = useState(false)
  // shuffle: songs still to play this round; null = not started, so an empty bag really means the round is over
  const bag = useRef<string[] | null>(null)
  const history = useRef<string[]>([]) // what played, for "Anterior"
  const lastId = useRef<string | null>(null)
  const goingBack = useRef(false)
  const failures = useRef(0) // songs in a row that failed to load
  const counted = useRef(false) // this play already counted
  const [expanded, setExpanded] = useState(false) // "Reproduciendo ahora" open
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(false) // waiting for the audio (a stream takes a few seconds)

  const ids = queue.map((s) => s.id)

  const setPlaying = (on: boolean): void => {
    setPlayingState(on)
    onPlayingChange(on)
  }

  function play(id: string | null): void {
    if (!id) return
    if (id === song?.id) {
      // Same song (one-song list): start it over instead of stopping.
      const el = audio.current
      if (el) {
        counted.current = false
        el.currentTime = 0
        el.play().catch(() => setPlaying(false))
      }
      return
    }
    onSelect(id)
  }

  /** `auto`: the song ended by itself (not a click), so the radio may take over at the end of the list. */
  function next(auto = false): void {
    const n = pickNext(ids, song?.id ?? null, shuffle, bag.current ?? ids)
    if (auto && radio && song && (n.wrapped || n.id === null || !ids.includes(song.id))) {
      bag.current = null
      return onQueueEnd(song)
    }
    bag.current = n.bag
    play(n.id)
  }

  function prev(): void {
    // A few seconds in, "Anterior" restarts the song, like any player.
    const el = audio.current
    if (el && song && el.currentTime > 3) {
      el.currentTime = 0
      return
    }
    const p = pickPrev(ids, song?.id ?? null, history.current)
    history.current = p.history
    goingBack.current = true
    play(p.id)
  }

  /** A song that can't load is skipped, but never more than one lap around the list. */
  function skipBroken(): void {
    failures.current++
    if (failures.current < ids.length) next()
    else setPlaying(false)
  }

  // Turning shuffle on or off, or another list (a playlist, the radio), starts a fresh round.
  useEffect(() => {
    bag.current = null
  }, [shuffle, queueLabel])

  useEffect(() => {
    const el = audio.current
    if (el) el.volume = muted ? 0 : volume
    try {
      localStorage.setItem(VOLUME_KEY, String(volume))
    } catch {
      // not remembered this time
    }
  }, [volume, muted])

  useEffect(() => {
    const el = audio.current
    if (lastId.current && lastId.current !== song?.id && !goingBack.current) {
      history.current = remember(history.current, lastId.current)
    }
    goingBack.current = false
    lastId.current = song?.id ?? null
    counted.current = false
    if (!song || !el) return
    // Picked by hand: don't play it again later in this shuffle round.
    if (bag.current) bag.current = bag.current.filter((id) => id !== song.id)
    let cancelled = false
    setLoading(true)
    window.api.audioUrl(song.id).then((url) => {
      if (cancelled) return
      if (!url) {
        setLoading(false)
        return skipBroken()
      }
      el.src = url
      el.play().catch(() => setPlaying(false))
    })
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artists,
        album: song.album ?? undefined,
        artwork: song.coverUrl ? [{ src: song.coverUrl }] : []
      })
    }
    return () => {
      cancelled = true
    }
  }, [song?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Media keys (play/pause/next on the keyboard or headphones).
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.setActionHandler('nexttrack', () => next())
    navigator.mediaSession.setActionHandler('previoustrack', prev)
  })

  const toggle = (): void => {
    const el = audio.current
    if (!el) return
    if (!song) return next() // nothing chosen yet: start the list (random if shuffle is on)
    if (el.paused) el.play().catch(() => setPlaying(false))
    else el.pause()
  }

  const pct = (v: number, max: number): string => `${max > 0 ? (v / max) * 100 : 0}%`
  const shownVolume = muted ? 0 : volume

  return (
    <footer
      className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-6 border-t border-white/5 px-4 py-3 transition-colors duration-1000"
      style={{ backgroundColor: 'color-mix(in srgb, rgb(var(--accent)) 8%, #0c0b10)' }}
    >
      <audio
        ref={audio}
        data-testid="audio"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime
          setTime(t)
          if (song && !counted.current && isListened(t, e.currentTarget.duration)) {
            counted.current = true
            window.api.songPlayed(song.id)
          }
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlaying={() => {
          failures.current = 0
          setLoading(false)
        }}
        onEnded={() => next(true)}
        onError={() => {
          setLoading(false)
          if (song) skipBroken()
        }}
      />

      <div className="flex min-w-0 items-center gap-3">
      <button
        className="group flex min-w-0 items-center gap-3 rounded-lg text-left disabled:cursor-default"
        aria-label="Abrir reproductor"
        title="Ver letra y portada"
        disabled={!song}
        onClick={() => setExpanded(!expanded)}
      >
        {song?.coverUrl ? (
          <img
            src={song.coverUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-lg object-cover shadow-lg shadow-black/50 transition group-hover:brightness-110 group-enabled:group-hover:scale-105"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white/5">
            <MusicIcon className="h-5 w-5 text-neutral-500" />
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium group-enabled:group-hover:underline" data-testid="now-playing">
            {song?.title ?? 'Nada sonando'}
          </div>
          <div className="truncate text-xs text-neutral-400">
            {loading ? <span className="animate-pulse text-pink-300">Cargando…</span> : song?.artists}
          </div>
          {queueLabel && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-500" data-testid="queue-label">
              <span className="truncate">{queueLabel}</span>
            </div>
          )}
        </div>
      </button>
      {queueLabel && (
        <button className="icon shrink-0 p-1" aria-label="Volver a mi biblioteca" title="Volver a mi biblioteca" onClick={onExitQueue}>
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {isPreview && song && (
        <button
          className="btn-accent h-8 shrink-0 px-3 text-xs"
          disabled={adding}
          title="Descargarla y guardarla en tu biblioteca"
          onClick={async () => {
            setAdding(true)
            try {
              await onAdd()
            } finally {
              setAdding(false)
            }
          }}
        >
          {!adding && <PlusIcon className="h-3.5 w-3.5" />}
          {adding ? 'Agregando…' : 'Agregar'}
        </button>
      )}
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-3">
          <button
            className={`icon relative ${shuffle ? 'text-pink-400 hover:text-pink-300' : ''}`}
            aria-label="Aleatorio"
            aria-pressed={shuffle}
            title={shuffle ? 'Aleatorio: activado' : 'Aleatorio: desactivado'}
            onClick={() => onShuffle(!shuffle)}
          >
            <ShuffleIcon className="h-[18px] w-[18px]" />
            {shuffle && <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-pink-400" />}
          </button>
          <button className="icon" aria-label="Anterior" onClick={prev}>
            <PrevIcon />
          </button>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 active:scale-95"
            aria-label={playing ? 'Pausar' : 'Reproducir'}
            onClick={toggle}
          >
            {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="ml-0.5 h-5 w-5" />}
          </button>
          <button className="icon" aria-label="Siguiente" onClick={() => next()}>
            <NextIcon />
          </button>
          {/* Keeps the play button centered. */}
          <span className="w-[34px]" />
        </div>
        <div className="flex w-full max-w-xl items-center gap-2">
          <span className="w-10 text-right text-[11px] text-neutral-400 tabular-nums">{fmt(time)}</span>
          <input
            type="range"
            aria-label="Posición"
            className="slider flex-1"
            style={{ '--p': pct(time, duration) } as React.CSSProperties}
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => {
              if (audio.current) audio.current.currentTime = Number(e.target.value)
            }}
          />
          <span className="w-10 text-[11px] text-neutral-400 tabular-nums">{fmt(duration)}</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          className={`icon relative ${radio ? 'text-pink-400 hover:text-pink-300' : ''}`}
          aria-label="Radio sin fin"
          aria-pressed={radio}
          title={radio ? 'Radio sin fin: al acabarse la lista siguen canciones parecidas' : 'Radio sin fin: desactivada'}
          onClick={() => onRadio(!radio)}
        >
          <RadioIcon className="h-[18px] w-[18px]" />
          {radio && <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-pink-400" />}
        </button>
        <button className="icon" aria-label={muted ? 'Activar sonido' : 'Silenciar'} onClick={() => setMuted(!muted)}>
          {shownVolume === 0 ? <MuteIcon className="h-[18px] w-[18px]" /> : <VolumeIcon className="h-[18px] w-[18px]" />}
        </button>
        <input
          type="range"
          aria-label="Volumen"
          className="slider w-28"
          style={{ '--p': pct(shownVolume, 1) } as React.CSSProperties}
          min={0}
          max={1}
          step={0.01}
          value={shownVolume}
          onChange={(e) => {
            setMuted(false)
            setVolume(Number(e.target.value))
          }}
        />
      </div>
      {expanded &&
        song &&
        document.getElementById('stage') &&
        createPortal(
          <NowPlaying
            song={song}
            time={time}
            onSeek={(t) => {
              if (audio.current) audio.current.currentTime = t
            }}
            onClose={() => setExpanded(false)}
          />,
          document.getElementById('stage')!
        )}
    </footer>
  )
}
