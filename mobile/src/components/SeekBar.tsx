import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

/** 125 → "2:05"; 7007 → "1:56:47". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Where a touch at `x` on a bar `width` wide lands, in seconds. */
export const seekTime = (x: number, width: number, duration: number): number =>
  width > 0 && duration > 0 ? Math.min(1, Math.max(0, x / width)) * duration : 0

/** Progress you can touch or drag to move within the song (or a long audiobook). */
export function SeekBar(props: {
  time: number
  duration: number
  onSeek: (t: number) => void
}): React.JSX.Element {
  const [width, setWidth] = useState(0)
  /** While dragging: where it would land. */
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? props.time
  const pct = props.duration > 0 ? Math.min(1, shown / props.duration) : 0
  const at = (x: number): number => seekTime(x, width, props.duration)
  const step = Math.min(30, props.duration / 20)

  return (
    <View style={styles.root}>
      <View
        testID="seek-bar"
        style={styles.touch}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => props.duration > 0}
        onMoveShouldSetResponder={() => props.duration > 0}
        onResponderGrant={(e) => setDrag(at(e.nativeEvent.locationX))}
        onResponderMove={(e) => setDrag(at(e.nativeEvent.locationX))}
        onResponderRelease={(e) => {
          setDrag(null)
          props.onSeek(at(e.nativeEvent.locationX))
        }}
        onResponderTerminate={() => setDrag(null)}
        accessibilityRole="adjustable"
        accessibilityLabel="Posición"
        accessibilityValue={{ text: `${clock(shown)} de ${clock(props.duration)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          props.onSeek(
            Math.min(props.duration, Math.max(0, props.time + (e.nativeEvent.actionName === 'increment' ? step : -step)))
          )
        }
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%` }]} />
        </View>
        <View style={[styles.knob, { left: `${pct * 100}%` }]} />
      </View>
      <View style={styles.times}>
        <Text testID="seek-time" style={styles.time}>
          {clock(shown)}
        </Text>
        <Text style={styles.time}>-{clock(Math.max(0, props.duration - shown))}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch', marginTop: 20 },
  touch: { height: 28, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: '#3f3f46', overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.pinkSoft },
  knob: {
    position: 'absolute',
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.text
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] }
})
