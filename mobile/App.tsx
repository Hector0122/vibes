import { File } from 'expo-file-system'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from 'react-native'
import {
  applyPlaylistOp,
  type CloudPlaylist,
  type CloudSong,
  type PlaylistOp,
  type SongRequest
} from '../src/shared/api'
import { chaptersOf, groupBooks, guessBookName, isBook, setBookCover, uploadBook, type PickedFile } from './src/books'
import { CloudError, createCloud, type Cloud } from './src/cloud'
import { ActionSheet, type Action } from './src/components/ActionSheet'
import { NameDialog } from './src/components/NameDialog'
import { PlayerBar } from './src/components/PlayerBar'
import { TabBar, type Tab } from './src/components/TabBar'
import {
  DEFAULT_PREFS,
  loadBookPositions,
  loadPrefs,
  loadSnapshot,
  savePrefs,
  saveSnapshot,
  type BookPositions,
  type Prefs
} from './src/offline'
import { onWifi } from './src/network'
import { flushPlays } from './src/plays'
import { HomeScreen } from './src/screens/HomeScreen'
import {
  groupArtists,
  LibraryScreen,
  mainArtist,
  type DownloadState,
  type Section
} from './src/screens/LibraryScreen'
import { NowPlayingScreen } from './src/screens/NowPlayingScreen'
import { SearchScreen } from './src/screens/SearchScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { loadSettings, saveSettings, type CloudSettings } from './src/settings'
import { colors } from './src/theme'
import { checkForUpdate } from './src/updates'
import { useOffline } from './src/useOffline'
import { engine } from './src/engine'
import { usePlayer } from './src/usePlayer'
import { startWidgetSync } from './src/widget/sync'

