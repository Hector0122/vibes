// "Abrir al iniciar sesión": an XDG autostart entry (~/.config/autostart/vibes.desktop),
// which COSMIC, GNOME and KDE all read. It starts Vibes with --hidden: only the icon in
// the bar, ready for ▶. Turned on once on the first run of an installed build; after
// that, the tray checkbox decides (a marker remembers it was already offered).
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

export const HIDDEN_FLAG = '--hidden'

export function autostartFile(configHome: string): string {
  return join(configHome, 'autostart', 'vibes.desktop')
}

/** The .desktop entry that starts `exec` (the .deb's /opt/Vibes/vibes or the AppImage) hidden. */
export function autostartEntry(exec: string): string {
  const quoted = `"${exec.replace(/(["`$\\])/g, '\\$1')}"`
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Vibes',
    'Comment=Tu música, lista en la barra',
    `Exec=${quoted} ${HIDDEN_FLAG}`,
    'Icon=vibes',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

export const isAutostartOn = (configHome: string): boolean => existsSync(autostartFile(configHome))

export function setAutostart(configHome: string, exec: string, on: boolean): void {
  const file = autostartFile(configHome)
  if (!on) return rmSync(file, { force: true })
  mkdirSync(join(configHome, 'autostart'), { recursive: true })
  writeFileSync(file, autostartEntry(exec))
}

/** First run of an installed build: on, once. `marker` (in userData) says it was already done. */
export function autostartFirstRun(configHome: string, exec: string, marker: string): void {
  if (existsSync(marker)) return
  setAutostart(configHome, exec, true)
  writeFileSync(marker, '')
}
