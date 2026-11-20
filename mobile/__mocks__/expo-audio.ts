// Jest stand-in for expo-audio (native). One shared fake player records what
// the app asks of it; tests drive its status (e.g. "the song ended") with
// mockStatus(). Used automatically: this folder sits next to node_modules.
import { useEffect, useState } from 'react'

type Status = {
  playing: boolean
  currentTime: number
  duration: number
  didJustFinish: boolean
  isBuffering: boolean
}

const initial: Status = {
  playing: false,
  currentTime: 0,
  duration: 0,
  didJustFinish: false,
  isBuffering: false
}
let status: Status = { ...initial }
const listeners = new Set<(s: Status) => void>()

export function mockStatus(patch: Partial<Status>): void {
  status = { ...status, ...patch }
  listeners.forEach((l) => l(status))
}

export const mockPlayer = {
  sources: [] as string[],
  replace: jest.fn((src: { uri: string }) => {
    mockPlayer.sources.push(src.uri)
    mockStatus({ currentTime: 0, duration: 200, didJustFinish: false })
  }),
  play: jest.fn(() => mockStatus({ playing: true })),
  pause: jest.fn(() => mockStatus({ playing: false })),
  seekTo: jest.fn(async (t: number) => mockStatus({ currentTime: t })),
  setActiveForLockScreen: jest.fn()
}

export function mockReset(): void {
  status = { ...initial }
  mockPlayer.sources = []
  for (const f of Object.values(mockPlayer))
    if (typeof f === 'function' && 'mockClear' in f) f.mockClear()
}

export const setAudioModeAsync = jest.fn(async () => {})
export const useAudioPlayer = (): typeof mockPlayer => mockPlayer
export function useAudioPlayerStatus(): Status {
  const [s, set] = useState(status)
  useEffect(() => {
    listeners.add(set)
    return () => {
      listeners.delete(set)
    }
  }, [])
  return s
}

// ── Native playlist (the app's player) ─────────────────────────────────────
// Holds URIs like ExoPlayer would. `played` logs each URI that started playing.
// Tests end a song with mockPlaylistFinish() (Android moves on by itself) and
// set time with mockPlaylistStatus().
type PlStatus = {
  playing: boolean
  currentTime: number
  duration: number
  isBuffering: boolean
  didJustFinish: boolean
}
type PlListener = (arg: unknown) => void
const plListeners: Record<string, Set<PlListener>> = {
  playlistStatusUpdate: new Set(),
  trackChanged: new Set()
}
let plStatus: PlStatus = {
  playing: false,
  currentTime: 0,
  duration: 0,
  isBuffering: false,
  didJustFinish: false
}

function plEmit(patch: Partial<PlStatus> = {}): void {
  plStatus = { ...plStatus, ...patch }
  plListeners.playlistStatusUpdate.forEach((l) =>
    l({ ...plStatus, currentIndex: mockPlaylist.currentIndex })
  )
}
function plTrackChanged(prev: number): void {
  plStatus = { ...plStatus, currentTime: 0 }
  if (plStatus.playing) mockPlaylist.played.push(mockPlaylist.uris[mockPlaylist.currentIndex])
  plListeners.trackChanged.forEach((l) =>
    l({ previousIndex: prev, currentIndex: mockPlaylist.currentIndex })
  )
  plEmit()
}

export const mockPlaylist = {
  uris: [] as string[],
  currentIndex: 0,
  played: [] as string[],
  add: jest.fn((src: { uri: string }) => {
    mockPlaylist.uris.push(src.uri)
  }),
  insert: jest.fn((src: { uri: string }, i: number) => {
    mockPlaylist.uris.splice(i, 0, src.uri)
    if (i <= mockPlaylist.currentIndex && mockPlaylist.uris.length > 1) mockPlaylist.currentIndex++
  }),
  remove: jest.fn((i: number) => {
    mockPlaylist.uris.splice(i, 1)
    if (i < mockPlaylist.currentIndex) mockPlaylist.currentIndex--
  }),
  clear: jest.fn(() => {
    mockPlaylist.uris = []
    mockPlaylist.currentIndex = 0
    plStatus = { ...plStatus, playing: false, currentTime: 0 }
  }),
  play: jest.fn(() => {
    const was = plStatus.playing
    if (!was || mockPlaylist.played.at(-1) !== mockPlaylist.uris[mockPlaylist.currentIndex]) {
      mockPlaylist.played.push(mockPlaylist.uris[mockPlaylist.currentIndex])
    }
    plEmit({ playing: true, duration: 200 })
  }),
  pause: jest.fn(() => plEmit({ playing: false })),
  seekTo: jest.fn(async (t: number) => plEmit({ currentTime: t })),
  next: jest.fn(() => {
    if (mockPlaylist.currentIndex >= mockPlaylist.uris.length - 1) return
    const prev = mockPlaylist.currentIndex++
    plTrackChanged(prev)
  }),
  previous: jest.fn(() => {
    if (mockPlaylist.currentIndex <= 0) return
    const prev = mockPlaylist.currentIndex--
    plTrackChanged(prev)
  }),
  setActiveForLockScreen: jest.fn(),
  updateLockScreenMetadata: jest.fn(),
  addListener: jest.fn((event: string, l: PlListener) => {
    plListeners[event]?.add(l)
    return { remove: () => plListeners[event]?.delete(l) }
  })
}

/** The song ended: Android moves to the next one in the list, still playing. */
export function mockPlaylistFinish(): void {
  if (mockPlaylist.currentIndex >= mockPlaylist.uris.length - 1) {
    plEmit({ playing: false, didJustFinish: true })
    return
  }
  const prev = mockPlaylist.currentIndex++
  plTrackChanged(prev)
}

export function mockPlaylistStatus(patch: Partial<PlStatus>): void {
  plEmit(patch)
}

export function mockPlaylistReset(): void {
  mockPlaylist.uris = []
  mockPlaylist.currentIndex = 0
  mockPlaylist.played = []
  plStatus = {
    playing: false,
    currentTime: 0,
    duration: 0,
    isBuffering: false,
    didJustFinish: false
  }
  for (const f of Object.values(mockPlaylist))
    if (typeof f === 'function' && 'mockClear' in f) f.mockClear()
}

export const createAudioPlaylist = jest.fn(() => mockPlaylist)
