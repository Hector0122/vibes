import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from 'react-native'
import type { CloudPlaylist, CloudSong, SongRequest } from '../src/shared/api'
import { CloudError, createCloud, type Cloud } from './src/cloud'
import { PlayerBar } from './src/components/PlayerBar'
import { loadSnapshot, saveSnapshot } from './src/offline'
import { LibraryScreen, type DownloadState } from './src/screens/LibraryScreen'
import { SearchScreen } from './src/screens/SearchScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { loadSettings, saveSettings, type CloudSettings } from './src/settings'
import { colors } from './src/theme'
import { checkForUpdate } from './src/updates'
import { useOffline } from './src/useOffline'
import { usePlayer } from './src/usePlayer'

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
  const [searching, setSearching] = useState(false)

  const cloud: Cloud | null = useMemo(() => {
    if (!settings) return null
    try {
      return createCloud(settings)
    } catch {
      return null
    }
  }, [settings])

  const downloads = useOffline(cloud)
  const player = usePlayer(cloud, queue, downloads.localUri)

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

  // Songs deleted from the cloud don't keep taking space on the phone.
  useEffect(() => {
    if (downloadsReady && !offline && !loading && songs.length > 0) prune(songs.map((s) => s.id))
  }, [downloadsReady, offline, loading, songs, prune])

  // A playlist deleted on the computer: back to all songs.
  useEffect(() => {
    if (playlistId && !playlists.some((p) => p.id === playlistId)) setPlaylistId(null)
  }, [playlists, playlistId])

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs])
  const selected = playlists.find((p) => p.id === playlistId) ?? null
  const shown = useMemo(() => {
    const base = selected
      ? selected.songIds.map((id) => byId.get(id)).filter((s): s is CloudSong => !!s)
      : songs
    return offline || onlyDownloaded ? base.filter((s) => localUri(s.id)) : base
  }, [selected, byId, songs, offline, onlyDownloaded, localUri])

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
      {searching && cloud ? (
        <SearchScreen
          cloud={cloud}
          onClose={() => {
            setSearching(false)
            void refresh() // songs the computer already brought in
          }}
          onRequested={(r) => setRequests((list) => [...list.filter((x) => x.id !== r.id), r])}
          onPreviewStart={player.pause}
        />
      ) : (
        <LibraryScreen
          songs={shown}
          total={songs.length}
          title={selected?.name ?? 'Tu música'}
          loading={loading}
          error={error ?? downloads.error}
          offline={offline}
          onRefresh={refresh}
          currentId={player.current?.id ?? null}
          onPlay={(id) => void player.play(id)}
          onShuffleAll={(visible) => {
            player.setShuffle(true)
            const pick = visible[Math.floor(Math.random() * visible.length)]
            if (pick) void player.play(pick.id)
          }}
          onOpenSettings={() => setEditing(true)}
          onVisibleChange={setQueue}
          playlists={playlists.map((p) => ({ id: p.id, name: p.name, count: p.songIds.length }))}
          playlistId={selected?.id ?? null}
          onSelectPlaylist={setPlaylistId}
          downloadedCount={downloads.count}
          onlyDownloaded={onlyDownloaded}
          onToggleOnlyDownloaded={() => setOnlyDownloaded((v) => !v)}
          downloadState={downloadState}
          onDownload={downloads.download}
          onRemoveDownload={(s) => downloads.remove([s.id])}
          progress={downloads.progress}
          onCancelDownloads={downloads.cancel}
          onOpenSearch={() => setSearching(true)}
          requests={requests}
          onCancelRequest={(r) => void cancelRequest(r)}
          onRetryRequest={(r) => void retryRequest(r)}
        />
      )}
      <PlayerBar player={player} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' }
})
