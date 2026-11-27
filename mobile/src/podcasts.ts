// Podcasts: shows found in Apple's directory (by the Worker), subscribed in the cloud.
// An episode plays straight from the show's own server, as a "song" the player
// knows how to handle (no cloud file, no shuffle, not counted as a play), and each
// one remembers where it was left (offline.ts).
import type { CloudSong, PodcastEpisode, Podcast } from '../../src/shared/api'
import type { EpisodePositions } from './offline'

/** An episode, ready for the player: `episodeUrl` is where its audio is. */
export type EpisodeSong = CloudSong & { episodeUrl: string; podcastId: string }

export const isEpisode = (s: CloudSong | null | undefined): s is EpisodeSong =>
  !!s && typeof (s as Partial<EpisodeSong>).episodeUrl === 'string'

/** Never clashes with a song's 11-character id (they can't have ":"). */
export const episodeSongId = (episodeId: string): string => `pc:${episodeId}`
/** The episode's own id back from the player's ("pc:123" → "123"). */
export const episodeIdOf = (s: EpisodeSong): string => s.id.slice(3)

export function episodeSong(ep: PodcastEpisode, show: Podcast): EpisodeSong {
  return {
    id: episodeSongId(ep.id),
    title: ep.title,
    artists: show.title,
    album: show.title,
    deezerId: null,
    deezerArtistId: null,
    isrc: null,
    durationSec: ep.durationSec,
    coverUrl: ep.image ?? show.image,
    // Marked like a book chapter: the player then plays it on its own, in order, uncounted.
    book: show.title,
    chapter: null,
    size: 0,
    sha256: '',
    updatedAt: ep.publishedAt ?? 0,
    episodeUrl: ep.url,
    podcastId: show.id
  }
}

/** Near the end counts as heard (credits, ads after the outro). */
const HEARD_TAIL_SEC = 60

export type EpisodeProgress = { heard: true } | { left: number } | null

/** Heard, how much is left of a started one, or null when not started. */
export function episodeProgress(ep: PodcastEpisode, positions: EpisodePositions): EpisodeProgress {
  const p = positions[episodeSongId(ep.id)]
  if (!p || p.time < 5) return null
  const duration = p.duration || ep.durationSec || 0
  if (duration > 0 && duration - p.time <= Math.min(HEARD_TAIL_SEC, duration * 0.05 + 5))
    return { heard: true }
  return duration > 0 ? { left: duration - p.time } : { left: 0 }
}

/** Where to start it: where it was left, or from the start once heard. */
export function startAt(ep: PodcastEpisode, positions: EpisodePositions): number {
  const p = episodeProgress(ep, positions)
  return p && 'left' in p ? positions[episodeSongId(ep.id)].time : 0
}

/** "hace 3 días" / "12 mar" / "12 mar 2024". */
export function published(ms: number | null, now = Date.now()): string {
  if (!ms) return ''
  const days = Math.floor((now - ms) / 86_400_000)
  if (days < 1) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} días`
  const d = new Date(ms)
  const months = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic'
  ]
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return `${d.getDate()} ${months[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`
}

/** "1 h 05 min" / "42 min". */
export function length(sec: number | null): string {
  if (!sec || sec < 60) return ''
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}
