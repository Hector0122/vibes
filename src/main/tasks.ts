// The three library jobs behind the toolbar buttons. Free of Electron so the
// tests drive them directly; index.ts wires them to IPC.
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { pickMeta } from '../shared/api'
import type { ImportResult, LocalSong, TaskProgress } from '../shared/types'
import type { CloudClient } from './cloud/client'
import { readEsoundLibrary } from './esound'
import type { Library } from './library'
import { downloadAudio, eachLimit, remuxToM4a, type Tools } from './media'

export interface TaskContext {
  library: Library
  audioDir: string
  tools: Tools
  onSong?: (song: LocalSong) => void
  onProgress?: (p: TaskProgress) => void
}

const hasAudio = (ctx: TaskContext, s: LocalSong): boolean =>
  !!s.file && existsSync(join(ctx.audioDir, s.file))

async function setSong(ctx: TaskContext, id: string, patch: Partial<LocalSong>): Promise<void> {
  // Not `onSong?.(await update())`: optional call would skip the update itself.
  const song = await ctx.library.update(id, patch)
  ctx.onSong?.(song)
}

/** Imports eSound's songs and copies the audio it already cached. */
export async function importEsound(ctx: TaskContext, esoundDir: string): Promise<ImportResult> {
  const songs = await readEsoundLibrary(esoundDir)
  const { added, updated } = await ctx.library.merge(
    songs.map(({ cachedAudio: _cached, ...s }) => s)
  )
  const toCopy = songs.filter((s) => s.cachedAudio && !hasAudio(ctx, ctx.library.get(s.id)!))
  const progress: TaskProgress = { task: 'import', done: 0, total: toCopy.length, failed: 0 }
  await eachLimit(toCopy, 4, async (s) => {
    try {
      await remuxToM4a(ctx.tools, s.cachedAudio!, join(ctx.audioDir, `${s.id}.m4a`))
      await setSong(ctx, s.id, { file: `${s.id}.m4a`, uploaded: false, error: null })
    } catch (err) {
      progress.failed++
      await setSong(ctx, s.id, { error: (err as Error).message })
    }
    progress.done++
    ctx.onProgress?.({ ...progress })
  })
  const missing = ctx.library.list().filter((s) => !hasAudio(ctx, s)).length
  return { added, updated, copied: toCopy.length - progress.failed, missing }
}

/** Downloads every song that has no local audio yet. */
export async function downloadMissing(ctx: TaskContext): Promise<TaskProgress> {
  const todo = ctx.library.list().filter((s) => !hasAudio(ctx, s))
  const progress: TaskProgress = { task: 'download', done: 0, total: todo.length, failed: 0 }
  await eachLimit(todo, 3, async (s) => {
    try {
      await downloadAudio(ctx.tools, s.id, ctx.audioDir)
      await setSong(ctx, s.id, { file: `${s.id}.m4a`, uploaded: false, error: null })
    } catch (err) {
      progress.failed++
      await setSong(ctx, s.id, { error: (err as Error).message })
    }
    progress.done++
    ctx.onProgress?.({ ...progress })
  })
  return progress
}

/** Uploads every local song that isn't in the cloud yet. */
export async function uploadAll(ctx: TaskContext, client: CloudClient): Promise<TaskProgress> {
  const todo = ctx.library.list().filter((s) => !s.uploaded && hasAudio(ctx, s))
  const progress: TaskProgress = { task: 'upload', done: 0, total: todo.length, failed: 0 }
  await eachLimit(todo, 3, async (s) => {
    try {
      const data = await readFile(join(ctx.audioDir, s.file!))
      const sha256 = createHash('sha256').update(data).digest('hex')
      const { url } = await client.beginUpload(s.id, { meta: pickMeta(s), size: data.length, sha256 })
      if (url) await client.putFile(url, data)
      await client.commit(s.id)
      await setSong(ctx, s.id, { uploaded: true, error: null })
    } catch (err) {
      progress.failed++
      await setSong(ctx, s.id, { error: (err as Error).message })
    }
    progress.done++
    ctx.onProgress?.({ ...progress })
  })
  return progress
}
