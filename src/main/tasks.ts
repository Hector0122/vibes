// The library jobs behind the toolbar buttons and the search "Agregar". Free of Electron so the
// tests drive them directly; index.ts wires them to IPC.
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile, rm } from 'fs/promises'
import { join } from 'path'
import { pickMeta, validateMeta, YOUTUBE_ID_RE } from '../shared/api'
import { fillByArtist, songLang, type Lang } from '../shared/lang'
import type { ImportResult, LocalSong, SearchResult, TaskProgress } from '../shared/types'
import { CloudApiError, type CloudClient } from './cloud/client'
import { readEsoundLibrary } from './esound'
import type { Library } from './library'
import { downloadAudio, eachLimit, remuxToM4a, type Tools } from './media'
import type { Enrichment } from './metadata'

export interface TaskContext {
  library: Library
  audioDir: string
  tools: Tools
  onSong?: (song: LocalSong) => void
  onProgress?: (p: TaskProgress) => void
  /** Real cover/album for a YouTube song (Deezer); null when unknown. */
  enrich?: (title: string, artists: string, durationSec: number | null) => Promise<Enrichment | null>
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

/**
 * Each saved song's language: from its lyrics (once), else its title, else its
 * artist's other songs. A change goes up to the cloud so the phone's shuffle
 * keeps it too. `lyrics` throws when it can't tell (offline): tried next time.
 */
export async function detectLanguages(
  ctx: TaskContext,
  lyrics: (s: LocalSong) => Promise<string | null>,
  client: CloudClient | null
): Promise<number> {
  const songs = ctx.library.list().filter((s) => s.saved)
  const own = new Map<string, Lang>()
  for (const s of songs) {
    let l = s.lang
    if (l === undefined) {
      try {
        l = songLang(await lyrics(s), s.title)
      } catch {
        continue
      }
      await setSong(ctx, s.id, { lang: l })
    }
    if (l) own.set(s.id, l)
  }
  const all = fillByArtist(songs, own)
  let changed = 0
  for (const s of songs) {
    const now = ctx.library.get(s.id)!
    if (now.lang === undefined) continue // its lyrics couldn't be checked yet
    const l = all.get(s.id) ?? null
    if (now.lang !== l) await setSong(ctx, s.id, { lang: l })
    if (s.lang === l || !client || !now.uploaded || !hasAudio(ctx, now)) continue
    // Same audio: the cloud only updates the metadata. Failed: the old value, so it's retried.
    if (await uploadOne(ctx, client, ctx.library.get(s.id)!)) changed++
    else await setSong(ctx, s.id, { lang: s.lang })
  }
  return changed
}

/**
 * Deletes songs here (entry and audio file) and, with `client`, in the cloud
 * first: if the cloud fails nothing is lost here, and it can be tried again.
 */
export async function deleteSongs(ctx: TaskContext, ids: string[], client: CloudClient | null): Promise<string[]> {
  const gone: string[] = []
  for (const id of ids) {
    const s = ctx.library.get(id)
    if (!s) continue
    if (client) await client.deleteSong(id)
    if (s.file) await rm(join(ctx.audioDir, s.file), { force: true })
    await ctx.library.remove(id)
    gone.push(id)
  }
  return gone
}

/** Songs deleted on the phone: deleted here too, then cleared in the cloud. */
export async function applyCloudDeletions(ctx: TaskContext, client: CloudClient): Promise<string[]> {
  let deletions
  try {
    deletions = (await client.listDeletions()).deletions
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 404) return [] // an older Worker
    throw err
  }
  if (deletions.length === 0) return []
  const gone = await deleteSongs(
    ctx,
    deletions.map((d) => d.id),
    null
  )
  await client.ackDeletions(Math.max(...deletions.map((d) => d.seq)))
  return gone
}

/** Uploads every local song that isn't in the cloud yet. */
export async function uploadAll(ctx: TaskContext, client: CloudClient): Promise<TaskProgress> {
  const todo = ctx.library.list().filter((s) => !s.uploaded && hasAudio(ctx, s))
  const progress: TaskProgress = { task: 'upload', done: 0, total: todo.length, failed: 0 }
  await eachLimit(todo, 3, async (s) => {
    if (!(await uploadOne(ctx, client, s))) progress.failed++
    progress.done++
    ctx.onProgress?.({ ...progress })
  })
  return progress
}

