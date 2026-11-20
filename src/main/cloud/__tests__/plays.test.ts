import { expect, it, vi } from 'vitest'
import { CloudApiError, type CloudClient } from '../client'
import { importPhonePlays } from '../plays'

it('counts each phone play here, then clears them up to the last one', async () => {
  const calls: string[] = []
  const client = {
    listPlays: vi.fn(async () => ({
      plays: [
        { seq: 4, id: 'aaaaaaaaaaa', at: 10 },
        { seq: 7, id: 'bbbbbbbbbbb', at: 20 }
      ]
    })),
    ackPlays: vi.fn(async (upTo: number) => void calls.push(`ack ${upTo}`))
  } as unknown as CloudClient
  const n = await importPhonePlays(client, async (id, at) => void calls.push(`play ${id} ${at}`))
  expect(n).toBe(2)
  expect(calls).toEqual(['play aaaaaaaaaaa 10', 'play bbbbbbbbbbb 20', 'ack 7'])
})

it('nothing to do with no plays or an older Worker', async () => {
  const none = { listPlays: vi.fn(async () => ({ plays: [] })), ackPlays: vi.fn() } as unknown as CloudClient
  expect(await importPhonePlays(none, vi.fn())).toBe(0)
  expect(none.ackPlays).not.toHaveBeenCalled()
  const old = {
    listPlays: vi.fn(async () => {
      throw new CloudApiError('Not found', 404)
    })
  } as unknown as CloudClient
  expect(await importPhonePlays(old, vi.fn())).toBe(0)
})
