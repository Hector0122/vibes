import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Lyrics, SongRef } from '../../shared/types'
import { cachedLyrics, currentLine, fetchLyrics, parseLrc, pickLyrics, type LrclibRecord } from '../lyrics'

// Shaped like real lrclib.net/api/search results (trimmed).
const AFUERA_LRC = '[00:22.90] Muchos años uno cree\n[00:27.23] Que el caer es levantarse\n[00:30.98] \n[00:33.11] Ya no te paras'
const rec = (album: string, duration: number, synced: string | null, extra: Partial<LrclibRecord> = {}): LrclibRecord => ({
  trackName: 'Afuera',
  artistName: 'Caifanes',
  duration,
  syncedLyrics: synced,
  plainLyrics: synced ? 'Muchos años uno cree\nQue el caer es levantarse' : null,
  ...extra
})

describe('parseLrc', () => {
  it('reads timestamps (with centiseconds or not), keeps blank lines as pauses, skips tags', () => {
    expect(parseLrc('[ar:Caifanes]\n[00:22.90] Muchos años\n[00:30] \n[01:02.5]Otra')).toEqual([
      { t: 22.9, text: 'Muchos años' },
      { t: 30, text: '' },
      { t: 62.5, text: 'Otra' }
    ])
  })

  it('a line with several timestamps (a chorus) appears at each, in time order', () => {
    expect(parseLrc('[00:10.00][01:10.00] Coro\n[00:20.00] Verso').map((l) => [l.t, l.text])).toEqual([
      [10, 'Coro'],
      [20, 'Verso'],
      [70, 'Coro']
    ])
  })
})

describe('currentLine', () => {
  const lines = parseLrc(AFUERA_LRC)
  it('is the last line that has started', () => {
    expect(currentLine(lines, 0)).toBe(-1)
    expect(currentLine(lines, 22.9)).toBe(0)
    expect(currentLine(lines, 29)).toBe(1)
    expect(currentLine(lines, 999)).toBe(3)
  })
})

describe('pickLyrics', () => {
  it('synced lyrics from the recording closest in length', () => {
    const r = pickLyrics([rec('Historia', 289, '[00:01.00] otra'), rec('El Nervio', 286, AFUERA_LRC)], 'Afuera', 'Caifanes', 284)
    expect(r?.synced?.[0]).toEqual({ t: 22.9, text: 'Muchos años uno cree' })
  })

  it('a recording far off in length gives plain text, so timing never drifts', () => {
    const r = pickLyrics([rec('El Nervio', 286, AFUERA_LRC)], 'Afuera', 'Caifanes', 251)
    expect(r).toMatchObject({ synced: null, plain: expect.stringContaining('Muchos años') })
  })

  it('needs artist and title to match', () => {
    expect(pickLyrics([rec('x', 286, AFUERA_LRC, { artistName: 'Otro' })], 'Afuera', 'Caifanes', 286)).toBeNull()
    expect(pickLyrics([rec('x', 286, AFUERA_LRC)], 'Viento', 'Caifanes', 286)).toBeNull()
  })

  it('instrumental tracks say so', () => {
    expect(pickLyrics([rec('x', 200, null, { instrumental: true })], 'Afuera', 'Caifanes', 200)).toEqual({
      synced: null,
      plain: null,
      instrumental: true
    })
  })
})

describe('fetchLyrics', () => {
  it('searches by title and main artist', async () => {
    let asked = ''
    const fake = (async (url: string) => {
      asked = url
      return new Response(JSON.stringify([rec('El Nervio', 286, AFUERA_LRC)]))
    }) as unknown as typeof fetch
    const r = await fetchLyrics({ title: 'Afuera', artists: 'Caifanes, Saúl', durationSec: 286 }, fake, 'https://lrc.test')
    expect(new URL(asked).searchParams.get('artist_name')).toBe('Caifanes')
    expect(r?.synced).toHaveLength(4)
  })

  it('an HTTP error throws (so it is not cached as "no lyrics")', async () => {
    const fake = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    await expect(fetchLyrics({ title: 'a', artists: 'b', durationSec: null }, fake, 'https://lrc.test')).rejects.toThrow()
  })
})

describe('cachedLyrics', () => {
  let dir: string
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'vibes-lyrics-'))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const song: SongRef = { id: 'aaaaaaaaaaa', title: 'Afuera', artists: 'Caifanes', album: null, durationSec: 286, coverUrl: null }
  const found: Lyrics = { synced: null, plain: 'letra', instrumental: false }

  it('fetches once, then reads from disk', async () => {
    let calls = 0
    const fetcher = async () => (calls++, found)
    expect(await cachedLyrics(dir, song, fetcher)).toEqual(found)
    expect(await cachedLyrics(dir, song, fetcher)).toEqual(found)
    expect(calls).toBe(1)
  })

  it('"no lyrics" is retried after a week; a failed request is not cached', async () => {
    let calls = 0
    const none = async () => (calls++, null)
    await cachedLyrics(dir, song, none, 0)
    await cachedLyrics(dir, song, none, 6 * 24 * 3600_000)
    expect(calls).toBe(1)
    await cachedLyrics(dir, song, none, 8 * 24 * 3600_000)
    expect(calls).toBe(2)

    const other = { ...song, id: 'bbbbbbbbbbb' }
    await expect(cachedLyrics(dir, other, async () => Promise.reject(new Error('offline')))).rejects.toThrow()
    expect(await cachedLyrics(dir, other, async () => found)).toEqual(found)
  })

  it('refuses ids that are not YouTube ids (they become file names)', async () => {
    await expect(cachedLyrics(dir, { ...song, id: '../../etc' }, async () => found)).rejects.toThrow('Canción inválida')
  })
})
