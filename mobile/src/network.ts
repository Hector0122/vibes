// Is the phone on Wi-Fi (or a cable)? Unknown counts as no, so "solo con Wi-Fi" never spends data by mistake.
import { getNetworkStateAsync, NetworkStateType } from 'expo-network'

export async function onWifi(): Promise<boolean> {
  try {
    const s = await getNetworkStateAsync()
    return s.type === NetworkStateType.WIFI || s.type === NetworkStateType.ETHERNET
  } catch {
    return false
  }
}
