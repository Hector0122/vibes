import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import type { CloudSong } from '../src/shared/api'
import { createCloud, type Cloud } from './src/cloud'
import { PlayerBar } from './src/components/PlayerBar'
import { LibraryScreen } from './src/screens/LibraryScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { loadSettings, saveSettings, type CloudSettings } from './src/settings'
import { colors } from './src/theme'
import { usePlayer } from './src/usePlayer'

export default function App(): React.JSX.Element {
  // undefined = still reading secure storage; null = not set up yet.
  const [settings, setSettings] = useState<CloudSettings | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [songs, setSongs] = useState<CloudSong[]>([])
  const [queue, setQueue] = useState<CloudSong[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cloud: Cloud | null = useMemo(() => {
    if (!settings) return null
    try {
      return createCloud(settings)
    } catch {
      return null
    }
  }, [settings])

  const player = usePlayer(cloud, queue)

  useEffect(() => {
    loadSettings().then(setSettings)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!cloud) return
    setLoading(true)
    setError(null)
    try {
      const list = await cloud.listSongs()
      setSongs(list)
      setQueue(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [cloud])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (settings === undefined) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.pink} />
      </View>
    )
  }

  if (!settings || editing) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SettingsScreen
          initial={settings}
          onCancel={settings ? () => setEditing(false) : undefined}
          onSave={async (s) => {
            await saveSettings(s)
            setSettings(s)
            setEditing(false)
          }}
        />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LibraryScreen
        songs={songs}
        loading={loading}
        error={error}
        onRefresh={refresh}
        currentId={player.current?.id ?? null}
        onPlay={(id) => void player.play(id)}
        onShuffleAll={(visible) => {
          player.setShuffle(true)
          const pick = visible[Math.floor(Math.random() * visible.length)]
          if (pick) void player.play(pick.id)
        }}
        onOpenSettings={() => setEditing(true)}
        onVisibleChange={setQueue}
      />
      <PlayerBar player={player} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' }
})
