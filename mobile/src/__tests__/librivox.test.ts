// LibriVox via archive.org: reading its answers (a real one, saved in fixtures/), and
// bringing a book into the cloud chapter by chapter.
import type { CloudSong } from '../../../src/shared/api'
import type { Cloud } from '../cloud'
import { bookSize, cleanTitle, importBook, parseBook, parseLength, searchBooks, type LvBook } from '../librivox'
import quijote from './fixtures/archive-quijote.json'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('expo-file-system') as typeof import('../../__mocks__/expo-file-system')

beforeEach(() => fs.mockFsReset())

it('reads lengths and chapter titles the way archive.org writes them', () => {
  expect(parseLength('27:50')).toBe(1670)
  expect(parseLength('1:02:03')).toBe(3723)
  expect(parseLength('420.53')).toBe(421)
  expect(parseLength(undefined)).toBeNull()
  expect(parseLength('n/a')).toBeNull()
  expect(cleanTitle('01: Tasa & El Rey')).toBe('Tasa & El Rey')
  expect(cleanTitle('18b - Capítulo XVIII')).toBe('Capítulo XVIII')
  expect(cleanTitle('Capitulo I')).toBe('Capitulo I')
})

it('Don Quijote vol. 1: only the 64 kbps MP3s, in file order (split chapters 18a, 18b, 18c stay together), with its cover', () => {
  const b = parseBook(quijote)
  expect(b.title).toBe('Don Quijote, Volume 1')
  expect(b.author).toBe('Miguel de Cervantes Saavedra')
  expect(b.chapters).toHaveLength(37)
  expect(b.chapters[0]).toEqual({
    url: 'https://archive.org/download/don_quijote_vol1_0706_librivox/quijote_vol1_01_cervantes_64kb.mp3',
    title: 'Tasa & El Rey',
    durationSec: 420,
    size: 3363026
  })
  const names = b.chapters.map((c) => c.url.split('/').pop())
  const i = names.indexOf('quijote_vol1_18a_cervantes_64kb.mp3')
  expect(names.slice(i, i + 4)).toEqual([
    'quijote_vol1_18a_cervantes_64kb.mp3',
    'quijote_vol1_18b_cervantes_64kb.mp3',
    'quijote_vol1_18c_cervantes_64kb.mp3',
    'quijote_vol1_19_cervantes_64kb.mp3'
  ])
  expect(b.cover).toBe('https://archive.org/download/don_quijote_vol1_0706_librivox/Don_Quijote_Vol1_1109.jpg')
  expect(bookSize(b)).toMatch(/^≈ \d+ MB$/)
})

it('search asks archive.org for LibriVox books in Spanish and reads its answer', async () => {
  const urls: string[] = []
  const get = (async (url: string) => {
    urls.push(url)
    return {
      ok: true,
      json: async () => ({
        response: {
          docs: [
            {
              identifier: 'don_quijote_vol1_0706_librivox',
              title: 'Don Quijote, Volume 1',
              creator: ['Miguel de Cervantes Saavedra', 'otro'],
              runtime: '21:10:20'
            }
          ]
        }
      })
    }
  }) as unknown as typeof fetch
  expect(await searchBooks('quijote', 'spa', get)).toEqual([
    {
      id: 'don_quijote_vol1_0706_librivox',
      title: 'Don Quijote, Volume 1',
      author: 'Miguel de Cervantes Saavedra',
      runtime: '21:10:20'
    }
  ])
  expect(decodeURIComponent(urls[0])).toContain('collection:librivoxaudio AND language:spa AND (quijote)')
  expect(await searchBooks('   ', 'spa', get)).toEqual([])
  expect(urls).toHaveLength(1) // nothing typed: no request
})

describe('importBook', () => {
  const book: LvBook = {
    id: 'x',
    title: 'Libro',
    author: 'A',
    cover: 'https://archive.org/download/x/cover.jpg',
    chapters: [1, 2, 3].map((n) => ({
      url: `https://archive.org/download/x/c${n}.mp3`,
      title: `Capítulo ${n}`,
      durationSec: 60 * n,
      size: 10
    }))
  }
  const fakeCloud = () => {
    const begun: { id: string; meta: Record<string, unknown> }[] = []
    const committed: string[] = []
    const cloud = {
      uploadCover: jest.fn(async () => 'https://cdn/cover.jpg'),
      beginUpload: jest.fn(async (id: string, req: { meta: Record<string, unknown> }) => {
        begun.push({ id, meta: req.meta })
        return { url: `https://r2/${id}` }
      }),
      commit: jest.fn(async (id: string) => {
        committed.push(id)
        return {} as CloudSong
      })
    }
    return { cloud: cloud as unknown as Cloud, begun, committed, raw: cloud }
  }

  it('each chapter is downloaded, uploaded with its title, number, length and the cover, then deleted from the phone', async () => {
    const { cloud, begun, committed } = fakeCloud()
    await importBook(cloud, book, 'Mi libro', [], () => {})
    expect(fs.mockDownloads.urls).toEqual([book.cover, ...book.chapters.map((c) => c.url)])
    expect(begun.map((b) => b.meta)).toEqual(
      [1, 2, 3].map((n) =>
        expect.objectContaining({
          title: `Capítulo ${n}`,
          book: 'Mi libro',
          artists: 'Mi libro',
          chapter: n,
          durationSec: 60 * n,
          coverUrl: 'https://cdn/cover.jpg'
        })
      )
    )
    expect(committed).toEqual(begun.map((b) => b.id))
    expect(fs.mockUploads.urls).toHaveLength(3)
    expect([...fs.mockDisk.keys()].filter((k) => k.startsWith('file:///cache/'))).toEqual([])
  })

  it('cut short: running it again only brings the missing chapters, with the cover it already has', async () => {
    const { cloud, begun, raw } = fakeCloud()
    const have = [{ chapter: 1, coverUrl: 'https://cdn/old.jpg' } as CloudSong]
    await importBook(cloud, book, 'Mi libro', have, () => {})
    expect(raw.uploadCover).not.toHaveBeenCalled()
    expect(begun.map((b) => b.meta.chapter)).toEqual([2, 3])
    expect(begun[0].meta.coverUrl).toBe('https://cdn/old.jpg')
  })

  it('a chapter that fails to download stops the import (the next try resumes there)', async () => {
    const { cloud, begun } = fakeCloud()
    fs.mockDownloads.hook = async (url) => {
      if (url.endsWith('c2.mp3')) throw new Error('red')
    }
    await expect(importBook(cloud, book, 'Mi libro', [], () => {})).rejects.toThrow('red')
    expect(begun.map((b) => b.meta.chapter)).toEqual([1])
  })
})
