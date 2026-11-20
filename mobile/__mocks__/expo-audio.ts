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

const initial: Status = { playing: false, currentTime: 0, duration: 0, didJustFinish: false, isBuffering: false }
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
  for (const f of Object.values(mockPlayer)) if (typeof f === 'function' && 'mockClear' in f) f.mockClear()
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
