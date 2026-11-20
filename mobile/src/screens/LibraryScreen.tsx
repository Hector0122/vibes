import { Ionicons } from '@expo/vector-icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native'
import type { CloudSong, SongRequest } from '../../../src/shared/api'
import { Collage } from '../components/Collage'
import { colors, fmtTime } from '../theme'
import type { DownloadProgress } from '../useOffline'

export type DownloadState = 'done' | 'downloading' | 'queued' | 'none'
export type Section = 'songs' | 'artists' | 'playlists'

export interface PlaylistChip {
  id: string
  name: string
  count: number
  /** Covers of its first songs, for its collage. */
  covers: (string | null)[]
}

export interface ArtistGroup {
  name: string
  count: number
  cover: string | null
}

interface Props {
  /** The songs of what's selected (all, a playlist or an artist), already filtered for offline. */
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
  onPlayAll?: (visible: CloudSong[]) => void
  onShuffleAll: (visible: CloudSong[]) => void
  /** Reports the filtered list, which is what the player plays through. */
  onVisibleChange?: (visible: CloudSong[]) => void

  /** Canciones / Artistas / Playlists (when nothing is open). */
  section?: Section
  onSection?: (s: Section) => void
  playlists?: PlaylistChip[]
  /** null = all songs. */
  playlistId?: string | null
  onSelectPlaylist?: (id: string | null) => void
  artists?: ArtistGroup[]
  /** The open artist; null = none. */
  artist?: string | null
  onSelectArtist?: (name: string | null) => void
  /** Back from a playlist or an artist. */
  onBack?: () => void

  downloadedCount?: number
  onlyDownloaded?: boolean
  onToggleOnlyDownloaded?: () => void
  downloadState?: (song: CloudSong) => DownloadState
  onDownload?: (songs: CloudSong[]) => void
  onRemoveDownload?: (song: CloudSong) => void
  progress?: DownloadProgress | null
  onCancelDownloads?: () => void
  /** The open playlist is kept downloaded (new songs too). */
  keepDownloaded?: boolean

  /** Long press on a song: its menu (add to / remove from playlists). */
  onSongMenu?: (song: CloudSong) => void
  onNewPlaylist?: () => void
  /** ⋯: the open playlist's menu, or the download settings. */
  onMenu?: () => void

