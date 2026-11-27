// Podcast subscriptions from the phone, kept in D1 (the real migration SQL). The phone
// searches Apple's directory itself: the Worker no longer offers search or episodes.
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './fakes'
import type { ListPodcastSubscriptionsResponse } from '../../src/shared/api'

let h: Harness
beforeEach(() => {
  h = createHarness()
})

const show = { title: 'Leyendas Legendarias', author: 'Leyendas', image: 'https://img.test/ll.jpg' }

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

it('search and episodes are gone from the Worker (Apple turns Cloudflare away)', async () => {
  expect((await h.call('GET', '/v1/podcasts/search?q=x')).status).toBe(404)
  expect((await h.call('GET', '/v1/podcasts/920666/episodes')).status).toBe(404)
})
