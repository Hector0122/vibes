import { useEffect, useRef, useState } from 'react'
import type { LocalSong } from '../../shared/types'

const fmt = (sec: number): string =>
  Number.isFinite(sec) ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : '0:00'

interface Props {
  song: LocalSong | null
  queue: LocalSong[]
  onSelect: (id: string) => void
}

export function Player({ song, queue, onSelect }: Props): React.JSX.Element {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [shuffle, setShuffle] = useState(false)

  function step(dir: 1 | -1): void {
    if (queue.length === 0) return
    if (shuffle && dir === 1) {
      onSelect(queue[Math.floor(Math.random() * queue.length)].id)
      return
    }
    const i = queue.findIndex((s) => s.id === song?.id)
    onSelect(queue[(i + dir + queue.length) % queue.length].id)
  }

  useEffect(() => {
    const el = audio.current
    if (!song || !el) return
    let cancelled = false
    window.api.audioUrl(song.id).then((url) => {
      if (cancelled || !url) return
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
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1))
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1))
  })

  const toggle = (): void => {
    const el = audio.current
    if (!el || !song) return
    if (el.paused) el.play()
    else el.pause()
  }

  return (
    <footer className="flex items-center gap-4 border-t border-neutral-800 bg-neutral-950 px-4 py-3">
      <audio
        ref={audio}
        data-testid="audio"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => step(1)}
      />
      <div className="w-64 min-w-0">
        <div className="truncate text-sm" data-testid="now-playing">
          {song?.title ?? 'Nada sonando'}
        </div>
        <div className="truncate text-xs text-neutral-500">{song?.artists}</div>
      </div>
      <div className="flex items-center gap-2">
        <button className="icon" aria-label="Anterior" onClick={() => step(-1)}>
          ⏮
        </button>
        <button className="icon text-2xl" aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={toggle}>
          {playing ? '⏸' : '▶'}
        </button>
        <button className="icon" aria-label="Siguiente" onClick={() => step(1)}>
          ⏭
        </button>
        <button
          className={`icon ${shuffle ? 'text-violet-400' : 'text-neutral-500'}`}
          aria-label="Aleatorio"
          aria-pressed={shuffle}
          onClick={() => setShuffle(!shuffle)}
        >
          🔀
        </button>
      </div>
      <span className="w-10 text-right text-xs text-neutral-500">{fmt(time)}</span>
      <input
        type="range"
        aria-label="Posición"
        className="flex-1 accent-violet-500"
        min={0}
        max={duration || 0}
        step={0.1}
        value={time}
        onChange={(e) => {
          if (audio.current) audio.current.currentTime = Number(e.target.value)
        }}
      />
      <span className="w-10 text-xs text-neutral-500">{fmt(duration)}</span>
    </footer>
  )
}