export default function App(): React.JSX.Element {
  // undefined = still reading secure storage; null = not set up yet.
  const [settings, setSettings] = useState<CloudSettings | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [songs, setSongs] = useState<CloudSong[]>([])
  const [playlists, setPlaylists] = useState<CloudPlaylist[]>([])
  const [queue, setQueue] = useState<CloudSong[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The last refresh couldn't reach the cloud: showing the saved copy. */
  const [offline, setOffline] = useState(false)
  const [playlistId, setPlaylistId] = useState<string | null>(null)
  const [onlyDownloaded, setOnlyDownloaded] = useState(false)
  const [requests, setRequests] = useState<SongRequest[]>([])
  const [tab, setTab] = useState<Tab>('home')
  /** Biblioteca: Canciones / Artistas / Playlists, and the open artist. */
  const [section, setSection] = useState<Section>('songs')
  const [artist, setArtist] = useState<string | null>(null)
  const [nowOpen, setNowOpen] = useState(false)
  /** Open menus / dialogs: a song's menu, the playlist's menu, a name prompt. */
  const [sheet, setSheet] = useState<{
    title: string
    subtitle?: string
    actions: Action[]
  } | null>(null)
  const [naming, setNaming] = useState<{
    title: string
    initial?: string
    save: (name: string) => void
    placeholder?: string
  } | null>(null)
  /** Libros: the open audiobook, where each was left, and the upload running. */
  const [book, setBook] = useState<string | null>(null)
  const [positions, setPositions] = useState<BookPositions>({})
  const [upload, setUpload] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)

  const cloud: Cloud | null = useMemo(() => {
    if (!settings) return null
    try {
      return createCloud(settings)
    } catch {
      return null
    }
  }, [settings])

  const downloads = useOffline(cloud)
  const player = usePlayer(cloud, queue)

  // The home screen widget follows the player.
  useEffect(() => startWidgetSync(), [])

  // A newer APK on GitHub: offer it (Android asks before installing).
  useEffect(() => {
    void checkForUpdate().then((u) => {
      if (!u) return
      Alert.alert('Nueva versión disponible', `Vibes ${u.version} está lista para instalar.`, [
        { text: 'Después', style: 'cancel' },
        { text: 'Actualizar', onPress: () => void Linking.openURL(u.apkUrl) }
      ])
    })
  }, [])

  useEffect(() => {
    loadSettings().then(setSettings)
    loadPrefs().then(setPrefs, () => {})
    // The last library seen, so the app opens (and plays downloads) without internet.
    loadSnapshot().then((s) => {
      if (!s) return
      setSongs((cur) => (cur.length ? cur : s.songs))
      setPlaylists((cur) => (cur.length ? cur : s.playlists))
    })
  }, [])

  const { prune, ready: downloadsReady, localUri } = downloads
  const refresh = useCallback(async (): Promise<void> => {
    if (!cloud) return
    setLoading(true)
    setError(null)
    try {
      const [list, lists, marked] = await Promise.all([
        cloud.listSongs(),
        cloud.listPlaylists(),
        cloud.listRequests()
      ])
      setSongs(list)
      setPlaylists(lists)
      setRequests(marked)
      setOffline(false)
      void flushPlays().catch(() => {}) // what was listened to offline
      void saveSnapshot({ songs: list, playlists: lists, savedAt: Date.now() }).catch(() => {})
    } catch (e) {
      if (e instanceof CloudError && e.status === 0) setOffline(true)
      else setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [cloud])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const updatePrefs = (patch: Partial<Prefs>): void => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      void savePrefs(next).catch(() => {})
      return next
    })
  }

  // Kept playlists: whatever they have that isn't on the phone yet is downloaded
  // (new songs too, after each refresh), on Wi-Fi only if so set.
  const { download } = downloads
  useEffect(() => {
    if (offline || !downloadsReady || prefs.keep.length === 0 || songs.length === 0) return
    const byIdNow = new Map(songs.map((s) => [s.id, s]))
    const wanted = playlists
      .filter((p) => prefs.keep.includes(p.id))
      .flatMap((p) => p.songIds.map((id) => byIdNow.get(id)).filter((s): s is CloudSong => !!s))
    if (wanted.length === 0) return
    let cancelled = false
    void (async () => {
      if (prefs.wifiOnly && !(await onWifi())) return
      if (!cancelled) download(wanted)
    })()
    return () => {
      cancelled = true
    }
  }, [offline, downloadsReady, prefs, songs, playlists, download])

  /** Manual downloads: on mobile data with "solo Wi-Fi" on, ask first. */
  const downloadAsked = async (list: CloudSong[]): Promise<void> => {
    if (!prefs.wifiOnly || (await onWifi())) {
      download(list)
      return
    }
    Alert.alert(
      'Estás usando datos móviles',
      '¿Descargar de todos modos? Puede gastar tu plan de datos.',
      [
        { text: 'Esperar a Wi-Fi', style: 'cancel' },
        { text: 'Descargar', onPress: () => download(list) }
      ]
    )
  }

  // Songs deleted from the cloud don't keep taking space on the phone.
  useEffect(() => {
    if (downloadsReady && !offline && !loading && songs.length > 0) prune(songs.map((s) => s.id))
  }, [downloadsReady, offline, loading, songs, prune])

  // Last time's song, paused where it was (once the library is known).
  useEffect(() => {
    if (songs.length) void engine.restore(songs)
  }, [songs])

  // A playlist deleted on the computer: back to all songs.
  useEffect(() => {
    if (playlistId && !playlists.some((p) => p.id === playlistId)) setPlaylistId(null)
  }, [playlists, playlistId])

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs])
  const selected = playlists.find((p) => p.id === playlistId) ?? null
  // Audiobook chapters live in Libros only, never with the music.
  const music = useMemo(() => songs.filter((s) => !isBook(s)), [songs])
  const shown = useMemo(() => {
    const base = selected
      ? selected.songIds.map((id) => byId.get(id)).filter((s): s is CloudSong => !!s)
      : artist
        ? music.filter((s) => mainArtist(s) === artist)
        : book
          ? chaptersOf(songs, book)
          : music
    return offline || onlyDownloaded ? base.filter((s) => localUri(s.id)) : base
  }, [selected, artist, book, byId, songs, music, offline, onlyDownloaded, localUri])
  // Offline, only what's on the phone counts.
  const available = useMemo(
    () => (offline ? songs.filter((s) => localUri(s.id)) : songs),
    [offline, songs, localUri]
  )
  const artists = useMemo(() => groupArtists(available.filter((s) => !isBook(s))), [available])
  const books = useMemo(() => groupBooks(available), [available])
  const playlistCards = useMemo(
    () =>
      playlists.map((p) => {
        const its = p.songIds.map((id) => byId.get(id)).filter((s): s is CloudSong => !!s)
        return {
          id: p.id,
          name: p.name,
          count: its.length,
          covers: its.slice(0, 8).map((s) => s.coverUrl)
        }
      }),
    [playlists, byId]
  )
  const openPlaylist = (id: string | null): void => {
    setBook(null)
    setArtist(null)
    setPlaylistId(id)
    setTab('library')
  }
  const openArtist = (name: string | null): void => {
    setBook(null)
    setPlaylistId(null)
    setArtist(name)
    setTab('library')
  }
  const openBook = (name: string): void => {
    setPlaylistId(null)
    setArtist(null)
    setBook(name)
    void loadBookPositions().then(setPositions, () => {})
  }
  /** "Continuar": where the book was left, else its first chapter. */
  const left = book ? positions[book] : undefined
  const continueBook = async (name: string, chapters: CloudSong[]): Promise<void> => {
    const at = (await loadBookPositions())[name] // fresh: it moves as you listen
    if (at && chapters.some((c) => c.id === at.id)) await player.playBook(chapters, at.id, at.time)
    else if (chapters[0]) await player.playBook(chapters, chapters[0].id)
  }

  /** Audio files picked on the phone go up as a book's chapters (after the ones it has). */
  const sendBook = async (name: string, files: PickedFile[]): Promise<void> => {
    if (!cloud) return
    setError(null)
    setUpload('Preparando…')
    try {
      const chapters = chaptersOf(songs, name)
      await uploadBook(
        cloud,
        files,
        name,
        chapters.length,
        (u) =>
          setUpload(
            `${u.step === 'hash' ? 'Preparando' : 'Subiendo'} ${u.total > 1 ? `${u.file} de ${u.total} · ` : ''}${Math.round(u.fraction * 100)}%`
          ),
        chapters[0]?.coverUrl ?? null
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUpload(null)
      void refresh()
    }
  }
  /** An image picked on the phone becomes the open book's cover. */
  const pickCover = async (name: string): Promise<void> => {
    if (!cloud) return
    const picked = await File.pickFileAsync({ mimeTypes: 'image/*' })
    if (picked.canceled || !picked.result) return
    const f = Array.isArray(picked.result) ? picked.result[0] : picked.result
    setError(null)
    setUpload('Subiendo portada…')
    try {
      await setBookCover(cloud, { uri: f.uri, name: f.name }, chaptersOf(songs, name))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUpload(null)
      void refresh()
    }
  }
  const pickBook = async (): Promise<void> => {
    const picked = await File.pickFileAsync({ multipleFiles: true, mimeTypes: 'audio/*' })
    if (picked.canceled || picked.result.length === 0) return
    const files = picked.result.map((f) => ({ uri: f.uri, name: f.name }))
    setNaming({
      title: 'Nombre del audiolibro',
      placeholder: 'Nombre del libro',
      initial: book ?? guessBookName(files[0].name),
      save: (name) => void sendBook(name, files)
    })
  }

  const downloadState = (s: CloudSong): DownloadState =>
    downloads.downloadingId === s.id
      ? 'downloading'
      : downloads.isQueued(s.id)
        ? 'queued'
        : downloads.isDownloaded(s)
          ? 'done'
          : 'none'

  if (settings === undefined) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.pink} />
      </View>
    )
  }

  if (!settings || editing) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SettingsScreen
          initial={settings}
          onCancel={settings ? () => setEditing(false) : undefined}
          onSave={async (s) => {
            await saveSettings(s)
            setSettings(s)
            setEditing(false)
          }}
        />
      </View>
    )
  }

  /** Edits a playlist: shown right away, sent to the cloud (the computer takes it from there). */
  const editPlaylists = async (ops: PlaylistOp[]): Promise<void> => {
    if (!cloud) return
    const before = playlists
    setPlaylists((list) => ops.reduce((l, op) => applyPlaylistOp(l, op, Date.now()), list))
    try {
      const now = await cloud.editPlaylists(ops)
      setPlaylists(now)
      void saveSnapshot({ songs, playlists: now, savedAt: Date.now() }).catch(() => {})
    } catch (e) {
      setPlaylists(before)
      setError(
        (e as { status?: number }).status === 0
          ? 'Necesitas internet para editar las playlists'
          : (e as Error).message
      )
    }
  }
  const newPlaylistId = (): string =>
    Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

  const askNewPlaylist = (withSong?: CloudSong): void =>
    setNaming({
      title: 'Nueva playlist',
      save: (name) => {
        const id = newPlaylistId()
        const ops: PlaylistOp[] = [{ type: 'create', id, name }]
        if (withSong) ops.push({ type: 'add', id, songIds: [withSong.id] })
        void editPlaylists(ops)
      }
    })

  const songMenu = (s: CloudSong): void => {
    const actions: Action[] = playlists
      .filter((p) => !p.songIds.includes(s.id))
      .map((p) => ({
        label: `Agregar a «${p.name}»`,
        onPress: () => void editPlaylists([{ type: 'add', id: p.id, songIds: [s.id] }])
      }))
    actions.push({ label: 'Agregar a una playlist nueva…', onPress: () => askNewPlaylist(s) })
    if (selected) {
      actions.unshift({
        label: `Quitar de «${selected.name}»`,
        destructive: true,
        onPress: () => void editPlaylists([{ type: 'remove', id: selected.id, songId: s.id }])
      })
    }
    setSheet({ title: s.title, subtitle: s.artists, actions })
  }

  /** "Mantener descargada" (a playlist) and "Descargar solo con Wi-Fi", as checks in a menu. */
  const downloadSettings = (keepId?: string): Action[] => [
    ...(keepId
      ? [
          {
            label: 'Mantener descargada',
            checked: prefs.keep.includes(keepId),
            onPress: () =>
              updatePrefs({
                keep: prefs.keep.includes(keepId)
                  ? prefs.keep.filter((x) => x !== keepId)
                  : [...prefs.keep, keepId]
              })
          }
        ]
      : []),
    {
      label: 'Descargar solo con Wi-Fi',
      checked: prefs.wifiOnly,
      onPress: () => updatePrefs({ wifiOnly: !prefs.wifiOnly })
    }
  ]

  const playlistMenu = (): void => {
    const pl = selected
    if (!pl) return
    setSheet({
      title: pl.name,
      actions: [
        ...downloadSettings(pl.id),
        {
          label: 'Renombrar',
          onPress: () =>
            setNaming({
              title: 'Renombrar playlist',
              initial: pl.name,
              save: (name) => void editPlaylists([{ type: 'rename', id: pl.id, name }])
            })
        },
        {
          label: 'Eliminar playlist',
          destructive: true,
          onPress: () =>
            Alert.alert(
              'Eliminar playlist',
              `¿Eliminar «${pl.name}»? Las canciones siguen en tu biblioteca.`,
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Eliminar',
                  style: 'destructive',
                  onPress: () => {
                    setPlaylistId(null)
                    setSection('playlists')
                    void editPlaylists([{ type: 'delete', id: pl.id }])
                  }
                }
              ]
            )
        }
      ]
    })
  }

  const retryRequest = async (r: SongRequest): Promise<void> => {
    if (!cloud) return
    try {
      const fresh = await cloud.request(r)
      setRequests((list) => list.map((x) => (x.id === r.id ? fresh : x)))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const cancelRequest = async (r: SongRequest): Promise<void> => {
    if (!cloud) return
    try {
      await cloud.cancelRequest(r.id)
      setRequests((list) => list.filter((x) => x.id !== r.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {nowOpen && player.current ? (
        <NowPlayingScreen player={player} onClose={() => setNowOpen(false)} />
      ) : tab === 'search' && cloud ? (
        <SearchScreen
          cloud={cloud}
          onClose={() => {
            setTab('library')
            void refresh() // songs the computer already brought in
          }}
          onRequested={(r) => setRequests((list) => [...list.filter((x) => x.id !== r.id), r])}
          onPreviewStart={player.pause}
        />
      ) : tab === 'home' ? (
        <HomeScreen
          cloud={offline ? null : cloud}
          playlists={playlistCards}
          artists={artists}
          downloadedCount={downloads.count}
          error={error ?? downloads.error}
          loading={loading}
          onRefresh={refresh}
          onOpenPlaylist={openPlaylist}
          onOpenArtist={openArtist}
          onOpenDownloaded={() => {
            openPlaylist(null)
            setSection('songs')
            setOnlyDownloaded(true)
          }}
          onOpenSearch={() => setTab('search')}
          onOpenSettings={() => setEditing(true)}
        />
      ) : (
        <LibraryScreen
          songs={shown}
          total={music.length}
          title={selected?.name ?? artist ?? 'Biblioteca'}
          loading={loading}
          error={error ?? downloads.error}
          offline={offline}
          onRefresh={refresh}
          currentId={player.current?.id ?? null}
          onPlay={(id) => void (book ? player.playBook(shown, id) : player.play(id))}
          onPlayAll={(visible) => {
            if (book) return void continueBook(book, shown)
            player.setShuffle(false)
            if (visible[0]) void player.play(visible[0].id)
          }}
          playLabel={book && left ? 'Continuar' : undefined}
          books={books}
          book={book}
          onSelectBook={openBook}
          onUploadBook={cloud ? () => void pickBook() : undefined}
          onBookCover={cloud && book ? () => void pickCover(book) : undefined}
          upload={upload}
          onShuffleAll={(visible) => {
            player.setShuffle(true)
            const pick = visible[Math.floor(Math.random() * visible.length)]
            if (pick) void player.play(pick.id)
          }}
          onVisibleChange={setQueue}
          section={section}
          onSection={setSection}
          playlists={playlistCards}
          playlistId={selected?.id ?? null}
          onSelectPlaylist={openPlaylist}
          artists={artists}
          artist={artist}
          onSelectArtist={openArtist}
          onBack={() => {
            setPlaylistId(null)
            setArtist(null)
            setBook(null)
          }}
          downloadedCount={downloads.count}
          onlyDownloaded={onlyDownloaded}
          onToggleOnlyDownloaded={() => setOnlyDownloaded((v) => !v)}
          downloadState={downloadState}
          onDownload={(list) => void downloadAsked(list)}
          keepDownloaded={!!selected && prefs.keep.includes(selected.id)}
          onRemoveDownload={(s) => downloads.remove([s.id])}
          progress={downloads.progress}
          onCancelDownloads={downloads.cancel}
          onOpenSearch={() => setTab('search')}
          onSongMenu={songMenu}
          onNewPlaylist={() => askNewPlaylist()}
          onMenu={
            selected
              ? playlistMenu
              : () => setSheet({ title: 'Descargas', actions: downloadSettings() })
          }
          requests={requests}
          onCancelRequest={(r) => void cancelRequest(r)}
          onRetryRequest={(r) => void retryRequest(r)}
        />
      )}
      <PlayerBar player={player} onOpen={() => setNowOpen(true)} />
      {!(nowOpen && player.current) && <TabBar tab={tab} onChange={setTab} />}
      <ActionSheet
        visible={!!sheet}
        title={sheet?.title ?? ''}
        subtitle={sheet?.subtitle}
        actions={sheet?.actions ?? []}
        onClose={() => setSheet(null)}
      />
      <NameDialog
        visible={!!naming}
        title={naming?.title ?? ''}
        initial={naming?.initial}
        placeholder={naming?.placeholder}
        onCancel={() => setNaming(null)}
        onSave={(name) => {
          naming?.save(name)
          setNaming(null)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' }
})
