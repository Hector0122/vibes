// The phone's cloud client against the real Worker app (real migration SQL on
// SQLite, in-memory R2) — the same fakes the Worker's own tests use.
// Runs with the root Vitest (`pnpm test` at the repo root), not Jest.
import { describe, expect, it } from 'vitest'
import { createApp } from '../../../worker/src/app'
import { createFakeD1, fakePresign, FakeR2, TOKEN } from '../../../worker/test/fakes'
import type { Env } from '../../../worker/src/env'
import { CloudError, createCloud, normalizeUrl } from '../cloud'

const META = {
  title: 'Afuera',
  artists: 'Caifanes',
  album: 'El Nervio del Volcán',
  deezerId: '1',
  deezerArtistId: '2',
  isrc: null,
  durationSec: 286,
  coverUrl: 'https://img/1.jpg'
}

/** A Worker with one complete song and one still uploading. */
async function worker(): Promise<typeof fetch> {
  const r2 = new FakeR2()
  const env: Env = { BUCKET: r2 as unknown as R2Bucket, DB: createFakeD1(), R2_BUCKET_NAME: 'vibes', API_TOKEN: TOKEN }
  const app = createApp(fakePresign)
  const f = ((input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init), env)) as typeof fetch
  const call = (path: string, method = 'POST', body?: unknown): Promise<Response> =>
    f(`https://w.test/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })
  for (const id of ['aaaaaaaaaaa', 'bbbbbbbbbbb']) {
    await call(`/songs/${id}/upload`, 'POST', { meta: { ...META, title: id }, size: 4, sha256: 'a'.repeat(64) })
  }
  r2.objects.set('songs/aaaaaaaaaaa.m4a', 'xxxx')
  await call('/songs/aaaaaaaaaaa/commit')
  return f
}

describe('mobile cloud client', () => {
  it('lists only complete songs, with their metadata', async () => {
    const cloud = createCloud({ url: 'https://w.test/', token: TOKEN, fetch: await worker() })
    await cloud.health()
    const songs = await cloud.listSongs()
    expect(songs.map((s) => s.id)).toEqual(['aaaaaaaaaaa'])
    expect(songs[0]).toMatchObject({ artists: 'Caifanes', durationSec: 286, size: 4 })
  })

  it('gives a signed URL to stream a song', async () => {
    const cloud = createCloud({ url: 'https://w.test', token: TOKEN, fetch: await worker() })
    expect(await cloud.streamUrl('aaaaaaaaaaa')).toMatch(/songs\/aaaaaaaaaaa\.m4a/)
  })

  it('a song that is not complete cannot be streamed', async () => {
    const cloud = createCloud({ url: 'https://w.test', token: TOKEN, fetch: await worker() })
    await expect(cloud.streamUrl('bbbbbbbbbbb')).rejects.toBeInstanceOf(CloudError)
  })

  it('a wrong token says so', async () => {
    const cloud = createCloud({ url: 'https://w.test', token: 'wrong', fetch: await worker() })
    await expect(cloud.listSongs()).rejects.toThrow('Token de la nube inválido')
  })

  it('no connection gives a clear message', async () => {
    const down = (async () => {
      throw new TypeError('Network request failed')
    }) as unknown as typeof fetch
    await expect(createCloud({ url: 'https://w.test', token: TOKEN, fetch: down }).health()).rejects.toThrow(
      'No se pudo conectar con la nube'
    )
  })

  it('only https URLs', () => {
    expect(normalizeUrl(' https://x.workers.dev/ ')).toBe('https://x.workers.dev')
    expect(normalizeUrl('http://x.workers.dev')).toBe('')
    expect(normalizeUrl('nope')).toBe('')
    expect(() => createCloud({ url: 'http://x', token: 't' })).toThrow('https://')
  })
})
