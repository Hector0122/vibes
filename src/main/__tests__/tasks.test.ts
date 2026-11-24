// End-to-end through the jobs: eSound fixture → library + audio files →
// the real Worker app (real migration SQL on SQLite, in-memory R2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createApp } from '../../../worker/src/app'
import { createFakeD1, fakePresign, FakeR2, TOKEN } from '../../../worker/test/fakes'
import type { Env } from '../../../worker/src/env'
import type { ListSongsResponse } from '../../shared/api'
import { CloudClient } from '../cloud/client'
import { Library } from '../library'
import {
  addFromSearch,
  applyCloudDeletions,
  deleteSongs,
  detectLanguages,
  downloadMissing,
  enrichYoutubeSongs,
  importEsound,
  recordPlay,
  uploadAll,
  type TaskContext
} from '../tasks'
import { searchYoutube } from '../youtube'
import { CACHED_ID, FAILING_ID, makeAudio, makeEsoundDir, makeFakeYtdlp, MISSING_ID, SEARCH_HIT_ID } from './fixtures'

let root: string
let esoundDir: string
let ctx: TaskContext

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'vibes-tasks-'))
  esoundDir = makeEsoundDir(root)
  makeAudio(join(root, 'dl.m4a'))
  const audioDir = join(root, 'audio')
  mkdirSync(audioDir)
  const library = new Library(join(root, 'library.json'))
  await library.load()
  ctx = { library, audioDir, tools: { ffmpeg: 'ffmpeg', ytdlp: makeFakeYtdlp(root, join(root, 'dl.m4a')) } }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** A Worker + R2 pair; presigned PUTs land in the fake bucket like real ones would. */
function cloud(): { client: CloudClient; r2: FakeR2; list: () => Promise<ListSongsResponse> } {
  const r2 = new FakeR2()
  const env: Env = { BUCKET: r2 as unknown as R2Bucket, DB: createFakeD1(), R2_BUCKET_NAME: 'vibes', API_TOKEN: TOKEN }
  const app = createApp(fakePresign)
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (url.host === 'r2.test') {
      const key = url.pathname.replace(/^\/PUT\//, '')
      const size = (await req.arrayBuffer()).byteLength
      r2.objects.set(key, 'x'.repeat(size))
      return new Response(null, { status: 200 })
    }
    return app.fetch(req, env)
  }) as typeof fetch
  const client = new CloudClient({ baseUrl: 'https://worker.test', token: TOKEN, fetch: fetchImpl, retries: 0 })
  return { client, r2, list: () => client.listSongs() }
}

describe('import → download → upload', () => {
  it('import adds the songs and copies eSound’s cached audio as m4a', async () => {
    const r = await importEsound(ctx, esoundDir)
    expect(r).toEqual({ added: 2, updated: 0, copied: 1, missing: 1 })
    expect(ctx.library.get(CACHED_ID)?.file).toBe(`${CACHED_ID}.m4a`)
    expect(existsSync(join(ctx.audioDir, `${CACHED_ID}.m4a`))).toBe(true)
    expect(ctx.library.get(MISSING_ID)?.file).toBeNull()

    // A second import adds nothing and doesn't copy again.
    expect(await importEsound(ctx, esoundDir)).toEqual({ added: 0, updated: 2, copied: 0, missing: 1 })
  })

  it('download fills in the missing audio and records failures per song', async () => {
    await importEsound(ctx, esoundDir)
    await ctx.library.merge([{ ...ctx.library.get(MISSING_ID)!, id: FAILING_ID }])
    const seen: string[] = []
    ctx.onSong = (s) => seen.push(s.id)

    const p = await downloadMissing(ctx)
    expect(p).toEqual({ task: 'download', done: 2, total: 2, failed: 1 })
    expect(ctx.library.get(MISSING_ID)).toMatchObject({ file: `${MISSING_ID}.m4a`, error: null })
    expect(ctx.library.get(FAILING_ID)).toMatchObject({ file: null, error: expect.stringContaining('Video unavailable') })
    expect(seen.sort()).toEqual([MISSING_ID, FAILING_ID].sort())
  })

  it('upload puts every local song in R2 + D1, and a second run uploads nothing', async () => {
    await importEsound(ctx, esoundDir)
    await downloadMissing(ctx)
    const c = cloud()

    expect(await uploadAll(ctx, c.client)).toEqual({ task: 'upload', done: 2, total: 2, failed: 0 })
    const { songs } = await c.list()
    expect(songs.map((s) => s.id).sort()).toEqual([CACHED_ID, MISSING_ID].sort())
    const stylo = songs.find((s) => s.id === CACHED_ID)!
    expect(stylo).toMatchObject({ title: 'Stylo', artists: 'Gorillaz, Bobby Womack', deezerArtistId: '14' })
    // The object in R2 has exactly the local file's size.
    const localSize = statSync(join(ctx.audioDir, `${CACHED_ID}.m4a`)).size
    expect(stylo.size).toBe(localSize)
    expect((await c.r2.head(`songs/${CACHED_ID}.m4a`))?.size).toBe(localSize)
    expect(ctx.library.list().every((s) => s.uploaded)).toBe(true)

    expect(await uploadAll(ctx, c.client)).toMatchObject({ total: 0 })
  })

  it('a wrong token marks the songs with the error and uploads nothing', async () => {
    await importEsound(ctx, esoundDir)
    const c = cloud()
    const bad = new CloudClient({ baseUrl: 'https://worker.test', token: 'wrong', retries: 0, fetch: (c.client as unknown as { fetchImpl: typeof fetch }).fetchImpl })
    const p = await uploadAll(ctx, bad)
    expect(p).toMatchObject({ total: 1, failed: 1 })
    expect(ctx.library.get(CACHED_ID)).toMatchObject({ uploaded: false, error: 'Token de la nube inválido' })
    expect(c.r2.objects.size).toBe(0)
    expect(JSON.parse(readFileSync(join(root, 'library.json'), 'utf-8')).songs).toHaveLength(2)
  })
})

