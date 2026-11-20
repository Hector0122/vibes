import { useEffect, useState } from 'react'
import type { LocalSong, Recommendations, SearchResult } from '../../shared/types'
import { AlertIcon, CheckIcon, CloseIcon, Equalizer, PlayIcon, PlusIcon, SearchIcon } from './icons'

const clean = (e: unknown): string =>
  (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const duration = (s: number | null): string =>
  s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function greeting(d = new Date()): string {
  const h = d.getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

/** "A", "A y B", "A, B y C" */
const listing = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`

/**
 * The start page: search YouTube, and recommendations from YouTube mixes of
 * songs in the library. Either one adds songs (download + cloud) in place.
 */
export function Home({
  songs,
  onAdded,
  currentId,
  playing,
  onPlay
}: {
  songs: LocalSong[]
  onAdded: () => void
  currentId: string | null
  playing: boolean
  /** Listen without adding: plays `id`, then the rest of `list`. */
  onPlay: (label: string, list: SearchResult[], id: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [searchedFor, setSearchedFor] = useState<string | null>(null)
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [recs, setRecs] = useState<Recommendations | null>(null)
  const [recsLoading, setRecsLoading] = useState(false)
  const [recsError, setRecsError] = useState<string | null>(null)
  const [adding, setAdding] = useState<Record<string, boolean>>({})
  const [failed, setFailed] = useState<Record<string, string>>({})

  const hasMusic = songs.some((s) => s.file)

  async function loadRecs(): Promise<void> {
    setRecsLoading(true)
    setRecsError(null)
    try {
      setRecs(await window.api.recommend())
    } catch (err) {
      setRecsError(clean(err))
    } finally {
      setRecsLoading(false)
    }
  }

  // First recommendations as soon as there is music to base them on.
  useEffect(() => {
    if (hasMusic && !recs && !recsLoading) loadRecs()
  }, [hasMusic]) // eslint-disable-line react-hooks/exhaustive-deps

  async function search(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    try {
      setResults(await window.api.searchYoutube(q))
      setSearchedFor(q)
    } catch (err) {
      setSearchError(clean(err))
    } finally {
      setSearching(false)
    }
  }

  async function add(r: SearchResult): Promise<void> {
    setAdding((a) => ({ ...a, [r.id]: true }))
    setFailed(({ [r.id]: _, ...rest }) => rest)
    try {
      await window.api.addSong(r)
    } catch (err) {
      setFailed((f) => ({ ...f, [r.id]: clean(err) }))
    } finally {
      setAdding(({ [r.id]: _, ...rest }) => rest)
      onAdded()
    }
  }

  const inLibrary = new Set(songs.filter((s) => s.file).map((s) => s.id))
  const card = (r: SearchResult, testId: string, label: string, list: SearchResult[]): React.JSX.Element => (
    <SongCard
      key={r.id}
      r={r}
      testId={testId}
      inLibrary={inLibrary.has(r.id)}
      adding={!!adding[r.id]}
      error={failed[r.id]}
      onAdd={() => add(r)}
      isCurrent={r.id === currentId}
      playing={playing}
      onPlay={() => onPlay(label, list, r.id)}
    />
  )

  return (
    <div className="relative flex-1 overflow-y-auto">
      <div className="px-8 pt-10 pb-8">
        <p className="text-sm font-medium text-neutral-400">{greeting()}</p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">¿Qué quieres escuchar?</h1>
        <form onSubmit={search} className="mt-6 flex max-w-2xl gap-3">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              className="field h-12 pr-11 pl-12 text-base"
              placeholder="Busca en YouTube: canción, artista…"
              aria-label="Buscar en YouTube"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(query || searchedFor) && (
              <button
                type="button"
                className="icon absolute top-1/2 right-2 -translate-y-1/2"
                aria-label="Limpiar búsqueda"
                onClick={() => {
                  setQuery('')
                  setSearchedFor(null)
                  setResults([])
                  setSearchError(null)
                }}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          <button type="submit" className="btn-accent h-12 px-6" disabled={searching || !query.trim()}>
            {searching ? 'Buscando…' : 'Buscar'}
          </button>
        </form>
        {searchError && <p className="mt-3 text-sm text-red-400">{searchError}</p>}
      </div>

      {searchedFor !== null ? (
        <section className="px-8 pb-10">
          <h2 className="mb-4 text-xl font-bold">
            Resultados para <span className="gradient-text">“{searchedFor}”</span>
          </h2>
          {results.length === 0 ? (
            <p className="text-neutral-500">Sin resultados.</p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
              {results.map((r) => card(r, 'result', `Búsqueda: “${searchedFor}”`, results))}
            </ul>
          )}
        </section>
      ) : (
        <section className="px-8 pb-10">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-bold">Recomendado para ti</h2>
              {recs && recs.basedOn.length > 0 && (
                <p className="mt-1 truncate text-sm text-neutral-400" data-testid="based-on">
                  Porque escuchas {listing(recs.basedOn)}
                </p>
              )}
            </div>
            {hasMusic && (
              <button className="btn shrink-0" disabled={recsLoading} onClick={loadRecs}>
                {recsLoading ? 'Buscando…' : 'Otras recomendaciones'}
              </button>
            )}
          </div>

          {!hasMusic ? (
            <div className="rounded-2xl bg-white/[0.03] p-8 text-center text-neutral-400 ring-1 ring-white/5">
              Cuando tengas música en tu biblioteca (busca arriba o importa de eSound), aquí verás
              canciones parecidas.
            </div>
          ) : recsError ? (
            <div className="flex items-center gap-3 rounded-2xl bg-red-500/10 p-4 text-sm text-red-300 ring-1 ring-red-500/20">
              <AlertIcon className="h-5 w-5 shrink-0" />
              {recsError}
            </div>
          ) : recsLoading || !recs ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4" aria-busy="true">
              {Array.from({ length: 10 }, (_, i) => (
                <li key={i} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                  <div className="aspect-video animate-pulse rounded-lg bg-white/5" />
                  <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-white/5" />
                  <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-white/5" />
                </li>
              ))}
            </ul>
          ) : recs.results.length === 0 ? (
            <p className="text-neutral-500">Ya tienes todo lo que YouTube sugiere aquí. Prueba “Otras recomendaciones”.</p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
              {recs.results.map((r) => card(r, 'rec', 'Recomendado para ti', recs.results))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function SongCard({
  r,
  testId,
  inLibrary,
  adding,
  error,
  onAdd,
  isCurrent,
  playing,
  onPlay
}: {
  r: SearchResult
  testId: string
  inLibrary: boolean
  adding: boolean
  error?: string
  onAdd: () => void
  isCurrent: boolean
  playing: boolean
  onPlay: () => void
}): React.JSX.Element {
  return (
    <li
      data-testid={testId}
      className="group rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5 transition hover:bg-white/[0.07]"
    >
      <div className="relative aspect-video overflow-hidden rounded-lg bg-neutral-800 shadow-lg shadow-black/40">
        <img
          src={r.coverUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
        {r.durationSec != null && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium">
            {duration(r.durationSec)}
          </span>
        )}
        <button
          aria-label="Escuchar"
          title="Escuchar sin agregar"
          onClick={onPlay}
          className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-xl transition hover:scale-105">
            <PlayIcon className="ml-0.5 h-6 w-6" />
          </span>
        </button>
        {isCurrent && (
          <span className="pointer-events-none absolute top-2 left-2 flex items-center rounded-full bg-black/70 px-2 py-1.5">
            <Equalizer active={playing} />
          </span>
        )}
      </div>
      <div className={`mt-3 truncate font-medium ${isCurrent ? 'text-pink-400' : ''}`} title={r.title}>
        {r.title}
      </div>
      <div className="truncate text-sm text-neutral-400" title={r.artists}>
        {r.artists}
      </div>
      <div className="mt-3">
        {error && (
          <p className="mb-2 line-clamp-2 text-xs text-red-400" title={error}>
            {error}
          </p>
        )}
        {inLibrary ? (
          <span className="flex h-8 items-center justify-center gap-1.5 text-sm font-medium text-violet-300">
            <CheckIcon className="h-4 w-4" />
            En tu biblioteca
          </span>
        ) : (
          <button className="btn-accent h-8 w-full" data-testid="add" disabled={adding} onClick={onAdd}>
            {!adding && <PlusIcon className="h-4 w-4" />}
            {adding ? 'Agregando…' : error ? 'Reintentar' : 'Agregar'}
          </button>
        )}
      </div>
    </li>
  )
}
