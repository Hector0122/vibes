import { Ionicons } from '@expo/vector-icons'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import type { RecommendationsResponse, SearchResponse, SongRequest } from '../../../src/shared/api'
import type { Cloud } from '../cloud'
import { colors, fmtTime } from '../theme'

type Result = SearchResponse['results'][number]

interface Props {
  cloud: Cloud
  onClose: () => void
  /** A song was marked: the library shows it under "Esperando a la compu". */
  onRequested: (r: SongRequest) => void
  /** A preview clip starts: pause the music. */
  onPreviewStart?: () => void
}

/**
 * Search (Deezer) with 30-second previews, or pick from the computer's suggestions, and mark
 * songs; the computer finds them on YouTube and downloads them next time Vibes is open there.
 */
export function SearchScreen({
  cloud,
  onClose,
  onRequested,
  onPreviewStart
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [recs, setRecs] = useState<RecommendationsResponse | null>(null)

  // 30-second clips, on their own player so the music's queue is left alone.
  const clip = useAudioPlayer(null)
  const clipStatus = useAudioPlayerStatus(clip)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [finding, setFinding] = useState<string | null>(null)
  useEffect(() => {
    if (clipStatus.didJustFinish) setPreviewing(null)
  }, [clipStatus.didJustFinish])

  async function togglePreview(r: Result): Promise<void> {
    if (previewing === r.id) {
      clip.pause()
      setPreviewing(null)
      return
    }
    setError(null)
    let url = r.previewUrl
    if (url === undefined) {
      // A suggestion from the computer (a YouTube video): find its clip on Deezer.
      setFinding(r.id)
      try {
        const found = await cloud.search(`${r.artists} ${r.title}`)
        url = found.find((x) => x.previewUrl)?.previewUrl ?? null
      } catch (e) {
        setError((e as Error).message)
        return
      } finally {
        setFinding(null)
      }
    }
    if (!url) {
      setError('Esta canción no tiene vista previa')
      return
    }
    onPreviewStart?.()
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})
    clip.replace({ uri: url })
    clip.play()
    setPreviewing(r.id)
  }

  // Until you search: the suggestions the computer prepared.
  useEffect(() => {
    cloud.recommendations().then(setRecs, () => {})
  }, [cloud])
  const showingRecs = results === null
  const data = showingRecs ? (recs?.results ?? []) : results

  async function search(): Promise<void> {
    if (!query.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      setResults(await cloud.search(query))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function add(r: Result): Promise<void> {
    setAdding(r.id)
    setError(null)
    try {
      onRequested(await cloud.request(r))
      const mark = (x: Result): Result => (x.id === r.id ? { ...x, requested: true } : x)
      setResults((list) => list?.map(mark) ?? null)
      setRecs((rr) => rr && { ...rr, results: rr.results.map(mark) })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAdding(null)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.top}>
          <Pressable onPress={onClose} accessibilityLabel="Volver" hitSlop={12}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Agregar música</Text>
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.faint} />
          <TextInput
            testID="yt-search"
            style={styles.input}
            value={query}
            onChangeText={(q) => {
              setQuery(q)
              if (!q.trim()) setResults(null) // cleared: back to the suggestions
            }}
            onSubmitEditing={search}
            returnKeyType="search"
            placeholder="Canción, artista o álbum"
            placeholderTextColor={colors.faint}
            autoCorrect={false}
            autoFocus
          />
          {busy && <ActivityIndicator size="small" color={colors.pink} />}
        </View>
        <Text style={styles.hint}>
          Lo que agregues se descarga en tu compu la próxima vez que abras Vibes allá, y luego
          aparece aquí.
        </Text>
        {error && (
          <Text testID="search-error" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
      <FlatList
        data={data}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          showingRecs && recs?.results.length ? (
            <View style={styles.recsHeader}>
              <Text style={styles.recsTitle}>Recomendado para ti</Text>
              {recs.basedOn.length > 0 && (
                <Text numberOfLines={2} style={styles.hint}>
                  Por escuchar {recs.basedOn.join(', ')}
                </Text>
              )}
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          busy ? undefined : (
            <Text style={styles.empty}>
              {showingRecs
                ? 'Busca una canción. Las sugerencias aparecen aquí cuando abras Vibes en tu compu.'
                : 'No encontré nada con eso.'}
            </Text>
          )
        }
        renderItem={({ item: r }) => (
          <View testID={`result-${r.id}`} style={styles.row}>
            {r.coverUrl ? (
              <Image source={{ uri: r.coverUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverEmpty]}>
                <Ionicons name="musical-note" size={18} color={colors.faint} />
              </View>
            )}
            {r.previewUrl !== null &&
              (finding === r.id ? (
                <ActivityIndicator size="small" color={colors.pink} style={styles.play} />
              ) : (
                <Pressable
                  accessibilityLabel={`${previewing === r.id ? 'Detener' : 'Escuchar'}: ${r.title}`}
                  onPress={() => void togglePreview(r)}
                  hitSlop={8}
                  style={styles.play}
                >
                  <Ionicons
                    name={previewing === r.id ? 'stop-circle' : 'play-circle'}
                    size={30}
                    color={previewing === r.id ? colors.pink : colors.text}
                  />
                </Pressable>
              ))}
            <View style={styles.text}>
              <Text
                numberOfLines={1}
                style={[styles.songTitle, previewing === r.id && { color: colors.pinkSoft }]}
              >
                {r.title}
              </Text>
              <Text numberOfLines={1} style={styles.artist}>
                {r.artists}
                {r.durationSec ? ` · ${fmtTime(r.durationSec)}` : ''}
              </Text>
            </View>
            {r.inCloud ? (
              <Text style={styles.tag}>En tu nube</Text>
            ) : r.requested ? (
              <Text style={styles.tag}>Pendiente</Text>
            ) : adding === r.id ? (
              <ActivityIndicator size="small" color={colors.pink} />
            ) : (
              <Pressable
                accessibilityLabel={`Agregar: ${r.title}`}
                style={styles.add}
                onPress={() => void add(r)}
                hitSlop={6}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addText}>Agregar</Text>
              </Pressable>
            )}
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: 'rgba(236,72,153,0.14)'
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14
  },
  input: { flex: 1, color: colors.text, paddingVertical: 10, fontSize: 15 },
  hint: { color: colors.faint, fontSize: 12, marginTop: 10, lineHeight: 17 },
  error: { color: colors.red, marginTop: 10, fontSize: 14 },
  recsHeader: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  recsTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  empty: { color: colors.faint, textAlign: 'center', padding: 32, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8
  },
  cover: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#27272a' },
  play: { width: 30, alignItems: 'center' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  songTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  artist: { color: colors.muted, fontSize: 13, marginTop: 2 },
  tag: { color: colors.faint, fontSize: 12 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.pink,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  addText: { color: '#fff', fontSize: 13, fontWeight: '600' }
})
