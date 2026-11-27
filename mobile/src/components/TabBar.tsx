import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

export type Tab = 'home' | 'music' | 'books' | 'podcasts'

const TABS: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  { id: 'music', label: 'Música', icon: 'musical-notes' },
  { id: 'books', label: 'Libros', icon: 'book' },
  { id: 'podcasts', label: 'Podcasts', icon: 'mic' }
]

/** Inicio · Música · Libros · Podcasts, at the very bottom. Each adds its own (the ➕ at its top). */
export function TabBar(props: { tab: Tab; onChange: (t: Tab) => void }): React.JSX.Element {
  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      {TABS.map((t) => {
        const on = props.tab === t.id
        return (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            onPress={() => props.onChange(t.id)}
            style={styles.tab}
          >
            <Ionicons
              name={on ? t.icon : (`${t.icon}-outline` as keyof typeof Ionicons.glyphMap)}
              size={24}
              color={on ? colors.text : colors.faint}
            />
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: 6,
    paddingBottom: 24
  },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4, minHeight: 48 },
  label: { color: colors.faint, fontSize: 11, fontWeight: '500' },
  labelOn: { color: colors.text, fontWeight: '700' }
})
