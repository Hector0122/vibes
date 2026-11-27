// Podcasts from the phone: search and episodes through Apple's directory (faked), and
// subscriptions kept in D1 (the real migration SQL).
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './fakes'
import type {
  ListPodcastSubscriptionsResponse,
  PodcastEpisodesResponse,
  PodcastSearchResponse
} from '../../src/shared/api'
import { plainText } from '../src/podcasts'

const calls: { url: URL; headers: Headers }[] = []

function fakeApple(mode: 'ok' | 'busy' | 'broken' | 'down' = 'ok'): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, headers: new Headers(init?.headers) })
    if (mode === 'down') throw new TypeError('fetch failed')
    if (mode === 'busy') return new Response('', { status: 403 })
    if (mode === 'broken') return new Response('oops', { status: 500 })
    if (url.pathname === '/search') {
      return Response.json({
        resultCount: 2,
        results: [
          {
            wrapperType: 'track',
            kind: 'podcast',
            collectionId: 920666,
            collectionName: 'Leyendas Legendarias',
            artistName: 'Leyendas',
            artworkUrl600: 'https://img.test/ll.jpg'
          },
          { wrapperType: 'track', kind: 'podcast', collectionId: 6, collectionName: '  ' }
        ]
      })
    }
    if (url.pathname === '/lookup') {
      return Response.json({
        results: [
          {
            wrapperType: 'track',
            kind: 'podcast',
            collectionId: 920666,
            collectionName: 'Leyendas Legendarias',
            artworkUrl600: 'https://img.test/ll.jpg'
          },
          {
            wrapperType: 'podcastEpisode',
            trackId: 11,
            collectionId: 920666,
            trackName: 'Episodio viejo',
            episodeUrl: 'http://cdn.test/old.mp3',
            trackTimeMillis: 3_600_000,
            releaseDate: '2023-11-14T22:13:20Z',
            description: '<p>Hola &amp; <b>adiós</b></p>'
          },
          {
            wrapperType: 'podcastEpisode',
            trackId: 12,
            collectionId: 920666,
            trackName: 'Episodio nuevo',
            episodeUrl: 'https://cdn.test/new.mp3',
            releaseDate: '2025-10-09T09:06:40Z',
            artworkUrl600: 'https://img.test/ep12.jpg'
          },
          { wrapperType: 'podcastEpisode', trackId: 13, trackName: 'Sin audio' }
        ]
      })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}

let h: Harness
beforeEach(() => {
  calls.length = 0
  h = createHarness({ fetch: fakeApple() })
})

const show = { title: 'Leyendas Legendarias', author: 'Leyendas', image: 'https://img.test/ll.jpg' }

describe('podcast search', () => {
  it('asks Apple for podcasts in Mexico\'s store, needs no key, and leaves out nameless shows', async () => {
    const res = await h.call('GET', '/v1/podcasts/search?q=leyendas')
    expect(res.status).toBe(200)
    const { results } = (await res.json()) as PodcastSearchResponse
    expect(results).toEqual([
      {
        id: '920666',
        title: 'Leyendas Legendarias',
        author: 'Leyendas',
        image: 'https://img.test/ll.jpg',
        subscribed: false
      }
    ])
    const { url, headers } = calls[0]
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search')
    expect(url.searchParams.get('term')).toBe('leyendas')
    expect(url.searchParams.get('media')).toBe('podcast')
    expect(url.searchParams.get('country')).toBe('MX')
    expect(headers.get('User-Agent')).toBeTruthy()
  })

  it('marks the shows already subscribed to', async () => {
    await h.call('PUT', '/v1/podcasts/subscriptions/920666', show)
    const { results } = (await (
      await h.call('GET', '/v1/podcasts/search?q=leyendas')
    ).json()) as PodcastSearchResponse
    expect(results[0].subscribed).toBe(true)
  })

  it('turns Apple failures into clear errors (too many searches: try again in a minute)', async () => {
    const expected = { busy: 503, broken: 502, down: 502 } as const
    for (const mode of ['busy', 'broken', 'down'] as const) {
      const res = await createHarness({ fetch: fakeApple(mode) }).call('GET', '/v1/podcasts/search?q=x')
      expect(res.status).toBe(expected[mode])
    }
    const busy = await createHarness({ fetch: fakeApple('busy') }).call('GET', '/v1/podcasts/search?q=x')
    expect(((await busy.json()) as { error: string }).error).toMatch(/un minuto/)
  })

  it('needs something to search, and the token', async () => {
    expect((await h.call('GET', '/v1/podcasts/search?q=%20')).status).toBe(400)
    expect((await h.call('GET', '/v1/podcasts/search?q=x', undefined, null)).status).toBe(401)
  })
})

