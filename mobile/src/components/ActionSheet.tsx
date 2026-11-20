import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

export interface Action {
  label: string
  onPress: () => void
  destructive?: boolean
}

/** A list of choices that slides up (song and playlist menus). */
export function ActionSheet(props: {
  visible: boolean
  title: string
  subtitle?: string
  actions: Action[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.backdrop} onPress={props.onClose}>
        <View style={styles.sheet}>
          <Text numberOfLines={1} style={styles.title}>
            {props.title}
          </Text>
          {props.subtitle && (
            <Text numberOfLines={1} style={styles.subtitle}>
              {props.subtitle}
            </Text>
          )}
          <ScrollView style={{ maxHeight: 420 }}>
            {props.actions.map((a) => (
              <Pressable
                key={a.label}
                style={styles.option}
                onPress={() => {
                  props.onClose()
                  a.onPress()
                }}
              >
                <Text style={[styles.optionText, a.destructive && { color: colors.red }]}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
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
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 2, marginBottom: 6 },
  option: { paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: 1 },
  optionText: { color: colors.text, fontSize: 16 }
})
