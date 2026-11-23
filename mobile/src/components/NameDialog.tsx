import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors } from '../theme'

/** Asks for a name: a playlist's (new, or renaming) or an audiobook's. */
export function NameDialog(props: {
  visible: boolean
  title: string
  initial?: string
  placeholder?: string
  onCancel: () => void
  onSave: (name: string) => void
}): React.JSX.Element {
  const [name, setName] = useState(props.initial ?? '')
  useEffect(() => {
    if (props.visible) setName(props.initial ?? '')
  }, [props.visible, props.initial])
  const ok = name.trim().length > 0 && name.trim().length <= 100
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>{props.title}</Text>
          <TextInput
            testID="playlist-name"
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={props.placeholder ?? 'Nombre de la playlist'}
            placeholderTextColor={colors.faint}
            autoFocus
            maxLength={100}
            onSubmitEditing={() => ok && props.onSave(name.trim())}
          />
          <View style={styles.buttons}>
            <Pressable onPress={props.onCancel} hitSlop={8}>
              <Text style={styles.cancel}>Cancelar</Text>
            </Pressable>
            <Pressable disabled={!ok} onPress={() => props.onSave(name.trim())} hitSlop={8}>
              <Text style={[styles.save, !ok && { opacity: 0.4 }]}>Guardar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 28 },
  box: { backgroundColor: '#1c1a24', borderRadius: 16, padding: 20 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  input: {
    marginTop: 14,
    color: colors.text,
    fontSize: 16,
    borderBottomColor: colors.pink,
    borderBottomWidth: 2,
    paddingVertical: 8
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 20 },
  cancel: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  save: { color: colors.pinkSoft, fontSize: 15, fontWeight: '700' }
})
