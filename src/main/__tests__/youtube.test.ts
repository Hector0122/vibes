import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  cleanTitle,
  inLibraryByName,
  mergeMixes,
  mixArgs,
  parseSearchOutput,
  pickSeeds,
  recommend,
  searchArgs,
  searchYoutube,
  shortTitle,
  radioFor,
  streamArgs,
  streamResolver
} from '../youtube'
import type { SearchResult } from '../../shared/types'
import { CACHED_ID, FAKE_SEARCH_OUTPUT, makeAudio, makeFakeYtdlp, MIX_IDS, SEARCH_HIT_ID } from './fixtures'

describe('cleanTitle', () => {
  it('splits "Artist - Song" and drops the "(Official Video)" noise', () => {
    expect(cleanTitle('Gorillaz - Feel Good Inc. (Official Video)', 'Gorillaz')).toEqual({
      artists: 'Gorillaz',
      title: 'Feel Good Inc.'
    })
  })

  it('handles Spanish tags, brackets and en dashes', () => {
    expect(cleanTitle('Bad Bunny – DtMF [Video Oficial] (Letra)', 'Bad Bunny')).toEqual({
      artists: 'Bad Bunny',
      title: 'DtMF'
    })
  })

  it('keeps meaningful parentheses like (Remix) or (feat. …)', () => {
    expect(cleanTitle('Daft Punk - One More Time (Remix) (Audio)', 'x').title).toBe('One More Time (Remix)')
    expect(cleanTitle('A - B (feat. C)', 'x').title).toBe('B (feat. C)')
  })

  it('without a dash, the channel is the artist ("- Topic" and VEVO removed)', () => {
    expect(cleanTitle('Stylo', 'Gorillaz - Topic')).toEqual({ title: 'Stylo', artists: 'Gorillaz' })
    expect(cleanTitle('Hello (Official Video)', 'AdeleVEVO')).toEqual({ title: 'Hello', artists: 'Adele' })
  })

  it('"Song - Artist" flips when the channel is on the right', () => {
    expect(cleanTitle('daño - Peso Pluma & Tito Double P (Lyric Video)', 'Peso Pluma')).toEqual({
      title: 'daño',
      artists: 'Peso Pluma & Tito Double P'
    })
  })

  it('with no channel, flips only when the right side is a list of artists', () => {
    expect(cleanTitle('Hollywood - Peso Pluma, Estevan Plazola (Video Oficial)', '')).toEqual({
      title: 'Hollywood',
      artists: 'Peso Pluma, Estevan Plazola'
    })
    // Both sides could be either: keep the usual "Artist - Song".
    expect(cleanTitle('Bad Bunny x Jhay Cortez - DÁKITI', '')).toEqual({
      artists: 'Bad Bunny x Jhay Cortez',
      title: 'DÁKITI'
    })
    expect(cleanTitle('Gorillaz - Feel Good Inc.', '')).toEqual({ artists: 'Gorillaz', title: 'Feel Good Inc.' })
  })

  it('the channel on the left wins even if the right side lists artists', () => {
    expect(cleanTitle('Peso Pluma - LADY GAGA, Gabito Ballesteros, Junior H', 'Peso Pluma').artists).toBe('Peso Pluma')
  })

  it('never ends with an empty title', () => {
    expect(cleanTitle('(Official Video)', 'X').title).toBe('(Official Video)')
  })
})

