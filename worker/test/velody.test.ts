// Sending songs to Velody (the practice app): the Worker's side, with the real migration SQL.
import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, hash, putAudio, SONG_ID, type Harness } from './fakes'
import type { ListVelodySendsResponse, SongMeta, VelodySend } from '../../src/shared/api'

const OTHER = 'aaaaaaaaaaa'
const meta = (title: string, extra: Partial<SongMeta> = {}): SongMeta => ({
  title,
  artists: 'Caifanes',
  album: null,
  deezerId: null,
  deezerArtistId: null,
  isrc: null,
  durationSec: 200,
  coverUrl: null,
  ...extra
})

let h: Harness
beforeEach(() => {
  h = createHarness()
})

async function upload(id: string, m: SongMeta, complete = true): Promise<void> {
  await h.call('POST', `/v1/songs/${id}/upload`, { meta: m, size: 3, sha256: hash('a') })
  if (!complete) return
  putAudio(h.r2, id, 3)
  expect((await h.call('POST', `/v1/songs/${id}/commit`)).status).toBe(200)
}

const sends = async (): Promise<VelodySend[]> =>
  ((await (await h.call('GET', '/v1/velody')).json()) as ListVelodySendsResponse).sends

describe('Vibes → Velody', () => {
  it('sends songs in order, with title and artist; sending again keeps its place', async () => {
    await upload(SONG_ID, meta('Afuera'))
    await upload(OTHER, meta('La Negra Tomasa'))
    const first = await h.call('PUT', `/v1/velody/${SONG_ID}`)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ id: SONG_ID, title: 'Afuera', artists: 'Caifanes', durationSec: 200 })
    await h.call('PUT', `/v1/velody/${OTHER}`)
    await h.call('PUT', `/v1/velody/${SONG_ID}`)
    expect((await sends()).map((s) => s.id)).toEqual([SONG_ID, OTHER])
  })

  it('taking it back (or Velody after importing) removes it', async () => {
    await upload(SONG_ID, meta('Afuera'))
    await h.call('PUT', `/v1/velody/${SONG_ID}`)
    expect((await h.call('DELETE', `/v1/velody/${SONG_ID}`)).status).toBe(200)
    expect(await sends()).toEqual([])
    expect((await h.call('DELETE', `/v1/velody/${SONG_ID}`)).status).toBe(200) // already gone: fine
  })

  it('only songs whose audio is in the cloud; never audiobooks', async () => {
    expect((await h.call('PUT', `/v1/velody/${SONG_ID}`)).status).toBe(404)
    await upload(SONG_ID, meta('Pendiente'), false)
    expect((await h.call('PUT', `/v1/velody/${SONG_ID}`)).status).toBe(404)
    await upload(OTHER, meta('Capítulo 1', { book: 'Un libro', chapter: 1 }))
    expect((await h.call('PUT', `/v1/velody/${OTHER}`)).status).toBe(400)
    expect(await sends()).toEqual([])
  })

  it('deleting the song from the cloud drops it from the list', async () => {
    await upload(SONG_ID, meta('Afuera'))
    await h.call('PUT', `/v1/velody/${SONG_ID}`)
    await h.call('DELETE', `/v1/songs/${SONG_ID}`)
    expect(await sends()).toEqual([])
  })

  it('checks the token and the id', async () => {
    expect((await h.call('GET', '/v1/velody', undefined, null)).status).toBe(401)
    expect((await h.call('PUT', '/v1/velody/../x')).status).not.toBe(200)
    expect((await h.call('PUT', '/v1/velody/bad')).status).toBe(400)
    expect((await h.call('POST', `/v1/velody/${SONG_ID}`)).status).toBe(405)
  })
})
