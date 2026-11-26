// LibriVox audiobooks (public domain, read by volunteers), found and fetched through
// archive.org, where they live: its search finds any word (LibriVox's own API only
// matches titles from the start), and each item lists its MP3s, one per chapter.
// A chosen book goes chapter by chapter: download to the phone, up to the cloud as a
// chapter (books.ts), delete the copy.
import { File, Paths } from 'expo-file-system'
import type { CloudSong } from '../../src/shared/api'
import { uploadChapter, type UploadProgress } from './books'
import type { Cloud } from './cloud'

const ARCHIVE = 'https://archive.org'

export interface LvHit {
  id: string
  title: string
  author: string
  /** "21:10:20", as archive.org gives it. */
  runtime: string | null
}

export interface LvChapter {
  url: string
  title: string
  durationSec: number | null
  size: number
}

export interface LvBook {
  id: string
  title: string
  author: string
  cover: string | null
  chapters: LvChapter[]
}

type Fetch = typeof fetch

const first = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''))

/** Books in Spanish (or `lang`, archive.org's 3-letter code) matching `query`, most downloaded first. */
export async function searchBooks(query: string, lang = 'spa', get: Fetch = fetch): Promise<LvHit[]> {
  const words = query.trim().replace(/[()":]/g, ' ')
  if (!words) return []
  const q = `collection:librivoxaudio AND language:${lang} AND (${words})`
  const params = ['identifier', 'title', 'creator', 'runtime'].map((f) => `fl[]=${f}`).join('&')
  const res = await get(
    `${ARCHIVE}/advancedsearch.php?q=${encodeURIComponent(q)}&${params}&sort[]=downloads+desc&rows=30&output=json`
  )
  if (!res.ok) throw new Error(`No se pudo buscar en LibriVox (${res.status})`)
  const body = (await res.json()) as { response?: { docs?: Record<string, unknown>[] } }
  return (body.response?.docs ?? []).map((d) => ({
    id: first(d.identifier),
    title: first(d.title),
    author: first(d.creator),
    runtime: d.runtime ? first(d.runtime) : null
  }))
}

/** "27:50" / "1:02:03" / "420.53" → seconds; null when it can't be read. */
export function parseLength(s: string | undefined): number | null {
  if (!s) return null
  const parts = s.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  return Math.round(parts.reduce((t, n) => t * 60 + n, 0))
}

/** "01: Tasa & El Rey" → "Tasa & El Rey". */
export const cleanTitle = (s: string): string => s.replace(/^\s*\d+[a-z]?\s*[:.-]\s*/i, '').trim()

interface ArchiveFile {
  name: string
  format?: string
  title?: string
  length?: string
  size?: string
}

/** An archive.org item's metadata → the book, chapters in file-name order ("18a" before "18b", "2" before "10"). */
export function parseBook(meta: {
  metadata: Record<string, unknown>
  files: ArchiveFile[]
}): LvBook {
  const id = first(meta.metadata.identifier)
  const url = (name: string): string => `${ARCHIVE}/download/${id}/${encodeURIComponent(name)}`
  const chapters = meta.files
    .filter((f) => f.format === '64Kbps MP3')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map((f) => ({
      url: url(f.name),
      title: cleanTitle(f.title ?? '') || f.name.replace(/\.mp3$/i, ''),
      durationSec: parseLength(f.length),
      size: Number(f.size) || 0
    }))
  // The full-size picture, else the thumbnail.
  const pic =
    meta.files.find((f) => f.format === 'JPEG' && !/_thumb\.jpg$/i.test(f.name)) ??
    meta.files.find((f) => f.format === 'JPEG Thumb' || f.format === 'Item Tile')
  return {
    id,
    title: first(meta.metadata.title),
    author: first(meta.metadata.creator),
    cover: pic ? url(pic.name) : null,
    chapters
  }
}

export async function loadBook(id: string, get: Fetch = fetch): Promise<LvBook> {
  const res = await get(`${ARCHIVE}/metadata/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`No se pudo abrir el libro (${res.status})`)
  const book = parseBook(await res.json())
  if (book.chapters.length === 0) throw new Error('Este libro no tiene capítulos en MP3')
  return book
}

/** "≈ 610 MB" / "≈ 1.2 GB". */
export function bookSize(book: LvBook): string {
  const mb = book.chapters.reduce((t, c) => t + c.size, 0) / 1e6
  return mb >= 1000 ? `≈ ${(mb / 1000).toFixed(1)} GB` : `≈ ${Math.max(1, Math.round(mb))} MB`
}

/**
 * Brings `book` into the cloud as `name`. Chapter numbers follow LibriVox's order, so a
 * cut-short import picks up where it stopped: chapters `have` already holds are skipped.
 */
export async function importBook(
  cloud: Cloud,
  book: LvBook,
  name: string,
  have: CloudSong[],
  onProgress: (p: UploadProgress) => void
): Promise<void> {
  const done = new Set(have.map((c) => c.chapter))
  let coverUrl = have.find((c) => c.coverUrl)?.coverUrl ?? null
  if (!coverUrl && book.cover) {
    try {
      const tmp = await File.downloadFileAsync(book.cover, new File(Paths.cache, 'librivox-cover.jpg'), {
        idempotent: true
      })
      coverUrl = await cloud.uploadCover(await tmp.bytes(), 'image/jpeg')
      tmp.delete()
    } catch {
      // no cover: the book still comes in
    }
  }
  const total = book.chapters.length
  for (const [i, ch] of book.chapters.entries()) {
    const chapter = i + 1
    if (done.has(chapter)) continue
    onProgress({ file: chapter, total, step: 'download', fraction: 0 })
    const tmp = new File(Paths.cache, `librivox-${chapter}.mp3`)
    await File.downloadFileAsync(ch.url, tmp, { idempotent: true })
    try {
      await uploadChapter(
        cloud,
        tmp,
        { title: ch.title, durationSec: ch.durationSec, book: name, chapter, coverUrl },
        (step, fraction) => onProgress({ file: chapter, total, step, fraction })
      )
    } finally {
      tmp.delete()
    }
  }
}
