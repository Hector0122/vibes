import { describe, expect, it } from 'vitest'
import { lookupDeezer, pickDeezerMatch, type DeezerTrack } from '../metadata'

// Shaped like real api.deezer.com/search results (trimmed).
const track = (id: number, title: string, artist: [number, string], album: string, duration: number): DeezerTrack => ({
  id,
  title,
  title_short: title.replace(/\s*\(.*\)$/, ''),
  duration,
  artist: { id: artist[0], name: artist[1] },
  album: { title: album, cover_xl: `https://cdn-images.dzcdn.net/images/cover/${id}/1000x1000.jpg` }
})

const PSYCHO = [
  track(417329482, 'Psychosocial', [117, 'Slipknot'], 'Day Of The Gusano (Live)', 276),
  track(599036032, 'Psychosocial', [117, 'Slipknot'], 'All Hope Is Gone (10th Anniversary)', 284),
  track(14609696, 'Psychosocial', [117, 'Slipknot'], 'All Hope Is Gone', 276)
]
const PESO = [
  track(3926892851, 'LAST BREATH (feat. Peso Pluma)', [230, 'Kanye West'], 'BULLY', 186),
  track(2855869562, 'SANTAL 33', [80365122, 'Peso Pluma'], 'ÉXODO', 190),
  track(3729422322, 'daño', [80365122, 'Peso Pluma'], 'DINASTÍA', 197)
]

describe('pickDeezerMatch', () => {
  it('takes the studio version with the closest duration', () => {
    expect(pickDeezerMatch(PSYCHO, 'Psychosocial', 'Slipknot', 277)).toEqual({
      coverUrl: 'https://cdn-images.dzcdn.net/images/cover/14609696/1000x1000.jpg',
      album: 'All Hope Is Gone',
      deezerId: '14609696',
      deezerArtistId: '117'
    })
  })

  it('needs the artist to match: a feat. on someone else’s song is not it', () => {
    expect(pickDeezerMatch(PESO, 'daño', 'Peso Pluma & Tito Double P', 197)?.deezerId).toBe('3729422322')
    expect(pickDeezerMatch(PESO, 'LAST BREATH', 'Peso Pluma', 186)).toBeNull()
  })

  it('ignores accents and case', () => {
    expect(pickDeezerMatch(PESO, 'DAÑO', 'peso pluma', null)?.album).toBe('DINASTÍA')
  })

  it('a different song by the same artist is not a match', () => {
    expect(pickDeezerMatch(PESO, 'Ella Baila Sola', 'Peso Pluma', null)).toBeNull()
  })

  it('rejects a match whose length is way off (another version/edit)', () => {
    expect(pickDeezerMatch(PSYCHO, 'Psychosocial', 'Slipknot', 600)).toBeNull()
  })
})

describe('lookupDeezer', () => {
  it('searches "artist title" and returns the match', async () => {
    let asked = ''
    const fake = (async (url: string) => {
      asked = url
      return new Response(JSON.stringify({ data: PESO, total: 3 }))
    }) as unknown as typeof fetch
    const r = await lookupDeezer('daño', 'Peso Pluma & Tito Double P', 197, fake, 'https://dz.test')
    expect(decodeURIComponent(asked)).toBe('https://dz.test/search?limit=10&q=Peso Pluma daño')
    expect(r?.album).toBe('DINASTÍA')
  })

  it('an HTTP error is "no match", not a crash', async () => {
    const fake = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch
    expect(await lookupDeezer('x', 'y', null, fake, 'https://dz.test')).toBeNull()
  })
})
