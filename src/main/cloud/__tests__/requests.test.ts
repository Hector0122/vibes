import { describe, expect, it, vi } from 'vitest'
import type { SongRequest } from '../../../shared/api'
import type { LocalSong, SearchResult } from '../../../shared/types'
import { CloudApiError, type CloudClient } from '../client'
import { addRequested, processRequests } from '../requests'

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

describe('addRequested', () => {
  const hit = (id: string): SearchResult => ({ id, title: 'Maggie May', artists: 'Rod Stewart', durationSec: 250, coverUrl: 'c' })
  const added = (add: ReturnType<typeof vi.fn>) => add.mock.calls.map(([h]) => (h as SearchResult).id)

  it('"dz" + a 9-digit Deezer id (11 characters, like a video id) is looked up on YouTube', async () => {
    const add = vi.fn(async (h: SearchResult) => song(h.id, true))
    const find = vi.fn(async () => hit('ytMaggie000'))
    const r = { ...req('dz538646262'), deezerId: '538646262' }
    expect((await addRequested(r, add, find)).id).toBe('ytMaggie000')
    expect(added(add)).toEqual(['ytMaggie000'])
    expect(add.mock.calls[0][0]).toMatchObject({ deezerId: '538646262', durationSec: 250 })
  })

  it('a YouTube video downloads as is', async () => {
    const add = vi.fn(async (h: SearchResult) => song(h.id, true))
    const find = vi.fn(async () => hit('other000000'))
    await addRequested(req('aaaaaaaaaaa'), add, find)
    expect(added(add)).toEqual(['aaaaaaaaaaa'])
    expect(find).not.toHaveBeenCalled()
  })

  it('a video that is gone: another upload of the same song', async () => {
    const add = vi.fn(async (h: SearchResult) => {
      if (h.id === 'aaaaaaaaaaa') throw new Error('This video is unavailable')
      return song(h.id, true)
    })
    expect((await addRequested(req('aaaaaaaaaaa'), add, async () => hit('other000000'))).id).toBe('other000000')
    expect(added(add)).toEqual(['aaaaaaaaaaa', 'other000000'])
  })

  it('no other upload either: the original error, for the phone', async () => {
    const add = vi.fn(async () => {
      throw new Error('This video is unavailable')
    })
    const none = async (): Promise<SearchResult> => {
      throw new Error('No encontré esta canción en YouTube')
    }
    await expect(addRequested(req('aaaaaaaaaaa'), add, none)).rejects.toThrow('This video is unavailable')
    await expect(addRequested(req('aaaaaaaaaaa'), add, async () => hit('aaaaaaaaaaa'))).rejects.toThrow('unavailable')
  })
})
