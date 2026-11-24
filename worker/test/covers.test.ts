import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { createHarness, fakePresign, hash, putAudio, SONG_ID, TOKEN, type Harness } from './fakes'
import type { CloudSong, SongMeta, UploadCoverResponse } from '../../src/shared/api'

let h: Harness
const app = createApp(fakePresign)
const raw = (method: string, path: string, init: { body?: BodyInit; type?: string; token?: string | null } = {}) => {
  const headers: Record<string, string> = {}
  if (init.token !== null) headers.Authorization = `Bearer ${init.token ?? TOKEN}`
  if (init.type) headers['Content-Type'] = init.type
  return app.fetch(new Request(`https://worker.test${path}`, { method, headers, body: init.body }), h.env)
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

beforeEach(() => {
  h = createHarness()
})

describe('covers', () => {
  it('uploads a cover, serves it without the token, and a book chapter keeps it', async () => {
    const up = await raw('POST', '/v1/covers', { body: PNG, type: 'image/png' })
    expect(up.status).toBe(200)
    const { coverUrl } = (await up.json()) as UploadCoverResponse
    expect(coverUrl).toMatch(/^https:\/\/worker\.test\/v1\/covers\/[A-Za-z0-9_-]{22}\.png$/)

    const got = await raw('GET', new URL(coverUrl).pathname, { token: null })
    expect(got.status).toBe(200)
    expect(got.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG)

    // Setting the cover on an uploaded chapter only changes its metadata: no new upload.
    const meta: SongMeta = { title: 'Cap 1', artists: 'Autor', album: 'Libro', deezerId: null, deezerArtistId: null,
      isrc: null, durationSec: 60, coverUrl: null, book: 'Libro', chapter: 1 }
    await h.call('POST', `/v1/songs/${SONG_ID}/upload`, { meta, size: 10, sha256: hash('a') })
    putAudio(h.r2, SONG_ID, 10)
    await h.call('POST', `/v1/songs/${SONG_ID}/commit`)
    const again = await h.call('POST', `/v1/songs/${SONG_ID}/upload`, { meta: { ...meta, coverUrl }, size: 10, sha256: hash('a') })
    expect(((await again.json()) as { url: string | null }).url).toBeNull()
    const songs = ((await (await h.call('GET', '/v1/songs')).json()) as { songs: CloudSong[] }).songs
    expect(songs.map((s) => [s.book, s.coverUrl])).toEqual([['Libro', coverUrl]])
  })

  it('needs the token to upload, and only takes images up to 5 MB', async () => {
    expect((await raw('POST', '/v1/covers', { body: PNG, type: 'image/png', token: null })).status).toBe(401)
    expect((await raw('POST', '/v1/covers', { body: PNG, type: 'text/html' })).status).toBe(400)
    expect((await raw('POST', '/v1/covers', { body: new Uint8Array(0), type: 'image/png' })).status).toBe(400)
    expect((await raw('POST', '/v1/covers', { body: new Uint8Array(5 * 1024 * 1024 + 1), type: 'image/jpeg' })).status).toBe(400)
    expect([...h.r2.objects.keys()]).toEqual([])
  })

  it('serves nothing else without the token', async () => {
    h.r2.objects.set(`songs/${SONG_ID}.m4a`, 'audio')
    expect((await raw('GET', '/v1/covers/../songs/x', { token: null })).status).toBe(401)
    expect((await raw('GET', '/v1/covers/short.png', { token: null })).status).toBe(404)
    expect((await raw('GET', '/v1/covers/AAAAAAAAAAAAAAAAAAAAAA.png', { token: null })).status).toBe(404)
    expect((await raw('GET', '/v1/songs', { token: null })).status).toBe(401)
  })
})
