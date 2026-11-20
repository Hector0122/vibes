import { Image, StyleSheet, Text, View } from 'react-native'

const TINTS = ['#c4b5fd', '#f9a8d4', '#7dd3fc', '#fdba74', '#86efac']

/** A stable color for a name, for covers without art. */
export const tintFor = (name: string): string =>
  TINTS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length]

/**
 * A cover from up to 4 song covers (a 2×2 grid when there are 4), or the name's initial on a
 * color when there are none. `round` for artists.
 */
export function Collage(props: {
  covers: (string | null)[]
  name: string
  size: number
  round?: boolean
}): React.JSX.Element {
  const urls = [...new Set(props.covers.filter((c): c is string => !!c))]
  const box = {
    width: props.size,
    height: props.size,
    borderRadius: props.round ? props.size / 2 : Math.max(6, props.size / 12)
  }
  if (urls.length === 0) {
    return (
      <View style={[styles.box, box, { backgroundColor: tintFor(props.name) }]}>
        <Text style={[styles.initial, { fontSize: props.size * 0.38 }]}>
          {props.name.trim().charAt(0).toUpperCase() || '♪'}
        </Text>
      </View>
    )
  }
  if (urls.length < 4 || props.round) {
    return <Image source={{ uri: urls[0] }} style={[styles.box, box]} />
  }
  const half = props.size / 2
  return (
    <View style={[styles.box, box, styles.grid]}>
      {urls.slice(0, 4).map((u) => (
        <Image key={u} source={{ uri: u }} style={{ width: half, height: half }} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center'
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  initial: { color: '#09090b', fontWeight: '800' }
})
