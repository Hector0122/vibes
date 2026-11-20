import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import type { CloudSong } from '../../../src/shared/api'
import { colors, fmtTime } from '../theme'

interface Props {
  songs: CloudSong[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  currentId: string | null
  onPlay: (id: string) => void
  onShuffleAll: (visible: CloudSong[]) => void
  onOpenSettings: () => void
  /** Reports the filtered list, which is what the player plays through. */
  onVisibleChange?: (visible: CloudSong[]) => void
}

export const filterSongs = (songs: CloudSong[], query: string): CloudSong[] => {
  const q = query.trim().toLowerCase()
  return q ? songs.filter((s) => s.title.toLowerCase().includes(q) || s.artists.toLowerCase().includes(q)) : songs
}

/** Your cloud library: search, shuffle, tap to play. */
export function LibraryScreen(p: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => filterSongs(p.songs, query), [p.songs, query])

  return (
    <FlatList
      style={styles.list}
      data={visible}
      keyExtractor={(s) => s.id}
      refreshControl={<RefreshControl refreshing={p.loading} onRefresh={p.onRefresh} tintColor={colors.pink} />}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.kicker}>BIBLIOTECA</Text>
              <Text style={styles.title}>Tu música</Text>
            </View>
            <Pressable onPress={p.onOpenSettings} accessibilityLabel="Nube" hitSlop={12}>
              <Ionicons name="cloud-outline" size={26} color={colors.muted} />
            </Pressable>
          </View>
          <Text testID="count" style={styles.count}>
            {p.songs.length} canciones en tu nube
          </Text>
          <View style={styles.actions}>
            <View style={styles.search}>
              <Ionicons name="search" size={18} color={colors.faint} />
              <TextInput
                testID="search"
                style={styles.searchInput}
                value={query}
                onChangeText={(q) => {
                  setQuery(q)
                  p.onVisibleChange?.(filterSongs(p.songs, q))
                }}
                placeholder="Buscar canción o artista"
                placeholderTextColor={colors.faint}
                autoCorrect={false}
              />
            </View>
            <Pressable
              style={styles.shuffle}
              accessibilityLabel="Aleatorio"
              disabled={visible.length === 0}
              onPress={() => p.onShuffleAll(visible)}
            >
              <Ionicons name="shuffle" size={22} color="#fff" />
            </Pressable>
          </View>
          {p.error && (
            <Text testID="error" style={styles.error}>
              {p.error}
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={
        p.loading ? undefined : (
          <Text style={styles.empty}>
            {p.songs.length === 0
              ? 'Tu nube está vacía. Sube tu música desde Vibes en la computadora (“Subir a la nube”).'
              : 'Nada coincide con tu búsqueda.'}
          </Text>
        )
      }
      renderItem={({ item: s }) => {
        const isCurrent = s.id === p.currentId
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
              <Text numberOfLines={1} style={[styles.songTitle, isCurrent && { color: colors.pinkSoft }]}>
                {s.title}
              </Text>
              <Text numberOfLines={1} style={styles.artist}>
                {s.artists}
              </Text>
            </View>
            <Text style={styles.duration}>{fmtTime(s.durationSec)}</Text>
          </Pressable>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 64, paddingBottom: 12, backgroundColor: 'rgba(139,92,246,0.18)' },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 34, fontWeight: '800', marginTop: 2 },
  count: { color: colors.muted, fontSize: 13, marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
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
  shuffle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.pink,
    alignItems: 'center',
    justifyContent: 'center'
  },
  error: { color: colors.red, marginTop: 12, fontSize: 14 },
  empty: { color: colors.faint, textAlign: 'center', padding: 32, fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 },
  rowActive: { backgroundColor: colors.surface },
  cover: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#27272a' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  songTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  artist: { color: colors.muted, fontSize: 13, marginTop: 2 },
  duration: { color: colors.faint, fontSize: 12, fontVariant: ['tabular-nums'] }
})
