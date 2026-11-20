// Mirrors the desktop's playlists to the cloud so the phone can show them.
// Changes come in bursts (drag-to-reorder, adding many songs): wait for a quiet
// moment, then send the whole set. One send at a time; a change during a send
// schedules another. Offline or no cloud set up: it just tries again on the next change.
import type { Playlist } from '../../shared/types'
import type { CloudClient } from './client'

export interface PlaylistSyncOptions {
  list: () => Playlist[]
  /** Takes in the phone's edits first (they must not be overwritten). */
  pull?: (client: CloudClient) => Promise<unknown>
  /** null when the cloud isn't set up. */
  client: () => Promise<CloudClient | null>
  delayMs?: number
  onError?: (err: unknown) => void
}

export interface PlaylistSync {
  /** Something changed: send soon. */
  schedule(): void
  /** Send now (waits for it); resolves false when it couldn't. */
  flush(): Promise<boolean>
}

export function createPlaylistSync(opts: PlaylistSyncOptions): PlaylistSync {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<boolean> | null = null
  let again = false

  async function send(): Promise<boolean> {
    try {
      const client = await opts.client()
      if (!client) return false
      await opts.pull?.(client)
      await client.putPlaylists({ playlists: opts.list() })
      return true
    } catch (err) {
      opts.onError?.(err)
      return false
    }
  }

  function flush(): Promise<boolean> {
    if (timer) clearTimeout(timer)
    timer = null
    if (running) {
      again = true
      return running
    }
    running = send().finally(() => {
      running = null
      if (again) {
        again = false
        void flush()
      }
    })
    return running
  }

  return {
    schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void flush(), opts.delayMs ?? 1500)
    },
    flush
  }
}
