// Playlist edits made on the phone: applied to the desktop's playlists, then
// cleared in the cloud. Always done right before the desktop sends its own set,
// so a phone edit is never overwritten.
import type { PlaylistOp } from '../../shared/api'
import { CloudApiError, type CloudClient } from './client'

export async function pullPlaylistOps(
  client: CloudClient,
  apply: (ops: PlaylistOp[]) => Promise<void>
): Promise<number> {
  let ops
  try {
    ops = (await client.listPlaylistOps()).ops
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 404) return 0 // an older Worker
    throw err
  }
  if (ops.length === 0) return 0
  await apply(ops.map(({ seq: _seq, ...op }) => op as PlaylistOp))
  await client.ackPlaylistOps(Math.max(...ops.map((o) => o.seq)))
  return ops.length
}
