// Shared by the desktop player and the mobile app.
// What plays next/previous. Pure, so it is unit-tested without a UI.
//
// Shuffle works like a deck of cards: every song in the list plays once, in
// random order, before any repeats (the "bag" holds the ones still to play),
// and the current song is never picked again right away. "Previous" walks back
// through what actually played (the history), not up the list.

import type { Lang } from './lang'

export type Rand = () => number

export interface Next {
  id: string | null
  bag: string[]
  /** The list ran out and starts over (the last song in order, or a full shuffle round). */
  wrapped: boolean
}

/** The song after `current`; in shuffle, draws from the bag (refilled when empty). */
export function pickNext(
  queue: string[],
  current: string | null,
  shuffle: boolean,
  bag: string[],
  rand: Rand = Math.random,
  /** Each song's language: in shuffle, a Spanish song is followed by Spanish ones (same for English). */
  langOf?: (id: string) => Lang | null | undefined
): Next {
  if (queue.length === 0) return { id: null, bag: [], wrapped: false }
  const lang = shuffle && current && langOf ? langOf(current) : null
  if (lang) {
    const same = queue.filter((id) => id === current || langOf!(id) === lang)
    if (same.length > 1) queue = same // nothing else in that language: the whole list
  }
  if (!shuffle) {
    const i = current ? queue.indexOf(current) : -1
    return { id: queue[(i + 1) % queue.length], bag, wrapped: i === queue.length - 1 }
  }
  // Only songs still in the list (it may have changed), never the one playing.
  let pool = bag.filter((id) => id !== current && queue.includes(id))
  // An empty bag while a song from this list plays means the round is over.
  const wrapped = pool.length === 0 && current !== null && queue.includes(current)
  if (pool.length === 0) pool = queue.filter((id) => id !== current)
  if (pool.length === 0) return { id: current, bag: [], wrapped: true } // one-song list: play it again
  const k = Math.min(pool.length - 1, Math.floor(rand() * pool.length))
  const id = pool[k]
  return { id, bag: pool.filter((_, j) => j !== k), wrapped }
}

export interface Prev {
  id: string | null
  history: string[]
}

/** The song before `current`: the last one that played (if still in the list), else the one above it. */
export function pickPrev(queue: string[], current: string | null, history: string[]): Prev {
  if (queue.length === 0) return { id: null, history: [] }
  const h = [...history]
  while (h.length) {
    const id = h.pop()!
    if (id !== current && queue.includes(id)) return { id, history: h }
  }
  const i = current ? queue.indexOf(current) : 0
  return { id: queue[(Math.max(i, 0) - 1 + queue.length) % queue.length], history: [] }
}

/** Keeps the last `max` songs that played; the newest is last. */
export function remember(history: string[], id: string, max = 200): string[] {
  return [...history.filter((h) => h !== id), id].slice(-max)
}

/** A play counts once it reaches 30 s, or half the song if it is shorter than a minute. */
export function isListened(time: number, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false
  return time >= Math.min(30, duration / 2)
}

/** A shuffled copy (Fisher–Yates). */
export function shuffled<T>(list: T[], rand: Rand = Math.random): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** `extra` (recommendations) spread through `mine`: one after every `every` of mine, none twice or already in `mine`. */
export function mixIn<T extends { id: string }>(mine: T[], extra: T[], every = 3): T[] {
  const seen = new Set(mine.map((s) => s.id))
  const add: T[] = []
  for (const s of extra) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    add.push(s)
  }
  const out: T[] = []
  mine.forEach((s, i) => {
    out.push(s)
    if ((i + 1) % every === 0 && add.length) out.push(add.shift()!)
  })
  return [...out, ...add]
}
