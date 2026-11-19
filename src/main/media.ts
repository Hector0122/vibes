// Getting audio onto disk: remuxing eSound's cached files and downloading
// with yt-dlp. Both write to a temp name and rename, so a crash never leaves
// a half-written {id}.m4a that looks complete.
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { rename, rm } from 'fs/promises'
import { join } from 'path'
import { YOUTUBE_ID_RE } from '../shared/api'

export interface Tools {
  ffmpeg: string
  ytdlp: string
}

export const defaultTools = (): Tools => ({
  ffmpeg: process.env.VIBES_FFMPEG || 'ffmpeg',
  ytdlp: process.env.VIBES_YTDLP || 'yt-dlp'
})

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
    child.on('error', (err) =>
      reject(
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error(`No encontré ${cmd}; instálalo y vuelve a intentar`)
          : err
      )
    )
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(lastLine(stderr) || `${cmd} terminó con ${signal ?? `código ${code}`}`))
    })
  })
}

const lastLine = (s: string): string =>
  s.trim().split('\n').filter(Boolean).pop()?.slice(0, 300) ?? ''

/** eSound caches DASH-fragmented mp4: copy the audio stream into a plain, seekable m4a. */
export async function remuxToM4a(tools: Tools, input: string, output: string): Promise<void> {
  const tmp = `${output}.part.m4a`
  try {
    await run(
      tools.ffmpeg,
      ['-nostdin', '-y', '-loglevel', 'error', '-i', input, '-vn', '-c:a', 'copy', '-movflags', '+faststart', tmp],
      120_000
    )
    await rename(tmp, output)
  } finally {
    await rm(tmp, { force: true })
  }
}

export function ytdlpArgs(id: string, outTemplate: string): string[] {
  if (!YOUTUBE_ID_RE.test(id)) throw new Error(`Invalid YouTube id: ${id}`)
  return [
    '-f', 'bestaudio[ext=m4a]/bestaudio',
    '-x', '--audio-format', 'm4a',
    '--no-playlist', '--no-progress', '--quiet', '--no-warnings',
    '-o', outTemplate,
    '--', `https://www.youtube.com/watch?v=${id}`
  ]
}

/** Downloads the song's audio to <dir>/<id>.m4a. */
export async function downloadAudio(tools: Tools, id: string, dir: string): Promise<string> {
  const out = join(dir, `${id}.m4a`)
  const partBase = join(dir, `${id}.part`)
  try {
    await run(tools.ytdlp, ytdlpArgs(id, `${partBase}.%(ext)s`), 10 * 60_000)
    if (!existsSync(`${partBase}.m4a`)) throw new Error('yt-dlp terminó pero no dejó el audio')
    await rename(`${partBase}.m4a`, out)
    return out
  } finally {
    await rm(`${partBase}.m4a`, { force: true })
  }
}

/** Runs fn over items with at most `limit` in flight. */
export async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
