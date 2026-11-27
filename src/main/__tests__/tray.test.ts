// The tray icon's menu and the login autostart (plain functions: no Electron running).
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { autostartEntry, autostartFile, autostartFirstRun, isAutostartOn, setAutostart } from '../autostart'
import { trayMenu, trayTooltip, type TrayActions } from '../tray'

describe('tray menu', () => {
  const actions = (autostart: TrayActions['autostart'] = null): TrayActions => ({
    command: vi.fn(),
    show: vi.fn(),
    quit: vi.fn(),
    autostart
  })
  const click = (items: ReturnType<typeof trayMenu>, label: string): void =>
    (items.find((i) => i.label === label)!.click as () => void)()

  it('nothing playing: says so, and ▶ Reproducir asks the player to start', () => {
    const a = actions()
    const items = trayMenu({ playing: false, title: null }, a)
    expect(items[0]).toMatchObject({ label: 'Nada sonando', enabled: false })
    click(items, 'Reproducir')
    expect(a.command).toHaveBeenCalledWith('toggle')
    expect(trayTooltip({ playing: false, title: null })).toBe('Vibes')
  })

  it('playing: shows the song, Pausar, and Siguiente / Anterior / Abrir / Salir do their thing', () => {
    const a = actions()
    const items = trayMenu({ playing: true, title: 'Afuera — Caifanes' }, a)
    expect(items[0].label).toBe('Afuera — Caifanes')
    expect(items.some((i) => i.label === 'Reproducir')).toBe(false)
    click(items, 'Pausar')
    click(items, 'Siguiente')
    click(items, 'Anterior')
    expect(vi.mocked(a.command).mock.calls.flat()).toEqual(['toggle', 'next', 'prev'])
    click(items, 'Abrir Vibes')
    click(items, 'Salir')
    expect(a.show).toHaveBeenCalled()
    expect(a.quit).toHaveBeenCalled()
    expect(trayTooltip({ playing: true, title: 'Afuera — Caifanes' })).toBe('Vibes · Afuera — Caifanes')
  })

  it('"Abrir al iniciar sesión": a checkbox only for the installed app, that flips it', () => {
    expect(trayMenu({ playing: false, title: null }, actions()).some((i) => i.type === 'checkbox')).toBe(false)
    const set = vi.fn()
    const items = trayMenu({ playing: false, title: null }, actions({ on: true, set }))
    expect(items.find((i) => i.type === 'checkbox')).toMatchObject({ label: 'Abrir al iniciar sesión', checked: true })
    click(items, 'Abrir al iniciar sesión')
    expect(set).toHaveBeenCalledWith(false)
  })
})

describe('autostart', () => {
  it('the entry starts the installed app hidden (quoted path)', () => {
    const e = autostartEntry('/opt/Vibes/vibes')
    expect(e).toContain('[Desktop Entry]')
    expect(e).toContain('Exec="/opt/Vibes/vibes" --hidden')
    expect(autostartEntry('/home/a b/Vibes.AppImage')).toContain('Exec="/home/a b/Vibes.AppImage" --hidden')
  })

  it('on and off; turned on only the first time (then it is your choice)', () => {
    const home = mkdtempSync(join(tmpdir(), 'vibes-autostart-'))
    const marker = join(home, 'offered')
    expect(isAutostartOn(home)).toBe(false)
    autostartFirstRun(home, '/opt/Vibes/vibes', marker)
    expect(isAutostartOn(home)).toBe(true)
    expect(readFileSync(autostartFile(home), 'utf8')).toContain('/opt/Vibes/vibes')
    setAutostart(home, '/opt/Vibes/vibes', false)
    expect(existsSync(autostartFile(home))).toBe(false)
    autostartFirstRun(home, '/opt/Vibes/vibes', marker) // next start: you turned it off, it stays off
    expect(isAutostartOn(home)).toBe(false)
  })
})
