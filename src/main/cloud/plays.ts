// Plays counted on the phone join the desktop's play counts (which drive the
// recommendations). Counted first, then cleared in the cloud: a crash in between
// may count a play twice, never lose one.
import { CloudApiError, type CloudClient } from './client'

export async function importPhonePlays(
  client: CloudClient,
  record: (id: string, at: number) => Promise<void>
): Promise<number> {
  let plays
  try {
    plays = (await client.listPlays()).plays
  } catch (err) {
    if (err instanceof CloudApiError && err.status === 404) return 0 // an older Worker
    throw err
  }
  if (plays.length === 0) return 0
  for (const p of plays) await record(p.id, p.at)
  await client.ackPlays(Math.max(...plays.map((p) => p.seq)))
  return plays.length
}
