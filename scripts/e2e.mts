// E2E: launches the built app (out/) against a fake eSound folder and a fake
// yt-dlp, then drives the real UI over the DevTools protocol (Node's built-in
// WebSocket, no test framework needed):
//   import → songs listed → download missing → play → seek → next →
//   start page recommendations → add one → search YouTube → add a song (real cover
//   from "Deezer") → its color tints the UI → plays are counted → "Reproduciendo
//   ahora" with synced lyrics → preview a recommendation without adding it →
//   radio when the list ends → playlists (create, + menu, drag & drop, reorder,
//   remove) → shuffle → upload without cloud settings shows the error →
//   delete a song → restart keeps the library, playlists and switches.
// Deezer, LRCLIB, the cover image and YouTube's audio stream are a local fake server.
// Run with: pnpm test:e2e   (needs a display; CI wraps it in xvfb-run)
// VIBES_APP_BIN=dist/linux-unpacked/vibes runs the same flow on the packaged app.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { makeAudio, makeEsoundDir, makeFakeYtdlp } from '../src/main/__tests__/fixtures.ts'

const appBin = process.env.VIBES_APP_BIN
const [cmd, baseArgs] = appBin
  ? [appBin, []]
  : [createRequire(import.meta.url)('electron') as unknown as string, ['.']]
const root = mkdtempSync(join(tmpdir(), 'vibes-e2e-'))
const esoundDir = makeEsoundDir(root)
makeAudio(join(root, 'dl.m4a'))
// A solid red cover, so the UI tint is predictable.
execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1', join(root, 'red.png')])

