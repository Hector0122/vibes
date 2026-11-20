import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'
import type { Player } from '../usePlayer'

/** The bar at the bottom: what's playing, progress, and the controls. */
export function PlayerBar({ player }: { player: Player }): React.JSX.Element | null {
  const s = player.current
  if (!s) return null
  const pct = player.duration > 0 ? Math.min(1, player.time / player.duration) : 0

  return (
    <View style={styles.bar}>
      <View style={styles.track}>
        <View testID="progress" style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
      <View style={styles.row}>
        {s.coverUrl ? (
          <Image source={{ uri: s.coverUrl }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverEmpty]}>
            <Ionicons name="musical-note" size={18} color={colors.faint} />
          </View>
        )}
        <View style={styles.text}>
          <Text testID="now-playing" numberOfLines={1} style={styles.title}>
            {s.title}
          </Text>
          <Text numberOfLines={1} style={[styles.artist, player.error ? { color: colors.red } : null]}>
            {player.error ?? s.artists}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Aleatorio"
          accessibilityState={{ selected: player.shuffle }}
          hitSlop={8}
          onPress={() => player.setShuffle(!player.shuffle)}
        >
          <Ionicons name="shuffle" size={22} color={player.shuffle ? colors.pinkSoft : colors.muted} />
        </Pressable>
        <Pressable accessibilityLabel="Anterior" hitSlop={8} onPress={player.prev}>
          <Ionicons name="play-skip-back" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityLabel={player.playing ? 'Pausar' : 'Reproducir'}
          style={styles.play}
          onPress={player.toggle}
        >
          {player.loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Ionicons name={player.playing ? 'pause' : 'play'} size={22} color="#000" style={player.playing ? null : { marginLeft: 2 }} />
          )}
        </Pressable>
        <Pressable accessibilityLabel="Siguiente" hitSlop={8} onPress={player.next}>
          <Ionicons name="play-skip-forward" size={22} color={colors.text} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: '#15131c', borderTopColor: colors.border, borderTopWidth: 1, paddingBottom: 24 },
  track: { height: 3, backgroundColor: 'rgba(255,255,255,0.12)' },
  fill: { height: 3, backgroundColor: colors.pinkSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingTop: 10 },
  cover: { width: 46, height: 46, borderRadius: 8, backgroundColor: '#27272a' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  artist: { color: colors.muted, fontSize: 13, marginTop: 2 },
  play: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center'
  }
})
