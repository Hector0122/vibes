import type { CloudSong } from '../../../src/shared/api'
import { groupArtists, letterOf, mainArtist } from '../screens/LibraryScreen'

const s = (artists: string, coverUrl: string | null = null): CloudSong =>
  ({ id: artists, title: 't', artists, coverUrl }) as CloudSong

it('index letters: accents dropped, numbers and symbols under #', () => {
  expect(['Ángel', 'éxito', 'zebra', '1999', '¿Qué?', ''].map(letterOf)).toEqual([
    'A',
    'E',
    'Z',
    '#',
    '#',
    '#'
  ])
})

it('songs are filed under their first artist', () => {
  expect(mainArtist(s('Bad Bunny, Jhay Cortez'))).toBe('Bad Bunny')
  expect(mainArtist(s('Calle 13 feat. Rubén Blades'))).toBe('Calle 13')
  expect(mainArtist(s('Jesse & Joy'))).toBe('Jesse & Joy')
  expect(mainArtist(s('Bad Bunny x Jhay Cortez'))).toBe('Bad Bunny')
  expect(mainArtist(s('Caifanes'))).toBe('Caifanes')
})

it('artists: most songs first, with the first cover found', () => {
  const g = groupArtists([s('B'), s('A', 'a1'), s('B, X', 'b1'), s('A')])
  expect(g).toEqual([
    { name: 'A', count: 2, cover: 'a1' },
    { name: 'B', count: 2, cover: 'b1' }
  ])
})
