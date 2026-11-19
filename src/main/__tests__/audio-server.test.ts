import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import type { Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseRange, startAudioServer } from '../audio-server'

describe('parseRange', () => {
  it.each([
    [undefined, null],
    ['bytes=0-', { start: 0, end: 99 }],
    ['bytes=10-19', { start: 10, end: 19 }],
    ['bytes=90-500', { start: 90, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=100-', 'invalid'],
    ['bytes=20-10', 'invalid'],
    ['bytes=-', 'invalid'],
    ['items=0-1', 'invalid'],
    ['bytes=0-1,5-6', 'invalid']
  ])('%s → %j', (header, expected) => {
    expect(parseRange(header, 100)).toEqual(expected)
  })
})

describe('audio server', () => {
  let root: string
  let server: Server
  let base: string
  const ID = 'dQw4w9WgXcQ'

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'vibes-srv-'))
    writeFileSync(join(root, `${ID}.m4a`), Buffer.from('0123456789'))
    writeFileSync(join(root, 'secret.txt'), 'secret')
    const s = await startAudioServer(root)
    server = s.server
    base = `http://127.0.0.1:${s.port}`
  })
  afterAll(() => {
    server.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('serves the whole file', async () => {
    const res = await fetch(`${base}/${ID}.m4a`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mp4')
    expect(await res.text()).toBe('0123456789')
  })

  it('serves byte ranges so the player can seek', async () => {
    const res = await fetch(`${base}/${ID}.m4a`, { headers: { Range: 'bytes=3-5' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 3-5/10')
    expect(await res.text()).toBe('345')
  })

  it('answers 416 for an impossible range', async () => {
    const res = await fetch(`${base}/${ID}.m4a`, { headers: { Range: 'bytes=50-' } })
    expect(res.status).toBe(416)
  })

  it.each(['/secret.txt', '/..%2Fsecret.txt', `/..%2F${ID}.m4a`, '/nonexisten.m4a'])(
    'refuses %s',
    async (path) => {
      expect((await fetch(base + path)).status).toBe(404)
    }
  )
})
