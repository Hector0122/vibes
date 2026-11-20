import { Ionicons } from '@expo/vector-icons'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import type { CloudSong, SongRequest } from '../../../src/shared/api'
import { colors, fmtTime } from '../theme'
import type { DownloadProgress } from '../useOffline'

export type DownloadState = 'done' | 'downloading' | 'queued' | 'none'

export interface PlaylistChip {
  id: string
  name: string
  count: number
}

interface Props {
  /** The songs of what's selected (all, or one playlist), already filtered for offline. */
  songs: CloudSong[]
  /** All songs in the cloud, for the count. */
  total: number
  title: string
  loading: boolean
  error: string | null
  /** No connection: only downloaded songs are shown. */
  offline: boolean
  onRefresh: () => void
  currentId: string | null
  onPlay: (id: string) => void
  onShuffleAll: (visible: CloudSong[]) => void
  onOpenSettings: () => void
  /** Reports the filtered list, which is what the player plays through. */
  onVisibleChange?: (visible: CloudSong[]) => void

  playlists?: PlaylistChip[]
  /** null = all songs. */
  playlistId?: string | null
  onSelectPlaylist?: (id: string | null) => void

  downloadedCount?: number
  onlyDownloaded?: boolean
  onToggleOnlyDownloaded?: () => void
  downloadState?: (song: CloudSong) => DownloadState
  onDownload?: (songs: CloudSong[]) => void
  onRemoveDownload?: (song: CloudSong) => void
  progress?: DownloadProgress | null
  onCancelDownloads?: () => void

  /** Opens the YouTube search (to mark songs for the computer). */
  onOpenSearch?: () => void
  /** Songs marked here, waiting for the computer. */
  requests?: SongRequest[]
  onCancelRequest?: (r: SongRequest) => void
  onRetryRequest?: (r: SongRequest) => void
}

export const filterSongs = (songs: CloudSong[], query: string): CloudSong[] => {
  const q = query.trim().toLowerCase()
  return q
    ? songs.filter((s) => s.title.toLowerCase().includes(q) || s.artists.toLowerCase().includes(q))
    : songs
}

