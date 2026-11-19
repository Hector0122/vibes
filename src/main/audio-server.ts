// Serves <audioDir>/{id}.m4a on 127.0.0.1 with Range support, so the
// renderer's <audio> can seek. Only plain {youtubeId}.m4a names are served.
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { createServer, type Server } from 'http'
import { join } from 'path'

const NAME_RE = /^\/([A-Za-z0-9_-]{11}\.m4a)$/

/** Parses a single "bytes=a-b" range; null when absent, 'invalid' when unsatisfiable. */
export function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return 'invalid'
  let start: number
  let end: number
  if (!m[1]) {
    // Suffix range: the last N bytes.
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  return start > end || start >= size ? 'invalid' : { start, end }
}

export function startAudioServer(audioDir: string): Promise<{ port: number; server: Server }> {
  const server = createServer(async (req, res) => {
    const name = NAME_RE.exec(req.url ?? '')?.[1]
    if (req.method !== 'GET' || !name) {
      res.writeHead(404).end()
      return
    }
    const path = join(audioDir, name)
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      res.writeHead(404).end()
      return
    }
    const range = parseRange(req.headers.range, size)
    const headers = { 'Content-Type': 'audio/mp4', 'Accept-Ranges': 'bytes' }
    if (range === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
    } else if (range) {
      res.writeHead(206, {
        ...headers,
        'Content-Length': range.end - range.start + 1,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`
      })
      createReadStream(path, range).pipe(res)
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size })
      createReadStream(path).pipe(res)
    }
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as { port: number }).port, server })
    )
  )
}
