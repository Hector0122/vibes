// Podcasts from the phone: search and episodes through Podcast Index (faked), and
// subscriptions kept in D1 (the real migration SQL).
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './fakes'
import type {
  ListPodcastSubscriptionsResponse,
  PodcastEpisodesResponse,
  PodcastSearchResponse
} from '../../src/shared/api'
import { plainText } from '../src/podcastindex'

const NOW = 1_764_000_000_000
const calls: { url: URL; headers: Headers }[] = []

function fakePodcastIndex(mode: 'ok' | 'denied' | 'down' = 'ok'): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, headers: new Headers(init?.headers) })
    if (mode === 'down') throw new TypeError('fetch failed')
    if (mode === 'denied') return new Response('{}', { status: 401 })
    if (url.pathname.endsWith('/search/byterm')) {
      return Response.json({
        status: 'true',
        feeds: [
          {
            id: 920666,
            title: 'Leyendas Legendarias',
            author: 'Leyendas',
            artwork: 'https://img.test/ll.jpg'
          },
          { id: 5, title: 'Muerto', author: 'x', dead: 1 },
          { id: 6, title: '  ' }
        ]
      })
    }
    if (url.pathname.endsWith('/episodes/byfeedid')) {
      return Response.json({
        status: 'true',
        items: [
          {
            id: 11,
            feedId: 920666,
            title: 'Episodio viejo',
            enclosureUrl: 'http://cdn.test/old.mp3',
            duration: 3600,
            datePublished: 1_700_000_000,
            feedImage: 'https://img.test/ll.jpg',
            description: '<p>Hola &amp; <b>adiós</b></p>'
          },
          {
            id: 12,
            feedId: 920666,
            title: 'Episodio nuevo',
            enclosureUrl: 'https://cdn.test/new.mp3',
            duration: 0,
            datePublished: 1_760_000_000
          },
          { id: 13, title: 'Sin audio', enclosureUrl: '' }
        ]
      })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}

let h: Harness
beforeEach(() => {
  calls.length = 0
  h = createHarness({ fetch: fakePodcastIndex(), now: () => NOW })
  h.env.PODCASTINDEX_KEY = 'KEY'
  h.env.PODCASTINDEX_SECRET = 'SECRET'
})

const show = { title: 'Leyendas Legendarias', author: 'Leyendas', image: 'https://img.test/ll.jpg' }

describe('podcast search', () => {
  it('signs each call (key + secret + date, SHA-1) and leaves out dead or nameless shows', async () => {
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
    expect(url.searchParams.get('q')).toBe('leyendas')
    const date = String(Math.floor(NOW / 1000))
    expect(headers.get('X-Auth-Key')).toBe('KEY')
    expect(headers.get('X-Auth-Date')).toBe(date)
    expect(headers.get('Authorization')).toBe(
      createHash('sha1').update(`KEYSECRET${date}`).digest('hex')
    )
    expect(headers.get('User-Agent')).toBeTruthy()
  })

  it('marks the shows already subscribed to', async () => {
    await h.call('PUT', '/v1/podcasts/subscriptions/920666', show)
    const { results } = (await (
      await h.call('GET', '/v1/podcasts/search?q=leyendas')
    ).json()) as PodcastSearchResponse
    expect(results[0].subscribed).toBe(true)
  })

  it('says what is missing when the key is not set up, and never calls out', async () => {
    delete h.env.PODCASTINDEX_SECRET
    const res = await h.call('GET', '/v1/podcasts/search?q=x')
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toMatch(/PODCASTINDEX_KEY/)
    expect(calls).toHaveLength(0)
  })

  it('turns Podcast Index failures into clear errors', async () => {
    for (const mode of ['denied', 'down'] as const) {
      const hh = createHarness({ fetch: fakePodcastIndex(mode) })
      hh.env.PODCASTINDEX_KEY = 'KEY'
      hh.env.PODCASTINDEX_SECRET = 'SECRET'
      const res = await hh.call('GET', '/v1/podcasts/search?q=x')
      expect(res.status).toBe(502)
    }
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
      image: 'https://img.test/ll.jpg',
      description: 'Hola & adiós'
    })
    expect(episodes[0].durationSec).toBeNull()
    expect(calls[0].url.searchParams.get('id')).toBe('920666')
  })

  it('rejects ids that are not Podcast Index ids', async () => {
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
