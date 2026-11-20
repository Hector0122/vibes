// The whole app in Jest, with a fake Worker behind fetch: first-run setup →
// your cloud library → tap a song (a signed URL reaches the player) → it ends
// and the next one plays → search narrows what plays next → shuffle → a wrong
// token says so. Native pieces (audio, secure storage) are the mocks in /__mocks__.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import App from '../../App'
import type { CloudSong } from '../../../src/shared/api'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const audio = require('expo-audio') as typeof import('../../__mocks__/expo-audio')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('expo-secure-store') as typeof import('../../__mocks__/expo-secure-store')

const TOKEN = 'secret-token'
const song = (id: string, title: string, artists: string): CloudSong => ({
  id,
  title,
  artists,
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
  song('aaaaaaaaaaa', 'Afuera', 'Caifanes'),
  song('bbbbbbbbbbb', 'Sin Documentos', 'Los Rodríguez'),
  song('ccccccccccc', 'Flaca', 'Andrés Calamaro')
]

/** A Worker that answers like the real one: /health, /songs, /songs/:id/stream; 401 on a wrong token. */
const requests: string[] = []
function fakeWorker(): void {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push(url)
    const auth = new Headers(init?.headers).get('authorization')
    const json = (body: unknown, status = 200): Response =>
      ({ ok: status < 400, status, json: async () => body }) as Response
    if (auth !== `Bearer ${TOKEN}`) return json({ error: 'Unauthorized' }, 401)
    if (url.endsWith('/v1/health')) return json({ ok: true })
    if (url.endsWith('/v1/songs')) return json({ songs: SONGS })
    const m = /\/v1\/songs\/([^/]+)\/stream$/.exec(url)
    if (m) return json({ url: `https://r2.test/songs/${m[1]}.m4a?sig=1`, expiresAt: 0 })
    return json({ error: 'Not found' }, 404)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  store.mockStore.clear()
  audio.mockReset()
  requests.length = 0
  fakeWorker()
})

const nowPlaying = (): string => screen.getByTestId('now-playing').props.children

it('first run: set up the cloud, then the library appears', async () => {
  await render(<App />)
  await fireEvent.changeText(await screen.findByTestId('url'), 'https://vibes-cloud.example.workers.dev/')
  await fireEvent.changeText(screen.getByTestId('token'), TOKEN)
  await fireEvent.press(screen.getByText('Guardar'))

  expect(await screen.findByText('3 canciones en tu nube')).toBeTruthy()
  expect(JSON.parse(store.mockStore.get('vibes.cloud')!)).toEqual({
    url: 'https://vibes-cloud.example.workers.dev',
    token: TOKEN
  })
  expect(requests[0]).toBe('https://vibes-cloud.example.workers.dev/v1/health')
})

it('a wrong token is caught before saving', async () => {
  await render(<App />)
  await fireEvent.changeText(await screen.findByTestId('url'), 'https://w.example.dev')
  await fireEvent.changeText(screen.getByTestId('token'), 'nope')
  await fireEvent.press(screen.getByText('Guardar'))
  expect(await screen.findByText('Token de la nube inválido')).toBeTruthy()
  expect(store.mockStore.size).toBe(0)
})

