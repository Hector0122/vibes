// The whole app in Jest, with a fake Worker behind fetch: first-run setup →
// your cloud library → tap a song (a signed URL reaches the player) → it ends
// and the next one plays → search narrows what plays next → shuffle → a wrong
// token says so. Native pieces (audio, secure storage) are the mocks in /__mocks__.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert, Linking } from 'react-native'
import App from '../../App'
import { engine } from '../engine'
import { Sha256 } from '../sha256'
import { applyPlaylistOp, type CloudSong, type PlaylistOp } from '../../../src/shared/api'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const audio = require('expo-audio') as typeof import('../../__mocks__/expo-audio')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('expo-secure-store') as typeof import('../../__mocks__/expo-secure-store')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('expo-file-system') as typeof import('../../__mocks__/expo-file-system')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require('expo-network') as typeof import('../../__mocks__/expo-network')

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
let OPS: PlaylistOp[] = []
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
/** Begun uploads (their request) and the songs committed after them (audiobook chapters). */
let BEGUN = new Map<string, { meta: CloudSong; size: number; sha256: string }>()
let UPLOADED: CloudSong[] = []
let DELETED: string[] = []
let COVERS: { type: string | null; bytes: number }[] = []
function fakeWorker(): void {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://lrclib.net/')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            trackName: 'Afuera',
            artistName: 'Caifanes',
            duration: 200,
            syncedLyrics: '[00:01.00] Primera\n[00:10.00] Segunda línea',
            plainLyrics: 'Primera\nSegunda línea'
          }
        ]
      } as Response
    }
    if (url.startsWith('https://api.github.com/'))
      return { ok: false, status: 404, json: async () => ({}) } as Response
    requests.push(url)
    if (!online) throw new TypeError('Network request failed')
    const auth = new Headers(init?.headers).get('authorization')
    const json = (body: unknown, status = 200): Response =>
      ({ ok: status < 400, status, json: async () => body }) as Response
    if (auth !== `Bearer ${TOKEN}`) return json({ error: 'Unauthorized' }, 401)
    if (url.endsWith('/v1/health')) return json({ ok: true })
    if (url.endsWith('/v1/songs'))
      return json({ songs: [...SONGS, ...UPLOADED].filter((s) => !DELETED.includes(s.id)) })
    const gone = /\/v1\/songs\/([^/]+)$/.exec(url)
    if (gone && init?.method === 'DELETE') {
      DELETED.push(gone[1])
      return json({ deleted: true })
    }
    const up = /\/v1\/songs\/([^/]+)\/(upload|commit)$/.exec(url)
    if (url.endsWith('/v1/covers') && init?.method === 'POST') {
      COVERS.push({ type: new Headers(init.headers).get('content-type'), bytes: (init.body as Uint8Array).length })
      return json({ coverUrl: `https://worker.test/v1/covers/c${COVERS.length}.png` })
    }
    if (up && up[2] === 'upload') {
      const done = UPLOADED.findIndex((s) => s.id === up[1])
      const req = JSON.parse(String(init?.body))
      // Same file again: only the metadata changes, nothing to upload.
      if (done >= 0) {
        UPLOADED[done] = { ...UPLOADED[done], ...req.meta }
        return json({ url: null, expiresAt: 0 })
      }
      BEGUN.set(up[1], req)
      return json({ url: `https://r2.test/PUT/${up[1]}`, expiresAt: 0 })
    }
    if (up) {
      const b = BEGUN.get(up[1])!
      const s = { ...b.meta, id: up[1], size: b.size, sha256: b.sha256, updatedAt: 1 }
      UPLOADED.push(s)
      return json(s)
    }
    if (url.endsWith('/v1/playlists/ops') && init?.method === 'POST') {
      const { ops } = JSON.parse(String(init.body)) as { ops: PlaylistOp[] }
      OPS.push(...ops)
      PLAYLISTS = ops.reduce((l, op) => applyPlaylistOp(l, op, 5), PLAYLISTS)
      return json({ playlists: PLAYLISTS })
    }
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
  engine.reset()
  audio.mockPlaylistReset()
  fs.mockFsReset()
  net.mockNetwork.type = net.NetworkStateType.WIFI
  requests.length = 0
  PLAYLISTS = []
  REQUESTS = []
  BEGUN = new Map()
  UPLOADED = []
  DELETED = []
  COVERS = []
  OPS = []
  online = true
  fakeWorker()
})