describe('search → add', () => {
  const hit = async (id: string) => (await searchYoutube(ctx.tools, 'gorillaz')).find((r) => r.id === id)!

  it('adds a hit: saved in the library, audio on disk, and up in R2 + D1', async () => {
    const c = cloud()
    const song = await addFromSearch(ctx, await hit(SEARCH_HIT_ID), c.client)
    expect(song).toMatchObject({
      id: SEARCH_HIT_ID,
      title: 'Feel Good Inc.',
      artists: 'Gorillaz',
      saved: true,
      file: `${SEARCH_HIT_ID}.m4a`,
      uploaded: true,
      error: null
    })
    expect(existsSync(join(ctx.audioDir, `${SEARCH_HIT_ID}.m4a`))).toBe(true)
    // Persisted, so it survives a restart.
    const onDisk = new Library(join(root, 'library.json'))
    await onDisk.load()
    expect(onDisk.get(SEARCH_HIT_ID)?.file).toBe(`${SEARCH_HIT_ID}.m4a`)
    // In the cloud with the cleaned metadata and the exact file size.
    const { songs } = await c.list()
    expect(songs).toHaveLength(1)
    expect(songs[0]).toMatchObject({ id: SEARCH_HIT_ID, title: 'Feel Good Inc.', durationSec: 255 })
    expect((await c.r2.head(`songs/${SEARCH_HIT_ID}.m4a`))?.size).toBe(
      statSync(join(ctx.audioDir, `${SEARCH_HIT_ID}.m4a`)).size
    )
  })

  it('without a cloud the song stays local, and "Subir a la nube" picks it up later', async () => {
    const song = await addFromSearch(ctx, await hit(SEARCH_HIT_ID), null)
    expect(song).toMatchObject({ file: `${SEARCH_HIT_ID}.m4a`, uploaded: false })
    const c = cloud()
    expect(await uploadAll(ctx, c.client)).toMatchObject({ total: 1, failed: 0 })
    expect((await c.list()).songs.map((s) => s.id)).toEqual([SEARCH_HIT_ID])
  })

  it('a song already imported from eSound keeps its metadata and is not downloaded again', async () => {
    await importEsound(ctx, esoundDir)
    const before = statSync(join(ctx.audioDir, `${CACHED_ID}.m4a`)).mtimeMs
    const song = await addFromSearch(ctx, await hit(CACHED_ID), null)
    expect(song).toMatchObject({ title: 'Stylo', artists: 'Gorillaz, Bobby Womack', album: 'Plastic Beach' })
    expect(statSync(join(ctx.audioDir, `${CACHED_ID}.m4a`)).mtimeMs).toBe(before)
    expect(ctx.library.list()).toHaveLength(2)
  })

  it('a failed download rejects but leaves the song with its error, for "Descargar faltantes"', async () => {
    await expect(addFromSearch(ctx, await hit(FAILING_ID), null)).rejects.toThrow('Video unavailable')
    expect(ctx.library.get(FAILING_ID)).toMatchObject({ file: null, saved: true, error: expect.stringContaining('Video unavailable') })
  })

  it('a failed upload keeps the song local with the error instead of failing the add', async () => {
    const c = cloud()
    const bad = new CloudClient({ baseUrl: 'https://worker.test', token: 'wrong', retries: 0, fetch: (c.client as unknown as { fetchImpl: typeof fetch }).fetchImpl })
    const song = await addFromSearch(ctx, await hit(SEARCH_HIT_ID), bad)
    expect(song).toMatchObject({ file: `${SEARCH_HIT_ID}.m4a`, uploaded: false, error: 'Token de la nube inválido' })
    expect(c.r2.objects.size).toBe(0)
  })

  it('rejects anything that is not a YouTube id or has no title', async () => {
    const base = await hit(SEARCH_HIT_ID)
    await expect(addFromSearch(ctx, { ...base, id: '--exec=rm' }, null)).rejects.toThrow('Canción inválida')
    await expect(addFromSearch(ctx, { ...base, title: '  ' }, null)).rejects.toThrow('Invalid title')
    expect(ctx.library.list()).toHaveLength(0)
  })
})