/** Your cloud library: playlists, search, shuffle, downloads, tap to play. */
export function LibraryScreen(p: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => filterSongs(p.songs, query), [p.songs, query])
  const state = p.downloadState ?? ((): DownloadState => 'none')
  const missing = visible.filter((s) => state(s) === 'none')

  const report = p.onVisibleChange
  useEffect(() => {
    report?.(visible)
  }, [visible, report])

  const confirmRemove = (s: CloudSong): void =>
    Alert.alert(
      'Quitar del teléfono',
      `“${s.title}” seguirá en tu nube, pero ya no sonará sin internet.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => p.onRemoveDownload?.(s) }
      ]
    )

  const emptyText = (): string => {
    if (p.songs.length > 0) return 'Nada coincide con tu búsqueda.'
    if (p.offline)
      return 'Sin conexión y no tienes canciones descargadas aquí. Descárgalas con ⬇ cuando tengas internet.'
    if (p.onlyDownloaded)
      return 'Todavía no descargas canciones de esta lista. Toca ⬇ para tenerlas sin internet.'
    if (p.playlistId) return 'Esta playlist está vacía, o sus canciones aún no están en la nube.'
    return 'Tu nube está vacía. Sube tu música desde Vibes en la computadora (“Subir a la nube”).'
  }

  return (
    <FlatList
      testID="library"
      style={styles.list}
      data={visible}
      keyExtractor={(s) => s.id}
      refreshControl={
        <RefreshControl refreshing={p.loading} onRefresh={p.onRefresh} tintColor={colors.pink} />
      }
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>{p.playlistId ? 'PLAYLIST' : 'BIBLIOTECA'}</Text>
              <Text testID="title" numberOfLines={1} style={styles.title}>
                {p.title}
              </Text>
            </View>
            {p.onOpenSearch && !p.offline && (
              <Pressable onPress={p.onOpenSearch} accessibilityLabel="Agregar música" hitSlop={12}>
                <Ionicons name="add-circle-outline" size={28} color={colors.muted} />
              </Pressable>
            )}
            <Pressable onPress={p.onOpenSettings} accessibilityLabel="Nube" hitSlop={12}>
              <Ionicons name="cloud-outline" size={26} color={colors.muted} />
            </Pressable>
          </View>
          <Text testID="count" style={styles.count}>
            {p.playlistId ? `${p.songs.length} canciones` : `${p.total} canciones en tu nube`}
          </Text>
          {!!p.downloadedCount && (
            <Text testID="downloaded-count" style={styles.count}>
              {p.downloadedCount} en el teléfono
            </Text>
          )}

          {p.offline && (
            <View testID="offline" style={styles.offline}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.text} />
              <Text style={styles.offlineText}>Sin conexión: suenan tus canciones descargadas</Text>
            </View>
          )}

          {!p.playlistId && !!p.requests?.length && (
            <View testID="requests" style={styles.requests}>
              <Text style={styles.requestsTitle}>Esperando a la compu ({p.requests.length})</Text>
              {p.requests.map((r) => (
                <View key={r.id} testID={`request-${r.id}`} style={styles.requestRow}>
                  <Ionicons
                    name={r.status === 'failed' ? 'alert-circle-outline' : 'time-outline'}
                    size={18}
                    color={r.status === 'failed' ? colors.red : colors.faint}
                  />
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={styles.requestTitle}>
                      {r.title} · {r.artists}
                    </Text>
                    {r.status === 'failed' && (
                      <Text numberOfLines={2} style={styles.requestError}>
                        {r.error}
                      </Text>
                    )}
                  </View>
                  {r.status === 'failed' && (
                    <Pressable
                      hitSlop={8}
                      accessibilityLabel={`Reintentar: ${r.title}`}
                      onPress={() => p.onRetryRequest?.(r)}
                    >
                      <Ionicons name="refresh" size={18} color={colors.pinkSoft} />
                    </Pressable>
                  )}
                  <Pressable
                    hitSlop={8}
                    accessibilityLabel={`Cancelar: ${r.title}`}
                    onPress={() => p.onCancelRequest?.(r)}
                  >
                    <Ionicons name="close" size={18} color={colors.faint} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {!!p.playlists?.length && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              <Chip
                label="Todas"
                active={!p.playlistId}
                onPress={() => p.onSelectPlaylist?.(null)}
              />
              {p.playlists.map((pl) => (
                <Chip
                  key={pl.id}
                  label={pl.name}
                  active={p.playlistId === pl.id}
                  onPress={() => p.onSelectPlaylist?.(pl.id)}
                />
              ))}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <View style={styles.search}>
              <Ionicons name="search" size={18} color={colors.faint} />
              <TextInput
                testID="search"
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar canción o artista"
                placeholderTextColor={colors.faint}
                autoCorrect={false}
              />
            </View>
            {p.onToggleOnlyDownloaded && !p.offline && (
              <Pressable
                style={[styles.round, p.onlyDownloaded && styles.roundActive]}
                accessibilityLabel="Solo descargadas"
                accessibilityState={{ selected: !!p.onlyDownloaded }}
                onPress={p.onToggleOnlyDownloaded}
              >
                <Ionicons name="phone-portrait-outline" size={20} color="#fff" />
              </Pressable>
            )}
            <Pressable
              style={[styles.round, styles.shuffle]}
              accessibilityLabel="Aleatorio"
              disabled={visible.length === 0}
              onPress={() => p.onShuffleAll(visible)}
            >
              <Ionicons name="shuffle" size={22} color="#fff" />
            </Pressable>
          </View>

          {p.progress ? (
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color={colors.pink} />
              <Text testID="download-progress" style={styles.progressText}>
                Descargando {Math.min(p.progress.done + 1, p.progress.total)} de {p.progress.total}
                {p.progress.failed ? ` · ${p.progress.failed} con error` : ''}
              </Text>
              <Pressable onPress={p.onCancelDownloads} hitSlop={8}>
                <Text style={styles.link}>Cancelar</Text>
              </Pressable>
            </View>
          ) : (
            p.onDownload &&
            !p.offline &&
            missing.length > 0 && (
              <Pressable style={styles.progressRow} onPress={() => p.onDownload?.(missing)}>
                <Ionicons name="arrow-down-circle-outline" size={20} color={colors.pinkSoft} />
                <Text style={styles.link}>
                  {missing.length === visible.length
                    ? `Descargar ${missing.length === 1 ? 'la canción' : `las ${missing.length}`} para escuchar sin internet`
                    : `Descargar ${missing.length} que faltan`}
                </Text>
              </Pressable>
            )
          )}

          {p.error && (
            <Text testID="error" style={styles.error}>
              {p.error}
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={p.loading ? undefined : <Text style={styles.empty}>{emptyText()}</Text>}
      renderItem={({ item: s }) => {
        const isCurrent = s.id === p.currentId
        const st = state(s)
        return (
          <Pressable
            testID={`song-${s.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${s.title}, ${s.artists}`}
            onPress={() => p.onPlay(s.id)}
            style={({ pressed }) => [styles.row, (pressed || isCurrent) && styles.rowActive]}
          >
            {s.coverUrl ? (
              <Image source={{ uri: s.coverUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverEmpty]}>
                <Ionicons name="musical-note" size={18} color={colors.faint} />
              </View>
            )}
            <View style={styles.rowText}>
              <Text
                numberOfLines={1}
                style={[styles.songTitle, isCurrent && { color: colors.pinkSoft }]}
              >
                {s.title}
              </Text>
              <Text numberOfLines={1} style={styles.artist}>
                {s.artists}
              </Text>
            </View>
            <Text style={styles.duration}>{fmtTime(s.durationSec)}</Text>
            {p.onDownload && (
              <View style={styles.dl}>
                {st === 'downloading' ? (
                  <ActivityIndicator
                    testID={`downloading-${s.id}`}
                    size="small"
                    color={colors.pink}
                  />
                ) : st === 'queued' ? (
                  <Ionicons name="time-outline" size={20} color={colors.faint} />
                ) : st === 'done' ? (
                  <Pressable
                    accessibilityLabel={`Quitar del teléfono: ${s.title}`}
                    hitSlop={10}
                    onPress={() => confirmRemove(s)}
                  >
                    <Ionicons name="checkmark-circle" size={22} color={colors.pink} />
                  </Pressable>
                ) : p.offline ? null : (
                  <Pressable
                    accessibilityLabel={`Descargar: ${s.title}`}
                    hitSlop={10}
                    onPress={() => p.onDownload?.([s])}
                  >
                    <Ionicons name="arrow-down-circle-outline" size={22} color={colors.faint} />
                  </Pressable>
                )}
              </View>
            )}
          </Pressable>
        )
      }}
    />
  )
}

function Chip(props: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      style={[styles.chip, props.active && styles.chipActive]}
    >
      <Text numberOfLines={1} style={[styles.chipText, props.active && styles.chipTextActive]}>
        {props.label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 12,
    backgroundColor: 'rgba(139,92,246,0.18)'
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 16
  },
  requests: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    gap: 8
  },
  requestsTitle: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  requestTitle: { color: colors.text, fontSize: 14 },
  requestError: { color: colors.red, fontSize: 12, marginTop: 2 },
  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', marginTop: 2 },
  count: { color: colors.muted, fontSize: 13, marginTop: 6 },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surfaceHi
  },
  offlineText: { color: colors.text, fontSize: 13 },
  chips: { gap: 8, paddingTop: 16 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 200
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '500' },
  chipTextActive: { color: colors.bg },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14
  },
  searchInput: { flex: 1, color: colors.text, paddingVertical: 10, fontSize: 15 },
  round: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center'
  },
  roundActive: { backgroundColor: colors.violet },
  shuffle: { backgroundColor: colors.pink },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  progressText: { color: colors.muted, fontSize: 13, flex: 1 },
  link: { color: colors.pinkSoft, fontSize: 14, fontWeight: '600' },
  error: { color: colors.red, marginTop: 12, fontSize: 14 },
  empty: { color: colors.faint, textAlign: 'center', padding: 32, fontSize: 15, lineHeight: 22 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8
  },
  rowActive: { backgroundColor: colors.surface },
  cover: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#27272a' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  songTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  artist: { color: colors.muted, fontSize: 13, marginTop: 2 },
  duration: { color: colors.faint, fontSize: 12, fontVariant: ['tabular-nums'] },
  dl: { width: 26, alignItems: 'center' }
})
