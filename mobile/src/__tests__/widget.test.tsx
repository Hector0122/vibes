// The widget with the app closed: ▶ plays what's downloaded, no internet needed.
import type { CloudSong } from '../../../src/shared/api'
import { engine } from '../engine'
import { widgetTaskHandler } from '../widget/handler'
import { startWidgetSync } from '../widget/sync'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const audio = require('expo-audio') as typeof import('../../__mocks__/expo-audio')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('expo-file-system') as typeof import('../../__mocks__/expo-file-system')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('expo-secure-store') as typeof import('../../__mocks__/expo-secure-store')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const widget =
  require('react-native-android-widget') as typeof import('../../__mocks__/react-native-android-widget')

const song = (id: string, title: string): CloudSong => ({
  id,
  title,
  artists: 'Caifanes',
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
const SONGS = [
  song('aaaaaaaaaaa', 'Afuera'),
  song('bbbbbbbbbbb', 'Viento'),
  song('ccccccccccc', 'Nubes')
]
const click = (clickAction: string) => {
  const renderWidget = jest.fn()
  return {
    renderWidget,
    run: widgetTaskHandler({
      widgetInfo: {
        widgetName: 'Vibes',
        widgetId: 1,
        width: 300,
        height: 80,
        screenInfo: {} as never
      },
      widgetAction: 'WIDGET_CLICK',
      clickAction,
      renderWidget
    })
  }
}

beforeEach(() => {
  engine.reset()
  audio.mockPlaylistReset()
  fs.mockFsReset()
  store.mockStore.clear()
  widget.requestWidgetUpdate.mockClear()
  globalThis.fetch = jest.fn(async () => {
    throw new TypeError('Network request failed') // no internet at all
  }) as unknown as typeof fetch
  store.mockStore.set('vibes.cloud', JSON.stringify({ url: 'https://w.example.dev', token: 't' }))
  fs.mockDisk.set(
    'file:///docs/vibes/library.json',
    JSON.stringify({ songs: SONGS, playlists: [], savedAt: 0 })
  )
  // Only Viento and Nubes are on the phone.
  fs.mockDisk.set(
    'file:///docs/vibes/downloads.json',
    JSON.stringify({ bbbbbbbbbbb: 'a'.repeat(64), ccccccccccc: 'a'.repeat(64) })
  )
  fs.mockDisk.set('file:///docs/vibes/songs/bbbbbbbbbbb.m4a', 'x')
  fs.mockDisk.set('file:///docs/vibes/songs/ccccccccccc.m4a', 'x')
})

it('▶ with the app closed and no internet: shuffles the downloaded songs and shows the song on the widget', async () => {
  startWidgetSync()
  const { run, renderWidget } = click('TOGGLE')
  await run
  expect(audio.mockPlaylist.played).toHaveLength(1)
  expect(audio.mockPlaylist.played[0]).toMatch(
    /^file:\/\/\/docs\/vibes\/songs\/(bbbbbbbbbbb|ccccccccccc)\.m4a$/
  )
  expect(engine.state.shuffle).toBe(true)
  expect(engine.getQueue().map((s) => s.id)).toEqual(['bbbbbbbbbbb', 'ccccccccccc']) // never Afuera: not downloaded
  expect(renderWidget).toHaveBeenCalledWith(
    expect.objectContaining({ props: expect.objectContaining({ playing: true }) })
  )
  expect(widget.requestWidgetUpdate).toHaveBeenCalled()

  // ⏸ then ⏭ from the widget.
  await click('TOGGLE').run
  expect(audio.mockPlaylist.pause).toHaveBeenCalled()
  await new Promise((r) => setTimeout(r, 0))
  await click('NEXT').run
  expect(audio.mockPlaylist.played.length).toBeGreaterThanOrEqual(2)
})

it('picks up last time’s song where it was, if it is downloaded', async () => {
  fs.mockDisk.set(
    'file:///docs/vibes/session.json',
    JSON.stringify({
      current: SONGS[2],
      time: 42,
      queueIds: SONGS.map((s) => s.id),
      shuffle: false,
      savedAt: 0
    })
  )
  await click('TOGGLE').run
  expect(engine.state.current?.title).toBe('Nubes')
  expect(audio.mockPlaylist.seekTo).toHaveBeenCalledWith(42)
  expect(audio.mockPlaylist.played).toEqual(['file:///docs/vibes/songs/ccccccccccc.m4a'])
})

it('last time’s song is not downloaded: it shuffles the downloaded ones instead (no internet needed)', async () => {
  fs.mockDisk.set(
    'file:///docs/vibes/session.json',
    JSON.stringify({
      current: SONGS[0],
      time: 42,
      queueIds: SONGS.map((s) => s.id),
      shuffle: false,
      savedAt: 0
    })
  )
  await click('TOGGLE').run
  expect(engine.state.current?.id).not.toBe('aaaaaaaaaaa')
  expect(audio.mockPlaylist.played[0]).toMatch(/^file:/)
})
