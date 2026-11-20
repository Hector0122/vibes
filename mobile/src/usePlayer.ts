// The React side of the player (src/engine.ts): the screens read its state
// and tell it which list is showing. Playback itself lives in the engine, so it
// also answers the lock screen and the widget with the app closed.
import { useEffect, useSyncExternalStore } from 'react'
import type { CloudSong } from '../../src/shared/api'
import type { Cloud } from './cloud'
import { engine, type PlayerState, type Sleep } from './engine'

export type { Sleep }

export interface Player extends PlayerState {
  play: (id: string) => Promise<void>
  toggle: () => void
  /** Pauses if playing (e.g. while a preview clip plays). */
  pause: () => void
  next: () => void
  prev: () => void
  seek: (t: number) => void
  setShuffle: (on: boolean) => void
  setSleep: (s: { minutes: number } | 'endOfSong' | null) => void
}

export function usePlayer(cloud: Cloud | null, queue: CloudSong[]): Player {
  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  useEffect(() => engine.configure(cloud), [cloud])
  useEffect(() => engine.setQueue(queue), [queue])
  return {
    ...state,
    play: (id) => engine.play(id),
    toggle: engine.toggle,
    pause: engine.pause,
    next: engine.next,
    prev: engine.prev,
    seek: engine.seek,
    setShuffle: engine.setShuffle,
    setSleep: engine.setSleep
  }
}
