// The player engine on its own: picking up where you left off, and the sleep timer.
import type { CloudSong } from '../../../src/shared/api'
import { Engine } from '../engine'
import { flushPlays } from '../plays'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const audio = require('expo-audio') as typeof import('../../__mocks__/expo-audio')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('expo-file-system') as typeof import('../../__mocks__/expo-file-system')

const song = (id: string, title: string): CloudSong => ({
  id,
  title,
  artists: 'x',
  album: null,
  deezerId: null,
  deezerArtistId: null,
  isrc: null,
  durationSec: 200,
  coverUrl: null,
  size: 1,
  sha256: 'a'.repeat(64),
  updatedAt: 0
})
const A = song('aaaaaaaaaaa', 'Afuera')
const B = song('bbbbbbbbbbb', 'Sin Documentos')
const C = song('ccccccccccc', 'Flaca')
const flush = () => new Promise((r) => setTimeout(r, 0))

let clock = 1_000_000
let e: Engine
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 10)) // let the previous test's file writes land first
  audio.mockPlaylistReset()
  fs.mockFsReset()
  for (const s of [A, B, C]) fs.mockDisk.set(`file:///docs/vibes/songs/${s.id}.m4a`, 'x') // all downloaded
  clock = 1_000_000
  e = new Engine(() => clock)
  e.setQueue([A, B, C])
})

it('saves what is playing; next time it comes back paused at the same second and resumes from there', async () => {
  await e.play('bbbbbbbbbbb')
  audio.mockPlaylistStatus({ currentTime: 80 })
  e.pause()
  await flush()
  const saved = JSON.parse(fs.mockDisk.get('file:///docs/vibes/session.json')!)
  expect(saved).toMatchObject({
    current: { id: 'bbbbbbbbbbb' },
    time: 80,
    queueIds: [A.id, B.id, C.id]
  })

  // The app is opened again.
  audio.mockPlaylistReset()
  const again = new Engine(() => clock)
  expect(await again.restore([A, B, C])).toBe(true)
  expect(again.state).toMatchObject({
    current: { title: 'Sin Documentos' },
    time: 80,
    playing: false
  })
  again.toggle()
  await flush()
  expect(audio.mockPlaylist.seekTo).toHaveBeenCalledWith(80)
  expect(audio.mockPlaylist.played).toEqual(['file:///docs/vibes/songs/bbbbbbbbbbb.m4a'])
})

it('restore does nothing when there is no saved session, or something already plays', async () => {
  expect(await e.restore([A, B, C])).toBe(false)
  await e.play('aaaaaaaaaaa')
  expect(await e.restore([A, B, C])).toBe(false)
})

it('sleep timer: stops once the time is up (checked as the music plays, so it works with the screen off)', async () => {
  await e.play('aaaaaaaaaaa')
  e.setSleep({ minutes: 30 })
  clock += 29 * 60_000
  audio.mockPlaylistStatus({ currentTime: 10 })
  expect(audio.mockPlaylist.pause).not.toHaveBeenCalled()
  clock += 2 * 60_000
  audio.mockPlaylistStatus({ currentTime: 20 })
  expect(audio.mockPlaylist.pause).toHaveBeenCalled()
  expect(e.state.sleep).toBeNull()
})

it('sleep timer "at the end of this song": the next one does not keep playing', async () => {
  await e.play('aaaaaaaaaaa')
  await flush()
  e.setSleep('endOfSong')
  audio.mockPlaylistFinish()
  expect(audio.mockPlaylist.pause).toHaveBeenCalled()
  expect(e.state.sleep).toBeNull()
})

it('turning shuffle on replaces what was queued next', async () => {
  await e.play('aaaaaaaaaaa')
  await flush()
  expect(audio.mockPlaylist.uris[1]).toContain('bbbbbbbbbbb')
  e.setShuffle(true)
  await flush()
  expect(audio.mockPlaylist.uris).toHaveLength(2)
  expect(audio.mockPlaylist.remove).toHaveBeenCalledWith(1)
})

it('a song listened to for 30 s counts one play, sent to the cloud (kept while offline)', async () => {
  const sent: unknown[] = []
  let online = false
  e.configure({
    sendPlays: async (plays: unknown[]) => {
      if (!online) throw new Error('offline')
      sent.push(...plays)
    }
  } as never)
  await e.play('aaaaaaaaaaa')
  audio.mockPlaylistStatus({ currentTime: 10, duration: 200 })
  audio.mockPlaylistStatus({ currentTime: 31, duration: 200 })
  audio.mockPlaylistStatus({ currentTime: 45, duration: 200 }) // still the same play
  await flush()
  await flush()
  expect(sent).toEqual([])
  expect(JSON.parse(fs.mockDisk.get('file:///docs/vibes/plays.json')!)).toEqual([
    { id: 'aaaaaaaaaaa', at: clock }
  ])

  online = true
  expect(await flushPlays()).toBe(1)
  expect(sent).toEqual([{ id: 'aaaaaaaaaaa', at: clock }])
  expect(JSON.parse(fs.mockDisk.get('file:///docs/vibes/plays.json')!)).toEqual([])
})

