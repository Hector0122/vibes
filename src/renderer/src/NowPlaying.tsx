import { useEffect, useRef, useState } from 'react'
import { currentLine } from '../../shared/lyrics'
import type { Lyrics, SongRef } from '../../shared/types'
import { CloseIcon, MusicIcon } from './icons'

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'done'; lyrics: Lyrics | null }

/** Lines light up a bit early, the way people sing along. */
const LEAD = 0.3

/** Full-screen "now playing": big cover over a blurred backdrop, and the lyrics, synced when possible. */
export function NowPlaying({
  song,
  time,
  onSeek,
  onClose
}: {
  song: SongRef
  time: number
  onSeek: (t: number) => void
  onClose: () => void
}): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    let stale = false
    setState({ kind: 'loading' })
    window.api
      .lyrics({
        id: song.id,
        title: song.title,
        artists: song.artists,
        album: song.album,
        durationSec: song.durationSec,
        coverUrl: song.coverUrl
      })
      .then(
        (lyrics) => !stale && setState({ kind: 'done', lyrics }),
        () => !stale && setState({ kind: 'error' })
      )
    return () => {
      stale = true
    }
  }, [song.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const synced = state.kind === 'done' ? state.lyrics?.synced : null
  const active = synced ? currentLine(synced, time + LEAD) : -1

  // Keep the line being sung in the middle.
  useEffect(() => {
    if (active >= 0) lineRefs.current[active]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

  return (
    <div
      className="absolute inset-0 z-40 overflow-hidden bg-[#09090b]"
      data-testid="now-playing-view"
      role="dialog"
      aria-label="Reproduciendo ahora"
    >
      {song.coverUrl && (
        <img
          src={song.coverUrl}
          alt=""
          className="absolute inset-0 h-full w-full scale-125 object-cover opacity-40 blur-3xl"
        />
      )}
      <div
        className="absolute inset-0 transition-colors duration-1000"
        style={{
          background:
            'linear-gradient(135deg, rgb(var(--accent) / 0.35), rgb(9 9 11 / 0.75) 55%, rgb(9 9 11 / 0.95))'
        }}
      />
      <button className="icon absolute top-4 right-4 z-10 bg-black/30" aria-label="Cerrar" onClick={onClose}>
        <CloseIcon />
      </button>

      <div className="relative grid h-full grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-12 px-12 py-10">
        <div className="flex min-h-0 flex-col justify-center">
          {song.coverUrl ? (
            <img
              src={song.coverUrl}
              alt=""
              className="aspect-square w-full max-w-[26rem] rounded-2xl object-cover shadow-2xl shadow-black/60"
            />
          ) : (
            <div className="flex aspect-square w-full max-w-[26rem] items-center justify-center rounded-2xl bg-white/5">
              <MusicIcon className="h-20 w-20 text-neutral-600" />
            </div>
          )}
          <h2 className="mt-8 text-4xl leading-tight font-bold tracking-tight">{song.title}</h2>
          <p className="mt-2 text-lg text-neutral-300">{song.artists}</p>
          {song.album && <p className="mt-1 text-sm text-neutral-500">{song.album}</p>}
        </div>

        <div className="min-h-0 overflow-y-auto py-[30vh] [mask-image:linear-gradient(transparent,black_20%,black_80%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {state.kind === 'loading' && (
            <div className="space-y-5" aria-busy="true">
              {[70, 55, 80, 45, 65].map((w, i) => (
                <div key={i} className="h-7 animate-pulse rounded bg-white/10" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
          {state.kind === 'error' && (
            <p className="text-xl text-neutral-400">No se pudo cargar la letra. ¿Estás sin internet?</p>
          )}
          {state.kind === 'done' && !state.lyrics && (
            <p className="text-xl text-neutral-400">No encontramos la letra de esta canción.</p>
          )}
          {state.kind === 'done' && state.lyrics?.instrumental && (
            <p className="text-2xl font-semibold text-neutral-300">♪ Instrumental</p>
          )}
          {synced ? (
            <div className="space-y-5">
              {synced.map((l, i) => (
                <button
                  key={i}
                  ref={(el) => {
                    lineRefs.current[i] = el
                  }}
                  data-testid="lyric-line"
                  aria-current={i === active ? 'true' : undefined}
                  onClick={() => onSeek(l.t)}
                  className={`block origin-left text-left text-3xl leading-snug font-bold transition-all duration-300 hover:text-white/90 ${
                    i === active ? 'scale-[1.02] text-white' : i < active ? 'text-white/45' : 'text-white/25'
                  }`}
                >
                  {l.text || '♪'}
                </button>
              ))}
            </div>
          ) : (
            state.kind === 'done' &&
            state.lyrics?.plain && (
              <p className="text-2xl leading-relaxed font-semibold whitespace-pre-line text-white/85" data-testid="lyrics-plain">
                {state.lyrics.plain}
              </p>
            )
          )}
        </div>
      </div>
    </div>
  )
}
