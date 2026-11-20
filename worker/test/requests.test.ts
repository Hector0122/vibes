// Searching from the phone (Deezer, faked) and marking songs for the
// desktop to download: the Worker's side, with the real migration SQL.
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, hash, putAudio, SONG_ID, type Harness } from './fakes'
import type { ListRequestsResponse, SearchResponse, SongRequest } from '../../src/shared/api'

const OTHER = 'aaaaaaaaaaa'
const deezerCalls: string[] = []

/** Deezer's public search: one normal track, one with no preview, one not playable. */
function fakeDeezer(mode: 'ok' | 'busy' | 'down' = 'ok'): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    deezerCalls.push(`${url.host}${url.pathname} q=${url.searchParams.get('q')}`)
    if (mode === 'down') throw new TypeError('fetch failed')
    if (mode === 'busy') return new Response(JSON.stringify({ error: { message: 'Quota limit exceeded' } }))
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 3135556,
            readable: true,
            title: 'Feel Good Inc.',
            duration: 222,
            preview: 'https://cdnt-preview.dzcdn.net/1.mp3',
            artist: { name: 'Gorillaz' },
            album: { cover_big: 'https://e-cdns-images.dzcdn.net/big.jpg' }
          },
          { id: 42, readable: true, title: 'Stylo', duration: 270, preview: '', artist: { name: 'Gorillaz' }, album: {} },
          { id: 7, readable: false, title: 'Bloqueada', artist: { name: 'x' }, album: {} }
        ]
      })
    )
  }) as typeof fetch
}

let h: Harness
beforeEach(() => {
  deezerCalls.length = 0
  h = createHarness({ fetch: fakeDeezer() })
})

const hit = (id = OTHER, deezerId: string | null = null) => ({
  id,
  title: 'Feel Good Inc.',
  artists: 'Gorillaz',
  durationSec: 222,
  coverUrl: null,
  deezerId
})
const requests = async (): Promise<SongRequest[]> =>
  ((await (await h.call('GET', '/v1/requests')).json()) as ListRequestsResponse).requests

async function uploadSong(id: string, deezerId: string | null = null): Promise<void> {
  await h.call('POST', `/v1/songs/${id}/upload`, {
    meta: { title: 'x', artists: 'y', album: null, deezerId, deezerArtistId: null, isrc: null, durationSec: null, coverUrl: null },
    size: 3,
    sha256: hash('a')
  })
  putAudio(h.r2, id, 3)
  await h.call('POST', `/v1/songs/${id}/commit`)
}

describe('search (Deezer)', () => {
  it('searches Deezer, no key needed: titles, covers and 30-second previews; skips unplayable tracks', async () => {
    const res = await h.call('GET', '/v1/search?q=gorillaz')
    expect(res.status).toBe(200)
    const { results } = (await res.json()) as SearchResponse
    expect(results).toEqual([
      {
        id: 'dz3135556',
        title: 'Feel Good Inc.',
        artists: 'Gorillaz',
        durationSec: 222,
        coverUrl: 'https://e-cdns-images.dzcdn.net/big.jpg',
        deezerId: '3135556',
        previewUrl: 'https://cdnt-preview.dzcdn.net/1.mp3',
        inCloud: false,
        requested: false
      },
      {
        id: 'dz42',
        title: 'Stylo',
        artists: 'Gorillaz',
        durationSec: 270,
        coverUrl: null,
        deezerId: '42',
        previewUrl: null,
        inCloud: false,
        requested: false
      }
    ])
    expect(deezerCalls).toEqual(['api.deezer.com/search q=gorillaz'])
  })

  it('a song already in the cloud (same Deezer id) or already marked says so', async () => {
    await uploadSong(SONG_ID, '3135556') // the desktop matched it to this Deezer track
    await h.call('POST', '/v1/requests', hit('dz42', '42'))
    const { results } = (await (await h.call('GET', '/v1/search?q=gorillaz')).json()) as SearchResponse
    expect(results.map((r) => [r.id, r.inCloud, r.requested])).toEqual([
      ['dz3135556', true, false],
      ['dz42', false, true]
    ])
    // And it can't be marked again.
    expect((await h.call('POST', '/v1/requests', hit('dz3135556', '3135556'))).status).toBe(409)
  })

  it('clear errors: empty query, Deezer busy or down', async () => {
    expect((await h.call('GET', '/v1/search?q=%20')).status).toBe(400)
    for (const [mode, text] of [
      ['busy', 'Deezer está ocupado'],
      ['down', 'Deezer no respondió']
    ] as const) {
      const hh = createHarness({ fetch: fakeDeezer(mode) })
      const res = await hh.call('GET', '/v1/search?q=gorillaz')
      expect(res.status).toBeGreaterThanOrEqual(500)
      expect(((await res.json()) as { error: string }).error).toContain(text)
    }
  })

  it('needs the token', async () => {
    expect((await h.call('GET', '/v1/search?q=gorillaz', undefined, null)).status).toBe(401)
    expect(deezerCalls).toEqual([])
  })
})