describe('parseSearchOutput', () => {
  it('keeps videos with a cover, skips channels and playlists', () => {
    const r = parseSearchOutput(FAKE_SEARCH_OUTPUT)
    expect(r.map((x) => x.id)).not.toContain('UCfIXdjDQH9Fau7y99_Orpjw')
    expect(r[0]).toEqual({
      id: SEARCH_HIT_ID,
      title: 'Feel Good Inc.',
      artists: 'Gorillaz',
      durationSec: 255,
      coverUrl: `https://i.ytimg.com/vi/${SEARCH_HIT_ID}/mqdefault.jpg`
    })
  })

  it('skips live streams, junk lines and entries without a title', () => {
    const out = [
      'not json',
      JSON.stringify({ id: 'aaaaaaaaaaa', title: 'Live radio', channel: 'x', live_status: 'is_live' }),
      JSON.stringify({ id: 'bbbbbbbbbbb', title: '', channel: 'x' }),
      JSON.stringify({ id: 'ccccccccccc', title: 'Ok', uploader: 'Up', duration: null }),
      ''
    ].join('\n')
    expect(parseSearchOutput(out)).toEqual([
      { id: 'ccccccccccc', title: 'Ok', artists: 'Up', durationSec: null, coverUrl: expect.any(String) }
    ])
  })
})

describe('searchArgs', () => {
  it('a query that looks like an option stays a query', () => {
    const args = searchArgs('--exec rm', 5)
    expect(args.slice(-2)).toEqual(['--', 'ytsearch5:--exec rm'])
  })
})

describe('searchYoutube (fake yt-dlp)', () => {
  let root: string
  let ytdlp: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'vibes-yt-'))
    makeAudio(join(root, 'a.m4a'))
    ytdlp = makeFakeYtdlp(root, join(root, 'a.m4a'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const tools = (): { ffmpeg: string; ytdlp: string } => ({ ffmpeg: 'ffmpeg', ytdlp })

  it('runs yt-dlp and returns the parsed hits', async () => {
    const r = await searchYoutube(tools(), '  gorillaz  ')
    expect(r.map((x) => x.id)).toEqual([SEARCH_HIT_ID, CACHED_ID, 'fffffffffff'])
  })

  it('an empty query does not run yt-dlp', async () => {
    expect(await searchYoutube({ ffmpeg: 'ffmpeg', ytdlp: '/nonexistent' }, '   ')).toEqual([])
  })

  it('reports yt-dlp’s error', async () => {
    await expect(searchYoutube(tools(), 'rompe')).rejects.toThrow('Unable to download API page')
  })
})

const song = (
  id: string,
  extra: Partial<{ file: string | null; playCount: number; addedAt: number; lastPlayedAt: number }> = {}
) => ({
  id,
  title: `Song ${id}`,
  artists: 'Someone',
  file: `${id}.m4a`,
  playCount: 0,
  addedAt: 0,
  ...extra
})
const hit = (id: string): SearchResult => ({ id, title: id, artists: '', durationSec: null, coverUrl: '' })

describe('pickSeeds', () => {
  it('only songs with audio, never the same one twice', () => {
    const songs = [song('a'), song('b', { file: null }), song('c'), song('d')]
    const seeds = pickSeeds(songs, 3).map((s) => s.id)
    expect(seeds.sort()).toEqual(['a', 'c', 'd'])
  })

  it('picks among the most played first, then the recently played, then the newest (top 40)', () => {
    const songs = Array.from({ length: 60 }, (_, i) => song(`s${i}`, { addedAt: i }))
    songs[0].playCount = 99 // oldest but most played
    Object.assign(songs[1], { lastPlayedAt: 5 }) // old, but played recently
    // rand() = 0 takes the head of the ranking, ~1 the tail.
    expect(pickSeeds(songs, 2, () => 0).map((s) => s.id)).toEqual(['s0', 's1'])
    expect(pickSeeds(songs, 1, () => 0.9999)[0].id).toBe('s22') // 40th: s0, s1, then s59…s22
  })

  it('an empty library gives no seeds', () => {
    expect(pickSeeds([], 3)).toEqual([])
  })
})

