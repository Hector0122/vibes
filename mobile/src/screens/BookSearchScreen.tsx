import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { bookSize, loadBook, searchBooks, type LvBook, type LvHit } from '../librivox'
import { colors } from '../theme'

interface Props {
  onClose: () => void
  /** A book was chosen (and its size accepted): bring it into the cloud. */
  onPick: (book: LvBook) => void
}

/** Find a LibriVox audiobook (public domain, read by volunteers) to add to Libros. */
export function BookSearchScreen({ onClose, onPick }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LvHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function search(): Promise<void> {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try {
      setResults(await searchBooks(query))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function open(hit: LvHit): Promise<void> {
    setOpening(hit.id)
    setError(null)
    try {
      const book = await loadBook(hit.id)
      const n = book.chapters.length
      Alert.alert(
        book.title,
        `${n === 1 ? '1 capítulo' : `${n} capítulos`}${hit.runtime ? ` · ${hit.runtime} h` : ''} · ${bookSize(book)}\n\n` +
          'Se baja al teléfono y se sube a tu nube, capítulo por capítulo. Mejor con Wi-Fi.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Agregar', onPress: () => onPick(book) }
        ]
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOpening(null)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.top}>
          <Pressable onPress={onClose} accessibilityLabel="Volver" hitSlop={12}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>LibriVox</Text>
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.faint} />
          <TextInput
            testID="book-search"
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void search()}
            returnKeyType="search"
            placeholder="Título o autor"
            placeholderTextColor={colors.faint}
            autoCorrect={false}
            autoFocus
          />
          {busy && <ActivityIndicator size="small" color={colors.pink} />}
        </View>
        <Text style={styles.hint}>
          Audiolibros gratis en español, de dominio público, leídos por voluntarios.
        </Text>
        {error && (
          <Text testID="book-search-error" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
      <FlatList
        data={results ?? []}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          busy || results === null ? undefined : (
            <Text style={styles.empty}>No encontré nada con eso.</Text>
          )
        }
        renderItem={({ item: r }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Audiolibro: ${r.title}`}
            onPress={() => void open(r)}
            disabled={opening !== null}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
          >
            <Image source={{ uri: `https://archive.org/services/img/${r.id}` }} style={styles.cover} />
            <View style={styles.text}>
              <Text numberOfLines={2} style={styles.bookTitle}>
                {r.title}
              </Text>
              <Text numberOfLines={1} style={styles.author}>
                {r.author}
                {r.runtime ? ` · ${r.runtime} h` : ''}
              </Text>
            </View>
            {opening === r.id ? (
              <ActivityIndicator size="small" color={colors.pink} />
            ) : (
              <Ionicons name="add-circle" size={28} color={colors.pink} />
            )}
          </Pressable>
        )}
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
    backgroundColor: 'rgba(236,72,153,0.14)'
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  hint: { color: colors.faint, fontSize: 12, marginTop: 10, lineHeight: 17 },
  error: { color: colors.red, marginTop: 10, fontSize: 14 },
  empty: { color: colors.faint, textAlign: 'center', padding: 32, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8
  },
  cover: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#27272a' },
  text: { flex: 1, minWidth: 0 },
  bookTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  author: { color: colors.muted, fontSize: 13, marginTop: 2 }
})
