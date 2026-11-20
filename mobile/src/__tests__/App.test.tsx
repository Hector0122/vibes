// The whole app in Jest, with a fake Worker behind fetch: first-run setup →
// your cloud library → tap a song (a signed URL reaches the player) → it ends
// and the next one plays → search narrows what plays next → shuffle → a wrong
// token says so. Native pieces (audio, secure storage) are the mocks in /__mocks__.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert, Linking } from 'react-native'
import App from '../../App'
import type { CloudSong } from '../../../src/shared/api'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const audio = require('expo-audio') as typeof import('../../__mocks__/expo-audio')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('expo-secure-store') as typeof import('../../__mocks__/expo-secure-store')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('expo-file-system') as typeof import('../../__mocks__/expo-file-system')

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

/** A Worker that answers like the real one: /health, /songs, /playlists, /songs/:id/stream; 401 on a wrong token. */
const requests: string[] = []
let PLAYLISTS: {
  id: string
  name: string
  songIds: string[]
  createdAt: number
  updatedAt: number
}[] = []
let online = true
type Req = {
  id: string
  title: string
  artists: string
  durationSec: number | null
  coverUrl: string | null
  status: 'pending' | 'failed'
  error: string | null
  createdAt: number
}
let REQUESTS: Req[] = []
function fakeWorker(): void {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://api.github.com/'))
      return { ok: false, status: 404, json: async () => ({}) } as Response
    requests.push(url)
    if (!online) throw new TypeError('Network request failed')
    const auth = new Headers(init?.headers).get('authorization')
    const json = (body: unknown, status = 200): Response =>
      ({ ok: status < 400, status, json: async () => body }) as Response
    if (auth !== `Bearer ${TOKEN}`) return json({ error: 'Unauthorized' }, 401)
    if (url.endsWith('/v1/health')) return json({ ok: true })
    if (url.endsWith('/v1/songs')) return json({ songs: [...SONGS] })
    if (url.endsWith('/v1/playlists')) return json({ playlists: PLAYLISTS })
    if (url.includes('/v1/search?q=')) {
      const hit = (id: string, title: string, previewUrl: string | null) => ({
        id,
        title,
        artists: 'Soda Stereo',
        durationSec: 250,
        coverUrl: null,
        deezerId: id.slice(2),
        previewUrl
      })
      return json({
        results: [
          {
            ...hit('dz111', 'De Música Ligera', 'https://cdn.deezer.test/111.mp3'),
            inCloud: false,
            requested: false
          },
          { ...hit('dz222', 'Afuera', null), inCloud: true, requested: false }
        ]
      })
    }
    if (url.endsWith('/v1/recommendations')) {
      return json({
        basedOn: ['Afuera'],
        results: [
          {
            id: 'fffffffffff',
            title: 'La Célula Que Explota',
            artists: 'Caifanes',
            durationSec: 220,
            coverUrl: null,
            inCloud: false,
            requested: false
          }
        ],
        updatedAt: 1
      })
    }
    if (url.endsWith('/v1/requests') && (init?.method ?? 'GET') === 'GET')
      return json({ requests: REQUESTS })
    if (url.endsWith('/v1/requests') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Req
      const r: Req = { ...body, status: 'pending', error: null, createdAt: 1 }
      REQUESTS = [...REQUESTS.filter((x) => x.id !== r.id), r]
      return json(r)
    }
    const del = /\/v1\/requests\/([^/]+)$/.exec(url)
    if (del && init?.method === 'DELETE') {
      REQUESTS = REQUESTS.filter((x) => x.id !== del[1])
      return json({ deleted: true })
    }
    const m = /\/v1\/songs\/([^/]+)\/stream$/.exec(url)
    if (m) return json({ url: `https://r2.test/songs/${m[1]}.m4a?sig=1`, expiresAt: 0 })
    return json({ error: 'Not found' }, 404)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  store.mockStore.clear()
  audio.mockReset()
  fs.mockFsReset()
  requests.length = 0
  PLAYLISTS = []
  REQUESTS = []
  online = true
  fakeWorker()
})

const nowPlaying = (): string => screen.getByTestId('now-playing').props.children

