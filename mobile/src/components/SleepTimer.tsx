import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'
import type { Player } from '../usePlayer'

const OPTIONS: { label: string; value: { minutes: number } | 'endOfSong' }[] = [
  { label: '15 minutos', value: { minutes: 15 } },
  { label: '30 minutos', value: { minutes: 30 } },
  { label: '45 minutos', value: { minutes: 45 } },
  { label: '1 hora', value: { minutes: 60 } },
  { label: 'Al terminar esta canción', value: 'endOfSong' }
]

/** "Stop the music in…": the moon in the player bar (pink while set). */
export function SleepTimer({ player }: { player: Player }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const s = player.sleep
  const left =
    s && 'at' in s
      ? `Se detiene en ${Math.max(1, Math.round((s.at - Date.now()) / 60_000))} min`
      : s
        ? 'Se detiene al terminar esta canción'
        : null

  return (
    <>
      <Pressable
        accessibilityLabel="Temporizador"
        accessibilityState={{ selected: !!s }}
        hitSlop={8}
        onPress={() => setOpen(true)}
      >
        <Ionicons
          name={s ? 'moon' : 'moon-outline'}
          size={20}
          color={s ? colors.pinkSoft : colors.muted}
        />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Detener la música</Text>
            {left && (
              <Text testID="sleep-left" style={styles.left}>
                {left}
              </Text>
            )}
            {OPTIONS.map((o) => (
              <Pressable
                key={o.label}
                style={styles.option}
                onPress={() => {
                  player.setSleep(o.value)
                  setOpen(false)
                }}
              >
                <Text style={styles.optionText}>{o.label}</Text>
              </Pressable>
            ))}
            {s && (
              <Pressable
                style={styles.option}
                onPress={() => {
                  player.setSleep(null)
                  setOpen(false)
                }}
              >
                <Text style={[styles.optionText, { color: colors.red }]}>Quitar temporizador</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1c1a24',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  left: { color: colors.pinkSoft, fontSize: 13, marginBottom: 8 },
  option: { paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: 1 },
  optionText: { color: colors.text, fontSize: 16 }
})
