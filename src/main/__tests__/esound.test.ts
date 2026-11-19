import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readEsoundLibrary } from '../esound'
import { CACHED_ID, makeEsoundDir, MISSING_ID } from './fixtures'

let root: string
let dir: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'vibes-esound-test-'))
  dir = makeEsoundDir(root)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('readEsoundLibrary', () => {
  it('maps eSound songs to Vibes songs keyed by YouTube id', async () => {
    const songs = await readEsoundLibrary(dir)
    expect(songs.map((s) => s.id).sort()).toEqual([CACHED_ID, MISSING_ID])
    expect(songs.find((s) => s.id === CACHED_ID)).toEqual({
      id: CACHED_ID,
      title: 'Stylo',
      artists: 'Gorillaz, Bobby Womack',
      album: 'Plastic Beach',
      deezerId: '5490699',
      deezerArtistId: '14',
      isrc: 'GB1',
      durationSec: 270,
      coverUrl: 'https://img/1.jpg',
      saved: true,
      playCount: 3,
      cachedAudio: join(dir, 'tracks', 'e1.mp4')
    })
  })

  it('uses the display name, and no Deezer ids for YouTube-only songs', async () => {
    const s = (await readEsoundLibrary(dir)).find((x) => x.id === MISSING_ID)!
    expect(s).toMatchObject({
      title: 'Live (Official)',
      artists: 'Some Channel',
      deezerId: null,
      deezerArtistId: null,
      saved: false,
      cachedAudio: null
    })
  })

  it('never modifies the eSound database', async () => {
    const db = join(dir, 'sql-data', 'esound_main.db')
    const before = statSync(db).mtimeMs
    await readEsoundLibrary(dir)
    expect(statSync(db).mtimeMs).toBe(before)
  })

  it('explains when eSound is not installed', async () => {
    await expect(readEsoundLibrary(join(root, 'nope'))).rejects.toThrow(/eSound/)
  })
})
