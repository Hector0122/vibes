import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { downloadAudio, eachLimit, findTool, remuxToM4a, ytdlpArgs, type Tools } from '../media'
import { FAILING_ID, makeAudio, makeFakeYtdlp } from './fixtures'

let root: string
let tools: Tools

const probeDuration = (path: string): number =>
  Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
      .toString()
      .trim()
  )

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'vibes-media-'))
  makeAudio(join(root, 'source.m4a'))
  tools = { ffmpeg: 'ffmpeg', ytdlp: makeFakeYtdlp(root, join(root, 'source.m4a')) }
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('findTool', () => {
  const only = (...paths: string[]) => (p: string) => paths.includes(p)

  it('uses the override even if PATH has the tool', () => {
    expect(findTool('yt-dlp', '/opt/y', { PATH: '/usr/bin' }, only('/usr/bin/yt-dlp'))).toBe('/opt/y')
  })

  it('prefers PATH, in order', () => {
    const exists = only('/a/yt-dlp', '/b/yt-dlp')
    expect(findTool('yt-dlp', undefined, { PATH: '/a:/b', HOME: '/h' }, exists)).toBe('/a/yt-dlp')
  })

  it('finds ~/.local/bin when the desktop launcher left it out of PATH', () => {
    const exists = only('/h/.local/bin/yt-dlp')
    expect(findTool('yt-dlp', undefined, { PATH: '/usr/bin', HOME: '/h' }, exists)).toBe(
      '/h/.local/bin/yt-dlp'
    )
  })

  it('falls back to the bare name so the error message names the tool', () => {
    expect(findTool('yt-dlp', undefined, { PATH: '', HOME: '/h' }, () => false)).toBe('yt-dlp')
  })
})

describe('ytdlpArgs', () => {
  it('asks for audio only, as m4a, for exactly that video', () => {
    const args = ytdlpArgs('dQw4w9WgXcQ', '/x/%(ext)s')
    expect(args.slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'])
    expect(args).toContain('--no-playlist')
    expect(args.join(' ')).toContain('-x --audio-format m4a')
  })

  it('rejects anything that is not a YouTube id (no option injection)', () => {
    expect(() => ytdlpArgs('--exec=rm', '/x')).toThrow()
  })
})

describe('remuxToM4a', () => {
  it('turns eSound’s fragmented cache into a playable m4a of the same length', async () => {
    const frag = join(root, 'cache.mp4')
    makeAudio(frag, true)
    const out = join(root, 'remuxed.m4a')
    await remuxToM4a(tools, frag, out)
    expect(probeDuration(out)).toBeCloseTo(1, 1)
    expect(existsSync(`${out}.part.m4a`)).toBe(false)
  })

  it('leaves no file behind when the input is broken', async () => {
    const out = join(root, 'bad.m4a')
    await expect(remuxToM4a(tools, join(root, 'missing.mp4'), out)).rejects.toThrow()
    expect(existsSync(out)).toBe(false)
  })
})

describe('downloadAudio', () => {
  it('leaves <id>.m4a in the folder', async () => {
    const dir = join(root, 'dl')
    mkdirSync(dir)
    expect(await downloadAudio(tools, 'dQw4w9WgXcQ', dir)).toBe(join(dir, 'dQw4w9WgXcQ.m4a'))
    expect(readdirSync(dir)).toEqual(['dQw4w9WgXcQ.m4a'])
  })

  it('reports yt-dlp’s error and leaves nothing behind', async () => {
    const dir = join(root, 'dl-fail')
    mkdirSync(dir)
    await expect(downloadAudio(tools, FAILING_ID, dir)).rejects.toThrow('Video unavailable')
    expect(readdirSync(dir)).toEqual([])
  })

  it('says clearly when yt-dlp is not installed', async () => {
    await expect(
      downloadAudio({ ...tools, ytdlp: join(root, 'no-such-bin') }, 'dQw4w9WgXcQ', root)
    ).rejects.toThrow(/No encontré/)
  })
})

describe('eachLimit', () => {
  it('runs everything with at most `limit` at once', async () => {
    let active = 0
    let peak = 0
    const done: number[] = []
    await eachLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      peak = Math.max(peak, ++active)
      await new Promise((r) => setTimeout(r, 5))
      done.push(n)
      active--
    })
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(peak).toBe(3)
  })
})