describe('requests', () => {
  it('mark → listed as pending → the desktop fails it → mark again → back to pending → done', async () => {
    const res = await h.call('POST', '/v1/requests', hit())
    expect(res.status).toBe(200)
    expect(await requests()).toMatchObject([{ id: OTHER, title: 'Feel Good Inc.', status: 'pending', error: null }])

    // Marking twice doesn't duplicate.
    await h.call('POST', '/v1/requests', hit())
    expect(await requests()).toHaveLength(1)

    expect((await h.call('POST', `/v1/requests/${OTHER}/fail`, { error: 'Video no disponible' })).status).toBe(200)
    expect(await requests()).toMatchObject([{ status: 'failed', error: 'Video no disponible' }])

    await h.call('POST', '/v1/requests', hit())
    expect(await requests()).toMatchObject([{ status: 'pending', error: null }])

    expect((await h.call('DELETE', `/v1/requests/${OTHER}`)).status).toBe(200)
    expect(await requests()).toEqual([])
  })

  it('refuses a song already in the cloud, and invalid songs', async () => {
    await uploadSong(SONG_ID)
    expect((await h.call('POST', '/v1/requests', hit(SONG_ID))).status).toBe(409)
    expect((await h.call('POST', '/v1/requests', { ...hit(), id: 'nope' })).status).toBe(400)
    expect((await h.call('POST', '/v1/requests', { ...hit(), title: '' })).status).toBe(400)
    expect((await h.call('POST', `/v1/requests/${OTHER}/fail`, { error: 'x' })).status).toBe(404)
    expect(await requests()).toEqual([])
  })

  it('a song found on Deezer is marked by its Deezer id, for the desktop to find on YouTube', async () => {
    expect((await h.call('POST', '/v1/requests', hit('dz3135556', '3135556'))).status).toBe(200)
    expect(await requests()).toMatchObject([{ id: 'dz3135556', deezerId: '3135556', status: 'pending' }])
    expect((await h.call('POST', '/v1/requests/dz3135556/fail', { error: 'No la encontré en YouTube' })).status).toBe(200)
    expect((await h.call('DELETE', '/v1/requests/dz3135556')).status).toBe(200)
    expect(await requests()).toEqual([])
    expect((await h.call('POST', '/v1/requests', hit('dz12x', null))).status).toBe(400)
  })
})

describe('recommendations', () => {
  const recs = async () => (await (await h.call('GET', '/v1/recommendations')).json()) as import('../../src/shared/api').RecommendationsResponse

  it('none until the desktop sends them; then listed with what is marked; songs added since drop out', async () => {
    expect(await recs()).toEqual({ basedOn: [], results: [], updatedAt: null })
    const res = await h.call('PUT', '/v1/recommendations', {
      basedOn: ['Stylo'],
      results: [hit(OTHER), { ...hit(SONG_ID), title: 'On Melancholy Hill' }]
    })
    expect(res.status).toBe(200)
    await h.call('POST', '/v1/requests', hit(OTHER))
    let r = await recs()
    expect(r.basedOn).toEqual(['Stylo'])
    expect(r.updatedAt).toEqual(expect.any(Number))
    expect(r.results.map((x) => [x.id, x.requested])).toEqual([
      [OTHER, true],
      [SONG_ID, false]
    ])

    // SONG_ID reaches the cloud: it's no longer a suggestion.
    await uploadSong(SONG_ID)
    r = await recs()
    expect(r.results.map((x) => x.id)).toEqual([OTHER])
  })

  it('rejects an invalid set', async () => {
    expect((await h.call('PUT', '/v1/recommendations', { basedOn: [], results: [{ ...hit(), id: 'x' }] })).status).toBe(400)
    expect((await h.call('PUT', '/v1/recommendations', { results: [] })).status).toBe(400)
  })
})
