// "Hay una versión nueva": on start, ask GitHub for the latest release of this
// repo; if it's newer than this app and has an APK, offer to download it.
// The APK isn't from a store, so nothing else would ever tell the phone.
import app from '../app.json'

export const LATEST_RELEASE = 'https://api.github.com/repos/Hector0122/vibes/releases/latest'
export const APP_VERSION: string = app.expo.version

export interface Update {
  version: string
  apkUrl: string
}

/** "v1.10.0" vs "1.9.2" → true. Anything that isn't x.y.z counts as not newer. */
export function isNewer(tag: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
    return m ? m.slice(1).map(Number) : null
  }
  const a = parse(tag)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/** The newer release, or null (also when offline or GitHub is rate-limiting). */
export async function checkForUpdate(
  doFetch: typeof fetch = fetch,
  current = APP_VERSION
): Promise<Update | null> {
  try {
    const res = await doFetch(LATEST_RELEASE, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return null
    const release = (await res.json()) as {
      tag_name?: string
      assets?: { name?: string; browser_download_url?: string }[]
    }
    const apk = release.assets?.find((a) => a.name?.endsWith('.apk') && a.browser_download_url)
    if (!release.tag_name || !apk || !isNewer(release.tag_name, current)) return null
    return { version: release.tag_name.replace(/^v/, ''), apkUrl: apk.browser_download_url! }
  } catch {
    return null
  }
}