describe('mergeMixes', () => {
  it('takes turns between mixes, skipping known and repeated songs, up to the limit', () => {
    const r = mergeMixes(
      [[hit('a1'), hit('dup'), hit('a3')], [hit('b1'), hit('known'), hit('dup'), hit('b4')]],
      new Set(['known']),
      5
    )
    expect(r.map((x) => x.id)).toEqual(['a1', 'b1', 'dup', 'a3', 'b4'])
    expect(mergeMixes([[hit('a'), hit('b'), hit('c')]], new Set(), 2).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('skips what the isKnown check rejects', () => {
    const r = mergeMixes([[hit('a'), hit('b')]], new Set(), 5, (x) => x.id === 'a')
    expect(r.map((x) => x.id)).toEqual(['b'])
  })
})

describe('inLibraryByName', () => {
  const lib = [
    { title: 'Radiohead - Karma Police - Arabic subtitles/مترجمة عربي', artists: 'Radiohead' },
    { title: 'Corazón Espinado', artists: 'Santana, Maná' },
    { title: 'Hurt', artists: 'Johnny Cash' }
  ]
  it('the same song under another video counts as known (messy titles, accents)', () => {
    expect(inLibraryByName({ title: 'Karma Police', artists: 'Radiohead' }, lib)).toBe(true)
    expect(inLibraryByName({ title: 'Corazon Espinado', artists: 'Santana ft. Mana' }, lib)).toBe(true)
  })
  it('same title by another artist is new; titles match on whole words only', () => {
    expect(inLibraryByName({ title: 'Hurt', artists: 'Nine Inch Nails' }, lib)).toBe(false)
    expect(inLibraryByName({ title: 'Kar', artists: 'Radiohead' }, lib)).toBe(false)
  })
})

describe('shortTitle', () => {
  it('drops the artist prefix, tags and trailing extras', () => {
    expect(shortTitle('Radiohead - Karma Police - Arabic subtitles/مترجمة عربي', 'Radiohead')).toBe('Karma Police')
    expect(shortTitle('Corazón Espinado (Official Video)', 'Santana')).toBe('Corazón Espinado')
    expect(shortTitle('Stylo', 'Gorillaz')).toBe('Stylo')
  })
})

describe('mixArgs', () => {
  it('asks for the first items of the video’s mix and rejects non-ids', () => {
    expect(mixArgs('n6P0SitRwy8', 25).slice(-4)).toEqual([
      '--playlist-items',
      '1:25',
      '--',
      'https://www.youtube.com/watch?v=n6P0SitRwy8&list=RDn6P0SitRwy8'
    ])
    expect(() => mixArgs('x&list=1')).toThrow()
  })
})

describe('recommend (fake yt-dlp)', () => {
  let root: string
  let ytdlp: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'vibes-rec-'))
    makeAudio(join(root, 'a.m4a'))
    ytdlp = makeFakeYtdlp(root, join(root, 'a.m4a'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('recommends what the mixes have and the library doesn’t, without repeats', async () => {
    const library = [song(CACHED_ID), song('sssssssssss')]
    const r = await recommend({ ffmpeg: 'ffmpeg', ytdlp }, library)
    expect(r.basedOn.sort()).toEqual([`Song ${CACHED_ID}`, 'Song sssssssssss'].sort())
    expect(r.results.map((x) => x.id)).toEqual(MIX_IDS)
    expect(r.results[0]).toMatchObject({ title: 'Afuera', artists: 'Caifanes', durationSec: 251 })
  })

  it('an empty library has nothing to base it on', async () => {
    expect(await recommend({ ffmpeg: 'ffmpeg', ytdlp: '/nonexistent' }, [])).toEqual({ basedOn: [], results: [] })
  })

  it('fails with a clear message only if every mix fails', async () => {
    await expect(recommend({ ffmpeg: 'ffmpeg', ytdlp: '/nonexistent' }, [song('aaaaaaaaaaa')])).rejects.toThrow(
      'No se pudieron cargar las recomendaciones'
    )
  })
})

describe('streaming (fake yt-dlp)', () => {
  let root: string
  let ytdlp: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'vibes-stream-'))
    makeAudio(join(root, 'a.m4a'))
    ytdlp = makeFakeYtdlp(root, join(root, 'a.m4a'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('streamArgs asks for the audio URL of exactly that video', () => {
    expect(streamArgs('n6P0SitRwy8')).toContain('-g')
    expect(streamArgs('n6P0SitRwy8').slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=n6P0SitRwy8'])
    expect(() => streamArgs('--exec=x')).toThrow()
  })

  it('resolves the stream URL and reuses it for an hour', async () => {
    let t = 0
    let calls = 0
    const counting = { ffmpeg: 'ffmpeg', ytdlp: join(root, 'counting-ytdlp') }
    writeFileSync(counting.ytdlp, `#!/bin/sh\necho call >> "${join(root, 'calls')}"\nexec "${ytdlp}" "$@"\n`)
    chmodSync(counting.ytdlp, 0o755)
    const resolve = streamResolver(counting, () => t)
    expect(await resolve('aaaaaaaaaaa')).toBe('https://stream.test/aaaaaaaaaaa.m4a')
    await resolve('aaaaaaaaaaa')
    calls = readFileSync(join(root, 'calls'), 'utf-8').trim().split('\n').length
    expect(calls).toBe(1)
    t = 3600_001
    await resolve('aaaaaaaaaaa')
    expect(readFileSync(join(root, 'calls'), 'utf-8').trim().split('\n')).toHaveLength(2)
  })

  it('a failure is reported and retried next time (not cached)', async () => {
    const resolve = streamResolver({ ffmpeg: 'ffmpeg', ytdlp })
    await expect(resolve('fffffffffff')).rejects.toThrow('Video unavailable')
    await expect(resolve('fffffffffff')).rejects.toThrow('Video unavailable')
  })

  it('radioFor: the song’s mix without the song itself or what the library has', async () => {
    const r = await radioFor({ ffmpeg: 'ffmpeg', ytdlp }, 'sssssssssss', [
      { id: CACHED_ID, title: 'Stylo', artists: 'Gorillaz' },
      { id: 'xxxxxxxxxxx', title: 'De la noche a la mañana (Remastered)', artists: 'Elefante' }
    ])
    expect(r.map((x) => x.id)).toEqual([MIX_IDS[0]]) // Elefante's is known by name
  })
})

describe('pickYoutubeMatch (songs found on Deezer)', () => {
  const r = (id: string, title: string, artists: string, durationSec: number | null): SearchResult => ({
    id,
    title,
    artists,
    durationSec,
    coverUrl: ''
  })
  const want = { title: 'Feel Good Inc.', artists: 'Gorillaz', durationSec: 222 }

  it('the artist upload with the same title and duration', async () => {
    const { pickYoutubeMatch } = await import('../youtube')
    expect(
      pickYoutubeMatch(
        [
          r('live0000000', 'Feel Good Inc. (Live)', 'Gorillaz', 230),
          r('cover000000', 'Feel Good Inc.', 'Some Cover Band', 222),
          r('long0000000', 'Feel Good Inc.', 'Gorillaz', 300), // the long music video
          r('good0000000', 'Feel Good Inc.', 'Gorillaz', 224)
        ],
        want
      )?.id
    ).toBe('good0000000')
  })

  it('nothing when no result is really that song', async () => {
    const { pickYoutubeMatch } = await import('../youtube')
    expect(pickYoutubeMatch([r('other000000', 'Clint Eastwood', 'Gorillaz', 222)], want)).toBeNull()
    expect(pickYoutubeMatch([r('karaoke0000', 'Feel Good Inc. (Karaoke)', 'Gorillaz', 222)], want)).toBeNull()
  })

  it('a remix is fine when the remix is what was asked for; unknown duration is accepted', async () => {
    const { pickYoutubeMatch } = await import('../youtube')
    const rm = { title: 'Feel Good Inc. (Remix)', artists: 'Gorillaz', durationSec: 200 }
    expect(pickYoutubeMatch([r('remix000000', 'Feel Good Inc. Remix', 'Gorillaz', null)], rm)?.id).toBe('remix000000')
  })
})
