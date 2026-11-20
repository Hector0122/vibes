import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { createCloud, normalizeUrl } from '../cloud'
import type { CloudSettings } from '../settings'
import { colors } from '../theme'

interface Props {
  initial: CloudSettings | null
  onSave: (s: CloudSettings) => Promise<void>
  onCancel?: () => void
  /** Checks the connection; defaults to calling the Worker's /health. */
  test?: (s: CloudSettings) => Promise<void>
}

const defaultTest = (s: CloudSettings): Promise<void> => createCloud(s).health()

/** Where your music lives: the Worker URL and your personal token. */
export function SettingsScreen({ initial, onSave, onCancel, test = defaultTest }: Props): React.JSX.Element {
  const [url, setUrl] = useState(initial?.url ?? '')
  const [token, setToken] = useState(initial?.token ?? '')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const value = (): CloudSettings | null => {
    const u = normalizeUrl(url)
    if (!u) {
      setStatus({ ok: false, text: 'La URL debe empezar con https://' })
      return null
    }
    if (!token.trim()) {
      setStatus({ ok: false, text: 'Falta el token' })
      return null
    }
    return { url: u, token: token.trim() }
  }

  async function run(action: 'test' | 'save'): Promise<void> {
    const s = value()
    if (!s) return
    setBusy(true)
    setStatus(null)
    try {
      await test(s)
      if (action === 'save') await onSave(s)
      else setStatus({ ok: true, text: 'Conexión correcta ✓' })
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.badge}>
        <Ionicons name="cloud-outline" size={28} color="#fff" />
      </View>
      <Text style={styles.title}>Tu nube</Text>
      <Text style={styles.subtitle}>
        La misma que usas en la computadora: en Vibes de escritorio, botón “Nube”.
      </Text>

      <Text style={styles.label}>URL del Worker</Text>
      <TextInput
        testID="url"
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="https://vibes-cloud.tu-cuenta.workers.dev"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.label}>Token</Text>
      <TextInput
        testID="token"
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="Contenido de ~/.config/vibes/api_token"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      {status && (
        <Text testID="status" style={[styles.status, { color: status.ok ? '#6ee7b7' : colors.red }]}>
          {status.text}
        </Text>
      )}

      <View style={styles.row}>
        {onCancel && (
          <Pressable style={styles.btn} onPress={onCancel} accessibilityRole="button">
            <Text style={styles.btnText}>Cancelar</Text>
          </Pressable>
        )}
        <Pressable style={styles.btn} onPress={() => run('test')} disabled={busy} accessibilityRole="button">
          <Text style={styles.btnText}>Probar</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.accent]}
          onPress={() => run('save')}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnText, styles.bold]}>Guardar</Text>}
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 24, paddingTop: 72 },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 16 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 6, marginBottom: 24 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15
  },
  status: { marginTop: 16, fontSize: 14 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 28 },
  btn: {
    minWidth: 96,
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceHi
  },
  accent: { backgroundColor: colors.pink },
  btnText: { color: colors.text, fontSize: 15 },
  bold: { fontWeight: '700' }
})
