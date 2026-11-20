// The user's playlists: <userData>/playlists.json. A playlist is an ordered
// list of library song ids; the songs themselves live in the library.
// Kept in memory; every change is written back atomically, one write at a time.
import { randomBytes } from 'crypto'
import { readFile, rename, writeFile } from 'fs/promises'
import type { Playlist } from '../shared/types'

const MAX_NAME = 100

function cleanName(name: unknown): string {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!n) throw new Error('La playlist necesita un nombre')
  return n.slice(0, MAX_NAME)
}

export class Playlists {
  private items: Playlist[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf-8')) as { playlists: Playlist[] }
      this.items = raw.playlists
    } catch (err) {
      // Missing = none yet; corrupt JSON must not be silently replaced by an empty list.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  list(): Playlist[] {
    return this.items.map((p) => ({ ...p, songIds: [...p.songIds] }))
  }

  private get(id: string): Playlist {
    const p = this.items.find((x) => x.id === id)
    if (!p) throw new Error('Esa playlist ya no existe')
    return p
  }

  async create(name: string, now = Date.now()): Promise<Playlist> {
    const p: Playlist = { id: randomBytes(6).toString('hex'), name: cleanName(name), songIds: [], createdAt: now, updatedAt: now }
    this.items.push(p)
    await this.save()
    return { ...p }
  }

  async rename(id: string, name: string, now = Date.now()): Promise<Playlist> {
    const p = this.get(id)
    p.name = cleanName(name)
    p.updatedAt = now
    await this.save()
    return { ...p, songIds: [...p.songIds] }
  }

  async remove(id: string): Promise<void> {
    this.get(id)
    this.items = this.items.filter((p) => p.id !== id)
    await this.save()
  }

  /** Appends songs not already in it; returns how many were added. */
  async add(id: string, songIds: string[], now = Date.now()): Promise<number> {
    const p = this.get(id)
    const fresh = [...new Set(songIds.map(String))].filter((s) => !p.songIds.includes(s))
    if (fresh.length === 0) return 0
    p.songIds.push(...fresh)
    p.updatedAt = now
    await this.save()
    return fresh.length
  }

  async removeSong(id: string, songId: string, now = Date.now()): Promise<void> {
    const p = this.get(id)
    p.songIds = p.songIds.filter((s) => s !== songId)
    p.updatedAt = now
    await this.save()
  }

  /** Moves the song at `from` to position `to` (both clamped to the list). */
  async move(id: string, from: number, to: number, now = Date.now()): Promise<void> {
    const p = this.get(id)
    const n = p.songIds.length
    if (n < 2) return
    const f = Math.max(0, Math.min(n - 1, Math.trunc(from)))
    const t = Math.max(0, Math.min(n - 1, Math.trunc(to)))
    if (f === t) return
    const [song] = p.songIds.splice(f, 1)
    p.songIds.splice(t, 0, song)
    p.updatedAt = now
    await this.save()
  }

  private save(): Promise<void> {
    const data = JSON.stringify({ playlists: this.items })
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        const tmp = `${this.path}.${process.pid}.tmp`
        await writeFile(tmp, data, 'utf-8')
        await rename(tmp, this.path)
      })
    return this.writing
  }
}
