import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { RecommendationsResponse } from '../../../src/shared/api'
import type { Cloud } from '../cloud'
import { Collage } from '../components/Collage'
import { colors } from '../theme'
import type { ArtistGroup, PlaylistChip } from './LibraryScreen'

interface Props {
  cloud: Cloud | null
  playlists: PlaylistChip[]
  /** Most listened first (by number of songs). */
  artists: ArtistGroup[]
  downloadedCount: number
  error: string | null
  loading: boolean
  onRefresh: () => void
  onOpenPlaylist: (id: string) => void
  onOpenArtist: (name: string) => void
  onOpenDownloaded: () => void
  /** The suggestions open in Buscar, where they can be heard and marked. */
  onOpenSearch: () => void
  onOpenSettings: () => void
}

const greeting = (h = new Date().getHours()): string =>
  h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'

/** Inicio: shortcuts to your playlists, the computer's suggestions and your artists. */
export function HomeScreen(p: Props): React.JSX.Element {
  const [recs, setRecs] = useState<RecommendationsResponse | null>(null)
  useEffect(() => {
    p.cloud?.recommendations().then(setRecs, () => {})
  }, [p.cloud])

  const quick = [
    ...p.playlists.slice(0, p.downloadedCount ? 5 : 6).map((pl) => ({
      key: pl.id,
      name: pl.name,
      covers: pl.covers,
      onPress: () => p.onOpenPlaylist(pl.id)
    })),
    ...(p.downloadedCount
      ? [{ key: 'downloaded', name: 'Descargadas', covers: [], onPress: p.onOpenDownloaded }]
      : [])
  ]

  return (
    <ScrollView
      testID="home"
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={p.loading} onRefresh={p.onRefresh} tintColor={colors.pink} />
      }
    >
      <View style={[styles.pad, styles.top]}>
        <View>
          <Text style={styles.hello}>{greeting()}</Text>
          <Text style={styles.title}>Inicio</Text>
        </View>
        <Pressable
          onPress={p.onOpenSettings}
          accessibilityLabel="Nube"
          hitSlop={8}
          style={styles.round}
        >
          <Ionicons name="cloud-outline" size={22} color={colors.muted} />
        </Pressable>
      </View>

      {p.error && <Text style={[styles.pad, styles.error]}>{p.error}</Text>}

      {quick.length > 0 && (
        <View style={[styles.pad, styles.quick]}>
          {quick.map((q) => (
            <Pressable
              key={q.key}
              accessibilityRole="button"
              onPress={q.onPress}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
            >
              <Collage covers={q.covers} name={q.name} size={52} />
              <Text numberOfLines={2} style={styles.tileText}>
                {q.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {!!recs?.results.length && (
        <View style={styles.section}>
          <View style={styles.pad}>
            <Text style={styles.h2}>Recomendado para ti</Text>
            {recs.basedOn.length > 0 && (
              <Text numberOfLines={1} style={styles.sub}>
                Por escuchar {recs.basedOn.join(', ')}
              </Text>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {recs.results.slice(0, 12).map((r) => (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={`${r.title}, ${r.artists}`}
                onPress={p.onOpenSearch}
                style={styles.card}
              >
                <Collage covers={[r.coverUrl]} name={r.title} size={140} />
                <Text numberOfLines={1} style={styles.cardTitle}>
                  {r.title}
                </Text>
                <Text numberOfLines={1} style={styles.sub}>
                  {r.artists}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {p.artists.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.pad, styles.h2]}>Tus artistas</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {p.artists.slice(0, 12).map((a) => (
              <Pressable
                key={a.name}
                accessibilityRole="button"
                accessibilityLabel={`Artista: ${a.name}`}
                onPress={() => p.onOpenArtist(a.name)}
                style={styles.artist}
              >
                <Collage covers={[a.cover]} name={a.name} size={84} round />
                <Text numberOfLines={1} style={styles.artistName}>
                  {a.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {quick.length === 0 && p.artists.length === 0 && !recs?.results.length && !p.loading && (
        <Text style={[styles.pad, styles.sub]}>
          Tu nube está vacía. Sube tu música desde Vibes en la computadora (“Subir a la nube”).
        </Text>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: 56, paddingBottom: 24, gap: 26 },
  pad: { paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hello: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 2 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center'
  },
  error: { color: colors.red, fontSize: 14 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  tile: {
    width: '48.8%',
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHi
  },
  pressed: { opacity: 0.7 },
  tileText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600', paddingRight: 8 },
  section: { gap: 12 },
  h2: { color: colors.text, fontSize: 20, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  row: { gap: 14, paddingHorizontal: 20 },
  card: { width: 140, gap: 6 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  artist: { width: 84, alignItems: 'center', gap: 8 },
  artistName: { color: colors.text, fontSize: 12, fontWeight: '500', textAlign: 'center' }
})