describe('covers from Deezer', () => {
  const hit = async (id: string) => (await searchYoutube(ctx.tools, 'gorillaz')).find((r) => r.id === id)!
  const DZ = { coverUrl: 'https://cdn-images.dzcdn.net/x/1000x1000.jpg', album: 'Demon Days', deezerId: '3129775', deezerArtistId: '14' }

  it('a song added from YouTube gets the real cover and album, and the cloud gets them too', async () => {
    const asked: string[] = []
    ctx.enrich = async (title, artists) => {
      asked.push(`${artists} — ${title}`)
      return DZ
    }
    const c = cloud()
    const song = await addFromSearch(ctx, await hit(SEARCH_HIT_ID), c.client)
    expect(asked).toEqual(['Gorillaz — Feel Good Inc.'])
    expect(song).toMatchObject(DZ)
    expect((await c.list()).songs[0]).toMatchObject({ coverUrl: DZ.coverUrl, album: 'Demon Days' })
  })

  it('no match or Deezer down: the song is still added with the YouTube thumbnail', async () => {
    ctx.enrich = async () => {
      throw new Error('offline')
    }
    const song = await addFromSearch(ctx, await hit(SEARCH_HIT_ID), null)
    expect(song.file).toBe(`${SEARCH_HIT_ID}.m4a`)
    expect(song.coverUrl).toContain('ytimg.com')
    expect(song.deezerId).toBeNull()
  })

  it('songs from eSound already have Deezer data and are not looked up again', async () => {
    await importEsound(ctx, esoundDir)
    let calls = 0
    ctx.enrich = async () => {
      calls++
      return DZ
    }
    await addFromSearch(ctx, await hit(CACHED_ID), null)
    expect(calls).toBe(0)
  })

  it('the startup pass fixes earlier YouTube songs only', async () => {
    await importEsound(ctx, esoundDir) // Stylo has a Deezer id; "Live (Official)" has no cover
    await addFromSearch(ctx, await hit(SEARCH_HIT_ID), null) // no enrich yet
    const looked: string[] = []
    ctx.enrich = async (title) => {
      looked.push(title)
      return title === 'Feel Good Inc.' ? DZ : null
    }
    expect(await enrichYoutubeSongs(ctx)).toBe(1)
    expect(looked.sort()).toEqual(['Feel Good Inc.', 'Live (Official)'])
    expect(ctx.library.get(SEARCH_HIT_ID)).toMatchObject(DZ)
    expect(ctx.library.get(CACHED_ID)?.coverUrl).toBe('https://img/1.jpg')
  })
})

describe('recordPlay', () => {
  it('counts plays and remembers when, on disk', async () => {
    await importEsound(ctx, esoundDir)
    const before = ctx.library.get(CACHED_ID)!.playCount
    await recordPlay(ctx, CACHED_ID, 1000)
    await recordPlay(ctx, CACHED_ID, 2000)
    const onDisk = new Library(join(root, 'library.json'))
    await onDisk.load()
    expect(onDisk.get(CACHED_ID)).toMatchObject({ playCount: before + 2, lastPlayedAt: 2000 })
  })

  it('a preview of a song not in the library is ignored', async () => {
    await expect(recordPlay(ctx, 'zzzzzzzzzzz')).resolves.toBeUndefined()
    expect(ctx.library.list()).toHaveLength(0)
  })
})

