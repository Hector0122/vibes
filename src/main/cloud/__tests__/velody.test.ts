import { describe, expect, it, vi } from 'vitest'
import type { LocalSong } from '../../../shared/types'
import { CloudApiError, type CloudClient } from '../client'
import { sendToVelody } from '../velody'

const song = (id: string, uploaded = true) => ({ id, title: `t-${id}`, uploaded }) as LocalSong

describe('sendToVelody', () => {
  it('sends the songs already in the cloud; the rest come back with the reason', async () => {
    const sent: string[] = []
    const client = {
      sendToVelody: vi.fn(async (id: string) => {
        if (id === 'ccccccccccc') throw new CloudApiError('Los audiolibros no se mandan a Velody', 400)
        sent.push(id)
      })
    } as unknown as CloudClient
    const r = await sendToVelody(client, [song('aaaaaaaaaaa'), song('bbbbbbbbbbb', false), song('ccccccccccc')])
    expect(r.sent).toEqual(['aaaaaaaaaaa'])
    expect(sent).toEqual(['aaaaaaaaaaa'])
    expect(r.skipped).toEqual([
      { id: 'bbbbbbbbbbb', title: 't-bbbbbbbbbbb', reason: 'todavía no está en la nube' },
      { id: 'ccccccccccc', title: 't-ccccccccccc', reason: 'Los audiolibros no se mandan a Velody' }
    ])
  })
})
