import { describe, expect, it, vi } from 'vitest'
import type { SongRequest } from '../../../shared/api'
import type { LocalSong } from '../../../shared/types'
import { CloudApiError, type CloudClient } from '../client'
import { processRequests } from '../requests'

const req = (id: string, status: SongRequest['status'] = 'pending'): SongRequest => ({
  id,
  title: id,
  artists: 'x',
  durationSec: null,
  coverUrl: null,
  deezerId: null,
  status,
  error: null,
  createdAt: 0
})

function client(requests: SongRequest[]) {
  const calls: string[] = []
  const c = {
    listRequests: vi.fn(async () => ({ requests })),
    deleteRequest: vi.fn(async (id: string) => void calls.push(`delete ${id}`)),
    failRequest: vi.fn(async (id: string, e: string) => void calls.push(`fail ${id}: ${e}`))
  }
  return { c: c as unknown as CloudClient, calls }
}

const song = (id: string, uploaded: boolean) => ({ id, uploaded }) as LocalSong

describe('processRequests', () => {
  it('downloads each pending song, clears it once it is in the cloud, marks the failures', async () => {
    const { c, calls } = client([req('aaaaaaaaaaa'), req('bbbbbbbbbbb'), req('ccccccccccc'), req('ddddddddddd', 'failed')])
    const add = vi.fn(async (r: SongRequest) => {
      if (r.id === 'bbbbbbbbbbb') throw new Error('Video no disponible')
      return song(r.id, r.id !== 'ccccccccccc') // c downloads but its upload fails
    })
    expect(await processRequests(c, add)).toEqual({ done: 1, failed: 1 })
    expect(add.mock.calls.map(([r]) => r.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']) // not the failed one
    expect(calls).toEqual(['delete aaaaaaaaaaa', 'fail bbbbbbbbbbb: Video no disponible'])
  })

  it('an older Worker without requests is not an error', async () => {
    const c = {
      listRequests: vi.fn(async () => {
        throw new CloudApiError('Not found', 404)
      })
    } as unknown as CloudClient
    expect(await processRequests(c, vi.fn())).toEqual({ done: 0, failed: 0 })
  })
})