/** A one-finger touch at `pageX` (what PanResponder reads), with the given locationX. */
function touch(locationX: number, pageX: number, timestamp: number) {
  const t = { touchActive: true, startPageX: 20, startPageY: 300, startTimeStamp: 0, currentPageX: pageX, currentPageY: 300,
    currentTimeStamp: timestamp, previousPageX: 20, previousPageY: 300, previousTimeStamp: 0 }
  return {
    nativeEvent: { locationX, pageX, pageY: 300, timestamp, touches: [{ pageX, pageY: 300 }], changedTouches: [] },
    touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: timestamp, touchBank: [t] }
  }
}

const nowPlaying = (): string => screen.getByTestId('now-playing').props.children

/** The app opens on Inicio: this goes to Biblioteca. */
async function renderLibrary(): Promise<void> {
  await render(<App />)
  await fireEvent.press(await screen.findByLabelText('Biblioteca'))
}

it('first run: set up the cloud, then the library appears', async () => {
  await render(<App />)
  await fireEvent.changeText(
    await screen.findByTestId('url'),
    'https://vibes-cloud.example.workers.dev/'
  )
  await fireEvent.changeText(screen.getByTestId('token'), TOKEN)
  await fireEvent.press(screen.getByText('Guardar'))

  await fireEvent.press(await screen.findByLabelText('Biblioteca'))
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

  it('tap a song: it streams from a signed URL, the next one is already queued natively, and Android moves on by itself', async () => {
    await renderLibrary()
    await fireEvent.press(await screen.findByTestId('song-bbbbbbbbbbb'))
    await waitFor(() =>
      expect(audio.mockPlaylist.played).toEqual(['https://r2.test/songs/bbbbbbbbbbb.m4a?sig=1'])
    )
    expect(audio.mockPlaylist.setActiveForLockScreen).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ title: 'Sin Documentos', artist: 'Los Rodríguez' })
    )
    expect(nowPlaying()).toBe('Sin Documentos')
    expect(screen.getByLabelText('Pausar')).toBeTruthy()
    // The next song is in the native list before this one ends (no app work needed with the screen off).
    await waitFor(() => expect(audio.mockPlaylist.uris).toHaveLength(2))
    expect(audio.mockPlaylist.uris[1]).toContain('ccccccccccc')

    // The song ends by itself → Android plays the next; the app follows and queues the one after.
    await act(() => audio.mockPlaylistFinish())
    await waitFor(() => expect(nowPlaying()).toBe('Flaca'))
    expect(audio.mockPlaylist.played.at(-1)).toContain('ccccccccccc')
    expect(audio.mockPlaylist.updateLockScreenMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Flaca' })
    )
    await waitFor(() => expect(audio.mockPlaylist.uris.at(-1)).toContain('aaaaaaaaaaa')) // the list wraps around
    expect(audio.mockPlaylist.uris).toHaveLength(3) // before, playing, after
  })

  it('tap the player: the song big, with synced lyrics that follow the music (saved for offline)', async () => {
    await renderLibrary()
    await fireEvent.press(await screen.findByTestId('song-aaaaaaaaaaa'))
    await waitFor(() => expect(nowPlaying()).toBe('Afuera'))
    await fireEvent.press(screen.getByLabelText('Abrir lo que suena'))
    expect(await screen.findByText('Segunda línea')).toBeTruthy()
    await act(() => audio.mockPlaylistStatus({ currentTime: 12 }))
    await waitFor(() => expect(screen.getByTestId('lyric-now')).toHaveTextContent('Segunda línea'))
    expect(fs.mockDisk.has('file:///docs/vibes/lyrics/aaaaaaaaaaa.json')).toBe(true)

    // The bar: drag shows where it would land; letting go moves the song there.
    const bar = screen.getByTestId('seek-bar')
    await fireEvent(bar, 'layout', { nativeEvent: { layout: { width: 200 } } })
    const t0 = Date.now()
    await fireEvent(bar, 'responderGrant', touch(20, 20, t0))
    // Android's locationX jumps around while moving: the finger's travel (pageX) counts.
    await fireEvent(bar, 'responderMove', touch(3, 150, t0 + 50))
    expect(screen.getByTestId('seek-time')).toHaveTextContent('2:30') // 3/4 of 200 s
    expect(audio.mockPlaylist.seekTo).not.toHaveBeenCalledWith(150)
    // The screen scrolls: it asks for the touch and must not get it.
    expect(bar.props.onResponderTerminationRequest()).toBe(false)
    // A long stream: the seek takes a moment to land.
    audio.mockPlaylist.seekTo.mockImplementationOnce(async () => {})
    await fireEvent(bar, 'responderRelease', touch(3, 150, t0 + 100))
    expect(audio.mockPlaylist.seekTo).toHaveBeenLastCalledWith(150)
    // The player still reports the old spot for a moment: the bar doesn't jump back.
    await act(() => audio.mockPlaylistStatus({ currentTime: 13 }))
    expect(screen.getByTestId('seek-time')).toHaveTextContent('2:30')
    await act(() => audio.mockPlaylistStatus({ currentTime: 150.4 }))
    await act(() => audio.mockPlaylistStatus({ currentTime: 152 }))
    expect(screen.getByTestId('seek-time')).toHaveTextContent('2:32') // then it follows the music
    await fireEvent.press(screen.getByLabelText('Cerrar'))
    expect(await screen.findByTestId('song-bbbbbbbbbbb')).toBeTruthy()
  })

  it('lock screen ⏭ and ⏮ (the native list moves; the app follows)', async () => {
    await renderLibrary()
    await fireEvent.press(await screen.findByTestId('song-aaaaaaaaaaa'))
    await waitFor(() => expect(audio.mockPlaylist.uris).toHaveLength(2))
    await act(() => audio.mockPlaylist.next()) // ⏭ from the lock screen
    await waitFor(() => expect(nowPlaying()).toBe('Sin Documentos'))
    await waitFor(() => expect(audio.mockPlaylist.uris).toHaveLength(3))
    await act(() => audio.mockPlaylist.previous()) // ⏮ from the lock screen
    await waitFor(() => expect(nowPlaying()).toBe('Afuera'))
    expect(audio.mockPlaylist.uris[audio.mockPlaylist.currentIndex]).toContain('aaaaaaaaaaa')
  })

  it('pause, play, previous and next buttons', async () => {
    await renderLibrary()
    await fireEvent.press(await screen.findByTestId('song-aaaaaaaaaaa'))
    await waitFor(() => expect(nowPlaying()).toBe('Afuera'))
    await fireEvent.press(screen.getByLabelText('Pausar'))
    expect(audio.mockPlaylist.pause).toHaveBeenCalled()
    await fireEvent.press(await screen.findByLabelText('Reproducir'))
    expect(audio.mockPlaylist.play).toHaveBeenCalledTimes(2)
    await fireEvent.press(screen.getByLabelText('Siguiente'))
    await waitFor(() => expect(nowPlaying()).toBe('Sin Documentos'))
    await fireEvent.press(screen.getByLabelText('Anterior'))
    await waitFor(() => expect(nowPlaying()).toBe('Afuera'))
  })

  it('search narrows the list, and what plays next stays within it', async () => {
    await renderLibrary()
    await screen.findByTestId('song-aaaaaaaaaaa')
    await fireEvent.changeText(screen.getByTestId('search'), 'cal')
    expect(screen.queryByTestId('song-aaaaaaaaaaa')).toBeNull()
    await fireEvent.press(screen.getByTestId('song-ccccccccccc'))
    await waitFor(() => expect(nowPlaying()).toBe('Flaca'))
    await fireEvent.press(screen.getByLabelText('Siguiente')) // only one song matches: it plays again
    await waitFor(() => expect(audio.mockPlaylist.played).toHaveLength(2))
    expect(audio.mockPlaylist.played.every((u) => u.includes('ccccccccccc'))).toBe(true)
    expect(nowPlaying()).toBe('Flaca')
  })

  it('shuffle plays every song once before repeating, never the same twice in a row', async () => {
    await renderLibrary()
    await screen.findByTestId('song-aaaaaaaaaaa')
    await fireEvent.press(screen.getAllByLabelText('Aleatorio')[0]) // the header button: shuffle all
    await waitFor(() => expect(audio.mockPlaylist.played).toHaveLength(1))
    const order = [nowPlaying()]
    for (let i = 0; i < 2; i++) {
      await fireEvent.press(screen.getByLabelText('Siguiente'))
      await waitFor(() => expect(nowPlaying()).not.toBe(order.at(-1)))
      order.push(nowPlaying())
    }
    expect(new Set(order).size).toBe(3)
  })

  it('after a long pause it gets a fresh signed URL and resumes where it was', async () => {
    await renderLibrary()
    await fireEvent.press(await screen.findByTestId('song-aaaaaaaaaaa'))
    await waitFor(() => expect(audio.mockPlaylist.played).toHaveLength(1))
    await act(() => audio.mockPlaylistStatus({ currentTime: 95 }))
    await fireEvent.press(screen.getByLabelText('Pausar'))
    const now = Date.now()
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000)
    try {
      await fireEvent.press(await screen.findByLabelText('Reproducir'))
      await waitFor(() => expect(audio.mockPlaylist.played).toHaveLength(2))
      expect(audio.mockPlaylist.seekTo).toHaveBeenCalledWith(95)
      expect(audio.mockPlaylist.clear).toHaveBeenCalledTimes(2) // reloaded with a fresh URL
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
    await renderLibrary()
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
    expect(screen.getByTestId('count')).toHaveTextContent('2 canciones · 7 min')
    expect(screen.queryByTestId('song-bbbbbbbbbbb')).toBeNull()

    await fireEvent.press(screen.getByTestId('song-ccccccccccc'))
    await waitFor(() => expect(nowPlaying()).toBe('Flaca'))
    await fireEvent.press(screen.getByLabelText('Siguiente'))
    await waitFor(() => expect(nowPlaying()).toBe('Afuera'))

    await fireEvent.press(screen.getByLabelText('Volver'))
    expect(await screen.findByTestId('song-bbbbbbbbbbb')).toBeTruthy()
  })

  it('audiobooks: upload from the phone, kept out of the music, chapters in order, Continuar where it was left', async () => {
    fs.mockDisk.set('content://dl/Dune%20-%2002.mp3', 'segundo')
    fs.mockDisk.set('content://dl/Dune%20-%2001.mp3', 'primero')
    fs.mockPick.uris = ['content://dl/Dune%20-%2002.mp3', 'content://dl/Dune%20-%2001.mp3']
    await renderLibrary()
    await fireEvent.press(await screen.findByText('Libros'))
    await fireEvent.press(await screen.findByText('Subir audiolibro desde el teléfono'))
    expect(await screen.findByDisplayValue('Dune')).toBeTruthy() // name guessed from the files
    await fireEvent.press(screen.getByText('Guardar'))
    await fireEvent.press(await screen.findByLabelText('Audiolibro: Dune'))

    // Uploaded in file order, as chapters 1 and 2 of "Dune", each straight to storage.
    expect(UPLOADED.map((c) => [c.title, c.book, c.chapter])).toEqual([
      ['Dune - 01', 'Dune', 1],
      ['Dune - 02', 'Dune', 2]
    ])
    expect(fs.mockUploads.urls).toEqual(UPLOADED.map((c) => `https://r2.test/PUT/${c.id}`))
    expect(BEGUN.get(UPLOADED[0].id)!.sha256).toBe(new Sha256().update(Uint8Array.from('primero', (c) => c.charCodeAt(0))).digest())
    expect(screen.getByText('AUDIOLIBRO')).toBeTruthy()

    // Chapters play in order even with shuffle on, and the book stops at its end.
    engine.setShuffle(true)
    await fireEvent.press(screen.getByText('Reproducir'))
    await waitFor(() => expect(nowPlaying()).toBe('Dune - 01'))
    await act(() => audio.mockPlaylistFinish())
    await waitFor(() => expect(nowPlaying()).toBe('Dune - 02'))
    expect(audio.mockPlaylist.uris).toHaveLength(2) // nothing after the last chapter
    await act(() => audio.mockPlaylistStatus({ currentTime: 95 }))
    await fireEvent.press(screen.getByLabelText('Pausar'))

    // Back later: "Continuar" picks up in chapter 2 at 1:35.
    await fireEvent.press(screen.getByLabelText('Volver'))
    await fireEvent.press(screen.getByLabelText('Audiolibro: Dune'))
    await fireEvent.press(await screen.findByText('Continuar'))
    await waitFor(() => expect(audio.mockPlaylist.seekTo).toHaveBeenLastCalledWith(95))
    expect(nowPlaying()).toBe('Dune - 02')

    // Cambiar portada: the picked image goes to the cloud and every chapter shows it.
    fs.mockDisk.set('content://dl/portada.png', 'PNGDATA')
    fs.mockPick.uris = ['content://dl/portada.png']
    await fireEvent.press(screen.getByLabelText('Volver'))
    await fireEvent.press(screen.getByLabelText('Audiolibro: Dune'))
    const putsBefore = fs.mockUploads.urls.length
    await fireEvent.press(await screen.findByText('Cambiar portada'))
    await waitFor(() => expect(UPLOADED.map((c) => c.coverUrl)).toEqual(Array(2).fill('https://worker.test/v1/covers/c1.png')))
    expect(COVERS).toEqual([{ type: 'image/png', bytes: 7 }])
    expect(fs.mockUploads.urls).toHaveLength(putsBefore) // the audio isn't sent again
    expect(UPLOADED.map((c) => c.chapter)).toEqual([1, 2])
    await waitFor(() =>
      expect(screen.container.queryAll((n) => n.props.source?.uri === 'https://worker.test/v1/covers/c1.png').length).toBeGreaterThan(0)
    )

    // A chapter added later keeps the book's cover.
    fs.mockDisk.set('content://dl/Dune%20-%2003.mp3', 'tercero')
    fs.mockPick.uris = ['content://dl/Dune%20-%2003.mp3']
    await fireEvent.press(screen.getByLabelText('Volver'))
    await fireEvent.press(await screen.findByText('Subir audiolibro desde el teléfono'))
    await fireEvent.press(screen.getByText('Guardar'))
    await waitFor(() => expect(UPLOADED).toHaveLength(3))
    expect(UPLOADED[2]).toMatchObject({ chapter: 3, coverUrl: 'https://worker.test/v1/covers/c1.png' })
    await fireEvent.press(await screen.findByLabelText('Audiolibro: Dune'))

    // The music doesn't show the chapters.
    await fireEvent.press(screen.getByLabelText('Volver'))
    await fireEvent.press(screen.getByText('Canciones'))
    expect(screen.getByTestId('count')).toHaveTextContent('3 canciones en tu nube')
    expect(screen.queryByTestId(`song-${UPLOADED[0].id}`)).toBeNull()
  })

  it('Inicio: tap an artist and only their songs show; Biblioteca sorts A–Z with letters', async () => {
    await render(<App />)
    await fireEvent.press(await screen.findByLabelText('Artista: Caifanes'))
    expect(screen.getByTestId('title')).toHaveTextContent('Caifanes')
    expect(await screen.findByTestId('song-aaaaaaaaaaa')).toBeTruthy()
    expect(screen.queryByTestId('song-bbbbbbbbbbb')).toBeNull()

    await fireEvent.press(screen.getByLabelText('Volver'))
    await fireEvent.press(screen.getByLabelText('Ordenar de la A a la Z'))
    const order = screen.getAllByTestId(/^song-/).map((e) => e.props.testID)
    expect(order).toEqual(['song-aaaaaaaaaaa', 'song-ccccccccccc', 'song-bbbbbbbbbbb'])
    expect(screen.getByLabelText('Ir a la F')).toBeTruthy()
    // What plays next follows the order on screen.
    await fireEvent.press(screen.getByTestId('song-aaaaaaaaaaa'))
    await waitFor(() => expect(nowPlaying()).toBe('Afuera'))
    await fireEvent.press(screen.getByLabelText('Siguiente'))
    await waitFor(() => expect(nowPlaying()).toBe('Flaca'))
  })

  it('download a song: from then on it plays from the phone, not a signed URL', async () => {
    await renderLibrary()
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
    expect(audio.mockPlaylist.played).toEqual(['file:///docs/vibes/songs/bbbbbbbbbbb.m4a'])
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
    await renderLibrary()
    expect(await screen.findByTestId('offline')).toBeTruthy()
    expect(await screen.findByTestId('song-bbbbbbbbbbb')).toBeTruthy()
    expect(screen.queryByTestId('song-aaaaaaaaaaa')).toBeNull()
    expect(screen.queryByTestId('error')).toBeNull()
    await fireEvent.press(screen.getByTestId('song-bbbbbbbbbbb'))
    await waitFor(() => expect(nowPlaying()).toBe('Sin Documentos'))
    await act(() => audio.mockPlaylistFinish())
    await waitFor(() => expect(nowPlaying()).toBe('Flaca'))
    expect(requests.filter((u) => u.includes('/stream'))).toEqual([]) // nothing from the internet
    expect(audio.mockPlaylist.played).toEqual([
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
    // "Only downloaded" narrows the whole library to what's on the phone.
    await fireEvent.press(screen.getByLabelText('Volver'))
    await fireEvent.press(screen.getByLabelText('Solo descargadas'))
    expect(screen.queryByTestId('song-ccccccccccc')).toBeNull()
    expect(screen.getByTestId('song-aaaaaaaaaaa')).toBeTruthy()
  })

  it('remove a download (after confirming), and songs gone from the cloud are cleaned up', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.()
    })
    try {
      await renderLibrary()
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
    await renderLibrary()
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
    await renderLibrary()
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
    await renderLibrary()
    await fireEvent.press(await screen.findByLabelText('Agregar música'))
    await fireEvent.changeText(screen.getByTestId('yt-search'), 'x')
    await fireEvent(screen.getByTestId('yt-search'), 'submitEditing')
    expect(await screen.findByTestId('search-error')).toHaveTextContent(
      /Falta la API key de YouTube/
    )
  })

  it('suggestions from the computer show before searching, can be previewed (clip found on Deezer) and marked', async () => {
    await renderLibrary()
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

describe('kept playlists and Wi-Fi', () => {
  beforeEach(() => {
    store.mockStore.set(
      'vibes.cloud',
      JSON.stringify({ url: 'https://w.example.dev', token: TOKEN })
    )
    PLAYLISTS = [
      {
        id: 'p1',
        name: 'Viaje',
        songIds: ['aaaaaaaaaaa', 'ccccccccccc'],
        createdAt: 0,
        updatedAt: 0
      }
    ]
  })

  it('"Mantener descargada" downloads the playlist, and keeps doing it after a refresh', async () => {
    await render(<App />)
    await fireEvent.press(await screen.findByText('Viaje'))
    await fireEvent.press(screen.getByLabelText('Opciones de la playlist'))
    await fireEvent.press(await screen.findByLabelText('Mantener descargada'))
    await waitFor(() => expect(fs.mockDownloads.urls).toHaveLength(2))
    expect(JSON.parse(fs.mockDisk.get('file:///docs/vibes/prefs.json')!)).toEqual({
      wifiOnly: true,
      keep: ['p1']
    })
    // A song is added to it on the computer: the next refresh brings it down too.
    PLAYLISTS = [{ ...PLAYLISTS[0], songIds: ['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb'] }]
    await act(async () => screen.getByTestId('library').props.refreshControl.props.onRefresh())
    await waitFor(() => expect(fs.mockDownloads.urls).toHaveLength(3))
  })

  it('on mobile data: kept playlists wait for Wi-Fi, and a manual download asks first', async () => {
    fs.mockDisk.set(
      'file:///docs/vibes/prefs.json',
      JSON.stringify({ wifiOnly: true, keep: ['p1'] })
    )
    net.mockNetwork.type = net.NetworkStateType.CELLULAR
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    try {
      await renderLibrary()
      await screen.findByTestId('song-bbbbbbbbbbb')
      await act(() => new Promise((r) => setTimeout(r, 20)))
      expect(fs.mockDownloads.urls).toEqual([])
      await fireEvent.press(screen.getByLabelText('Descargar: Sin Documentos'))
      await waitFor(() =>
        expect(alert).toHaveBeenCalledWith(
          'Estás usando datos móviles',
          expect.any(String),
          expect.any(Array)
        )
      )
      expect(fs.mockDownloads.urls).toEqual([])
      // Accepting downloads it.
      const buttons = alert.mock.calls[0][2]!
      await act(async () => buttons.find((b) => b.text === 'Descargar')!.onPress!())
      await waitFor(() => expect(fs.mockDownloads.urls).toHaveLength(1))
    } finally {
      alert.mockRestore()
    }
  })
})

describe('editing playlists on the phone', () => {
  beforeEach(() => {
    store.mockStore.set(
      'vibes.cloud',
      JSON.stringify({ url: 'https://w.example.dev', token: TOKEN })
    )
    PLAYLISTS = [{ id: 'p1', name: 'Viaje', songIds: ['aaaaaaaaaaa'], createdAt: 0, updatedAt: 0 }]
  })

  it('new playlist, add a song with a long press, remove it, rename, delete', async () => {
    await renderLibrary()
    await fireEvent.press(await screen.findByText('Playlists'))
    await fireEvent.press(await screen.findByText('Nueva playlist'))
    await fireEvent.changeText(screen.getByTestId('playlist-name'), 'Gym')
    await fireEvent.press(screen.getByText('Guardar'))
    expect(await screen.findByText('Gym')).toBeTruthy()
    expect(OPS).toMatchObject([{ type: 'create', name: 'Gym' }])
    const gym = OPS[0].id

    await fireEvent.press(screen.getByText('Canciones'))
    await fireEvent(await screen.findByTestId('song-ccccccccccc'), 'longPress')
    await fireEvent.press(await screen.findByText('Agregar a «Gym»'))
    await waitFor(() =>
      expect(OPS.at(-1)).toEqual({ type: 'add', id: gym, songIds: ['ccccccccccc'] })
    )

    await fireEvent.press(screen.getByText('Playlists'))
    await fireEvent.press(await screen.findByText('Gym'))
    expect(await screen.findByTestId('song-ccccccccccc')).toBeTruthy()
    await fireEvent(screen.getByTestId('song-ccccccccccc'), 'longPress')
    await fireEvent.press(await screen.findByText('Quitar de «Gym»'))
    await waitFor(() => expect(screen.queryByTestId('song-ccccccccccc')).toBeNull())

    await fireEvent.press(screen.getByLabelText('Opciones de la playlist'))
    await fireEvent.press(await screen.findByText('Renombrar'))
    await fireEvent.changeText(screen.getByTestId('playlist-name'), 'Gym pesado')
    await fireEvent.press(screen.getByText('Guardar'))
    await waitFor(() => expect(screen.getByTestId('title')).toHaveTextContent('Gym pesado'))

    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, b) => b?.find((x) => x.style === 'destructive')?.onPress?.())
    try {
      await fireEvent.press(screen.getByLabelText('Opciones de la playlist'))
      await fireEvent.press(await screen.findByText('Eliminar playlist'))
      await waitFor(() => expect(PLAYLISTS.map((p) => p.id)).toEqual(['p1']))
      expect(screen.getByTestId('title')).toHaveTextContent('Biblioteca')
    } finally {
      alert.mockRestore()
    }
  })

  it('deleting a song: asks first, then it leaves the cloud, the phone and its playlists', async () => {
    PLAYLISTS = [{ id: 'p1', name: 'Viaje', songIds: ['ccccccccccc', 'aaaaaaaaaaa'], createdAt: 0, updatedAt: 0 }]
    await renderLibrary()
    await fireEvent.press(screen.getByText('Canciones'))
    let answer: 'Cancelar' | 'Eliminar' = 'Cancelar'
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, b) => b?.find((x) => x.text === answer)?.onPress?.())
    try {
      await fireEvent(await screen.findByTestId('song-ccccccccccc'), 'longPress')
      await fireEvent.press(await screen.findByText('Eliminar de tu música'))
      expect(DELETED).toEqual([]) // "Cancelar": nothing happens

      answer = 'Eliminar'
      await fireEvent(screen.getByTestId('song-ccccccccccc'), 'longPress')
      await fireEvent.press(await screen.findByText('Eliminar de tu música'))
      await waitFor(() => expect(screen.queryByTestId('song-ccccccccccc')).toBeNull())
      expect(DELETED).toEqual(['ccccccccccc'])
      expect(OPS).toEqual([{ type: 'remove', id: 'p1', songId: 'ccccccccccc' }])
      expect(PLAYLISTS[0].songIds).toEqual(['aaaaaaaaaaa'])
      expect(screen.getByTestId('count')).toHaveTextContent('2 canciones en tu nube')
    } finally {
      alert.mockRestore()
    }
  })

  it('without internet the edit is undone and says why', async () => {
    await renderLibrary()
    await screen.findByTestId('song-ccccccccccc')
    online = false
    await fireEvent(screen.getByTestId('song-ccccccccccc'), 'longPress')
    await fireEvent.press(await screen.findByText('Agregar a «Viaje»'))
    expect(await screen.findByText('Necesitas internet para editar las playlists')).toBeTruthy()
    await fireEvent.press(screen.getByText('Playlists'))
    await fireEvent.press(await screen.findByText('Viaje'))
    expect(await screen.findByTestId('title')).toHaveTextContent('Viaje')
    expect(screen.queryByTestId('song-ccccccccccc')).toBeNull()
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
