// The phone's player, outside React: the screens, the lock screen and the home
// screen widget all drive this one instance.
//
// It uses expo-audio's native playlist (ExoPlayer) holding the song before, the
// one playing and the one after. When a song ends, Android moves on to the next
// one by itself, so music keeps going with the screen off, and the lock screen
// gets ⏮ ⏭ buttons. On every track change we queue the following song (what
// comes next uses the same logic as the desktop, ../../src/shared/queue.ts).
//
// The native track-change event reports positions that drift as songs are added
// and removed, so each queued song gets a token and we follow tokens, not indexes.
import {
  createAudioPlaylist,
  setAudioModeAsync,
  type AudioPlaylist,
  type AudioPlaylistStatus
} from 'expo-audio'
import type { CloudSong } from '../../src/shared/api'
import { isListened, pickNext, pickPrev, remember } from '../../src/shared/queue'
import { chaptersOf } from './books'
import type { Cloud } from './cloud'
import * as store from './offline'
import { recordPlay, setPlaysCloud } from './plays'

/** Signed URLs last 15 min; after a long pause a streamed song gets a fresh one. */
const STALE_AFTER_MS = 10 * 60_000
const SAVE_EVERY_MS = 15_000

export type Sleep = { at: number } | { endOfSong: true }

export interface PlayerState {
  current: CloudSong | null
  playing: boolean
  loading: boolean
  error: string | null
  time: number
  duration: number
  shuffle: boolean
  sleep: Sleep | null
}

interface Item {
  token: number
  song: CloudSong
  streamed: boolean
}

const meta = (s: CloudSong) => ({
  title: s.title,
  artist: s.artists,
  albumTitle: s.album ?? undefined,
  artworkUrl: s.coverUrl ?? undefined
})

export class Engine {
  private pl: AudioPlaylist | null = null
  private cloud: Cloud | null = null
  private queue: CloudSong[] = []
  /** The audiobook playing, in order: it keeps going whatever list the screen shows. */
  private chapters: CloudSong[] = []
  /** Mirrors the native playlist, in order. */
  private items: Item[] = []
  private currentToken = 0
  private tokens = 0
  private bag: string[] = []
  private history: string[] = []
  private pausedAt: number | null = null
  /** Bumped by every new load: a slower, older one must not win. */
  private loadSeq = 0
  /** The current song isn't in the native list yet (restored from last time). */
  private needsLoad = false
  private resumeAt = 0
  private lastSave = 0
  /** The token of the last song whose play was counted (once per time it plays). */
  private countedToken = 0
  /** Songs in a row that failed to play. */
  private failures = 0
  private listeners = new Set<() => void>()
  state: PlayerState = {
    current: null,
    playing: false,
    loading: false,
    error: null,
    time: 0,
    duration: 0,
    shuffle: false,
    sleep: null
  }

  constructor(private readonly now: () => number = () => Date.now()) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getState = (): PlayerState => this.state

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  configure(cloud: Cloud | null): void {
    this.cloud = cloud
    setPlaysCloud(cloud)
  }

  /** The list "next" and "previous" walk through (what the screen shows). */
  setQueue(songs: CloudSong[]): void {
    this.queue = songs
  }

  getQueue(): CloudSong[] {
    return this.queue
  }

