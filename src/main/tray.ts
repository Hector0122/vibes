// The icon in the system bar (COSMIC/KDE show it; GNOME needs the AppIndicator
// extension): play/pause, next, previous and the window, so music is one click away
// with the window closed. The menu is built here from plain state, so it is tested
// without a running Electron.
import type { MenuItemConstructorOptions } from 'electron'

export type PlayerCommand = 'toggle' | 'next' | 'prev'

export interface PlayerState {
  playing: boolean
  /** "Afuera — Caifanes"; null when nothing has been picked yet. */
  title: string | null
}

export interface TrayActions {
  command: (c: PlayerCommand) => void
  show: () => void
  quit: () => void
  autostart: { on: boolean; set: (on: boolean) => void } | null
}

/** "Vibes" / "Vibes · Afuera — Caifanes" (what hovering the icon says). */
export const trayTooltip = (s: PlayerState): string => (s.title ? `Vibes · ${s.title}` : 'Vibes')

export function trayMenu(s: PlayerState, a: TrayActions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    { label: s.title ?? 'Nada sonando', enabled: false },
    { type: 'separator' },
    { label: s.playing ? 'Pausar' : 'Reproducir', click: () => a.command('toggle') },
    { label: 'Siguiente', click: () => a.command('next') },
    { label: 'Anterior', click: () => a.command('prev') },
    { type: 'separator' },
    { label: 'Abrir Vibes', click: a.show }
  ]
  if (a.autostart) {
    const { on, set } = a.autostart
    items.push({ label: 'Abrir al iniciar sesión', type: 'checkbox', checked: on, click: () => set(!on) })
  }
  items.push({ type: 'separator' }, { label: 'Salir', click: a.quit })
  return items
}
