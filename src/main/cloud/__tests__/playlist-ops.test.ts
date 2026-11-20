import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it, vi } from 'vitest'
import { Playlists } from '../../playlists'
import type { CloudClient } from '../client'
import { pullPlaylistOps } from '../playlist-ops'
import { createPlaylistSync } from '../playlist-sync'

it("the phone's edits land in the desktop's playlists before the desktop sends its set", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vibes-ops-'))
  try {
    const playlists = new Playlists(join(dir, 'playlists.json'))
    const noche = await playlists.create('Noche', 1)
    await playlists.add(noche.id, ['aaaaaaaaaaa'], 1)
    const calls: string[] = []
    const client = {
      listPlaylistOps: vi.fn(async () => ({
        ops: [
          { seq: 3, type: 'create', id: 'phone1', name: 'Gym' },
          { seq: 4, type: 'add', id: 'phone1', songIds: ['bbbbbbbbbbb'] },
          { seq: 5, type: 'remove', id: noche.id, songId: 'aaaaaaaaaaa' }
        ]
      })),
      ackPlaylistOps: vi.fn(async (upTo: number) => void calls.push(`ack ${upTo}`)),
      putPlaylists: vi.fn(async (req: { playlists: { id: string; songIds: string[] }[] }) => {
        calls.push(`put ${req.playlists.map((p) => `${p.id}:${p.songIds.join('+')}`).join(' ')}`)
        return req
      })
    } as unknown as CloudClient
    const sync = createPlaylistSync({
      list: () => playlists.list(),
      client: async () => client,
      pull: (c) => pullPlaylistOps(c, (ops) => playlists.applyOps(ops))
    })
    expect(await sync.flush()).toBe(true)
    expect(calls).toEqual(['ack 5', `put ${noche.id}: phone1:bbbbbbbbbbb`])
    // Saved on disk too.
    const again = new Playlists(join(dir, 'playlists.json'))
    await again.load()
    expect(again.list().map((p) => p.name)).toEqual(['Noche', 'Gym'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
