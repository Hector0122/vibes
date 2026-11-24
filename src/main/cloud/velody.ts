// Vibes → Velody: songs sent from here (or the phone) wait in the cloud until Velody, the practice
// app, downloads and separates them. Only songs whose audio is in the cloud can be sent.
import type { LocalSong } from '../../shared/types'
import type { CloudClient } from './client'

export interface SendResult {
  sent: string[]
  /** Not in the cloud yet, or the cloud said no: shown to the user. */
  skipped: { id: string; title: string; reason: string }[]
}

export async function sendToVelody(client: Pick<CloudClient, 'sendToVelody'>, songs: LocalSong[]): Promise<SendResult> {
  const out: SendResult = { sent: [], skipped: [] }
  for (const s of songs) {
    if (!s.uploaded) {
      out.skipped.push({ id: s.id, title: s.title, reason: 'todavía no está en la nube' })
      continue
    }
    try {
      await client.sendToVelody(s.id)
      out.sent.push(s.id)
    } catch (err) {
      out.skipped.push({ id: s.id, title: s.title, reason: (err as Error).message })
    }
  }
  return out
}