describe('episodes', () => {
  it('lists playable episodes newest first, with https audio and plain-text notes', async () => {
    const res = await h.call('GET', '/v1/podcasts/920666/episodes')
    expect(res.status).toBe(200)
    const { episodes } = (await res.json()) as PodcastEpisodesResponse
    expect(episodes.map((e) => e.id)).toEqual(['12', '11'])
    expect(episodes[1]).toEqual({
      id: '11',
      podcastId: '920666',
      title: 'Episodio viejo',
      url: 'https://cdn.test/old.mp3',
      durationSec: 3600,
      publishedAt: 1_700_000_000_000,
      image: 'https://img.test/ll.jpg', // the show's, when the episode has none
      description: 'Hola & adiós'
    })
    expect(episodes[0].durationSec).toBeNull()
    expect(episodes[0].image).toBe('https://img.test/ep12.jpg')
    expect(calls[0].url.pathname).toBe('/lookup')
    expect(calls[0].url.searchParams.get('id')).toBe('920666')
    expect(calls[0].url.searchParams.get('entity')).toBe('podcastEpisode')
    expect(calls[0].url.searchParams.get('limit')).toBe('100')
  })

  it('rejects ids that are not Apple podcast ids', async () => {
    expect((await h.call('GET', '/v1/podcasts/abc/episodes')).status).toBe(400)
  })
})

describe('subscriptions', () => {
  it('subscribe, list (newest first), subscribe again without duplicates, unsubscribe', async () => {
    const empty = (await (
      await h.call('GET', '/v1/podcasts/subscriptions')
    ).json()) as ListPodcastSubscriptionsResponse
    expect(empty.podcasts).toEqual([])

    await h.call('PUT', '/v1/podcasts/subscriptions/1', { ...show, title: 'Uno' })
    await new Promise((r) => setTimeout(r, 2))
    const res = await h.call('PUT', '/v1/podcasts/subscriptions/2', { ...show, title: 'Dos' })
    expect(res.status).toBe(200)
    let list = ((await res.json()) as ListPodcastSubscriptionsResponse).podcasts
    expect(list.map((p) => p.title)).toEqual(['Dos', 'Uno'])

    list = (
      (await (
        await h.call('PUT', '/v1/podcasts/subscriptions/1', { ...show, title: 'Uno (nuevo)' })
      ).json()) as ListPodcastSubscriptionsResponse
    ).podcasts
    expect(list.map((p) => p.title)).toEqual(['Dos', 'Uno (nuevo)'])

    list = (
      (await (
        await h.call('DELETE', '/v1/podcasts/subscriptions/2')
      ).json()) as ListPodcastSubscriptionsResponse
    ).podcasts
    expect(list.map((p) => p.id)).toEqual(['1'])
  })

  it('validates the show', async () => {
    expect(
      (await h.call('PUT', '/v1/podcasts/subscriptions/1', { title: '', author: '' })).status
    ).toBe(400)
    expect((await h.call('PUT', '/v1/podcasts/subscriptions/x1', show)).status).toBe(400)
    expect((await h.call('POST', '/v1/podcasts/subscriptions/1', show)).status).toBe(405)
  })
})

it('plainText: tags out, entities decoded, long notes cut', () => {
  expect(plainText('a<br>b&nbsp;&quot;c&quot;')).toBe('a\nb "c"')
  expect(plainText('x'.repeat(1000)).length).toBe(400)
  expect(plainText(undefined)).toBe('')
})