  /** Opens the search (to mark songs for the computer). */
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

/** The first artist of "A, B feat. C" / "A x B": who the song is filed under ("Jesse & Joy" stays whole). */
export const mainArtist = (s: Pick<CloudSong, 'artists'>): string =>
  s.artists.split(/,| feat\.? | ft\.? | x /i)[0].trim() || s.artists

/** Your artists, the ones with more songs first. */
export const groupArtists = (songs: CloudSong[]): ArtistGroup[] => {
  const by = new Map<string, ArtistGroup>()
  for (const s of songs) {
    const name = mainArtist(s)
    const g = by.get(name) ?? { name, count: 0, cover: null }
    g.count++
    g.cover ??= s.coverUrl
    by.set(name, g)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'))
}

/** The index letter of a title: accents dropped, anything that isn't A–Z is "#". */
export const letterOf = (title: string): string => {
  const c = title.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

const byTitle = (a: CloudSong, b: CloudSong): number => {
  const la = letterOf(a.title)
  const lb = letterOf(b.title)
  if (la !== lb) return la === '#' ? 1 : lb === '#' ? -1 : la.localeCompare(lb)
  return a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })
}

const minutes = (songs: CloudSong[]): string => {
  const min = Math.round(songs.reduce((t, s) => t + (s.durationSec ?? 0), 0) / 60)
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`
}

/** Your cloud library: songs, artists and playlists; a playlist or an artist open. */
export function LibraryScreen(p: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [az, setAz] = useState(false)
  // Playlist cards: two per row, whatever the phone's width.
  const card = Math.floor((useWindowDimensions().width - 56) / 2)
  const list = useRef<FlatList<CloudSong>>(null)
  const openName = p.playlistId ? 'playlist' : p.artist ? 'artist' : null
  const section = openName ? 'songs' : (p.section ?? 'songs')
  // A–Z only for the whole library; a playlist keeps its order.
  const sorted = !openName && az
  const visible = useMemo(() => {
    const found = filterSongs(p.songs, query)
    return sorted ? [...found].sort(byTitle) : found
  }, [p.songs, query, sorted])
  const state = p.downloadState ?? ((): DownloadState => 'none')
  const missing = visible.filter((s) => state(s) === 'none')
  const letters = useMemo(
    () => (sorted ? [...new Set(visible.map((s) => letterOf(s.title)))] : []),
    [sorted, visible]
  )

  const report = p.onVisibleChange
  useEffect(() => {
    report?.(visible)
  }, [visible, report])

  // A new playlist or artist starts with an empty search.
  useEffect(() => setQuery(''), [p.playlistId, p.artist])

  const jumpTo = (letter: string): void => {
    const index = visible.findIndex((s) => letterOf(s.title) === letter)
    if (index >= 0) list.current?.scrollToIndex({ index, animated: false })
  }

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

  const refresh = (
    <RefreshControl refreshing={p.loading} onRefresh={p.onRefresh} tintColor={colors.pink} />
  )

  const offlineBanner = p.offline && (
    <View testID="offline" style={styles.offline}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.text} />
      <Text style={styles.offlineText}>Sin conexión: suenan tus canciones descargadas</Text>
    </View>
  )
  const errorText = p.error && (
    <Text testID="error" style={styles.error}>
      {p.error}
    </Text>
  )
  const downloadRow = p.progress ? (
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
  )

  /** Biblioteca's top: title, actions and the Canciones / Artistas / Playlists switch. */
  const libraryTop = (
    <>
      <View style={styles.headerTop}>
        <View style={{ flex: 1 }}>
          <Text testID="title" numberOfLines={1} style={styles.title}>
            {p.title}
          </Text>
          <Text testID="count" style={styles.count}>
            {p.total} canciones en tu nube
            {p.downloadedCount ? ` · ` : ''}
            {!!p.downloadedCount && (
              <Text testID="downloaded-count">{p.downloadedCount} en el teléfono</Text>
            )}
          </Text>
        </View>
        {p.onOpenSearch && !p.offline && (
          <Pressable
            onPress={p.onOpenSearch}
            accessibilityLabel="Agregar música"
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Ionicons name="add" size={26} color={colors.text} />
          </Pressable>
        )}
        {p.onMenu && (
          <Pressable
            onPress={p.onMenu}
            accessibilityLabel="Opciones de descarga"
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </Pressable>
        )}
      </View>
      {offlineBanner}
      <View accessibilityRole="tablist" style={styles.segments}>
        {(
          [
            ['songs', 'Canciones'],
            ['artists', 'Artistas'],
            ['playlists', 'Playlists']
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === id }}
            onPress={() => p.onSection?.(id)}
            style={[styles.segment, section === id && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, section === id && styles.segmentTextOn]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  )

  // Artistas and Playlists: their own lists.
  if (section === 'artists') {
    return (
      <FlatList
        testID="library"
        key="artists"
        style={styles.list}
        data={p.artists ?? []}
        keyExtractor={(a) => a.name}
        refreshControl={refresh}
        ListHeaderComponent={
          <View style={styles.header}>
            {libraryTop}
            {errorText}
          </View>
        }
        ListEmptyComponent={p.loading ? undefined : <Text style={styles.empty}>{emptyText()}</Text>}
        renderItem={({ item: a }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Artista: ${a.name}`}
            onPress={() => p.onSelectArtist?.(a.name)}
            style={({ pressed }) => [styles.row, pressed && styles.rowActive]}
          >
            <Collage covers={[a.cover]} name={a.name} size={56} round />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.songTitle}>
                {a.name}
              </Text>
              <Text style={styles.artist}>
                {a.count === 1 ? '1 canción' : `${a.count} canciones`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </Pressable>
        )}
      />
    )
  }
  if (section === 'playlists') {
    const cards: (PlaylistChip | 'new')[] = [
      ...(p.playlists ?? []),
      ...(p.onNewPlaylist && !p.offline ? (['new'] as const) : [])
    ]
    return (
      <FlatList
        testID="library"
        key="playlists"
        style={styles.list}
        data={cards}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        keyExtractor={(c) => (c === 'new' ? 'new' : c.id)}
        refreshControl={refresh}
        ListHeaderComponent={
          <View style={styles.header}>
            {libraryTop}
            {errorText}
          </View>
        }
        renderItem={({ item: c }) =>
          c === 'new' ? (
            <Pressable
              accessibilityRole="button"
              onPress={p.onNewPlaylist}
              style={[styles.card, { width: card }]}
            >
              <View style={[styles.newCover, { width: card, height: card }]}>
                <Ionicons name="add" size={40} color={colors.muted} />
              </View>
              <Text style={styles.cardTitle}>Nueva playlist</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={c.name}
              onPress={() => p.onSelectPlaylist?.(c.id)}
              style={[styles.card, { width: card }]}
            >
              <Collage covers={c.covers} name={c.name} size={card} />
              <Text numberOfLines={1} style={styles.cardTitle}>
                {c.name}
              </Text>
              <Text style={styles.artist}>
                {c.count === 1 ? '1 canción' : `${c.count} canciones`}
              </Text>
            </Pressable>
          )
        }
      />
    )
  }

  const covers = p.songs.slice(0, 8).map((s) => s.coverUrl)
  const header = openName ? (
    // A playlist or an artist, open.
    <View style={[styles.header, styles.openHeader]}>
      <View style={styles.openNav}>
        <Pressable
          onPress={p.onBack}
          accessibilityLabel="Volver"
          hitSlop={8}
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        {p.onMenu && openName === 'playlist' && !p.offline && (
          <Pressable
            onPress={p.onMenu}
            accessibilityLabel="Opciones de la playlist"
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
          </Pressable>
        )}
      </View>
      <View style={styles.openInfo}>
        <Collage covers={covers} name={p.title} size={120} round={openName === 'artist'} />
        <View style={styles.rowText}>
          <Text style={styles.kicker}>{openName === 'playlist' ? 'PLAYLIST' : 'ARTISTA'}</Text>
          <Text testID="title" numberOfLines={2} style={styles.openTitle}>
            {p.title}
          </Text>
          <Text testID="count" style={styles.count}>
            {p.songs.length === 1 ? '1 canción' : `${p.songs.length} canciones`} ·{' '}
            {minutes(p.songs)}
          </Text>
          {p.keepDownloaded && (
            <View style={styles.kept}>
              <Ionicons name="checkmark-circle" size={14} color={colors.pinkSoft} />
              <Text style={styles.keptText}>Descargada</Text>
            </View>
          )}
        </View>
      </View>
      {offlineBanner}
      <View style={styles.bigButtons}>
        <Pressable
          style={[styles.bigButton, styles.bigPlay]}
          disabled={visible.length === 0}
          onPress={() =>
            p.onPlayAll ? p.onPlayAll(visible) : visible[0] && p.onPlay(visible[0].id)
          }
        >
          <Ionicons name="play" size={18} color="#fff" />
          <Text style={styles.bigPlayText}>Reproducir</Text>
        </Pressable>
        <Pressable
          style={[styles.bigButton, styles.bigOutline]}
          accessibilityLabel="Aleatorio"
          disabled={visible.length === 0}
          onPress={() => p.onShuffleAll(visible)}
        >
          <Ionicons name="shuffle" size={18} color={colors.text} />
          <Text style={styles.bigOutlineText}>Aleatorio</Text>
        </Pressable>
      </View>
      {downloadRow}
      {errorText}
    </View>
  ) : (
    <View style={styles.header}>
      {libraryTop}

      {!!p.requests?.length && (
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

      <View style={styles.actions}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.faint} />
          <TextInput
            testID="search"
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar en tu música"
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
      <View style={styles.sortRow}>
        <Pressable
          onPress={() => setAz((v) => !v)}
          accessibilityLabel={az ? 'Ordenar por recientes' : 'Ordenar de la A a la Z'}
          hitSlop={8}
          style={styles.sort}
        >
          <Ionicons name="swap-vertical" size={16} color={colors.muted} />
          <Text style={styles.sortText}>{az ? 'A–Z' : 'Recientes'}</Text>
        </Pressable>
      </View>
      {downloadRow}
      {errorText}
    </View>
  )

  return (
    <View style={styles.list}>
      <FlatList
        ref={list}
        testID="library"
        key="songs"
        style={styles.list}
        data={visible}
        keyExtractor={(s) => s.id}
        refreshControl={refresh}
        keyboardShouldPersistTaps="handled"
        onScrollToIndexFailed={(info) => {
          // Rows not measured yet: jump close by, then exactly.
          list.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false
          })
          setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false }), 50)
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={p.loading ? undefined : <Text style={styles.empty}>{emptyText()}</Text>}
        renderItem={({ item: s, index }) => {
          const isCurrent = s.id === p.currentId
          const st = state(s)
          const letter = sorted ? letterOf(s.title) : null
          const newLetter = letter && (index === 0 || letterOf(visible[index - 1].title) !== letter)
          return (
            <>
              {newLetter && <Text style={styles.letter}>{letter}</Text>}
              <Pressable
                testID={`song-${s.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${s.title}, ${s.artists}`}
                onPress={() => p.onPlay(s.id)}
                onLongPress={p.onSongMenu && !p.offline ? () => p.onSongMenu?.(s) : undefined}
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
            </>
          )
        }}
      />
      {letters.length > 1 && (
        <View style={styles.rail}>
          {letters.map((l) => (
            <Pressable
              key={l}
              accessibilityLabel={`Ir a la ${l}`}
              hitSlop={{ left: 12, right: 4 }}
              onPress={() => jumpTo(l)}
            >
              <Text style={styles.railText}>{l}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHi
  },
  title: { color: colors.text, fontSize: 30, fontWeight: '800' },
  count: { color: colors.muted, fontSize: 13, marginTop: 4 },
  segments: { flexDirection: 'row', gap: 8, marginTop: 16 },
  segment: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center'
  },
  segmentOn: { backgroundColor: colors.text, borderColor: colors.text },
  segmentText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  segmentTextOn: { color: colors.bg },
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceHi,
    borderRadius: 10,
    paddingHorizontal: 12
  },
  searchInput: { flex: 1, color: colors.text, paddingVertical: 10, fontSize: 15 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center'
  },
  roundActive: { backgroundColor: colors.violet },
  shuffle: { backgroundColor: colors.pink },
  sortRow: { flexDirection: 'row', marginTop: 10 },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  sortText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  progressText: { color: colors.muted, fontSize: 13, flex: 1 },
  link: { color: colors.pinkSoft, fontSize: 14, fontWeight: '600' },
  error: { color: colors.red, marginTop: 12, fontSize: 14 },
  empty: { color: colors.faint, textAlign: 'center', padding: 32, fontSize: 15, lineHeight: 22 },
  openHeader: { paddingTop: 44, paddingBottom: 14, backgroundColor: 'rgba(139,92,246,0.14)' },
  openNav: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  openInfo: { flexDirection: 'row', alignItems: 'flex-end', gap: 16 },
  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  openTitle: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 4 },
  kept: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  keptText: { color: colors.pinkSoft, fontSize: 13, fontWeight: '600' },
  bigButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  bigButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  bigPlay: { backgroundColor: colors.pink },
  bigPlayText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  bigOutline: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  bigOutlineText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  letter: {
    color: colors.pinkSoft,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 2
  },
  rail: {
    position: 'absolute',
    right: 2,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    gap: 2
  },
  railText: { color: colors.muted, fontSize: 11, fontWeight: '700', paddingHorizontal: 4 },
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
  dl: { width: 26, alignItems: 'center' },
  gridRow: { gap: 16, paddingHorizontal: 20, marginBottom: 18 },
  card: { gap: 6 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  newCover: {
    borderRadius: 13,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center'
  }
})
