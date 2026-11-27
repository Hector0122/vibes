// Podcast episodes in the player (streamed from the show's server, each one
// remembering where it was left) and the helpers the Podcasts screen uses.
import type { Podcast, PodcastEpisode } from '../../../src/shared/api'
import { Engine } from '../engine'
import { loadEpisodePositions } from '../offline'
import { episodeProgress, episodeSong, isEpisode, length, published, startAt } from '../podcasts'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const audio = require('expo-audio') as typeof import('../../__mocks__/expo-audio')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('expo-file-system') as typeof import('../../__mocks__/expo-file-system')

const show: Podcast = {
  id: '920666',
  title: 'Leyendas Legendarias',
  author: 'Leyendas',
  image: 'https://img.test/ll.jpg'
}
const ep = (id: string, durationSec: number | null = 3600): PodcastEpisode => ({
  id,
  podcastId: show.id,
  title: `Episodio ${id}`,
  url: `https://cdn.test/${id}.mp3`,
  durationSec,
  publishedAt: 1_700_000_000_000,
  image: null,
  description: ''
})
const flush = () => new Promise((r) => setTimeout(r, 0))

let clock = 1_000_000
let e: Engine
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 10))
  audio.mockPlaylistReset()
  fs.mockFsReset()
  clock = 1_000_000
  e = new Engine(() => clock)
})

it('an episode streams from its own URL, no cloud needed, and keeps the show as the artist', async () => {
  const song = episodeSong(ep('11'), show)
  expect(isEpisode(song)).toBe(true)
  expect(song).toMatchObject({ id: 'pc:11', artists: show.title, coverUrl: show.image })
  await e.playEpisode(song)
  expect(audio.mockPlaylist.uris).toEqual(['https://cdn.test/11.mp3'])
  expect(e.state).toMatchObject({ current: { id: 'pc:11' }, error: null })
})

it('remembers where each episode was left, and starts there next time', async () => {
  await e.playEpisode(episodeSong(ep('11'), show))
  audio.mockPlaylistStatus({ currentTime: 754, duration: 3600, playing: true })
  e.pause()
  await flush()
  const positions = await loadEpisodePositions()
  expect(positions['pc:11']).toMatchObject({ time: 754, duration: 3600 })
  expect(startAt(ep('11'), positions)).toBe(754)
  expect(episodeProgress(ep('11'), positions)).toEqual({ left: 3600 - 754 })
  expect(startAt(ep('12'), positions)).toBe(0)
})

it('heard to the end: marked heard, starts over next time, and nothing else plays after it', async () => {
  await e.playEpisode(episodeSong(ep('11'), show))
  audio.mockPlaylistStatus({
    currentTime: 3600,
    duration: 3600,
    didJustFinish: true,
    playing: false
  })
  await flush()
  const positions = await loadEpisodePositions()
  expect(episodeProgress(ep('11'), positions)).toEqual({ heard: true })
  expect(startAt(ep('11'), positions)).toBe(0)
  expect(audio.mockPlaylist.uris).toEqual(['https://cdn.test/11.mp3'])
})

it('comes back after the app restarts, paused where it was', async () => {
  await e.playEpisode(episodeSong(ep('11'), show))
  audio.mockPlaylistStatus({ currentTime: 300, duration: 3600 })
  e.pause()
  await flush()
  audio.mockPlaylistReset()
  const again = new Engine(() => clock)
  expect(await again.restore([])).toBe(true)
  expect(again.state).toMatchObject({ current: { id: 'pc:11' }, time: 300 })
  again.toggle()
  await flush()
  expect(audio.mockPlaylist.uris).toEqual(['https://cdn.test/11.mp3'])
})

it('formats dates and lengths', () => {
  const now = Date.UTC(2026, 10, 26, 12)
  expect(published(now - 3_600_000, now)).toBe('hoy')
  expect(published(now - 86_400_000, now)).toBe('ayer')
  expect(published(now - 3 * 86_400_000, now)).toBe('hace 3 días')
  expect(published(Date.UTC(2026, 2, 12, 12), now)).toBe('12 mar')
  expect(published(Date.UTC(2024, 2, 12, 12), now)).toBe('12 mar 2024')
  expect(published(null, now)).toBe('')
  expect(length(3900)).toBe('1 h 05 min')
  expect(length(2520)).toBe('42 min')
  expect(length(null)).toBe('')
})
