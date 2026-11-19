// E2E: launches the built app (out/) against a fake eSound folder and a fake
// yt-dlp, then drives the real UI over the DevTools protocol (Node's built-in
// WebSocket, no test framework needed):
//   import → songs listed → download missing → play → seek → next →
//   restart keeps the library → upload without cloud settings shows the error.
// Run with: pnpm test:e2e   (needs a display; CI wraps it in xvfb-run)
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { makeAudio, makeEsoundDir, makeFakeYtdlp } from '../src/main/__tests__/fixtures.ts'

const electron = createRequire(import.meta.url)('electron') as unknown as string
const root = mkdtempSync(join(tmpdir(), 'vibes-e2e-'))
const esoundDir = makeEsoundDir(root)
makeAudio(join(root, 'dl.m4a'))
const env = {
  ...process.env,
  VIBES_USER_DATA: join(root, 'user-data'),
  VIBES_ESOUND_DIR: esoundDir,
  VIBES_YTDLP: makeFakeYtdlp(root, join(root, 'dl.m4a'))
}

interface App {
  proc: ChildProcess
  eval: <T>(expr: string) => Promise<T>
}

async function launch(): Promise<App> {
  const proc = spawn(electron, ['.', '--remote-debugging-port=0', '--no-sandbox'], { env, stdio: ['ignore', 'ignore', 'pipe'] })
  const port = await new Promise<string>((resolve, reject) => {
    let err = ''
    proc.stderr!.on('data', (d) => {
      err += d
      const m = /DevTools listening on ws:\/\/[^:]+:(\d+)/.exec(err)
      if (m) resolve(m[1])
    })
    proc.on('exit', (code) => reject(new Error(`app exited (${code}): ${err}`)))
  })
  // Wait for the renderer page target.
  let wsUrl = ''
  for (let i = 0; i < 50 && !wsUrl; i++) {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[]
    wsUrl = targets.find((t) => t.type === 'page' && t.url.includes('index.html'))?.webSocketDebuggerUrl ?? ''
    if (!wsUrl) await sleep(100)
  }
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map<number, (v: unknown) => void>()
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data))
    pending.get(msg.id)?.(msg)
    pending.delete(msg.id)
  })
  const evaluate = async <T>(expression: string): Promise<T> => {
    const msgId = ++id
    ws.send(JSON.stringify({ id: msgId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    const res = (await new Promise((r) => pending.set(msgId, r))) as { result: { result: { value: T }; exceptionDetails?: { text: string } } }
    if (res.result.exceptionDetails) throw new Error(`${expression}: ${JSON.stringify(res.result.exceptionDetails)}`)
    return res.result.result.value
  }
  return { proc, eval: evaluate }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitFor<T>(app: App, expr: string, what: string, timeoutMs = 15_000): Promise<T> {
  const end = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < end) {
    last = await app.eval<T>(expr).catch(() => undefined as T)
    if (last) return last
    await sleep(100)
  }
  throw new Error(`Timed out waiting for: ${what} (last: ${JSON.stringify(last)})`)
}

const click = (label: string): string =>
  `(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) throw new Error('no button ${label}'); b.click(); return true })()`
const status = `document.querySelector('[data-testid=status]').textContent`
const rows = `[...document.querySelectorAll('[data-testid=song]')].map((b) => ({ title: b.querySelector('.truncate').textContent, enabled: !b.disabled }))`
const audio = `(() => { const a = document.querySelector('[data-testid=audio]'); return { t: a.currentTime, paused: a.paused, src: a.src } })()`
const nowPlaying = `document.querySelector('[data-testid=now-playing]').textContent`

type Row = { title: string; enabled: boolean }
type AudioState = { t: number; paused: boolean; src: string }

async function run(): Promise<void> {
  let app = await launch()
  try {
    await waitFor(app, `document.body.innerText.includes('Importar de eSound')`, 'app loaded')

    // 1. Import from eSound: both songs listed, only the cached one playable.
    await app.eval(click('Importar de eSound'))
    await waitFor(app, `${status}.startsWith('eSound:')`, 'import finished')
    assert.match(await app.eval<string>(status), /2 nuevas, 0 actualizadas, 1 audios copiados, 1 sin audio/)
    let list = await app.eval<Row[]>(rows)
    assert.deepEqual(list.map((r) => r.enabled).sort(), [false, true])
    console.log('✓ import:', JSON.stringify(list))

    // 2. Download the missing one: now both are playable.
    await app.eval(click('Descargar faltantes'))
    await waitFor(app, `${status}.startsWith('Descargadas')`, 'download finished')
    assert.equal(await app.eval<string>(status), 'Descargadas 1 de 1')
    list = await app.eval<Row[]>(rows)
    assert.ok(list.every((r) => r.enabled))
    console.log('✓ download: both songs have audio')

    // 3. Play the first song: audio actually advances.
    const first = list[0].title
    await app.eval(`document.querySelectorAll('[data-testid=song]')[0].click()`)
    await waitFor(app, `(${audio}).t > 0.3`, 'playback advancing')
    const playing = await app.eval<AudioState>(audio)
    assert.equal(playing.paused, false)
    assert.match(playing.src, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{11}\.m4a$/)
    assert.equal(await app.eval<string>(nowPlaying), first)
    console.log('✓ play:', first, playing.src)

    // 4. Seek (needs Range support) and pause.
    await app.eval(`document.querySelector('[data-testid=audio]').currentTime = 0.1`)
    assert.ok((await app.eval<AudioState>(audio)).t < 0.3)
    await app.eval(click('Pausar'))
    await waitFor(app, `(${audio}).paused`, 'paused')
    console.log('✓ seek + pause')

    // 5. Next track switches song.
    await app.eval(click('Siguiente'))
    await waitFor(app, `${nowPlaying} !== ${JSON.stringify(first)}`, 'next song')
    console.log('✓ next:', await app.eval<string>(nowPlaying))

    // 6. Upload without a configured cloud explains what to do, uploads nothing.
    await app.eval(click('Subir a la nube'))
    await waitFor(app, `${status}.includes('Configura la nube')`, 'cloud error')
    console.log('✓ upload without cloud:', await app.eval<string>(status))
  } finally {
    app.proc.kill()
  }

  // 7. Restart: the library and its audio survive.
  await sleep(500)
  app = await launch()
  try {
    await waitFor(app, `document.querySelectorAll('[data-testid=song]').length === 2`, 'library after restart')
    const list = await app.eval<Row[]>(rows)
    assert.ok(list.every((r) => r.enabled))
    console.log('✓ restart keeps library:', list.length, 'songs')
  } finally {
    app.proc.kill()
  }
}

run()
  .then(() => {
    console.log('E2E OK')
    rmSync(root, { recursive: true, force: true })
  })
  .catch((err) => {
    console.error('E2E FAILED:', err)
    process.exitCode = 1
  })
