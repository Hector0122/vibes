// Audiobooks: uploaded from the phone, one cloud "song" per chapter, marked with the
// book's name and chapter number (src/shared/api.ts). They live apart from the music.
import { File, UploadType } from 'expo-file-system'
import type { CloudSong } from '../../src/shared/api'
import type { Cloud } from './cloud'
import { sha256File } from './sha256'

export interface BookGroup {
  name: string
  count: number
  cover: string | null
}

export const isBook = (s: CloudSong): boolean => !!s.book

/** The books in `songs`, by name. */
export function groupBooks(songs: CloudSong[]): BookGroup[] {
  const by = new Map<string, BookGroup>()
  for (const s of songs) {
    if (!s.book) continue
    const g = by.get(s.book) ?? { name: s.book, count: 0, cover: s.coverUrl }
    g.count++
    by.set(s.book, g)
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** A book's chapters, in order. */
export const chaptersOf = (songs: CloudSong[], book: string): CloudSong[] =>
  songs.filter((s) => s.book === book).sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0))

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
/** 11 characters, like the songs' YouTube ids (the cloud only takes that shape). */
export const newId = (): string =>
  Array.from({ length: 11 }, () => ID_CHARS[Math.floor(Math.random() * 64)]).join('')

/** "03 - El inicio.mp3" → "03 - El inicio". */
export const chapterTitle = (fileName: string): string =>
  fileName.replace(/\.[^.]+$/, '').trim() || 'Capítulo'

/** A book's name guessed from its first file: "Dune - 01.mp3" → "Dune". */
export const guessBookName = (fileName: string): string =>
  chapterTitle(fileName)
    .replace(/[\s._-]*(cap[ií]tulo|chapter|parte|part)?[\s._-]*\d+$/i, '')
    .replace(/^\d+[\s._-]+/, '')
    .trim() || chapterTitle(fileName)

const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** Uploads the picked image and sets it as the cover of every chapter (metadata only: the audio stays). */
export async function setBookCover(cloud: Cloud, picked: PickedFile, chapters: CloudSong[]): Promise<void> {
  const file = new File(picked.uri)
  const type = file.type || IMAGE_TYPES[picked.name.split('.').pop()?.toLowerCase() ?? '']
  if (!type || !Object.values(IMAGE_TYPES).includes(type)) throw new Error('La portada debe ser JPG, PNG o WebP')
  const coverUrl = await cloud.uploadCover(await file.bytes(), type)
  for (const { id, size, sha256, updatedAt: _, ...meta } of chapters) {
    await cloud.beginUpload(id, { meta: { ...meta, coverUrl }, size, sha256 })
  }
}

export interface PickedFile {
  uri: string
  name: string
}

export interface UploadProgress {
  /** Chapter being uploaded (1-based) of `total`. */
  file: number
  total: number
  step: 'hash' | 'upload'
  /** 0–1 within this file. */
  fraction: number
}

/**
 * Uploads the files as chapters of `book`, after the `existing` ones, in file-name order
 * ("2" before "10"). Each file goes straight to storage, then the cloud lists it.
 */
export async function uploadBook(
  cloud: Cloud,
  files: PickedFile[],
  book: string,
  existing: number,
  onProgress: (p: UploadProgress) => void,
  /** The book's cover, when it has one: new chapters keep it. */
  coverUrl: string | null = null
): Promise<void> {
  const sorted = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
  for (const [i, picked] of sorted.entries()) {
    const file = new File(picked.uri)
    const size = file.size
    const report = (step: UploadProgress['step'], fraction: number): void =>
      onProgress({ file: i + 1, total: sorted.length, step, fraction })
    const sha256 = await sha256File(file, (done) => report('hash', size ? done / size : 1))
    const id = newId()
    const { url } = await cloud.beginUpload(id, {
      meta: {
        title: chapterTitle(picked.name),
        artists: book,
        album: book,
        deezerId: null,
        deezerArtistId: null,
        isrc: null,
        durationSec: null,
        coverUrl,
        book,
        chapter: existing + i + 1
      },
      size,
      sha256
    })
    if (url) {
      const task = file.createUploadTask(url, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT
      })
      const sub = task.addListener('progress', (p) =>
        report('upload', p.totalBytes ? p.bytesSent / p.totalBytes : 0)
      )
      try {
        const res = await task.uploadAsync()
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`No se pudo subir "${picked.name}" (${res.status})`)
        }
      } finally {
        sub.remove()
      }
    }
    await cloud.commit(id)
  }
}
