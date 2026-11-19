import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Library, type IncomingSong } from '../library'

let dir: string
const song = (id: string, over: Partial<IncomingSong> = {}): IncomingSong => ({
  id,
  title: `Song ${id}`,
  artists: 'Artist',
  album: null,
  deezerId: null,
  deezerArtistId: null,
  isrc: null,
  durationSec: null,
  coverUrl: null,
  saved: false,
  playCount: 0,
  ...over
})

beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'vibes-lib-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('Library', () => {
  it('persists songs and their local state across restarts', async () => {
    const lib = new Library(join(dir, 'library.json'))
    await lib.load()
    expect(await lib.merge([song('aaaaaaaaaaa')], 100)).toEqual({ added: 1, updated: 0 })
    await lib.update('aaaaaaaaaaa', { file: 'aaaaaaaaaaa.m4a', uploaded: true })

    const again = new Library(join(dir, 'library.json'))
    await again.load()
    expect(again.get('aaaaaaaaaaa')).toMatchObject({ file: 'aaaaaaaaaaa.m4a', uploaded: true, addedAt: 100 })
  })

  it('re-importing refreshes metadata but keeps file, upload state and saved flag', async () => {
    const lib = new Library(join(dir, 'library.json'))
    await lib.merge([song('aaaaaaaaaaa', { saved: true, playCount: 5 })], 100)
    await lib.update('aaaaaaaaaaa', { file: 'x.m4a', uploaded: true })
    const r = await lib.merge([song('aaaaaaaaaaa', { title: 'New title', saved: false, playCount: 2 })], 200)
    expect(r).toEqual({ added: 0, updated: 1 })
    expect(lib.get('aaaaaaaaaaa')).toMatchObject({
      title: 'New title',
      saved: true,
      playCount: 5,
      file: 'x.m4a',
      uploaded: true,
      addedAt: 100
    })
  })

  it('refuses to start over a corrupt library instead of wiping it', async () => {
    writeFileSync(join(dir, 'library.json'), '{not json')
    await expect(new Library(join(dir, 'library.json')).load()).rejects.toThrow()
  })
})