it('first run: set up the cloud, then the library appears', async () => {
  await render(<App />)
  await fireEvent.changeText(
    await screen.findByTestId('url'),
    'https://vibes-cloud.example.workers.dev/'
  )
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
    store.mockStore.set(
      'vibes.cloud',
      JSON.stringify({ url: 'https://w.example.dev', token: TOKEN })
    )
  })

  it('tap a song: it streams from a signed URL, shows on the lock screen, and plays the next one when it ends', async () => {
    await render(<App />)
    await fireEvent.press(await screen.findByTestId('song-bbbbbbbbbbb'))
    await waitFor(() =>
      expect(audio.mockPlayer.sources).toEqual(['https://r2.test/songs/bbbbbbbbbbb.m4a?sig=1'])
    )
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
    store.mockStore.set(
      'vibes.cloud',
      JSON.stringify({ url: 'https://w.example.dev', token: 'old' })
    )
    await render(<App />)
    expect(await screen.findByTestId('error')).toHaveTextContent('Token de la nube inválido')
    expect(screen.getByText('0 canciones en tu nube')).toBeTruthy()
  })

  it('playlists from the computer: pick one, it shows and plays only its songs, in its order', async () => {
    PLAYLISTS = [
      // 'zzzzzzzzzzz' isn't uploaded yet: it doesn't show.
      {
        id: 'p1',
        name: 'Rock en tu idioma',
        songIds: ['ccccccccccc', 'zzzzzzzzzzz', 'aaaaaaaaaaa'],
        createdAt: 0,
        updatedAt: 0
      }
    ]
    await render(<App />)
    await fireEvent.press(await screen.findByText('Rock en tu idioma'))
    expect(screen.getByTestId('title')).toHaveTextContent('Rock en tu idioma')
    expect(screen.getByTestId('count')).toHaveTextContent('2 canciones')
    expect(screen.queryByTestId('song-bbbbbbbbbbb')).toBeNull()

    await fireEvent.press(screen.getByTestId('song-ccccccccccc'))
    await waitFor(() => expect(nowPlaying()).toBe('Flaca'))
    await fireEvent.press(screen.getByLabelText('Siguiente'))
    await waitFor(() => expect(nowPlaying()).toBe('Afuera'))

    await fireEvent.press(screen.getByText('Todas'))
    expect(await screen.findByTestId('song-bbbbbbbbbbb')).toBeTruthy()
  })

  it('download a song: from then on it plays from the phone, not a signed URL', async () => {
    await render(<App />)
    await fireEvent.press(await screen.findByLabelText('Descargar: Sin Documentos'))
    expect(await screen.findByLabelText('Quitar del teléfono: Sin Documentos')).toBeTruthy()
    expect(screen.getByTestId('downloaded-count')).toHaveTextContent('1 en el teléfono')
    expect(fs.mockDownloads.urls).toEqual(['https://r2.test/songs/bbbbbbbbbbb.m4a?sig=1'])
    // What a later launch reads: the library copy and the downloads index.
    expect(JSON.parse(fs.mockDisk.get('file:///docs/vibes/library.json')!).songs).toHaveLength(3)
    expect(JSON.parse(fs.mockDisk.get('file:///docs/vibes/downloads.json')!)).toEqual({
      bbbbbbbbbbb: 'a'.repeat(64)
    })

    await fireEvent.press(screen.getByTestId('song-bbbbbbbbbbb'))
    await waitFor(() => expect(nowPlaying()).toBe('Sin Documentos'))
    expect(audio.mockPlayer.sources).toEqual(['file:///docs/vibes/songs/bbbbbbbbbbb.m4a'])
  })

  it('without internet: the saved library opens, only downloads show, and they play', async () => {
    fs.mockDisk.set(
      'file:///docs/vibes/library.json',
      JSON.stringify({ songs: SONGS, playlists: [], savedAt: 0 })
    )
    fs.mockDisk.set(
      'file:///docs/vibes/downloads.json',
      JSON.stringify({ bbbbbbbbbbb: 'a'.repeat(64), ccccccccccc: 'a'.repeat(64) })
    )
    fs.mockDisk.set('file:///docs/vibes/songs/bbbbbbbbbbb.m4a', 'x')
    fs.mockDisk.set('file:///docs/vibes/songs/ccccccccccc.m4a', 'x')
    online = false
    await render(<App />)
    expect(await screen.findByTestId('offline')).toBeTruthy()
    expect(await screen.findByTestId('song-bbbbbbbbbbb')).toBeTruthy()
    expect(screen.queryByTestId('song-aaaaaaaaaaa')).toBeNull()
    expect(screen.queryByTestId('error')).toBeNull()
    await fireEvent.press(screen.getByTestId('song-bbbbbbbbbbb'))
    await waitFor(() => expect(nowPlaying()).toBe('Sin Documentos'))
    await act(() => audio.mockStatus({ didJustFinish: true, playing: false }))
    await waitFor(() => expect(nowPlaying()).toBe('Flaca'))
    expect(audio.mockPlayer.sources).toEqual([
      'file:///docs/vibes/songs/bbbbbbbbbbb.m4a',
      'file:///docs/vibes/songs/ccccccccccc.m4a'
    ])
  })

  it('download a whole playlist with one tap; an incomplete file is not kept', async () => {
    PLAYLISTS = [
      {
        id: 'p1',
        name: 'Viaje',
        songIds: ['aaaaaaaaaaa', 'ccccccccccc'],
        createdAt: 0,
        updatedAt: 0
      }
    ]
    fs.mockDownloads.size = (url) => (url.includes('ccccccccccc') ? 0 : 1) // the second arrives cut
    await render(<App />)
    await fireEvent.press(await screen.findByText('Viaje'))
    await fireEvent.press(screen.getByText('Descargar las 2 para escuchar sin internet'))
    await waitFor(() => expect(fs.mockDownloads.urls).toHaveLength(2))
    expect(await screen.findByLabelText('Quitar del teléfono: Afuera')).toBeTruthy()
    expect(await screen.findByText('La descarga quedó incompleta')).toBeTruthy()
    expect(screen.getByLabelText('Descargar: Flaca')).toBeTruthy()
    expect([...fs.mockDisk.keys()].filter((k) => k.includes('/songs/'))).toEqual([
      'file:///docs/vibes/songs/aaaaaaaaaaa.m4a'
    ])
    // "Only downloaded" narrows the list to what's on the phone.
    await fireEvent.press(screen.getByLabelText('Solo descargadas'))
    expect(screen.queryByTestId('song-ccccccccccc')).toBeNull()
    expect(screen.getByTestId('song-aaaaaaaaaaa')).toBeTruthy()
  })

  it('remove a download (after confirming), and songs gone from the cloud are cleaned up', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.()
    })
    try {
      await render(<App />)
      await fireEvent.press(await screen.findByLabelText('Descargar: Afuera'))
      await fireEvent.press(await screen.findByLabelText('Descargar: Flaca'))
      await screen.findByLabelText('Quitar del teléfono: Flaca')
      await fireEvent.press(await screen.findByLabelText('Quitar del teléfono: Afuera'))
      expect(await screen.findByLabelText('Descargar: Afuera')).toBeTruthy()
      expect(fs.mockDisk.has('file:///docs/vibes/songs/aaaaaaaaaaa.m4a')).toBe(false)

      // Flaca is deleted from the cloud on the computer: pulling to refresh removes its copy.
      SONGS.splice(2, 1)
      try {
        const list = screen.getByTestId('library')
        await act(async () => list.props.refreshControl.props.onRefresh())
        await waitFor(() =>
          expect(fs.mockDisk.has('file:///docs/vibes/songs/ccccccccccc.m4a')).toBe(false)
        )
      } finally {
        SONGS.push(song('ccccccccccc', 'Flaca', 'Andrés Calamaro'))
      }
    } finally {
      alert.mockRestore()
    }
  })

  it('search (Deezer), listen to the 30-second clip, mark a song: it waits for the computer; cancel it', async () => {
    await render(<App />)
    await fireEvent.press(await screen.findByLabelText('Agregar música'))
    await fireEvent.changeText(screen.getByTestId('yt-search'), 'soda stereo')
    await fireEvent(screen.getByTestId('yt-search'), 'submitEditing')
    expect(await screen.findByTestId('result-dz111')).toBeTruthy()
    expect(requests.at(-1)).toBe('https://w.example.dev/v1/search?q=soda%20stereo')
    expect(screen.getByText('En tu nube')).toBeTruthy() // Afuera is already there: no button
    expect(screen.queryByLabelText('Escuchar: Afuera')).toBeNull() // no clip for it

    await fireEvent.press(screen.getByLabelText('Escuchar: De Música Ligera'))
    expect(audio.mockPlayer.sources).toEqual(['https://cdn.deezer.test/111.mp3'])
    await fireEvent.press(await screen.findByLabelText('Detener: De Música Ligera'))
    expect(audio.mockPlayer.pause).toHaveBeenCalled()

    await fireEvent.press(screen.getByLabelText('Agregar: De Música Ligera'))
    expect(await screen.findByText('Pendiente')).toBeTruthy()
    expect(REQUESTS).toMatchObject([{ id: 'dz111', deezerId: '111' }])

    await fireEvent.press(screen.getByLabelText('Volver'))
    expect(await screen.findByText('Esperando a la compu (1)')).toBeTruthy()
    await fireEvent.press(screen.getByLabelText('Cancelar: De Música Ligera'))
    await waitFor(() => expect(screen.queryByTestId('requests')).toBeNull())
    expect(REQUESTS).toEqual([])
  })

  it('a song the computer could not get shows why, and can be retried', async () => {
    REQUESTS = [
      {
        id: 'eeeeeeeeeee',
        title: 'Persiana Americana',
        artists: 'Soda Stereo',
        durationSec: null,
        coverUrl: null,
        status: 'failed',
        error: 'Video no disponible',
        createdAt: 0
      }
    ]
    await render(<App />)
    expect(await screen.findByText('Video no disponible')).toBeTruthy()
    await fireEvent.press(screen.getByLabelText('Reintentar: Persiana Americana'))
    await waitFor(() => expect(screen.queryByText('Video no disponible')).toBeNull())
    expect(REQUESTS[0].status).toBe('pending')
  })

  it('search errors (no YouTube key in the cloud) are shown', async () => {
    const base = globalThis.fetch
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/search')
        ? ({
            ok: false,
            status: 501,
            json: async () => ({ error: 'Falta la API key de YouTube en tu nube' })
          } as Response)
        : base(input, init)
    ) as unknown as typeof fetch
    await render(<App />)
    await fireEvent.press(await screen.findByLabelText('Agregar música'))
    await fireEvent.changeText(screen.getByTestId('yt-search'), 'x')
    await fireEvent(screen.getByTestId('yt-search'), 'submitEditing')
    expect(await screen.findByTestId('search-error')).toHaveTextContent(
      /Falta la API key de YouTube/
    )
  })

  it('suggestions from the computer show before searching, can be previewed (clip found on Deezer) and marked', async () => {
    await render(<App />)
    await fireEvent.press(await screen.findByLabelText('Agregar música'))
    expect(await screen.findByText('Recomendado para ti')).toBeTruthy()
    expect(screen.getByText('Por escuchar Afuera')).toBeTruthy()
    await fireEvent.press(screen.getByLabelText('Escuchar: La Célula Que Explota'))
    await waitFor(() =>
      expect(audio.mockPlayer.sources).toEqual(['https://cdn.deezer.test/111.mp3'])
    )
    expect(requests.at(-1)).toBe(
      'https://w.example.dev/v1/search?q=Caifanes%20La%20C%C3%A9lula%20Que%20Explota'
    )
    await fireEvent.press(screen.getByLabelText('Agregar: La Célula Que Explota'))
    expect(await screen.findByText('Pendiente')).toBeTruthy()
    expect(REQUESTS.map((r) => r.id)).toEqual(['fffffffffff'])
  })
})

it('a newer release on GitHub offers to download its APK', async () => {
  const base = globalThis.fetch
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === 'https://api.github.com/repos/Hector0122/vibes/releases/latest'
      ? ({
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: 'v99.0.0',
            assets: [
              {
                name: 'vibes-99.0.0.apk',
                browser_download_url: 'https://github.com/x/vibes-99.0.0.apk'
              }
            ]
          })
        } as Response)
      : base(input, init)
  ) as unknown as typeof fetch
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never)
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === 'Actualizar')?.onPress?.()
  })
  try {
    await render(<App />)
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'Nueva versión disponible',
        'Vibes 99.0.0 está lista para instalar.',
        expect.any(Array)
      )
    )
    expect(open).toHaveBeenCalledWith('https://github.com/x/vibes-99.0.0.apk')
  } finally {
    alert.mockRestore()
    open.mockRestore()
  }
})
