import { existsSync, mkdtempSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, installMode, installUpdate, isNewer, type DesktopUpdate, type UpdateProgress } from '../updater'

const release = (tag: string, assets: { name: string; size?: number }[]) =>
  (async () =>
    new Response(
      JSON.stringify({
        tag_name: tag,
        html_url: `https://github.com/Hector0122/vibes/releases/tag/${tag}`,
        assets: assets.map((a) => ({ ...a, browser_download_url: `https://dl.test/${a.name}` }))
      })
    )) as unknown as typeof fetch

describe('desktop updates', () => {
  it('compares versions like the phone', () => {
    expect(isNewer('v1.10.0', '1.9.2')).toBe(true)
    expect(isNewer('v1.7.0', '1.7.0')).toBe(false)
    expect(isNewer('v1.6.9', '1.7.0')).toBe(false)
    expect(isNewer('nightly', '1.0.0')).toBe(false)
  })

  it('only the .deb build updates itself; an AppImage opens the page; dev builds never', () => {
    expect(installMode({ isPackaged: true, execPath: '/opt/Vibes/vibes' })).toBe('deb')
    expect(installMode({ isPackaged: true, execPath: '/tmp/.mount_x/vibes', appImage: '/home/h/Vibes.AppImage' })).toBe('appimage')
    expect(installMode({ isPackaged: false, execPath: '/opt/Vibes/vibes' })).toBe('none')
    expect(installMode({ isPackaged: true, execPath: '/usr/lib/x/vibes' })).toBe('none')
  })

  it('finds the newer release and its amd64 .deb', async () => {
    const f = release('v1.8.0', [{ name: 'vibes-1.8.0.apk' }, { name: 'vibes_1.8.0_amd64.deb', size: 90 }, { name: 'Vibes-1.8.0.AppImage' }])
    expect(await checkForUpdate('1.7.0', f)).toEqual({
      version: '1.8.0',
      debUrl: 'https://dl.test/vibes_1.8.0_amd64.deb',
      size: 90,
      pageUrl: 'https://github.com/Hector0122/vibes/releases/tag/v1.8.0'
    })
    expect(await checkForUpdate('1.8.0', f)).toBeNull()
    expect(await checkForUpdate('1.7.0', release('v1.8.0', [{ name: 'vibes-1.8.0.apk' }]))).toBeNull() // no .deb yet
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await checkForUpdate('1.7.0', offline)).toBeNull()
    expect(await checkForUpdate('1.7.0', (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch)).toBeNull()
  })

  const update: DesktopUpdate = { version: '1.8.0', debUrl: 'https://dl.test/vibes_1.8.0_amd64.deb', size: 6, pageUrl: '' }
  const debFetch = (body = 'abcdef') =>
    (async () => new Response(body, { headers: { 'content-length': String(body.length) } })) as unknown as typeof fetch

  it('downloads the .deb, installs it with pkexec apt, reports progress, and leaves nothing behind', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vibes-upd-'))
    const calls: string[][] = []
    const progress: UpdateProgress[] = []
    const run = vi.fn(async (file: string, args: string[]) => {
      calls.push([file, ...args])
      expect(existsSync(args[3])).toBe(true) // the .deb is there while apt reads it
      return { code: 0, output: 'Configurando vibes (1.8.0) ...' }
    })
    await installUpdate(update, { tmpDir: tmp, fetch: debFetch(), run }, (p) => progress.push(p))
    expect(calls).toEqual([['pkexec', 'apt', 'install', '-y', join(tmp, 'vibes_1.8.0_amd64.deb')]])
    expect(progress[0]).toEqual({ stage: 'download', percent: 0 })
    expect(progress).toContainEqual({ stage: 'download', percent: 100 })
    expect(progress.at(-1)).toEqual({ stage: 'install' })
    expect(readdirSync(tmp)).toEqual([])
  })

  it('a closed password window, a failed apt or a short download say so (and nothing is left)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vibes-upd-'))
    const cancelled = async () => ({ code: 126, output: '' })
    await expect(installUpdate(update, { tmpDir: tmp, fetch: debFetch(), run: cancelled }, () => {})).rejects.toThrow(
      'Se canceló la contraseña'
    )
    const aptFails = async () => ({ code: 100, output: 'E: Sub-process /usr/bin/dpkg returned an error code (1)' })
    await expect(installUpdate(update, { tmpDir: tmp, fetch: debFetch(), run: aptFails }, () => {})).rejects.toThrow(
      /No se pudo instalar.*\n.*dpkg/
    )
    const run = vi.fn()
    await expect(installUpdate(update, { tmpDir: tmp, fetch: debFetch('abc'), run }, () => {})).rejects.toThrow('incompleta')
    expect(run).not.toHaveBeenCalled()
    expect(readdirSync(tmp)).toEqual([])
  })
})
