import { useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, Text, View } from 'react-native'
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
  /** While dragging: where it would land. (After letting go the player shows it: see Engine.seek.) */
  const [target, setTarget] = useState<number | null>(null)
  // Fresh values for the gesture handlers (created once).
  const live = useRef({ width, duration: props.duration, onSeek: props.onSeek })
  live.current = { width, duration: props.duration, onSeek: props.onSeek }
  const startX = useRef(0)

  const pan = useMemo(() => {
    const at = (x: number): number => seekTime(x, live.current.width, live.current.duration)
    return PanResponder.create({
      onStartShouldSetPanResponder: () => live.current.duration > 0,
      onMoveShouldSetPanResponder: () => live.current.duration > 0,
      // The screen scrolls vertically: it must not take the drag over.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        // The bar's children don't take touches, so this is relative to the bar.
        startX.current = e.nativeEvent.locationX
        setTarget(at(startX.current))
      },
      // By how far the finger moved (locationX jumps around while moving on Android).
      onPanResponderMove: (_e, g) => setTarget(at(startX.current + g.dx)),
      onPanResponderRelease: (_e, g) => {
        setTarget(null)
        live.current.onSeek(at(startX.current + g.dx))
      },
      onPanResponderTerminate: () => setTarget(null)
    })
  }, [])

  const shown = target ?? props.time
  const pct = props.duration > 0 ? Math.min(1, shown / props.duration) : 0
  const step = Math.min(30, props.duration / 20)

  return (
    <View style={styles.root}>
      <View
        testID="seek-bar"
        style={styles.touch}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
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
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: `${pct * 100}%` }]} />
        </View>
        <View style={[styles.knob, { left: `${pct * 100}%` }]} pointerEvents="none" />
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
  // Tall enough to grab with a thumb.
  touch: { height: 40, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: '#3f3f46', overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.pinkSoft },
  knob: {
    position: 'absolute',
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: colors.text
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] }
})
