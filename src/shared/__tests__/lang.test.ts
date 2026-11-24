import { describe, expect, it } from 'vitest'
import { fillByArtist, guessLang, keepLang, songLang } from '../lang'

describe('guessLang', () => {
  it('lyrics in Spanish or English', () => {
    expect(guessLang('Yo no sé qué me pasa cuando estoy contigo, eres todo lo que quiero')).toBe('es')
    expect(guessLang("I don't know what you want, baby, but it's all for you")).toBe('en')
    expect(guessLang('¿Quién?')).toBe('es')
  })
  it("says nothing when it can't tell", () => {
    expect(guessLang('Creep')).toBeNull()
    expect(guessLang('')).toBeNull()
    expect(guessLang(null)).toBeNull()
    expect(guessLang('la the')).toBeNull() // a tie
  })
  it('a title says nothing about its language in brackets', () => {
    expect(songLang(null, 'Jigsaw Falling Into Place (Letra en Español / Inglés)')).toBeNull()
    expect(songLang('you and me, all the night', 'Nude (Letra en Español)')).toBe('en')
  })
})

describe('fillByArtist', () => {
  const s = (id: string, artists: string) => ({ id, artists })
  it("an unknown song takes its artist's language", () => {
    const songs = [s('1', 'Caifanes'), s('2', 'Caifanes'), s('3', 'Caifanes'), s('4', 'Radiohead'), s('5', 'Nadie')]
    const out = fillByArtist(songs, new Map([['1', 'es'], ['2', 'es'], ['4', 'en']]))
    expect(Object.fromEntries(out)).toEqual({ 1: 'es', 2: 'es', 3: 'es', 4: 'en' })
  })
  it('a tie decides nothing; featured artists go by the main one', () => {
    const songs = [s('1', 'A'), s('2', 'A'), s('3', 'A'), s('4', 'B feat. A')]
    expect(fillByArtist(songs, new Map([['1', 'es'], ['2', 'en']])).has('3')).toBe(false)
    expect(fillByArtist([s('1', 'B'), s('2', 'B, C')], new Map([['1', 'en']])).get('2')).toBe('en')
  })
})

describe('keepLang (radio)', () => {
  const lib = [{ id: 'l1', artists: 'Soda Stereo', lang: 'es' as const }, { id: 'l2', artists: 'Muse', lang: 'en' as const }]
  const t = (id: string, title: string, artists: string) => ({ id, title, artists })
  it("drops tracks known to be in the other language, keeps the ones nothing says about", () => {
    const tracks = [t('a', 'Persiana Americana', 'Soda Stereo'), t('b', 'Uprising', 'Muse'), t('c', 'Sin documentos', 'Los Rodríguez'), t('d', "Don't Stop", 'X'), t('e', 'Zombie', 'Y')]
    expect(keepLang(tracks, lib, 'es').map((x) => x.id)).toEqual(['a', 'c', 'e'])
    expect(keepLang(tracks, lib, 'en').map((x) => x.id)).toEqual(['b', 'd', 'e'])
  })
})