describe('with the cloud set up', () => {
  beforeEach(() => {
    store.mockStore.set('vibes.cloud', JSON.stringify({ url: 'https://w.example.dev', token: TOKEN }))
  })

  it('tap a song: it streams from a signed URL, shows on the lock screen, and plays the next one when it ends', async () => {
    await render(<App />)
    await fireEvent.press(await screen.findByTestId('song-bbbbbbbbbbb'))
    await waitFor(() => expect(audio.mockPlayer.sources).toEqual(['https://r2.test/songs/bbbbbbbbbbb.m4a?sig=1']))
    expect(audio.mockPlayer.play).toHaveBeenCalled()
    expect(audio.mockPlayer.setActiveForLockScreen).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ title: 'Sin Documentos', artist: 'Los Rodríguez' })
    )
    expect(nowPlaying()).toBe('Sin Documentos')
    expect(screen.getByLabelText('Pausar')).toBeTruthy()

    // The song ends by itself → the next in the list.
    await act(() => audio.mockStatus({ didJustFinish: true, playing: false }))
    await waitFor(() => expect(nowPlaying()).toBe('Flaca'))
    expect(audio.mockPlayer.sources.at(-1)).toContain('ccccccccccc')
  })

  it('pause, play, previous and next buttons', async () => {
    await render(<App />)
    await fireEvent.press(await screen.findByTestId('song-aaaaaaaaaaa'))
    await waitFor(() => expect(nowPlaying()).toBe('Afuera'))
    await fireEvent.press(screen.getByLabelText('Pausar'))
    expect(audio.mockPlayer.pause).toHaveBeenCalled()
    await fireEvent.press(await screen.findByLabelText('Reproducir'))
    expect(audio.mockPlayer.play).toHaveBeenCalledTimes(2)
    await fireEvent.press(screen.getByLabelText('Siguiente'))
    await waitFor(() => expect(nowPlaying()).toBe('Sin Documentos'))
    await fireEvent.press(screen.getByLabelText('Anterior'))
    await waitFor(() => expect(nowPlaying()).toBe('Afuera'))
  })

  it('search narrows the list, and what plays next stays within it', async () => {
    await render(<App />)
    await screen.findByTestId('song-aaaaaaaaaaa')
    await fireEvent.changeText(screen.getByTestId('search'), 'cal')
    expect(screen.queryByTestId('song-aaaaaaaaaaa')).toBeNull()
    await fireEvent.press(screen.getByTestId('song-ccccccccccc'))
    await waitFor(() => expect(nowPlaying()).toBe('Flaca'))
    await fireEvent.press(screen.getByLabelText('Siguiente')) // only one song matches: it starts over
    await waitFor(() => expect(audio.mockPlayer.seekTo).toHaveBeenCalledWith(0))
    expect(nowPlaying()).toBe('Flaca')
  })

  it('shuffle plays every song once before repeating, never the same twice in a row', async () => {
    await render(<App />)
    await screen.findByTestId('song-aaaaaaaaaaa')
    await fireEvent.press(screen.getAllByLabelText('Aleatorio')[0]) // the header button: shuffle all
    await waitFor(() => expect(audio.mockPlayer.sources).toHaveLength(1))
    const order = [nowPlaying()]
    for (let i = 0; i < 2; i++) {
      await fireEvent.press(screen.getByLabelText('Siguiente'))
      await waitFor(() => expect(nowPlaying()).not.toBe(order.at(-1)))
      order.push(nowPlaying())
    }
    expect(new Set(order).size).toBe(3)
  })

  it('after a long pause it gets a fresh signed URL and resumes where it was', async () => {
    await render(<App />)
    await fireEvent.press(await screen.findByTestId('song-aaaaaaaaaaa'))
    await waitFor(() => expect(audio.mockPlayer.sources).toHaveLength(1))
    await act(() => audio.mockStatus({ currentTime: 95 }))
    await fireEvent.press(screen.getByLabelText('Pausar'))
    const now = Date.now()
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000)
    try {
      await fireEvent.press(await screen.findByLabelText('Reproducir'))
      await waitFor(() => expect(audio.mockPlayer.sources).toHaveLength(2))
      expect(audio.mockPlayer.seekTo).toHaveBeenCalledWith(95)
      expect(nowPlaying()).toBe('Afuera')
    } finally {
      clock.mockRestore()
    }
  })

  it('an expired token later shows the error instead of the songs', async () => {
    store.mockStore.set('vibes.cloud', JSON.stringify({ url: 'https://w.example.dev', token: 'old' }))
    await render(<App />)
    expect(await screen.findByTestId('error')).toHaveTextContent('Token de la nube inválido')
    expect(screen.getByText('0 canciones en tu nube')).toBeTruthy()
  })
})