it('keeps going song after song on its own (shuffle, screen off)', async () => {
  const many = 'defghijk'.split('').map((c) => song(c.repeat(11), c))
  for (const s of many) fs.mockDisk.set(`file:///docs/vibes/songs/${s.id}.m4a`, 'x')
  e.setQueue(many)
  e.setShuffle(true)
  await e.play(many[0].id)
  await flush()
  for (let i = 0; i < 6; i++) {
    audio.mockPlaylistFinish()
    await flush()
  }
  expect(audio.mockPlaylist.played).toHaveLength(7)
  expect(e.state.current?.id).toBe(audio.mockPlaylist.uris[audio.mockPlaylist.currentIndex].match(/songs\/(\w+)\./)![1])
})

it('the next song could not be queued (no link at the time): it is picked when the song ends', async () => {
  fs.mockDisk.delete(`file:///docs/vibes/songs/${B.id}.m4a`) // not downloaded, and no cloud yet
  await e.play(A.id)
  await flush()
  expect(audio.mockPlaylist.uris).toHaveLength(1) // nothing after A
  fs.mockDisk.set(`file:///docs/vibes/songs/${B.id}.m4a`, 'x') // reachable again
  audio.mockPlaylistFinish()
  await flush()
  expect(e.state.current?.id).toBe(B.id)
  expect(audio.mockPlaylist.played.at(-1)).toContain(B.id)
})

it('a song that fails to load is skipped with a fresh player (Android stays stuck after an error)', async () => {
  await e.play(A.id)
  await flush()
  audio.mockPlaylistFinish() // on to B
  await flush()
  const created = (audio.createAudioPlaylist as jest.Mock).mock.calls.length
  audio.mockPlaylistStatus({ error: { message: 'Source error' } })
  await flush()
  expect(audio.createAudioPlaylist).toHaveBeenCalledTimes(created + 1)
  expect(e.state.current?.id).toBe(C.id)
  expect(audio.mockPlaylist.played.at(-1)).toContain(C.id)
})

it('gives up after one lap of broken songs, and ▶ tries again', async () => {
  await e.play(A.id)
  await flush()
  for (let i = 0; i < 3; i++) {
    audio.mockPlaylistStatus({ error: { message: 'Source error' } })
    await flush()
  }
  expect(e.state.error).toBe('No se pudo reproducir esta canción')
  const loads = audio.mockPlaylist.clear.mock.calls.length
  e.toggle()
  await flush()
  expect(audio.mockPlaylist.clear.mock.calls.length).toBe(loads + 1)
})

it("shuffle doesn't mix languages: from a Spanish song only Spanish ones play next", async () => {
  const es = 'defg'.split('').map((c) => ({ ...song(c.repeat(11), `es ${c}`), lang: 'es' as const }))
  const en = 'hijk'.split('').map((c) => ({ ...song(c.repeat(11), `en ${c}`), lang: 'en' as const }))
  for (const s of [...es, ...en]) fs.mockDisk.set(`file:///docs/vibes/songs/${s.id}.m4a`, 'x')
  e.setQueue([...en, ...es])
  e.setShuffle(true)
  await e.play(es[0].id)
  await flush()
  for (let i = 0; i < 6; i++) {
    audio.mockPlaylistFinish()
    await flush()
  }
  const played = audio.mockPlaylist.played.map((u: string) => u.match(/songs\/(\w+)\./)![1])
  expect(played).toHaveLength(7)
  expect(played.every((id: string) => es.some((s) => s.id === id))).toBe(true)
})

it('moving the bar right after opening (paused, nothing loaded yet): it shows there, is saved, and ▶ starts there', async () => {
  await e.play('bbbbbbbbbbb')
  audio.mockPlaylistStatus({ currentTime: 80 })
  e.pause()
  await flush()
  audio.mockPlaylistReset()
  const again = new Engine(() => clock)
  await again.restore([A, B, C])
  again.seek(150)
  expect(again.state.time).toBe(150)
  await flush()
  expect(JSON.parse(fs.mockDisk.get('file:///docs/vibes/session.json')!).time).toBe(150)
  again.toggle()
  await flush()
  expect(audio.mockPlaylist.seekTo).toHaveBeenCalledWith(150)
})
