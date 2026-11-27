import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import type { Podcast, PodcastEpisode } from '../../../src/shared/api'
import type { Cloud } from '../cloud'
import { loadEpisodePositions, type EpisodePositions } from '../offline'
import {
  episodeProgress,
  episodeSong,
  episodeSongId,
  length,
  published,
  startAt,
  type EpisodeSong
} from '../podcasts'
import { colors } from '../theme'

interface Props {
  cloud: Cloud
  /** The song or episode playing (to mark it), and whether it plays (positions move). */
  currentId: string | null
  playing: boolean
  onPlay: (episode: EpisodeSong, from: number) => void
}

type Show = Podcast & { subscribed: boolean }

/** Podcasts: your shows, a search (Podcast Index) and a show's episodes. */
export function PodcastsScreen({ cloud, currentId, playing, onPlay }: Props): React.JSX.Element {
  const [subs, setSubs] = useState<Podcast[] | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Show[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<Podcast | null>(null)

  const loadSubs = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setSubs(await cloud.listPodcastSubscriptions())
    } catch (e) {
      setError((e as Error).message)
      setSubs((s) => s ?? [])
    }
  }, [cloud])

  useEffect(() => {
    void loadSubs()
  }, [loadSubs])

  async function search(): Promise<void> {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try {
      setResults(await cloud.searchPodcasts(query))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const subscribed = (id: string): boolean => !!subs?.some((p) => p.id === id)

  async function toggleSub(p: Podcast): Promise<void> {
    setError(null)
    try {
      setSubs(
        subscribed(p.id) ? await cloud.unsubscribePodcast(p.id) : await cloud.subscribePodcast(p)
      )
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (show) {
    return (
      <ShowScreen
        cloud={cloud}
        show={show}
        subscribed={subscribed(show.id)}
        onToggleSub={() => void toggleSub(show)}
        onClose={() => setShow(null)}
        currentId={currentId}
        playing={playing}
        onPlay={onPlay}
      />
    )
  }

  const searching = results !== null
  const list: Podcast[] = searching ? results : (subs ?? [])

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Podcasts</Text>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.faint} />
          <TextInput
            testID="podcast-search"
            style={styles.input}
            value={query}
            onChangeText={(t) => {
              setQuery(t)
              if (!t.trim()) setResults(null) // cleared: back to your shows
            }}
            onSubmitEditing={() => void search()}
            returnKeyType="search"
            placeholder="Buscar podcasts"
            placeholderTextColor={colors.faint}
            autoCorrect={false}
          />
          {busy && <ActivityIndicator size="small" color={colors.pink} />}
          {!busy && query.length > 0 && (
            <Pressable
              accessibilityLabel="Borrar búsqueda"
              hitSlop={10}
              onPress={() => {
                setQuery('')
                setResults(null)
              }}
            >
              <Ionicons name="close-circle" size={18} color={colors.faint} />
            </Pressable>
          )}
        </View>
        {error && (
          <Text testID="podcast-error" style={styles.error}>
            {error}
          </Text>
        )}
        <Text style={styles.section}>{searching ? 'Resultados' : 'Tus podcasts'}</Text>
      </View>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          searching ? undefined : (
            <RefreshControl
              refreshing={false}
              onRefresh={() => void loadSubs()}
              tintColor={colors.pink}
            />
          )
        }
        ListEmptyComponent={
          searching ? (
            busy ? undefined : (
              <Text style={styles.empty}>No encontré nada con eso.</Text>
            )
          ) : subs === null ? (
            <ActivityIndicator style={{ padding: 32 }} color={colors.pink} />
          ) : (
            <Text style={styles.empty}>
              Busca un podcast arriba y suscríbete para tenerlo aquí.
            </Text>
          )
        }
        renderItem={({ item: p }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Podcast: ${p.title}`}
            onPress={() => setShow(p)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
          >
            <Cover uri={p.image} />
            <View style={styles.text}>
              <Text numberOfLines={2} style={styles.rowTitle}>
                {p.title}
              </Text>
              {!!p.author && (
                <Text numberOfLines={1} style={styles.sub}>
                  {p.author}
                </Text>
              )}
            </View>
            {searching && (
              <Pressable
                accessibilityLabel={
                  subscribed(p.id) ? `Quitar suscripción a ${p.title}` : `Suscribirse a ${p.title}`
                }
                hitSlop={10}
                onPress={() => void toggleSub(p)}
              >
                <Ionicons
                  name={subscribed(p.id) ? 'checkmark-circle' : 'add-circle-outline'}
                  size={28}
                  color={colors.pink}
                />
              </Pressable>
            )}
          </Pressable>
        )}
      />
    </View>
  )
}

function Cover({ uri, size = 52 }: { uri: string | null; size?: number }): React.JSX.Element {
  return uri ? (
    <Image source={{ uri }} style={[styles.cover, { width: size, height: size }]} />
  ) : (
    <View style={[styles.cover, styles.coverEmpty, { width: size, height: size }]}>
      <Ionicons name="mic" size={size / 2.2} color={colors.faint} />
    </View>
  )
}

/** A show: subscribe, and its episodes (newest first), each where it was left. */
function ShowScreen(props: {
  cloud: Cloud
  show: Podcast
  subscribed: boolean
  onToggleSub: () => void
  onClose: () => void
  currentId: string | null
  playing: boolean
  onPlay: (episode: EpisodeSong, from: number) => void
}): React.JSX.Element {
  const { cloud, show, currentId, playing } = props
  const [episodes, setEpisodes] = useState<PodcastEpisode[] | null>(null)
  const [positions, setPositions] = useState<EpisodePositions>({})
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setEpisodes(await cloud.podcastEpisodes(show.id))
    } catch (e) {
      setError((e as Error).message)
      setEpisodes((x) => x ?? [])
    }
  }, [cloud, show.id])

  useEffect(() => {
    void load()
  }, [load])

  // Fresh positions whenever something starts, stops or changes.
  useEffect(() => {
    void loadEpisodePositions().then(setPositions, () => {})
  }, [currentId, playing])

  return (
    <View style={styles.root}>
      <FlatList
        data={episodes ?? []}
        keyExtractor={(e) => e.id}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => void load()}
            tintColor={colors.pink}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Pressable onPress={props.onClose} accessibilityLabel="Volver" hitSlop={12}>
              <Ionicons name="chevron-back" size={28} color={colors.text} />
            </Pressable>
            <View style={styles.showTop}>
              <Cover uri={show.image} size={96} />
              <View style={styles.text}>
                <Text numberOfLines={3} style={styles.showTitle}>
                  {show.title}
                </Text>
                {!!show.author && (
                  <Text numberOfLines={1} style={styles.sub}>
                    {show.author}
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={props.onToggleSub}
                  style={[styles.subBtn, props.subscribed && styles.subBtnOn]}
                >
                  <Text style={styles.subBtnText}>
                    {props.subscribed ? 'Suscrito' : 'Suscribirse'}
                  </Text>
                </Pressable>
              </View>
            </View>
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          episodes === null ? (
            <ActivityIndicator style={{ padding: 32 }} color={colors.pink} />
          ) : error ? undefined : (
            <Text style={styles.empty}>Este podcast no tiene episodios para escuchar.</Text>
          )
        }
        renderItem={({ item: ep }) => {
          const id = episodeSongId(ep.id)
          const on = currentId === id
          const prog = episodeProgress(ep, positions)
          const info = [
            published(ep.publishedAt),
            prog && 'heard' in prog
              ? 'Escuchado'
              : prog && prog.left > 0
                ? `Quedan ${length(prog.left) || '1 min'}`
                : length(ep.durationSec)
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <View style={styles.episode}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Episodio: ${ep.title}`}
                onPress={() => props.onPlay(episodeSong(ep, show), startAt(ep, positions))}
                onLongPress={() => setOpen(open === ep.id ? null : ep.id)}
                style={({ pressed }) => [styles.episodeMain, pressed && { opacity: 0.6 }]}
              >
                <View style={styles.text}>
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.rowTitle,
                      on && { color: colors.pinkSoft },
                      prog && 'heard' in prog && { color: colors.muted }
                    ]}
                  >
                    {ep.title}
                  </Text>
                  <Text style={styles.sub}>{info}</Text>
                </View>
                <Ionicons
                  name={on && playing ? 'volume-high' : 'play-circle'}
                  size={30}
                  color={on ? colors.pinkSoft : colors.text}
                />
              </Pressable>
              {!!ep.description && (
                <Pressable onPress={() => setOpen(open === ep.id ? null : ep.id)} hitSlop={6}>
                  <Text numberOfLines={open === ep.id ? undefined : 2} style={styles.notes}>
                    {ep.description}
                  </Text>
                </Pressable>
              )}
            </View>
          )
        }}
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
    backgroundColor: 'rgba(139,92,246,0.14)'
  },
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
  section: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 16,
    textTransform: 'uppercase'
  },
  error: { color: colors.red, marginTop: 10, fontSize: 14 },
  empty: { color: colors.faint, textAlign: 'center', padding: 32, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8
  },
  cover: { borderRadius: 10, backgroundColor: '#27272a' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  showTop: { flexDirection: 'row', gap: 14, marginTop: 12, alignItems: 'center' },
  showTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  subBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.pink
  },
  subBtnOn: { backgroundColor: colors.surfaceHi },
  subBtnText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  episode: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: 1
  },
  episodeMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  notes: { color: colors.faint, fontSize: 13, marginTop: 6, lineHeight: 18 }
})
