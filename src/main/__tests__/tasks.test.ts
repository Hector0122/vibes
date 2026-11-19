// End-to-end through the jobs: eSound fixture → library + audio files →
// the real Worker app (real migration SQL on SQLite, in-memory R2).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createApp } from '../../../worker/src/app'
import { createFakeD1, fakePresign, FakeR2, TOKEN } from '../../../worker/test/fakes'
import type { Env } from '../../../worker/src/env'
import type { ListSongsResponse } from '../../shared/api'
import { CloudClient } from '../cloud/client'
import { Library } from '../library'
import { downloadMissing, importEsound, uploadAll, type TaskContext } from '../tasks'
import { CACHED_ID, FAILING_ID, makeAudio, makeEsoundDir, makeFakeYtdlp, MISSING_ID } from './fixtures'

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
