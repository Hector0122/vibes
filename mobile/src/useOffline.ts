// Downloads for listening without internet: one at a time, in the order asked,
// with progress; cancellable; survives app restarts (the index is on disk).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudSong } from '../../src/shared/api'
import type { Cloud } from './cloud'
import * as store from './offline'

export interface DownloadProgress {
  done: number
  total: number
  failed: number
}

export interface Offline {
  /** Index loaded from disk (until then nothing counts as downloaded). */
  ready: boolean
  /** The phone has an up-to-date copy of this song. */
  isDownloaded: (song: CloudSong) => boolean
  /** Where to play it from without internet (also an outdated copy), or null. */
  localUri: (id: string) => string | null
  downloadingId: string | null
  isQueued: (id: string) => boolean
  progress: DownloadProgress | null
  error: string | null
  /** Queues the songs that aren't on the phone yet. */
  download: (songs: CloudSong[]) => void
  remove: (ids: string[]) => void
  cancel: () => void
  /** Deletes copies of songs that are no longer in the cloud. */
  prune: (cloudIds: string[]) => void
  count: number
}

export function useOffline(cloud: Cloud | null): Offline {
  const [downloads, setDownloads] = useState<store.Downloads>({})
  const [ready, setReady] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [queued, setQueued] = useState<string[]>([])
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const index = useRef<store.Downloads>({})
  const queue = useRef<CloudSong[]>([])
  const running = useRef(false)
  const cloudRef = useRef(cloud)
  cloudRef.current = cloud

  useEffect(() => {
    store
      .loadDownloads()
      .then((d) => {
        index.current = d
        setDownloads(d)
      })
      .finally(() => setReady(true))
  }, [])

  const commit = useCallback(async (next: store.Downloads): Promise<void> => {
    index.current = next
    setDownloads(next)
    await store.saveDownloads(next).catch(() => {})
  }, [])

  const run = useCallback(async (): Promise<void> => {
    if (running.current) return
    running.current = true
    try {
      while (queue.current.length > 0) {
        const song = queue.current[0]
        setDownloadingId(song.id)
        try {
          const c = cloudRef.current
          if (!c) throw new Error('Configura la nube primero')
          await store.downloadSong(await c.streamUrl(song.id), song)
          await commit({ ...index.current, [song.id]: song.sha256 })
          setProgress((p) => p && { ...p, done: p.done + 1 })
        } catch (e) {
          setError((e as Error).message)
          setProgress((p) => p && { ...p, done: p.done + 1, failed: p.failed + 1 })
          // No connection: stop instead of failing the whole list one by one.
          if ((e as { status?: number }).status === 0) break
        }
        queue.current = queue.current.slice(1)
        setQueued(queue.current.map((s) => s.id))
      }
    } finally {
      queue.current = []
      setQueued([])
      running.current = false
      setDownloadingId(null)
    }
  }, [commit])

  const isDownloaded = useCallback((s: CloudSong) => downloads[s.id] === s.sha256, [downloads])

  const download = useCallback(
    (songs: CloudSong[]): void => {
      const inQueue = new Set(queue.current.map((s) => s.id))
      const fresh = songs.filter((s) => index.current[s.id] !== s.sha256 && !inQueue.has(s.id))
      if (fresh.length === 0) return
      setError(null)
      queue.current = [...queue.current, ...fresh]
      setQueued(queue.current.map((s) => s.id))
      setProgress((p) =>
        running.current && p ? { ...p, total: p.total + fresh.length } : { done: 0, total: fresh.length, failed: 0 }
      )
      void run()
    },
    [run]
  )

  const remove = useCallback(
    (ids: string[]): void => {
      const next = { ...index.current }
      for (const id of ids) {
        store.deleteSong(id)
        delete next[id]
      }
      void commit(next)
    },
    [commit]
  )

  const cancel = useCallback((): void => {
    // The one in progress finishes; the rest are dropped.
    queue.current = queue.current.slice(0, 1)
    setQueued(queue.current.map((s) => s.id))
    setProgress(null)
  }, [])

  const prune = useCallback(
    (cloudIds: string[]): void => {
      const keep = new Set(cloudIds)
      const gone = Object.keys(index.current).filter((id) => !keep.has(id))
      if (gone.length) remove(gone)
    },
    [remove]
  )

  const localUri = useCallback((id: string) => (downloads[id] ? store.localUri(id) : null), [downloads])
  const queuedSet = new Set(queued)

  return {
    ready,
    isDownloaded,
    localUri,
    downloadingId,
    isQueued: (id) => queuedSet.has(id),
    progress: downloadingId ? progress : null,
    error,
    download,
    remove,
    cancel,
    prune,
    count: Object.keys(downloads).length
  }
}
