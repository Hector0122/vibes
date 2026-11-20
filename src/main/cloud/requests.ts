// Songs marked on the phone: while the app is open it checks the cloud every
// few minutes, downloads each marked song (the same path as "Agregar" in the
// search), uploads it, and clears the mark. A song that can't be downloaded
// stays marked as failed, with the reason, for the phone to show.
import type { SongRequest } from '../../shared/api'
import type { LocalSong } from '../../shared/types'
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
