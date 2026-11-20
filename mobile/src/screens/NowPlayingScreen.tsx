import { Ionicons } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance
} from 'react-native'
import { currentLine } from '../../../src/shared/lyrics'
import type { Lyrics } from '../../../src/shared/types'
import { getLyrics } from '../lyrics'
import { colors } from '../theme'
import type { Player } from '../usePlayer'

/** The song playing, big, with its lyrics (synced ones follow the music). */
export function NowPlayingScreen({
  player,
  onClose
}: {
  player: Player
  onClose: () => void
}): React.JSX.Element | null {
  const song = player.current
  const [lyrics, setLyrics] = useState<Lyrics | null | undefined>(undefined)
  const lineY = useRef<number[]>([])
  const scroll = useRef<ScrollViewInstance>(null)

  useEffect(() => {
    if (!song) return
    let alive = true
    setLyrics(undefined)
    lineY.current = []
    getLyrics(song).then(
      (l) => alive && setLyrics(l),
      () => alive && setLyrics(null)
    )
    return () => {
      alive = false
    }
  }, [song])

  const synced = lyrics?.synced ?? null
  const at = synced ? currentLine(synced, player.time + 0.3) : -1
  useEffect(() => {
    const y = lineY.current[at]
    if (y != null) scroll.current?.scrollTo({ y: Math.max(0, y - 160), animated: true })
  }, [at])

  if (!song) return null
  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Pressable onPress={onClose} accessibilityLabel="Cerrar" hitSlop={12}>
          <Ionicons name="chevron-down" size={30} color={colors.text} />
        </Pressable>
        <Text style={styles.kicker}>REPRODUCIENDO</Text>
        <View style={{ width: 30 }} />
      </View>
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        {song.coverUrl ? (
          <Image source={{ uri: song.coverUrl }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverEmpty]}>
            <Ionicons name="musical-notes" size={64} color={colors.faint} />
          </View>
        )}
        <Text style={styles.title}>{song.title}</Text>
        <Text style={styles.artist}>{song.artists}</Text>
        <View style={styles.lyrics}>
          {lyrics === undefined ? (
            <ActivityIndicator color={colors.pink} />
          ) : synced ? (
            synced.map((l, i) => (
              <Text
                key={i}
                testID={i === at ? 'lyric-now' : undefined}
                onLayout={(e) => (lineY.current[i] = e.nativeEvent.layout.y + 420)}
                onPress={() => player.seek(l.t)}
                style={[styles.line, i === at && styles.lineNow, i < at && styles.linePast]}
              >
                {l.text || '♪'}
              </Text>
            ))
          ) : lyrics?.plain ? (
            <Text style={styles.plain}>{lyrics.plain}</Text>
          ) : (
            <Text style={styles.none}>
              {lyrics?.instrumental ? 'Instrumental' : 'No encontré la letra de esta canción.'}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 8
  },
  kicker: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  content: { paddingHorizontal: 24, paddingBottom: 40, alignItems: 'center' },
  cover: { width: 280, height: 280, borderRadius: 16, backgroundColor: '#27272a', marginTop: 12 },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 20,
    textAlign: 'center'
  },
  artist: { color: colors.muted, fontSize: 16, marginTop: 4, textAlign: 'center' },
  lyrics: { alignSelf: 'stretch', marginTop: 28, gap: 10 },
  line: { color: colors.faint, fontSize: 20, fontWeight: '700', lineHeight: 28 },
  lineNow: { color: colors.text },
  linePast: { color: colors.muted },
  plain: { color: colors.text, fontSize: 17, lineHeight: 26 },
  none: { color: colors.faint, fontSize: 15, textAlign: 'center' }
})