/** Uploads one song's local audio; records the outcome on the song. True if it made it. */
async function uploadOne(ctx: TaskContext, client: CloudClient, s: LocalSong): Promise<boolean> {
  try {
    const data = await readFile(join(ctx.audioDir, s.file!))
    const sha256 = createHash('sha256').update(data).digest('hex')
    const { url } = await client.beginUpload(s.id, { meta: pickMeta(s), size: data.length, sha256 })
    if (url) await client.putFile(url, data)
    await client.commit(s.id)
    await setSong(ctx, s.id, { uploaded: true, error: null })
    return true
  } catch (err) {
    await setSong(ctx, s.id, { error: (err as Error).message })
    return false
  }
}

/**
 * Adds a YouTube search hit: into the library (saved), download, then up to
 * the cloud when one is set up. A song already on this machine is not
 * downloaded again. Throws only when the download fails (the song stays in
 * the library with the error, so "Descargar faltantes" can retry it); a
 * failed upload is recorded on the song and "Subir a la nube" retries it.
 */
export async function addFromSearch(
  ctx: TaskContext,
  r: SearchResult,
  client: CloudClient | null
): Promise<LocalSong> {
  if (typeof r?.id !== 'string' || !YOUTUBE_ID_RE.test(r.id)) throw new Error('Canción inválida')
  const meta = pickMeta({
    title: String(r.title ?? ''),
    artists: String(r.artists ?? ''),
    album: null,
    deezerId: typeof r.deezerId === 'string' && /^\d{1,20}$/.test(r.deezerId) ? r.deezerId : null,
    deezerArtistId: null,
    isrc: null,
    durationSec: typeof r.durationSec === 'number' ? r.durationSec : null,
    coverUrl: typeof r.coverUrl === 'string' ? r.coverUrl : null
  })
  const invalid = validateMeta(meta)
  if (invalid) throw new Error(invalid)

  const prev = ctx.library.get(r.id)
  if (prev) {
    // Known song (e.g. from eSound): keep its richer metadata, just mark it saved.
    if (!prev.saved) await setSong(ctx, r.id, { saved: true })
  } else {
    await ctx.library.merge([{ id: r.id, ...meta, saved: true, playCount: 0 }])
    ctx.onSong?.(ctx.library.get(r.id)!)
    await enrichSong(ctx, r.id)
  }

  if (!hasAudio(ctx, ctx.library.get(r.id)!)) {
    try {
      await downloadAudio(ctx.tools, r.id, ctx.audioDir)
      await setSong(ctx, r.id, { file: `${r.id}.m4a`, uploaded: false, error: null })
    } catch (err) {
      await setSong(ctx, r.id, { error: (err as Error).message })
      throw err
    }
  }
  const song = ctx.library.get(r.id)!
  if (client && !song.uploaded) await uploadOne(ctx, client, song)
  return ctx.library.get(r.id)!
}

/** Swaps a YouTube thumbnail for the real album cover (and album, Deezer ids). Never throws. */
export async function enrichSong(ctx: TaskContext, id: string): Promise<boolean> {
  const s = ctx.library.get(id)
  if (!ctx.enrich || !s || s.deezerId) return false
  try {
    const found = await ctx.enrich(s.title, s.artists, s.durationSec)
    if (!found) return false
    await setSong(ctx, id, { ...found, album: s.album ?? found.album })
    return true
  } catch {
    return false // offline or Deezer down: the YouTube thumbnail stays
  }
}

/** Songs added from YouTube before covers were looked up, a couple at a time. */
export async function enrichYoutubeSongs(ctx: TaskContext): Promise<number> {
  const todo = ctx.library.list().filter((s) => !s.deezerId && (!s.coverUrl || s.coverUrl.includes('ytimg.com')))
  let done = 0
  await eachLimit(todo, 2, async (s) => {
    if (await enrichSong(ctx, s.id)) done++
  })
  return done
}

/** One more play of this song (the player calls it once it has really been listened to). */
export async function recordPlay(ctx: TaskContext, id: string, now = Date.now()): Promise<void> {
  const s = ctx.library.get(id)
  if (!s) return // a preview of a song that isn't in the library
  await setSong(ctx, id, { playCount: s.playCount + 1, lastPlayedAt: now })
}