describe('detectLanguages', () => {
  it("from the lyrics, else the artist's other songs; up to the cloud without sending the audio again", async () => {
    const c = cloud()
    const hit = (await searchYoutube(ctx.tools, 'gorillaz')).find((r) => r.id === SEARCH_HIT_ID)!
    await addFromSearch(ctx, hit, c.client)
    await ctx.library.merge([
      { id: 'other000000', title: 'On Melancholy Hill', artists: 'Gorillaz', album: null, deezerId: null, deezerArtistId: null,
        isrc: null, durationSec: 233, coverUrl: null, saved: true, playCount: 0 }
    ])
    const put = vi.spyOn(c.client, 'putFile')
    let offline = true
    const lyrics = vi.fn(async (s: { id: string }) => {
      if (s.id === SEARCH_HIT_ID) return "Windmill, windmill for the land, it's all for you and me"
      if (offline) throw new Error('sin internet')
      return null // no lyrics for this one
    })

    // Offline for the second song: it stays unchecked, the first goes up as English.
    expect(await detectLanguages(ctx, lyrics, c.client)).toBe(1)
    expect(ctx.library.get(SEARCH_HIT_ID)?.lang).toBe('en')
    expect(ctx.library.get('other000000')?.lang).toBeUndefined()
    expect((await c.list()).songs.map((s) => [s.id, s.lang])).toEqual([[SEARCH_HIT_ID, 'en']])
    expect(put).not.toHaveBeenCalled()

    // Back online: no lyrics, so it takes its artist's language. Nothing new to send.
    offline = false
    expect(await detectLanguages(ctx, lyrics, c.client)).toBe(0) // no audio here: not in the cloud
    expect(ctx.library.get('other000000')?.lang).toBe('en')
    // Lyrics are asked once per song.
    await detectLanguages(ctx, lyrics, c.client)
    expect(lyrics.mock.calls.filter(([s]) => s.id === SEARCH_HIT_ID)).toHaveLength(1)
  })
})

describe('deleting songs', () => {
  it('here: the entry, its audio file and the cloud copy', async () => {
    const c = cloud()
    const hit = (await searchYoutube(ctx.tools, 'gorillaz')).find((r) => r.id === SEARCH_HIT_ID)!
    await addFromSearch(ctx, hit, c.client)
    const file = join(ctx.audioDir, `${SEARCH_HIT_ID}.m4a`)
    expect(existsSync(file)).toBe(true)

    expect(await deleteSongs(ctx, [SEARCH_HIT_ID, 'notthere000'], c.client)).toEqual([SEARCH_HIT_ID])
    expect(ctx.library.get(SEARCH_HIT_ID)).toBeUndefined()
    expect(existsSync(file)).toBe(false)
    expect((await c.list()).songs).toEqual([])
    expect(c.r2.objects.size).toBe(0)
    const onDisk = new Library(join(root, 'library.json'))
    await onDisk.load()
    expect(onDisk.get(SEARCH_HIT_ID)).toBeUndefined()
  })

  it('a failed download (no audio, not in the cloud) goes too', async () => {
    const c = cloud()
    await ctx.library.merge([
      { id: 'dz538646262', title: 'Maggie May', artists: 'Rod Stewart', album: null, deezerId: null, deezerArtistId: null,
        isrc: null, durationSec: 350, coverUrl: null, saved: true, playCount: 0 }
    ])
    expect(await deleteSongs(ctx, ['dz538646262'], c.client)).toEqual(['dz538646262'])
    expect(ctx.library.list()).toEqual([])
  })

  it('on the phone: removed here on the next check, and cleared in the cloud', async () => {
    const c = cloud()
    const hit = (await searchYoutube(ctx.tools, 'gorillaz')).find((r) => r.id === SEARCH_HIT_ID)!
    await addFromSearch(ctx, hit, c.client)
    await c.client.deleteSong(SEARCH_HIT_ID) // what the phone does
    expect(await applyCloudDeletions(ctx, c.client)).toEqual([SEARCH_HIT_ID])
    expect(ctx.library.get(SEARCH_HIT_ID)).toBeUndefined()
    expect(existsSync(join(ctx.audioDir, `${SEARCH_HIT_ID}.m4a`))).toBe(false)
    expect((await c.client.listDeletions()).deletions).toEqual([])
    expect(await applyCloudDeletions(ctx, c.client)).toEqual([])
  })
})
