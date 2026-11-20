// Worker URL + token, kept in the phone's secure storage (Keychain / Keystore).
import * as SecureStore from 'expo-secure-store'

export interface CloudSettings {
  url: string
  token: string
}

const KEY = 'vibes.cloud'

export async function loadSettings(): Promise<CloudSettings | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<CloudSettings>
    return typeof s.url === 'string' && typeof s.token === 'string' && s.url && s.token
      ? { url: s.url, token: s.token }
      : null
  } catch {
    return null
  }
}

export async function saveSettings(s: CloudSettings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ url: s.url.trim(), token: s.token.trim() }))
}

export async function clearSettings(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY)
}