  private ensure(): AudioPlaylist {
    if (this.pl) return this.pl
    // Keep playing with the screen off / app in the background, and own the audio focus
    // (needed for the lock-screen controls).
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix'
    }).catch(() => {})
    const pl = createAudioPlaylist({ updateInterval: 500, loop: 'none' })
    pl.addListener('playlistStatusUpdate', (s) => this.onStatus(s))
    pl.addListener('trackChanged', () => this.onTrackChanged())
    this.pl = pl
    return pl
  }

  private async source(song: CloudSong): Promise<{ uri: string; streamed: boolean }> {
    const local = store.localUri(song.id)
    if (local) return { uri: local, streamed: false }
    if (!this.cloud) throw new Error('Sin conexión: esta canción no está descargada')
    return { uri: await this.cloud.streamUrl(song.id), streamed: true }
  }

  /** What next/previous walk through: the book's chapters while one plays, else the list. */
  private list(): CloudSong[] {
    return this.state.current?.book ? this.chapters : this.queue
  }

  private find(id: string | null): CloudSong | undefined {
    return id ? this.list().find((s) => s.id === id) : undefined
  }

  /** Chapters play in order (no shuffle) and the book stops at its end. */
  private pick(cur: CloudSong | null): ReturnType<typeof pickNext> {
    const book = !!cur?.book
    const list = this.list()
    const langs = new Map(list.map((s) => [s.id, s.lang]))
    const n = pickNext(
      list.map((s) => s.id),
      cur?.id ?? null,
      this.state.shuffle && !book,
      this.bag,
      undefined,
      (id) => langs.get(id)
    )
    return book && n.wrapped ? { ...n, id: null } : n
  }

  private item(song: CloudSong, streamed: boolean): Item {
    return { token: ++this.tokens, song, streamed }
  }

  private currentPos(): number {
    return this.items.findIndex((i) => i.token === this.currentToken)
  }

  /** Starts `song` from scratch: the native list becomes [previous?, song, next]. */
  private async load(song: CloudSong, from = 0, autoplay = true): Promise<void> {
    const seq = ++this.loadSeq
    this.needsLoad = false
    this.set({
      current: song,
      loading: true,
      error: null,
      time: from,
      duration: song.durationSec ?? 0
    })
    try {
      const src = await this.source(song)
      if (seq !== this.loadSeq) return
      const pl = this.ensure()
      pl.clear()
      const it = this.item(song, src.streamed)
      this.items = [it]
      this.currentToken = it.token
      pl.add({ uri: src.uri })
      if (from > 0) await pl.seekTo(from)
      if (autoplay) pl.play()
      this.pausedAt = autoplay ? null : this.now()
      pl.setActiveForLockScreen(true, meta(song))
      this.save(true)
      void this.fillAround(seq)
    } catch (e) {
      if (seq === this.loadSeq) this.set({ error: (e as Error).message })
    } finally {
      if (seq === this.loadSeq) this.set({ loading: false })
    }
  }

  /** Puts the song after (and, when there's history, before) the current one in the native list. */
  private async fillAround(seq = this.loadSeq): Promise<void> {
    const pl = this.pl
    const cur = this.state.current
    if (!pl || !cur) return
    let pos = this.currentPos()
    // Nothing queued after: pick and add the next one.
    if (pos === this.items.length - 1) {
      const n = this.pick(cur)
      const song = this.find(n.id)
      if (song) {
        try {
          const src = await this.source(song)
          if (seq !== this.loadSeq || this.state.current?.id !== cur.id) return
          this.bag = n.bag
          pl.add({ uri: src.uri })
          this.items.push(this.item(song, src.streamed))
        } catch {
          // Offline and not downloaded: no "next" for now.
        }
      }
    }
    pos = this.currentPos()
    // Nothing before: the last song that played, so ⏮ on the lock screen works.
    if (pos === 0 && this.history.length) {
      const p = pickPrev(
        this.list().map((s) => s.id),
        cur.id,
        this.history
      )
      const song = this.find(p.id)
      if (song && this.history.includes(song.id)) {
        try {
          const src = await this.source(song)
          if (seq !== this.loadSeq || this.state.current?.id !== cur.id || this.currentPos() !== 0)
            return
          pl.insert({ uri: src.uri }, 0)
          this.items.unshift(this.item(song, src.streamed))
        } catch {
          // Same: offline and not downloaded.
        }
      }
    }
  }

  /** Native moved to another song (it ended, or ⏮ ⏭ on the lock screen / in the app). */
  private onTrackChanged(): void {
    const pl = this.pl
    if (!pl) return
    const now = this.items[pl.currentIndex]
    if (!now || now.token === this.currentToken) return // a load or a list edit, not a song change
    const before = this.currentPos()
    const forward = before === -1 || pl.currentIndex > before
    const old = this.state.current
    if (forward) {
      if (old) this.history = remember(this.history, old.id)
    } else {
      this.history = this.history.filter((h) => h !== now.song.id)
    }
    this.currentToken = now.token
    this.bag = this.bag.filter((x) => x !== now.song.id)
    // Keep one song on each side; trim the rest.
    while (pl.currentIndex > 1) {
      pl.remove(0)
      this.items.shift()
    }
    while (this.items.length - 1 > pl.currentIndex + 1) {
      pl.remove(this.items.length - 1)
      this.items.pop()
    }
    this.set({ current: now.song, error: null, time: 0, duration: now.song.durationSec ?? 0 })
    pl.updateLockScreenMetadata(meta(now.song))
    if (forward && this.state.sleep && 'endOfSong' in this.state.sleep) {
      pl.pause()
      void pl.seekTo(0)
      this.set({ sleep: null })
    }
    this.save(true)
    void this.fillAround()
  }

  private onStatus(s: AudioPlaylistStatus & { error?: { message?: string } }): void {
    // Android skips trackChanged when the new index equals the last one it reported, which
    // happens once we trim songs off the front, so catch the change here too.
    this.onTrackChanged()
    const sleep = this.state.sleep
    if (sleep && 'at' in sleep && s.playing && this.now() >= sleep.at) {
      this.pl?.pause()
      this.set({ sleep: null })
    }
    const cur = this.state.current
    // Chapters aren't plays: they'd fill "most played" and the recommendations.
    if (cur && !cur.book && this.countedToken !== this.currentToken && isListened(s.currentTime, s.duration)) {
      this.countedToken = this.currentToken
      void recordPlay(cur.id, this.now()).catch(() => {})
    }
    this.set({
      playing: s.playing,
      time: s.currentTime,
      duration: s.duration || this.state.duration,
      error: s.error?.message ? 'No se pudo reproducir esta canción' : this.state.error
    })
    this.save()
    if (s.playing && s.isLoaded) this.failures = 0 // `playing` alone is also true while buffering
    if (s.error?.message) return this.skipBroken()
    // The list ran out: nothing got queued after this song (its link failed, say). Pick one now.
    // duration > 0 leaves out the "ended" that clearing the list for a new song also reports.
    if (s.didJustFinish && s.duration > 0) {
      if (this.state.sleep && 'endOfSong' in this.state.sleep) this.set({ sleep: null })
      else this.next()
    }
  }

  /** A song that can't play is skipped, but never more than one lap around the list. */
  private skipBroken(): void {
    // After an error ExoPlayer stays stopped until prepared again, which expo-audio only does
    // when it creates the player: start over with a new one.
    this.pl?.destroy()
    this.pl = null
    this.items = []
    this.needsLoad = true // ▶ loads it again if we stop here
    this.resumeAt = 0
    if (++this.failures < this.list().length) this.next()
    else this.set({ error: 'No se pudo reproducir esta canción', playing: false })
  }

  /** Plays a song from the current list. */
  async play(id: string): Promise<void> {
    const song = this.queue.find((s) => s.id === id)
    if (song) await this.start(song)
  }

  /** Plays a chapter of a book (`chapters` in order), from `from` seconds. */
  async playBook(chapters: CloudSong[], id: string, from = 0): Promise<void> {
    const song = chapters.find((s) => s.id === id)
    if (!song) return
    this.chapters = chapters
    await this.start(song, from)
  }

  private async start(song: CloudSong, from = 0): Promise<void> {
    const cur = this.state.current
    if (cur && cur.id !== song.id) this.history = remember(this.history, cur.id)
    this.bag = this.bag.filter((x) => x !== song.id)
    await this.load(song, from)
  }

  toggle = (): void => {
    const cur = this.state.current
    if (!cur) {
      this.next() // nothing chosen yet: start the list (random if shuffle is on)
      return
    }
    if (this.state.playing) {
      this.pause()
      return
    }
    if (this.needsLoad) {
      void this.load(cur, this.resumeAt)
      return
    }
    const it = this.items.find((i) => i.token === this.currentToken)
    // After a long pause the signed URL may have expired: get a new one and resume where it was.
    if (it?.streamed && this.pausedAt && this.now() - this.pausedAt > STALE_AFTER_MS) {
      void this.load(cur, this.state.time)
      return
    }
    this.pl?.play()
    this.pausedAt = null
  }

  pause = (): void => {
    if (!this.state.playing) return
    this.pl?.pause()
    this.pausedAt = this.now()
    this.save(true)
  }

  next = (): void => {
    const pl = this.pl
    const pos = this.currentPos()
    if (pl && !this.needsLoad && pos >= 0 && pos < this.items.length - 1) {
      pl.next() // already queued: the same path as the lock screen's ⏭
      pl.play()
      return
    }
    const cur = this.state.current
    const n = this.pick(cur)
    this.bag = n.bag
    const song = this.find(n.id)
    if (!song) return
    if (cur && song.id === cur.id && !this.needsLoad) {
      // A one-song list: start it over.
      void pl?.seekTo(0)
      pl?.play()
      return
    }
    if (cur) this.history = remember(this.history, cur.id)
    void this.load(song)
  }

  prev = (): void => {
    const pl = this.pl
    // A few seconds in, "previous" restarts the song, like any player.
    if (this.state.current && this.state.time > 3 && pl && !this.needsLoad) {
      void pl.seekTo(0)
      return
    }
    if (pl && !this.needsLoad && this.currentPos() > 0) {
      pl.previous()
      pl.play()
      return
    }
    const p = pickPrev(
      this.list().map((s) => s.id),
      this.state.current?.id ?? null,
      this.history
    )
    this.history = p.history
    const song = this.find(p.id)
    if (!song) return
    this.bag = this.bag.filter((x) => x !== song.id)
    void this.load(song)
  }

  seek = (t: number): void => {
    if (this.needsLoad) this.resumeAt = t
    else void this.pl?.seekTo(t)
  }

  setShuffle = (on: boolean): void => {
    this.set({ shuffle: on })
    this.bag = []
    // What's queued after the current song was picked with the old setting.
    const pl = this.pl
    const pos = this.currentPos()
    if (pl && pos >= 0 && pos < this.items.length - 1) {
      pl.remove(pos + 1)
      this.items.splice(pos + 1, 1)
      void this.fillAround()
    }
  }

  /** Stop after `minutes`, at the end of this song, or cancel (null). */
  setSleep = (s: { minutes: number } | 'endOfSong' | null): void => {
    this.set({
      sleep:
        s === null
          ? null
          : s === 'endOfSong'
            ? { endOfSong: true }
            : { at: this.now() + s.minutes * 60_000 }
    })
  }

  /** Back to nothing playing (tests; or a different cloud). */
  reset(): void {
    this.pl?.clear()
    this.pl?.destroy()
    this.pl = null
    this.items = []
    this.queue = []
    this.chapters = []
    this.bag = []
    this.history = []
    this.currentToken = 0
    this.pausedAt = null
    this.needsLoad = false
    this.loadSeq++
    this.set({
      current: null,
      playing: false,
      loading: false,
      error: null,
      time: 0,
      duration: 0,
      shuffle: false,
      sleep: null
    })
  }

  // ── Picking up where you left off ─────────────────────────────────────────

  private save(force = false): void {
    const cur = this.state.current
    if (!cur) return
    const t = this.now()
    if (!force && t - this.lastSave < SAVE_EVERY_MS) return
    this.lastSave = t
    void store
      .saveSession({
        current: cur,
        time: this.state.time,
        queueIds: this.queue.map((s) => s.id),
        shuffle: this.state.shuffle,
        savedAt: t
      })
      .catch(() => {})
    if (cur.book) void store.saveBookPosition(cur.book, cur.id, this.state.time).catch(() => {})
  }

  /**
   * Shows the last song (paused, where it was) after the app starts. `songs` is the
   * library, to rebuild the list it was playing from. Does nothing once something plays.
   */
  async restore(songs: CloudSong[], opts: { onlyFrom?: boolean } = {}): Promise<boolean> {
    if (this.state.current) return false
    const s = await store.loadSession()
    if (!s || this.state.current) return false
    const byId = new Map(songs.map((x) => [x.id, x]))
    // The widget plays only downloaded songs: last time's song counts only if it's one of them.
    if (opts.onlyFrom && !byId.has(s.current.id)) return false
    const queue = s.queueIds.map((id) => byId.get(id)).filter((x): x is CloudSong => !!x)
    if (this.queue.length === 0) this.queue = queue.length ? queue : songs
    const current = byId.get(s.current.id) ?? s.current
    if (current.book) this.chapters = chaptersOf(songs, current.book)
    this.needsLoad = true
    this.resumeAt = s.time
    this.set({
      current,
      time: s.time,
      duration: current.durationSec ?? 0,
      shuffle: s.shuffle,
      playing: false
    })
    return true
  }
}

/** The one player of the app. */
export const engine = new Engine()
