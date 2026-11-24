// Songs marked on the phone: while the app is open it checks the cloud every
// few minutes, downloads each marked song (the same path as "Agregar" in the
// search), uploads it, and clears the mark. A song that can't be downloaded
// stays marked as failed, with the reason, for the phone to show.
import { YOUTUBE_ID_RE, type SongRequest } from '../../shared/api'
import type { LocalSong, SearchResult } from '../../shared/types'
import { CloudApiError, type CloudClient } from './client'

export interface RequestRun {
  done: number
  failed: number
}

export async function processRequests(
  client: CloudClient,
  add: (r: SongRequest) => Promise<LocalSong>
): Promise<RequestRun> {
  let requests: SongRequest[]
  try {
    requests = (await client.listRequests()).requests
  } catch (err) {
    // An older Worker without requests: nothing to do.
    if (err instanceof CloudApiError && err.status === 404) return { done: 0, failed: 0 }
    throw err
  }
  const run: RequestRun = { done: 0, failed: 0 }
  for (const r of requests.filter((x) => x.status === 'pending')) {
    try {
      const song = await add(r)
      // Downloaded but the upload failed: try again next time, not a failure of the song.
      if (!song.uploaded) continue
      await client.deleteRequest(r.id)
      run.done++
    } catch (err) {
      run.failed++
      await client.failRequest(r.id, (err as Error).message || 'No se pudo descargar').catch(() => {})
    }
  }
  return run
}

type Want = { title: string; artists: string; durationSec: number | null }

/**
 * Downloads a marked song. Found on Deezer ("dz" + its id, which can also be 11
 * characters long): its YouTube upload. Marked from YouTube: that video, or, when
 * it can't be downloaded (removed, blocked), another upload of the same song.
 */
export async function addRequested(
  r: SongRequest,
  add: (hit: SearchResult) => Promise<LocalSong>,
  find: (want: Want) => Promise<SearchResult>
): Promise<LocalSong> {
  const fromVideo = (video: SearchResult | null): Promise<LocalSong> =>
    add({
      id: video?.id ?? r.id,
      title: r.title,
      artists: r.artists,
      durationSec: video?.durationSec ?? r.durationSec,
      coverUrl: r.coverUrl as string, // a null cover stays null
      deezerId: r.deezerId
    })
  const isVideo = YOUTUBE_ID_RE.test(r.id) && !(r.deezerId && r.id === `dz${r.deezerId}`)
  if (!isVideo) return fromVideo(await find(r))
  try {
    return await fromVideo(null)
  } catch (err) {
    const other = await find(r).catch(() => null)
    if (!other || other.id === r.id) throw err
    return fromVideo(other)
  }
}
