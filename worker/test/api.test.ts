import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, hash, putAudio, SONG_ID, type Harness } from './fakes'
import type {
  CloudSong,
  ListSongsResponse,
  SongMeta,
  StreamResponse,
  UploadBeginResponse
} from '../../src/shared/api'

let h: Harness

const META: SongMeta = {
  title: 'On Melancholy Hill',
  artists: 'Gorillaz',
  album: 'Plastic Beach',
  deezerId: '5490699',
  deezerArtistId: '14',
  isrc: 'GBAYE1000052',
  durationSec: 233,
  coverUrl: null
}

async function begin(size = 10, sha = hash('a'), meta = META): Promise<UploadBeginResponse> {
  const res = await h.call('POST', `/v1/songs/${SONG_ID}/upload`, { meta, size, sha256: sha })
  expect(res.status).toBe(200)
  return res.json()
}

async function uploadComplete(size = 10, sha = hash('a')): Promise<void> {
  await begin(size, sha)
  putAudio(h.r2, SONG_ID, size)
  expect((await h.call('POST', `/v1/songs/${SONG_ID}/commit`)).status).toBe(200)
}

async function listSongs(): Promise<CloudSong[]> {
  return ((await (await h.call('GET', '/v1/songs')).json()) as ListSongsResponse).songs
}

beforeEach(() => {
  h = createHarness()
})

describe('auth', () => {
  it('rejects a missing or wrong token without leaking data', async () => {
    await uploadComplete()
    expect((await h.call('GET', '/v1/songs', undefined, null)).status).toBe(401)
    const res = await h.call('GET', '/v1/songs', undefined, 'nope')
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain('Gorillaz')
  })

  it('rejects everything when no API_TOKEN is configured', async () => {
    h.env.API_TOKEN = undefined
    expect((await h.call('GET', '/v1/health')).status).toBe(401)
  })
})

describe('upload → commit → list', () => {
  it('lists the song with its metadata only after the audio is in R2 and committed', async () => {
    const { url } = await begin()
    expect(url).toBe(`https://r2.test/PUT/songs/${SONG_ID}.m4a`)
    expect(await listSongs()).toEqual([])

    // Commit before the PUT landed: refused, still hidden.
    expect((await h.call('POST', `/v1/songs/${SONG_ID}/commit`)).status).toBe(409)
    expect(await listSongs()).toEqual([])

    putAudio(h.r2, SONG_ID, 10)
    expect((await h.call('POST', `/v1/songs/${SONG_ID}/commit`)).status).toBe(200)
    const [song] = await listSongs()
    expect(song).toMatchObject({ id: SONG_ID, ...META, size: 10, sha256: hash('a') })
  })

  it('skips the upload when R2 already has the same file, and keeps it listed', async () => {
    await uploadComplete()
    const { url } = await begin(10, hash('a'), { ...META, title: 'Renamed' })
    expect(url).toBeNull()
    expect((await listSongs())[0].title).toBe('Renamed')
  })

  it('hides the song while a different file is re-uploaded', async () => {
    await uploadComplete()
    const { url } = await begin(12, hash('b'))
    expect(url).not.toBeNull()
    expect(await listSongs()).toEqual([])
    putAudio(h.r2, SONG_ID, 12)
    expect((await h.call('POST', `/v1/songs/${SONG_ID}/commit`)).status).toBe(200)
    expect((await listSongs())[0].size).toBe(12)
  })

  it('stores only known metadata fields', async () => {
    await begin(10, hash('a'), { ...META, evil: 'x'.repeat(5000) } as SongMeta)
    putAudio(h.r2, SONG_ID, 10)
    await h.call('POST', `/v1/songs/${SONG_ID}/commit`)
    expect(JSON.stringify(await listSongs())).not.toContain('evil')
  })
})

describe('validation', () => {
  it.each([
    ['bad id', '/v1/songs/not-a-yt-id!/upload', { meta: META, size: 1, sha256: hash('a') }],
    ['empty title', `/v1/songs/${SONG_ID}/upload`, { meta: { ...META, title: ' ' }, size: 1, sha256: hash('a') }],
    ['zero size', `/v1/songs/${SONG_ID}/upload`, { meta: META, size: 0, sha256: hash('a') }],
    ['huge size', `/v1/songs/${SONG_ID}/upload`, { meta: META, size: 2e9, sha256: hash('a') }],
    ['bad sha', `/v1/songs/${SONG_ID}/upload`, { meta: META, size: 1, sha256: 'abc' }]
  ])('rejects %s with 400', async (_name, path, body) => {
    expect((await h.call('POST', path, body)).status).toBe(400)
  })
})

describe('stream and delete', () => {
  it('gives a presigned GET only for committed songs', async () => {
    expect((await h.call('GET', `/v1/songs/${SONG_ID}/stream`)).status).toBe(404)
    await uploadComplete()
    const res = await h.call('GET', `/v1/songs/${SONG_ID}/stream`)
    expect(((await res.json()) as StreamResponse).url).toBe(`https://r2.test/GET/songs/${SONG_ID}.m4a`)
  })

  it('deleting removes the audio from R2 and the song from the list', async () => {
    await uploadComplete()
    expect((await h.call('DELETE', `/v1/songs/${SONG_ID}`)).status).toBe(200)
    expect(h.r2.objects.size).toBe(0)
    expect(await listSongs()).toEqual([])
  })
})

describe('playlists', () => {
  const pl = (id: string, name: string, songIds: string[]) => ({ id, name, songIds, createdAt: 1, updatedAt: 2 })

  it('starts empty; PUT replaces the whole set and GET returns it in order', async () => {
    expect(await (await h.call('GET', '/v1/playlists')).json()).toEqual({ playlists: [] })
    const first = [pl('b1', 'Para correr', [SONG_ID]), pl('a2', '  Noche  ', [])]
    const res = await h.call('PUT', '/v1/playlists', { playlists: first })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { playlists: { name: string }[] }).playlists.map((p) => p.name)).toEqual([
      'Para correr',
      'Noche'
    ])

    // A playlist deleted on the desktop disappears from the cloud too.
    await h.call('PUT', '/v1/playlists', { playlists: [pl('a2', 'Noche', [SONG_ID, 'aaaaaaaaaaa'])] })
    expect(await (await h.call('GET', '/v1/playlists')).json()).toEqual({
      playlists: [pl('a2', 'Noche', [SONG_ID, 'aaaaaaaaaaa'])]
    })
  })

  it('rejects an invalid set without touching what is stored', async () => {
    await h.call('PUT', '/v1/playlists', { playlists: [pl('x', 'Buena', [])] })
    for (const bad of [
      {},
      { playlists: [pl('x', '', [])] },
      { playlists: [pl('x', 'a', ['no es un id'])] },
      { playlists: [pl('dup', 'a', []), pl('dup', 'b', [])] },
      { playlists: [pl('bad/id', 'a', [])] }
    ]) {
      expect((await h.call('PUT', '/v1/playlists', bad)).status).toBe(400)
    }
    expect(await (await h.call('GET', '/v1/playlists')).json()).toEqual({ playlists: [pl('x', 'Buena', [])] })
  })

  it('needs the token', async () => {
    expect((await h.call('GET', '/v1/playlists', undefined, null)).status).toBe(401)
    expect((await h.call('PUT', '/v1/playlists', { playlists: [] }, 'nope')).status).toBe(401)
  })
})
