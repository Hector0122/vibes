// Apple's podcast directory (faked): search, a show's episodes, and its failures.
import { beforeEach, describe, expect, it } from 'vitest'
import { plainText, podcastEpisodes, PodcastError, searchPodcasts } from '../podcasts'

const calls: { url: URL; headers: Headers }[] = []
beforeEach(() => {
  calls.length = 0
})

function fakeApple(mode: 'ok' | 'busy' | 'broken' | 'down' = 'ok'): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, headers: new Headers(init?.headers) })
    if (mode === 'down') throw new TypeError('fetch failed')
    if (mode === 'busy') return new Response('', { status: 403 })
    if (mode === 'broken') return new Response('oops', { status: 500 })
    if (url.pathname === '/search') {
      return Response.json({
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
  }) as typeof fetch
}

describe('search', () => {
  it("asks Apple for podcasts in Mexico's store, needs no key, and leaves out nameless shows", async () => {
    expect(await searchPodcasts('leyendas', fakeApple())).toEqual([
      { id: '920666', title: 'Leyendas Legendarias', author: 'Leyendas', image: 'https://img.test/ll.jpg' }
    ])
    const { url, headers } = calls[0]
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search')
    expect(url.searchParams.get('term')).toBe('leyendas')
    expect(url.searchParams.get('media')).toBe('podcast')
    expect(url.searchParams.get('country')).toBe('MX')
    expect(headers.get('User-Agent')).toBeTruthy()
  })

  it('turns Apple failures into clear errors (too many searches: try again in a minute)', async () => {
    await expect(searchPodcasts('x', fakeApple('busy'))).rejects.toThrow(/un minuto/)
    await expect(searchPodcasts('x', fakeApple('broken'))).rejects.toThrow('Apple Podcasts respondió 500')
    await expect(searchPodcasts('x', fakeApple('down'))).rejects.toThrow(PodcastError)
  })
})

it('episodes: playable ones newest first, https audio, plain-text notes, the show cover when the episode has none', async () => {
  const episodes = await podcastEpisodes('920666', fakeApple())
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
  expect(episodes[0].image).toBe('https://img.test/ep12.jpg')
  const { url } = calls[0]
  expect(url.pathname).toBe('/lookup')
  expect(url.searchParams.get('id')).toBe('920666')
  expect(url.searchParams.get('entity')).toBe('podcastEpisode')
  expect(url.searchParams.get('limit')).toBe('100')
})

it('plainText: tags out, entities decoded, long notes cut', () => {
  expect(plainText('a<br>b&nbsp;&quot;c&quot;')).toBe('a\nb "c"')
  expect(plainText('x'.repeat(1000)).length).toBe(400)
  expect(plainText(undefined)).toBe('')
})
