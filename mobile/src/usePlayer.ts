// Playback: plays the copy on the phone when there is one (offline), otherwise
// streams from R2 (a fresh signed URL each time) with
// expo-audio, keeps playing with the screen off, and shows the song on the
// lock screen. What plays next/previous uses the same logic as the desktop
// app (../../src/shared/queue.ts): autoplay, deck-style shuffle, real "previous".
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudSong } from '../../src/shared/api'
import { pickNext, pickPrev, remember } from '../../src/shared/queue'
import type { Cloud } from './cloud'

/** Signed URLs last 15 min; after a long pause, get a new one before resuming. */
const STALE_AFTER_MS = 10 * 60_000

export interface Player {
  current: CloudSong | null
  playing: boolean
  loading: boolean
  error: string | null
  time: number
  duration: number
  shuffle: boolean
  play: (id: string) => Promise<void>
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (t: number) => void
  setShuffle: (on: boolean) => void
}

export function usePlayer(
  cloud: Cloud | null,
  queue: CloudSong[],
  /** A file:// URI when the song is downloaded to the phone. */
  localUri: (id: string) => string | null = () => null
): Player {
  const player = useAudioPlayer(null, { updateInterval: 500 })
  const status = useAudioPlayerStatus(player)
  const [current, setCurrent] = useState<CloudSong | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shuffle, setShuffleState] = useState(false)
  const bag = useRef<string[]>([])
  const history = useRef<string[]>([])
  const pausedAt = useRef<number | null>(null)
  /** The current song plays from a signed URL (which expires), not from the phone. */
  const streaming = useRef(false)
  const ids = queue.map((s) => s.id)

  useEffect(() => {
    // Keep playing with the screen off / app in the background, and own the audio focus
    // (needed for the lock-screen controls).
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(
      () => {}
    )
  }, [])

  const load = useCallback(
    async (song: CloudSong, from = 0): Promise<void> => {
      const local = localUri(song.id)
      if (!local && !cloud) return
      setLoading(true)
      setError(null)
      try {
        const url = local ?? (await cloud!.streamUrl(song.id))
        streaming.current = !local
        player.replace({ uri: url })
        if (from > 0) await player.seekTo(from)
        player.play()
        pausedAt.current = null
        player.setActiveForLockScreen(true, {
          title: song.title,
          artist: song.artists,
          albumTitle: song.album ?? undefined,
          artworkUrl: song.coverUrl ?? undefined
        })
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [cloud, player, localUri]
  )

  const play = useCallback(
    async (id: string): Promise<void> => {
      const song = queue.find((s) => s.id === id)
      if (!song) return
      if (current && current.id !== id) history.current = remember(history.current, current.id)
      bag.current = bag.current.filter((x) => x !== id)
      setCurrent(song)
      await load(song)
    },
    [queue, current, load]
  )

  const next = useCallback((): void => {
    const n = pickNext(ids, current?.id ?? null, shuffle, bag.current)
    bag.current = n.bag
    if (!n.id) return
    if (n.id === current?.id) {
      player.seekTo(0)
      player.play()
      return
    }
    void play(n.id)
  }, [ids, current, shuffle, player, play])

  const prev = useCallback((): void => {
    // A few seconds in, "previous" restarts the song, like any player.
    if (current && status.currentTime > 3) {
      player.seekTo(0)
      return
    }
    const p = pickPrev(ids, current?.id ?? null, history.current)
    history.current = p.history
    const song = queue.find((s) => s.id === p.id)
    if (!song) return
    bag.current = bag.current.filter((x) => x !== song.id)
    setCurrent(song)
    void load(song)
  }, [ids, current, status.currentTime, player, queue, load])

  // Autoplay: when a song ends, the next one starts.
  const nextRef = useRef(next)
  nextRef.current = next
  useEffect(() => {
    if (status.didJustFinish) nextRef.current()
  }, [status.didJustFinish])

  const toggle = useCallback((): void => {
    if (!current) {
      next() // nothing chosen yet: start the list (random if shuffle is on)
      return
    }
    if (status.playing) {
      player.pause()
      pausedAt.current = Date.now()
      return
    }
    // After a long pause the signed URL may have expired: get a new one and resume where it was.
    if (streaming.current && pausedAt.current && Date.now() - pausedAt.current > STALE_AFTER_MS) {
      void load(current, status.currentTime)
      return
    }
    player.play()
    pausedAt.current = null
  }, [current, status.playing, status.currentTime, player, next, load])

  return {
    current,
    playing: status.playing,
    loading: loading || (status.isBuffering && status.playing),
    error,
    time: status.currentTime,
    duration: status.duration,
    shuffle,
    play,
    toggle,
    next,
    prev,
    seek: (t) => void player.seekTo(t),
    setShuffle: (on) => {
      setShuffleState(on)
      bag.current = []
    }
  }
}
