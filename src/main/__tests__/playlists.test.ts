import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Playlists } from '../playlists'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibes-pl-'))
  path = join(dir, 'playlists.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const reopen = async (): Promise<Playlists> => {
  const p = new Playlists(path)
  await p.load()
  return p
}

describe('Playlists', () => {
  it('create, add songs (no duplicates), and it all survives a restart', async () => {
    const pl = await reopen()
    const rock = await pl.create('  Rock   en español ')
    expect(rock.name).toBe('Rock en español')
    expect(await pl.add(rock.id, ['a', 'b', 'a'])).toBe(2)
    expect(await pl.add(rock.id, ['b', 'c'])).toBe(1)
    expect((await reopen()).list()).toEqual([expect.objectContaining({ name: 'Rock en español', songIds: ['a', 'b', 'c'] })])
  })

  it('rename and delete', async () => {
    const pl = await reopen()
    const a = await pl.create('A')
    const b = await pl.create('B')
    await pl.rename(a.id, 'Para manejar')
    await pl.remove(b.id)
    expect((await reopen()).list().map((p) => p.name)).toEqual(['Para manejar'])
  })

  it('reorders by moving one song, and removes a song', async () => {
    const pl = await reopen()
    const p = await pl.create('X')
    await pl.add(p.id, ['a', 'b', 'c', 'd'])
    await pl.move(p.id, 3, 0) // drag "d" to the top
    expect(pl.list()[0].songIds).toEqual(['d', 'a', 'b', 'c'])
    await pl.move(p.id, 0, 99) // past the end = last
    expect(pl.list()[0].songIds).toEqual(['a', 'b', 'c', 'd'])
    await pl.removeSong(p.id, 'b')
    expect((await reopen()).list()[0].songIds).toEqual(['a', 'c', 'd'])
  })

  it('needs a name, and says so when a playlist no longer exists', async () => {
    const pl = await reopen()
    await expect(pl.create('   ')).rejects.toThrow('necesita un nombre')
    await expect(pl.add('nope', ['a'])).rejects.toThrow('ya no existe')
  })

  it('list() hands out copies: changing them does not change the store', async () => {
    const pl = await reopen()
    const p = await pl.create('X')
    await pl.add(p.id, ['a'])
    pl.list()[0].songIds.push('hacked')
    expect(pl.list()[0].songIds).toEqual(['a'])
  })

  it('a corrupt file is an error, never silently emptied', async () => {
    writeFileSync(path, '{not json')
    await expect(reopen()).rejects.toThrow()
  })
})
