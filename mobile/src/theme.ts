// Same palette as the desktop app.
export const colors = {
  bg: '#09090b',
  surface: 'rgba(255,255,255,0.05)',
  surfaceHi: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.08)',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  faint: '#71717a',
  violet: '#8b5cf6',
  pink: '#ec4899',
  pinkSoft: '#f472b6',
  red: '#f87171'
}

export const fmtTime = (sec: number | null | undefined): string =>
  sec == null || !Number.isFinite(sec) ? '' : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
