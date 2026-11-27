// Podcast episodes in the player (streamed from the show's server, each one
// remembering where it was left) and the helpers the Podcasts screen uses.
import type { Podcast, PodcastEpisode } from '../../../src/shared/api'
import { Engine } from '../engine'
import { deleteEpisode, downloadEpisode, episodeUri, loadEpisodePositions, loadSavedEpisodes } from '../offline'
import { autoEpisodePlan, episodeProgress, episodeSong, isEpisode, length, published, startAt } from '../podcasts'
import { syncAutoEpisodes } from '../podcastSync'
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

it('downloaded: kept on the phone with its show, listed newest first, plays from the file; removed: streams again', async () => {
  await downloadEpisode(ep('11'), show, 1)
  await downloadEpisode(ep('12'), show, 2)
  expect(fs.mockDownloads.urls).toEqual(['https://cdn.test/11.mp3', 'https://cdn.test/12.mp3'])
  expect((await loadSavedEpisodes()).map((x) => [x.episode.id, x.show.title])).toEqual([
    ['12', show.title],
    ['11', show.title]
  ])
  expect(episodeUri('11')).toBe('file:///docs/vibes/episodes/11.mp3')

  await e.playEpisode(episodeSong(ep('11'), show))
  expect(audio.mockPlaylist.uris).toEqual(['file:///docs/vibes/episodes/11.mp3'])

  await deleteEpisode('11')
  expect(episodeUri('11')).toBeNull()
  expect((await loadSavedEpisodes()).map((x) => x.episode.id)).toEqual(['12'])
  await e.playEpisode(episodeSong(ep('11'), show))
  expect(audio.mockPlaylist.uris.at(-1)).toBe('https://cdn.test/11.mp3')
})

it('a download that fails leaves nothing behind (no half file, not listed)', async () => {
  fs.mockDownloads.hook = async () => {
    throw new Error('red')
  }
  await expect(downloadEpisode(ep('13'), show, 1)).rejects.toThrow('red')
  expect(episodeUri('13')).toBeNull()
  expect(await loadSavedEpisodes()).toEqual([])
  expect([...fs.mockDisk.keys()].filter((k) => k.includes('/episodes/'))).toEqual([])
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

describe('automatic downloads: only the newest episodes you have not heard', () => {
  const eps = (...ids: string[]) => ids.map((id) => ep(id))
  const savedAs = (auto: boolean, ...ids: string[]) => ids.map((id) => ({ episode: ep(id), auto }))
  const heard = { 'pc:6': { time: 3590, duration: 3600, at: 1 } }
  const halfway = { 'pc:4': { time: 900, duration: 3600, at: 1 } }

  it('nothing on the phone: brings the 2 newest, not dozens', () => {
    expect(autoEpisodePlan(eps('5', '4', '3', '2', '1'), [], {})).toEqual({
      download: [ep('5'), ep('4')],
      remove: []
    })
  })

  it('a new one comes out: it comes in, and the oldest of the two (not started) goes', () => {
    const plan = autoEpisodePlan(eps('6', '5', '4', '3'), savedAs(true, '5', '4'), {})
    expect(plan.download.map((e) => e.id)).toEqual(['6'])
    expect(plan.remove).toEqual(['4'])
  })

  it('heard: removed, and nothing older comes to take its place', () => {
    const plan = autoEpisodePlan(eps('6', '5', '4'), savedAs(true, '6', '5'), heard)
    expect(plan).toEqual({ download: [], remove: ['6'] })
  })

  it('halfway through an old one: it stays until you finish it', () => {
    const plan = autoEpisodePlan(eps('6', '5', '4'), savedAs(true, '5', '4'), halfway)
    expect(plan.remove).toEqual([])
  })

  it('downloaded by hand: never removed on its own', () => {
    expect(autoEpisodePlan(eps('6', '5', '4', '1'), savedAs(false, '1'), {}).remove).toEqual([])
  })

  it('sync: on the phone and on disk; again after a new episode; a show you leave takes its automatic ones', async () => {
    let list = eps('5', '4', '3')
    let subs: Podcast[] = [show]
    const cloud = {
      listPodcastSubscriptions: async () => subs.map((p) => ({ ...p, subscribedAt: 1 })),
      podcastEpisodes: async () => list
    }
    expect(await syncAutoEpisodes(cloud, 1)).toEqual({ downloaded: 2, removed: 0 })
    expect((await loadSavedEpisodes()).map((x) => [x.episode.id, x.auto]).sort()).toEqual([
      ['4', true],
      ['5', true]
    ])

    list = eps('6', '5', '4', '3')
    expect(await syncAutoEpisodes(cloud, 2)).toEqual({ downloaded: 1, removed: 1 })
    expect((await loadSavedEpisodes()).map((x) => x.episode.id).sort()).toEqual(['5', '6'])
    expect(episodeUri('4')).toBeNull()

    expect(await syncAutoEpisodes(cloud, 3)).toEqual({ downloaded: 0, removed: 0 }) // nothing new: nothing moves

    subs = []
    expect(await syncAutoEpisodes(cloud, 4)).toEqual({ downloaded: 0, removed: 2 })
    expect(await loadSavedEpisodes()).toEqual([])
  })

  it('sync: Apple not answering for a show leaves its episodes as they are', async () => {
    await downloadEpisode(ep('5'), show, 1, true)
    const cloud = {
      listPodcastSubscriptions: async () => [{ ...show, subscribedAt: 1 }],
      podcastEpisodes: async () => {
        throw new Error('Apple Podcasts no respondió')
      }
    }
    expect(await syncAutoEpisodes(cloud, 2)).toEqual({ downloaded: 0, removed: 0 })
    expect(episodeUri('5')).not.toBeNull()
  })
})