// Fake Deezer (/search), LRCLIB (/api/search), cover (/red.png) and YouTube stream (/stream.m4a).
const fake = createServer((req, res) => {
  const url = new URL(req.url!, 'http://x')
  const json = (body: unknown): void => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }
  if (url.pathname === '/search') {
    const hit = /feel good/i.test(url.searchParams.get('q') ?? '')
    return json({
      data: hit
        ? [{ id: 3129775, title: 'Feel Good Inc.', title_short: 'Feel Good Inc.', duration: 255, artist: { id: 14, name: 'Gorillaz' }, album: { title: 'Demon Days', cover_xl: `${base}/red.png` } }]
        : []
    })
  }
  if (url.pathname === '/api/search') {
    if (url.searchParams.get('track_name') !== 'Feel Good Inc.') return json([])
    return json([{ trackName: 'Feel Good Inc.', artistName: 'Gorillaz', duration: 255, syncedLyrics: '[00:00.00] Primera línea\n[00:00.30] Segunda línea\n[00:00.60] Tercera línea', plainLyrics: 'Primera línea' }])
  }
  const file = url.pathname === '/red.png' ? 'red.png' : url.pathname === '/stream.m4a' ? 'dl.m4a' : null
  if (!file) return res.writeHead(404).end()
  res.setHeader('content-type', file.endsWith('png') ? 'image/png' : 'audio/mp4')
  res.end(readFileSync(join(root, file)))
})
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`

const env = {
  ...process.env,
  VIBES_USER_DATA: join(root, 'user-data'),
  VIBES_ESOUND_DIR: esoundDir,
  VIBES_YTDLP: makeFakeYtdlp(root, join(root, 'dl.m4a')),
  VIBES_DEEZER_URL: base,
  VIBES_LRCLIB_URL: base,
  VIBES_FAKE_STREAM_URL: `${base}/stream.m4a`
}

interface App {
  proc: ChildProcess
  eval: <T>(expr: string) => Promise<T>
}

/** Kills the app and waits until it has really exited (it keeps writing to its data folder until then). */
async function stop(app: App): Promise<void> {
  const { proc } = app
  if (proc.exitCode !== null || proc.signalCode !== null) return
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()))
  proc.kill()
  await Promise.race([exited, sleep(5000).then(() => proc.kill('SIGKILL'))])
  await exited
}

async function launch(): Promise<App> {
  const proc = spawn(cmd, [...baseArgs, '--remote-debugging-port=0', '--no-sandbox'], { env, stdio: ['ignore', 'ignore', 'pipe'] })
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
const cards = (testId: string): string =>
  `[...document.querySelectorAll('[data-testid=${testId}]')].map((li) => [...li.querySelectorAll('.truncate')].map((e) => e.textContent).join('|') + '|' + li.lastElementChild.textContent)`
/** Types into a React-controlled input (the native setter, so React sees the change). */
const typeInto = (selector: string, value: string): string =>
  `(() => { const i = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
const songsApi = `window.api.listSongs()`
/** Pause without depending on the button's label (the song may have ended by itself). */
const pause = `(() => { document.querySelector('[data-testid=audio]').pause(); return true })()`
/** Fires a native drag & drop (dragstart on one element, dragover + drop on another). */
const dragStart = (sel: string, i: number): string =>
  `(() => { window.__dt = new DataTransfer(); const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt })); return true })()`
const dropOn = (sel: string, i: number): string =>
  `(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; const o = { bubbles: true, cancelable: true, dataTransfer: window.__dt }; el.dispatchEvent(new DragEvent('dragenter', o)); el.dispatchEvent(new DragEvent('dragover', o)); el.dispatchEvent(new DragEvent('drop', o)); document.querySelectorAll('[data-testid=song-row]').forEach((r) => r.dispatchEvent(new DragEvent('dragend', { bubbles: true }))); return true })()`
const playlistTitles = `[...document.querySelectorAll('[data-testid=song]')].filter((b) => b.offsetParent).map((b) => b.querySelector('.truncate').textContent)`

/** Test songs last 1 s; at 1/16 speed (Chromium's minimum) they last 16 s and survive a few clicks. */
const slow = `(() => { const a = document.querySelector('[data-testid=audio]'); a.defaultPlaybackRate = 0.0625; a.playbackRate = 0.0625; return true })()`
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
    // With music in the library, the eSound import is no longer offered.
    await waitFor(app, `!document.body.innerText.includes('Importar de eSound')`, 'import button hidden')
    console.log('✓ import button hidden once the library has music')

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

    // 4b. Autoplay: when a song ends the next one starts by itself (no clicks).
    const before = await app.eval<string>(nowPlaying)
    await app.eval(click('Reproducir'))
    await waitFor(app, `${nowPlaying} !== ${JSON.stringify(before)} && !(${audio}).paused && (${audio}).t > 0.2`, 'autoplay next song')
    console.log('✓ autoplay:', before, '→', await app.eval<string>(nowPlaying))
    await app.eval(click('Pausar'))
    await waitFor(app, `(${audio}).paused`, 'paused again')

    // 5. Next track switches song (slowed down, so the change comes from the click, not autoplay).
    await app.eval(slow)
    const beforeNext = await app.eval<string>(nowPlaying)
    await app.eval(click('Siguiente'))
    await waitFor(app, `${nowPlaying} !== ${JSON.stringify(beforeNext)}`, 'next song')
    console.log('✓ next:', beforeNext, '→', await app.eval<string>(nowPlaying))
    await app.eval(click('Pausar'))

    // 6. Home (the start page): recommendations from the library, then search + add.
    await app.eval(click('Inicio'))
    await waitFor(app, `document.querySelectorAll('[data-testid=rec]').length === 2`, 'recommendations')
    const recs = await app.eval<string[]>(cards('rec'))
    assert.match(recs[0], /^Afuera\|Caifanes\|.*Agregar$/)
    assert.match(await app.eval<string>(`document.querySelector('[data-testid=based-on]').textContent`), /^Porque escuchas /)
    console.log('✓ recommendations:', recs.map((r) => r.split('|').slice(0, 2).join(' — ')).join(', '))
    await app.eval(`document.querySelectorAll('[data-testid=rec]')[0].querySelector('[data-testid=add]').click()`)
    await waitFor(app, `(${cards('rec')})[0].endsWith('En tu biblioteca')`, 'recommendation added')
    console.log('✓ add from recommendations')

    await app.eval(typeInto('[aria-label="Buscar en YouTube"]', 'gorillaz'))
    await app.eval(click('Buscar'))
    await waitFor(app, `document.querySelectorAll('[data-testid=result]').length === 3`, 'search results')
    const hits = await app.eval<string[]>(cards('result'))
    assert.match(hits[0], /^Feel Good Inc\.\|Gorillaz\|.*Agregar$/)
    assert.match(hits[1], /^Stylo\|.*En tu biblioteca$/) // already imported from eSound
    await app.eval(`document.querySelectorAll('[data-testid=result]')[0].querySelector('[data-testid=add]').click()`)
    await waitFor(app, `(${cards('result')})[0].endsWith('En tu biblioteca')`, 'song added')
    console.log('✓ search + add:', hits[0].split('|').slice(0, 2).join(' — '))
    await app.eval(click('Biblioteca'))
    await waitFor(app, `document.querySelectorAll('[data-testid=song]').length === 4`, 'library has the new songs')
    list = await app.eval<Row[]>(rows)
    assert.ok(list.find((r) => r.title === 'Feel Good Inc.')?.enabled, 'new song is playable')
    assert.ok(list.find((r) => r.title === 'Afuera')?.enabled, 'recommended song is playable')
    const idx = list.findIndex((r) => r.title === 'Feel Good Inc.')
    await app.eval(`document.querySelectorAll('[data-testid=song]')[${idx}].click()`)
    await waitFor(app, `${nowPlaying} === 'Feel Good Inc.' && (${audio}).t > 0.3`, 'new song playing')
    console.log('✓ new song plays from the library')

    // 6a. Its real cover came from "Deezer", and the UI takes the cover's color (red).
    const fg = (await app.eval<{ id: string; album: string; coverUrl: string }[]>(songsApi)).find((x) => x.album === 'Demon Days')
    assert.ok(fg && fg.coverUrl === `${base}/red.png`, 'Deezer cover and album')
    await waitFor(app, `(() => { const [r, g, b] = document.querySelector('[data-accent]').dataset.accent.split(' ').map(Number); return r > 180 && g < 80 && b < 80 })()`, 'red accent')
    console.log('✓ Deezer cover + accent color:', await app.eval<string>(`document.querySelector('[data-accent]').dataset.accent`))

    // 6b. Plays are counted once a song has really been listened to.
    await waitFor(app, `${songsApi}.then((l) => l.find((x) => x.album === 'Demon Days').playCount >= 1)`, 'play counted')
    console.log('✓ play counted')

    // 6c. "Reproduciendo ahora": synced lyrics, the sung line lit, Esc closes.
    await app.eval(slow)
    await app.eval(`document.querySelector('[data-testid=audio]').currentTime = 0; document.querySelector('[data-testid=audio]').play(); true`)
    await app.eval(click('Abrir reproductor'))
    await waitFor(app, `document.querySelectorAll('[data-testid=lyric-line]').length === 3`, 'lyrics shown')
    await waitFor(app, `!!document.querySelector('[data-testid=lyric-line][aria-current=true]')`, 'current lyric line')
    console.log('✓ now playing + lyrics:', await app.eval<string>(`document.querySelector('[data-testid=lyric-line][aria-current=true]').textContent`))
    await app.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`)
    await waitFor(app, `!document.querySelector('[data-testid=now-playing-view]')`, 'now playing closed')
    await app.eval(pause)

    // 6d. Preview: listen to a recommendation without adding it (streams; the player offers "Agregar").
    await app.eval(click('Inicio'))
    await app.eval(click('Limpiar búsqueda'))
    await waitFor(app, `document.querySelectorAll('[data-testid=rec]').length >= 1`, 'recommendations again')
    const recTitles = await app.eval<string[]>(`[...document.querySelectorAll('[data-testid=rec]')].map((c) => c.querySelector('.truncate').textContent)`)
    const pIdx = recTitles.indexOf('De la noche a la mañana')
    assert.ok(pIdx >= 0, `recommendation to preview in ${recTitles}`)
    await app.eval(`document.querySelectorAll('[data-testid=rec]')[${pIdx}].querySelector('[aria-label=Escuchar]').click()`)
    await waitFor(app, `${nowPlaying} === 'De la noche a la mañana' && (${audio}).src === ${JSON.stringify(`${base}/stream.m4a`)} && (${audio}).t > 0.1`, 'preview streaming')
    assert.equal(await app.eval<string>(`document.querySelector('[data-testid=queue-label]').textContent`), 'Recomendado para ti')
    assert.ok(await app.eval<boolean>(`[...document.querySelectorAll('footer button')].some((b) => b.textContent.trim() === 'Agregar')`), 'player offers Agregar')
    assert.equal((await app.eval<unknown[]>(songsApi)).length, 4, 'a preview is not added')
    console.log('✓ preview streams without adding')
    await app.eval(click('Volver a mi biblioteca'))
    await app.eval(pause)

    // 6e. Radio: with it on, when the library list ends the app keeps going with similar songs.
    await app.eval(click('Biblioteca'))
    if ((await app.eval<string>(`document.querySelector('[aria-label=Aleatorio]').getAttribute('aria-pressed')`)) === 'true') await app.eval(click('Aleatorio'))
    await app.eval(click('Radio sin fin'))
    assert.equal(await app.eval<string>(`document.querySelector('[aria-label="Radio sin fin"]').getAttribute('aria-pressed')`), 'true')
    await app.eval(`(() => { const a = document.querySelector('[data-testid=audio]'); a.defaultPlaybackRate = 1; a.playbackRate = 1; const s = document.querySelectorAll('[data-testid=song]'); s[s.length - 1].click(); return true })()`)
    await waitFor(app, `(document.querySelector('[data-testid=queue-label]')?.textContent ?? '').startsWith('Radio: parecidas a')`, 'radio took over')
    await waitFor(app, `${nowPlaying} === 'De la noche a la mañana'`, 'radio song playing')
    console.log('✓ radio:', await app.eval<string>(`document.querySelector('[data-testid=queue-label]').textContent`), '→', await app.eval<string>(nowPlaying))
    await app.eval(click('Radio sin fin'))
    await app.eval(click('Volver a mi biblioteca'))
    await app.eval(slow)
    await app.eval(pause)

    // 6f. Playlists: create, add with the + menu and by dragging onto the sidebar, reorder, remove.
    await app.eval(click('Nueva playlist'))
    await app.eval(typeInto('[aria-label="Nombre de la nueva playlist"]', 'Para manejar'))
    await app.eval(`document.querySelector('[aria-label="Nombre de la nueva playlist"]').form.requestSubmit(); true`)
    await waitFor(app, `[...document.querySelectorAll('[data-testid=playlist-link]')].some((b) => b.textContent.includes('Para manejar'))`, 'playlist created')
    await waitFor(app, `document.body.innerText.includes('Arrastra canciones')`, 'empty playlist view')
    await app.eval(click('Biblioteca'))
    list = await app.eval<Row[]>(rows)
    const stylo = list.findIndex((r) => r.title === 'Stylo')
    const feel = list.findIndex((r) => r.title === 'Feel Good Inc.')
    await app.eval(`document.querySelectorAll('[data-testid=song-row]')[${stylo}].querySelector('[aria-label="Agregar a playlist"]').click()`)
    await waitFor(app, `!!document.querySelector('[role=menuitem]')`, 'add menu')
    await app.eval(`[...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent === 'Para manejar').click()`)
    await waitFor(app, `${status} === 'Agregada a “Para manejar”'`, 'added with menu')
    await app.eval(dragStart('[data-testid=song-row]', feel))
    await sleep(100)
    await app.eval(dropOn('[data-testid=playlist-link]', 0))
    await waitFor(app, `document.querySelector('[data-testid=playlist-link]').textContent.endsWith('2')`, 'added by drag & drop')
    await app.eval(`document.querySelector('[data-testid=playlist-link]').click()`)
    await waitFor(app, `(${playlistTitles}).join() === 'Stylo,Feel Good Inc.'`, 'playlist songs in order')
    await app.eval(dragStart('[data-testid=song-row]:not(.hidden *)', 0))
    await sleep(100)
    // The playlist's rows are the visible ones (library rows stay mounted, hidden).
    await app.eval(`(() => { const rows = [...document.querySelectorAll('[data-testid=song-row]')].filter((r) => r.offsetParent); const o = { bubbles: true, cancelable: true, dataTransfer: window.__dt }; rows[1].dispatchEvent(new DragEvent('dragover', o)); rows[1].dispatchEvent(new DragEvent('drop', o)); return true })()`)
    await waitFor(app, `(${playlistTitles}).join() === 'Feel Good Inc.,Stylo'`, 'reordered')
    await app.eval(`[...document.querySelectorAll('[data-testid=song-row]')].filter((r) => r.offsetParent)[1].querySelector('[aria-label="Quitar de la playlist"]').click()`)
    await waitFor(app, `(${playlistTitles}).join() === 'Feel Good Inc.'`, 'removed from playlist')
    console.log('✓ playlists: create, + menu, drag & drop, reorder, remove')
    await app.eval(click('Biblioteca'))

    // 6g. Shuffle: songs play slowly so nothing advances on its own while we click.
    await app.eval(slow)
    await app.eval(click('Aleatorio'))
    assert.equal(await app.eval<string>(`document.querySelector('[aria-label=Aleatorio]').getAttribute('aria-pressed')`), 'true')
    const order: string[] = [await app.eval<string>(nowPlaying)]
    for (let i = 0; i < 6; i++) {
      await app.eval(click('Siguiente'))
      await waitFor(app, `${nowPlaying} !== ${JSON.stringify(order.at(-1))}`, `shuffle step ${i}`)
      order.push(await app.eval<string>(nowPlaying))
    }
    // Never the same song twice in a row, and with 4 songs every one comes up.
    assert.ok(order.every((t, i) => i === 0 || t !== order[i - 1]), order.join(' → '))
    assert.equal(new Set(order).size, 4, order.join(' → '))
    console.log('✓ shuffle:', order.join(' → '))
    // "Anterior" goes back to what actually played.
    await app.eval(click('Anterior'))
    await waitFor(app, `${nowPlaying} === ${JSON.stringify(order.at(-2))}`, 'previous = last played')
    console.log('✓ previous in shuffle:', order.at(-2))
    await app.eval(click('Pausar'))

    // 7. Upload without a configured cloud explains what to do, uploads nothing.
    await app.eval(click('Subir a la nube'))
    await waitFor(app, `${status}.includes('Configura la nube')`, 'cloud error')
    console.log('✓ upload without cloud:', await app.eval<string>(status))

    // 7b. Delete a song: asks first ("Cancelar" keeps it), then it's gone, also after a restart.
    const titles = `[...document.querySelectorAll('[data-testid=song]')].filter((b) => b.offsetParent).map((b) => b.querySelector('.truncate').textContent)`
    const victim = (await app.eval<string[]>(titles)).find((t) => t !== 'Feel Good Inc.')!
    const trash = `document.querySelector(${JSON.stringify(`[aria-label="Eliminar ${victim}"]`)}).click()`
    await app.eval(`window.confirm = () => false`)
    await app.eval(trash)
    await sleep(500)
    assert.ok((await app.eval<string[]>(titles)).includes(victim), 'Cancelar keeps the song')
    await app.eval(`window.confirm = () => true`)
    await app.eval(trash)
    await waitFor(app, `!(${titles}).includes(${JSON.stringify(victim)}) && (${titles}).length === 3`, 'song deleted')
    console.log('✓ delete a song:', victim)
  } finally {
    await stop(app)
  }

  // 8. Restart: the library (including the added song) and its audio survive.
  await sleep(500)
  app = await launch()
  try {
    await waitFor(app, `document.querySelectorAll('[data-testid=song]').length === 3`, 'library after restart (one deleted)')
    assert.ok(!(await app.eval<boolean>(`document.body.innerText.includes('Importar de eSound')`)), 'import stays hidden after restart')
    const list = await app.eval<Row[]>(rows)
    assert.ok(list.every((r) => r.enabled))
    console.log('✓ restart keeps library:', list.length, 'songs')
    assert.equal(await app.eval<string>(`document.querySelector('[aria-label=Aleatorio]').getAttribute('aria-pressed')`), 'true')
    console.log('✓ restart remembers shuffle')
    await waitFor(app, `(() => { const l = document.querySelector('[data-testid=playlist-link]'); return !!l && l.textContent.includes('Para manejar') && l.textContent.endsWith('1') })()`, 'playlist after restart')
    console.log('✓ restart keeps the playlist')
  } finally {
    await stop(app)
  }
}

run()
  .then(() => {
    console.log('E2E OK')
    // Electron's helper processes can still be closing files for a moment.
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  .catch((err) => {
    console.error('E2E FAILED:', err)
    process.exitCode = 1
  })
  .finally(() => fake.close())
