// "Hay una versión nueva" on the computer, like the phone's: on start, ask GitHub for the latest
// release; installed from the .deb (/opt/Vibes), "Actualizar" downloads the new .deb and installs it
// with pkexec (the system's password window), then the app restarts on the new version. The .deb
// doesn't come from an apt repository, so nothing else would ever update it.
import { createWriteStream } from 'fs'
import { rm, stat } from 'fs/promises'
import { join } from 'path'

export const LATEST_RELEASE = 'https://api.github.com/repos/Hector0122/vibes/releases/latest'

export interface DesktopUpdate {
  version: string
  debUrl: string
  size: number
  pageUrl: string
}

/** How this copy can update itself: the .deb in place, an AppImage (open the release page), or not at all (dev). */
export type InstallMode = 'deb' | 'appimage' | 'none'

export function installMode(o: { isPackaged: boolean; execPath: string; appImage?: string }): InstallMode {
  if (!o.isPackaged) return 'none'
  if (o.appImage) return 'appimage'
  return o.execPath.startsWith('/opt/Vibes/') ? 'deb' : 'none'
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

/** The newer release with its .deb, or null (also offline or when GitHub is rate-limiting). */
export async function checkForUpdate(current: string, doFetch: typeof fetch = fetch): Promise<DesktopUpdate | null> {
  try {
    const res = await doFetch(LATEST_RELEASE, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return null
    const release = (await res.json()) as {
      tag_name?: string
      html_url?: string
      assets?: { name?: string; size?: number; browser_download_url?: string }[]
    }
    const deb = release.assets?.find((a) => /^vibes_[\d.]+_amd64\.deb$/.test(a.name ?? '') && a.browser_download_url)
    if (!release.tag_name || !deb || !isNewer(release.tag_name, current)) return null
    return {
      version: release.tag_name.replace(/^v/, ''),
      debUrl: deb.browser_download_url!,
      size: deb.size ?? 0,
      pageUrl: release.html_url ?? `https://github.com/Hector0122/vibes/releases/tag/${release.tag_name}`
    }
  } catch {
    return null
  }
}

export type UpdateProgress = { stage: 'download'; percent: number } | { stage: 'install' }

export interface InstallDeps {
  tmpDir: string
  fetch: typeof fetch
  /** Runs a program (no shell) and resolves with its exit code and output. */
  run: (file: string, args: string[]) => Promise<{ code: number | null; output: string }>
}

/** Streams a file to disk, reporting whole percents. */
export async function downloadTo(
  doFetch: typeof fetch,
  url: string,
  dest: string,
  onPercent: (pct: number) => void
): Promise<number> {
  const res = await doFetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar la actualización (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const out = createWriteStream(dest)
  let got = 0
  let last = -1
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.length
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      const pct = total ? Math.floor((got / total) * 100) : 0
      if (pct !== last) onPercent((last = pct))
    }
  } finally {
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  }
  return got
}

/** Downloads the .deb and installs it with pkexec. Throws with what to tell the user. */
export async function installUpdate(
  u: DesktopUpdate,
  deps: InstallDeps,
  onProgress: (p: UpdateProgress) => void
): Promise<void> {
  const deb = join(deps.tmpDir, `vibes_${u.version}_amd64.deb`)
  try {
    onProgress({ stage: 'download', percent: 0 })
    await downloadTo(deps.fetch, u.debUrl, deb, (percent) => onProgress({ stage: 'download', percent }))
    if (u.size && (await stat(deb)).size !== u.size) throw new Error('La descarga de la actualización llegó incompleta')
    onProgress({ stage: 'install' })
    const r = await deps.run('pkexec', ['apt', 'install', '-y', deb])
    // pkexec: 126 = the password window was closed or the password refused, 127 = not authorized.
    if (r.code === 126 || r.code === 127) throw new Error('Se canceló la contraseña: no se actualizó')
    if (r.code !== 0) {
      const tail = r.output.trim().split('\n').slice(-4).join('\n')
      throw new Error(`No se pudo instalar la actualización${tail ? `:\n${tail}` : ''}`)
    }
  } finally {
    await rm(deb, { force: true })
  }
}
