// Searching from the phone (YouTube Data API, faked) and marking songs for the
// desktop to download: the Worker's side, with the real migration SQL.
import { beforeEach, describe, expect, it } from 'vitest'
import { parseDuration } from '../src/youtube'
import { createHarness, hash, putAudio, SONG_ID, type Harness } from './fakes'
import type { ListRequestsResponse, SearchResponse, SongRequest } from '../../src/shared/api'

const OTHER = 'aaaaaaaaaaa'
const youtubeCalls: string[] = []

/** YouTube Data API: search.list gives ids, videos.list the details. */
function fakeYoutube(mode: 'ok' | 'quota' | 'badkey' = 'ok'): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    youtubeCalls.push(`${url.pathname} key=${url.searchParams.get('key')}`)
    const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
    if (mode === 'quota') return json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403)
    if (mode === 'badkey') return json({ error: { errors: [{ reason: 'keyInvalid' }] } }, 400)
    if (url.pathname.endsWith('/search')) {
      expect(url.searchParams.get('q')).toBe('gorillaz')
      return json({ items: [SONG_ID, OTHER, 'livelivelil'].map((videoId) => ({ id: { videoId } })) })
    }
    return json({
      items: [
        {
          id: SONG_ID,
          snippet: {
            title: 'Gorillaz - On Melancholy Hill (Official Video)',
            channelTitle: 'Gorillaz',
            thumbnails: { high: { url: 'https://i.ytimg.com/hq.jpg' } }
          },
          contentDetails: { duration: 'PT3M53S' }
        },
        {
          id: OTHER,
          snippet: { title: 'Feel Good Inc.', channelTitle: 'Gorillaz - Topic', thumbnails: {} },
          contentDetails: { duration: 'PT3M42S' }
        },
        { id: 'livelivelil', snippet: { title: 'Radio 24/7', channelTitle: 'x', liveBroadcastContent: 'live' } }
      ]
    })
  }) as typeof fetch
}

let h: Harness
beforeEach(() => {
  youtubeCalls.length = 0
  h = createHarness({ fetch: fakeYoutube() })
  h.env.YOUTUBE_API_KEY = 'yt-key'
})

const hit = (id = OTHER) => ({ id, title: 'Feel Good Inc.', artists: 'Gorillaz', durationSec: 222, coverUrl: null })
const requests = async (): Promise<SongRequest[]> =>
  ((await (await h.call('GET', '/v1/requests')).json()) as ListRequestsResponse).requests

describe('search', () => {
  it('searches YouTube with the key, cleans titles, skips live streams', async () => {
    const res = await h.call('GET', '/v1/search?q=gorillaz')
    expect(res.status).toBe(200)
    const { results } = (await res.json()) as SearchResponse
    expect(results).toEqual([
      {
        id: SONG_ID,
        title: 'On Melancholy Hill',
        artists: 'Gorillaz',
        durationSec: 233,
        coverUrl: 'https://i.ytimg.com/hq.jpg',
        inCloud: false,
        requested: false
      },
      { id: OTHER, title: 'Feel Good Inc.', artists: 'Gorillaz', durationSec: 222, coverUrl: null, inCloud: false, requested: false }
    ])
    expect(youtubeCalls).toEqual(['/youtube/v3/search key=yt-key', '/youtube/v3/videos key=yt-key'])
  })

  it('says which results are already in the cloud or already marked', async () => {
    await h.call('POST', `/v1/songs/${SONG_ID}/upload`, {
      meta: { title: 'x', artists: 'y', album: null, deezerId: null, deezerArtistId: null, isrc: null, durationSec: null, coverUrl: null },
      size: 3,
      sha256: hash('a')
    })
    putAudio(h.r2, SONG_ID, 3)
    await h.call('POST', `/v1/songs/${SONG_ID}/commit`)
    await h.call('POST', '/v1/requests', hit())
    const { results } = (await (await h.call('GET', '/v1/search?q=gorillaz')).json()) as SearchResponse
    expect(results.map((r) => [r.id, r.inCloud, r.requested])).toEqual([
      [SONG_ID, true, false],
      [OTHER, false, true]
    ])
  })

  it('clear errors: no key set up, empty query, quota used up, wrong key', async () => {
    expect((await h.call('GET', '/v1/search?q=%20')).status).toBe(400)
    h.env.YOUTUBE_API_KEY = undefined
    const noKey = await h.call('GET', '/v1/search?q=gorillaz')
    expect(noKey.status).toBe(501)
    expect(((await noKey.json()) as { error: string }).error).toContain('YOUTUBE_API_KEY')

    for (const [mode, text] of [
      ['quota', 'búsquedas de hoy'],
      ['badkey', 'API key de YouTube no es válida']
    ] as const) {
      const hh = createHarness({ fetch: fakeYoutube(mode) })
      hh.env.YOUTUBE_API_KEY = 'k'
      const res = await hh.call('GET', '/v1/search?q=gorillaz')
      expect(res.status).toBeGreaterThanOrEqual(500)
      expect(((await res.json()) as { error: string }).error).toContain(text)
    }
  })

  it('needs the token (nobody else can spend your YouTube quota)', async () => {
    expect((await h.call('GET', '/v1/search?q=gorillaz', undefined, null)).status).toBe(401)
    expect(youtubeCalls).toEqual([])
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
    await h.call('POST', `/v1/songs/${SONG_ID}/upload`, {
      meta: { title: 'x', artists: 'y', album: null, deezerId: null, deezerArtistId: null, isrc: null, durationSec: null, coverUrl: null },
      size: 3,
      sha256: hash('a')
    })
    putAudio(h.r2, SONG_ID, 3)
    await h.call('POST', `/v1/songs/${SONG_ID}/commit`)
    expect((await h.call('POST', '/v1/requests', hit(SONG_ID))).status).toBe(409)
    expect((await h.call('POST', '/v1/requests', { ...hit(), id: 'nope' })).status).toBe(400)
    expect((await h.call('POST', '/v1/requests', { ...hit(), title: '' })).status).toBe(400)
    expect((await h.call('POST', `/v1/requests/${OTHER}/fail`, { error: 'x' })).status).toBe(404)
    expect(await requests()).toEqual([])
  })
})

it('parses YouTube durations', () => {
  expect(parseDuration('PT3M53S')).toBe(233)
  expect(parseDuration('PT1H2M3S')).toBe(3723)
  expect(parseDuration('PT45S')).toBe(45)
  expect(parseDuration('P0D')).toBe(0)
  expect(parseDuration('nope')).toBeNull()
  expect(parseDuration(undefined)).toBeNull()
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
    await h.call('POST', `/v1/songs/${SONG_ID}/upload`, {
      meta: { title: 'x', artists: 'y', album: null, deezerId: null, deezerArtistId: null, isrc: null, durationSec: null, coverUrl: null },
      size: 3,
      sha256: hash('a')
    })
    putAudio(h.r2, SONG_ID, 3)
    await h.call('POST', `/v1/songs/${SONG_ID}/commit`)
    r = await recs()
    expect(r.results.map((x) => x.id)).toEqual([OTHER])
  })

  it('rejects an invalid set', async () => {
    expect((await h.call('PUT', '/v1/recommendations', { basedOn: [], results: [{ ...hit(), id: 'x' }] })).status).toBe(400)
    expect((await h.call('PUT', '/v1/recommendations', { results: [] })).status).toBe(400)
  })
})
