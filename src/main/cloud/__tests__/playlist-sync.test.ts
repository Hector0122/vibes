import { describe, expect, it, vi } from 'vitest'
import type { Playlist } from '../../../shared/types'
import type { CloudClient } from '../client'
import { createPlaylistSync } from '../playlist-sync'

const pl = (id: string, songIds: string[] = []): Playlist => ({ id, name: id, songIds, createdAt: 1, updatedAt: 1 })

function fakeClient(): { client: CloudClient; sent: Playlist[][] } {
  const sent: Playlist[][] = []
  const client = {
    putPlaylists: vi.fn(async (req: { playlists: Playlist[] }) => {
      sent.push(req.playlists)
      return req
    })
  } as unknown as CloudClient
  return { client, sent }
}

describe('playlist sync', () => {
  it('a burst of changes becomes one send of the latest set', async () => {
    vi.useFakeTimers()
    try {
      let items = [pl('a')]
      const { client, sent } = fakeClient()
      const sync = createPlaylistSync({ list: () => items, client: async () => client, delayMs: 100 })
      sync.schedule()
      items = [pl('a', ['aaaaaaaaaaa'])]
      sync.schedule()
      items = [pl('a', ['aaaaaaaaaaa']), pl('b')]
      sync.schedule()
      await vi.advanceTimersByTimeAsync(150)
      expect(sent).toEqual([[pl('a', ['aaaaaaaaaaa']), pl('b')]])
    } finally {
      vi.useRealTimers()
    }
  })

  it('without a cloud it does nothing; a failed send is reported and does not throw', async () => {
    const none = createPlaylistSync({ list: () => [pl('a')], client: async () => null })
    expect(await none.flush()).toBe(false)

    const onError = vi.fn()
    const failing = {
      putPlaylists: vi.fn(async () => {
        throw new Error('offline')
      })
    } as unknown as CloudClient
    const sync = createPlaylistSync({ list: () => [], client: async () => failing, onError })
    expect(await sync.flush()).toBe(false)
    expect(onError).toHaveBeenCalled()
  })

  it('a change during a send is sent right after it', async () => {
    let items = [pl('a')]
    let release!: () => void
    const sent: string[][] = []
    const client = {
      putPlaylists: vi.fn(async (req: { playlists: Playlist[] }) => {
        sent.push(req.playlists.map((p) => p.id))
        if (sent.length === 1) await new Promise<void>((r) => (release = r))
        return req
      })
    } as unknown as CloudClient
    const sync = createPlaylistSync({ list: () => items, client: async () => client })
    const first = sync.flush()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    items = [pl('a'), pl('b')]
    void sync.flush()
    release()
    await first
    await vi.waitFor(() => expect(sent).toEqual([['a'], ['a', 'b']]))
  })
})
