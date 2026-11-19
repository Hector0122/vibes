// The desktop library: <userData>/library.json (song list) + <userData>/audio/
// (one {id}.m4a per song). Kept in memory; every change is written back
// atomically, one write at a time.
import { readFile, rename, writeFile } from 'fs/promises'
import type { SongMeta } from '../shared/api'
import type { LocalSong } from '../shared/types'

/** A song as an importer sees it, before it has local state. */
export interface IncomingSong extends SongMeta {
  id: string
  saved: boolean
  playCount: number
}

export class Library {
  private songs = new Map<string, LocalSong>()
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf-8')) as { songs: LocalSong[] }
      this.songs = new Map(raw.songs.map((s) => [s.id, s]))
    } catch (err) {
      // A missing file is a fresh install; anything else (corrupt JSON) must
      // not be silently overwritten with an empty library.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  list(): LocalSong[] {
    return [...this.songs.values()].sort((a, b) => b.addedAt - a.addedAt)
  }

  get(id: string): LocalSong | undefined {
    return this.songs.get(id)
  }

  /** Adds new songs and refreshes metadata of known ones; local file/cloud state is kept. */
  async merge(incoming: IncomingSong[], now = Date.now()): Promise<{ added: number; updated: number }> {
    let added = 0
    let updated = 0
    for (const s of incoming) {
      const prev = this.songs.get(s.id)
      if (prev) {
        updated++
        this.songs.set(s.id, {
          ...prev,
          ...s,
          saved: prev.saved || s.saved,
          playCount: Math.max(prev.playCount, s.playCount)
        })
      } else {
        added++
        this.songs.set(s.id, { ...s, addedAt: now, file: null, uploaded: false, error: null })
      }
    }
    await this.save()
    return { added, updated }
  }

  async update(id: string, patch: Partial<Omit<LocalSong, 'id'>>): Promise<LocalSong> {
    const prev = this.songs.get(id)
    if (!prev) throw new Error(`Unknown song ${id}`)
    const next = { ...prev, ...patch }
    this.songs.set(id, next)
    await this.save()
    return next
  }

  private save(): Promise<void> {
    const data = JSON.stringify({ songs: [...this.songs.values()] })
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
