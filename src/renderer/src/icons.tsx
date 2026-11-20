// Line icons (24×24, stroke = currentColor), drawn here so the app needs no icon package.
type P = { className?: string }

function icon(paths: React.ReactNode, filled = false) {
  return function Icon({ className = 'h-5 w-5' }: P): React.JSX.Element {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {paths}
      </svg>
    )
  }
}

export const PlayIcon = icon(<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />, true)
export const PauseIcon = icon(
  <>
    <rect x="6" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </>,
  true
)
export const NextIcon = icon(
  <>
    <path d="M5 6.2v11.6a.8.8 0 0 0 1.25.66l8.4-5.8a.8.8 0 0 0 0-1.32l-8.4-5.8A.8.8 0 0 0 5 6.2z" />
    <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
  </>,
  true
)
export const PrevIcon = icon(
  <>
    <path d="M19 6.2v11.6a.8.8 0 0 1-1.25.66l-8.4-5.8a.8.8 0 0 1 0-1.32l8.4-5.8A.8.8 0 0 1 19 6.2z" />
    <rect x="5" y="5" width="2.5" height="14" rx="1" />
  </>,
  true
)
export const ShuffleIcon = icon(
  <>
    <path d="M3 7h3.2c2 0 3.2.9 4.3 2.5l2.9 4.5c1.1 1.6 2.3 2.5 4.3 2.5H21" />
    <path d="M3 17h3.2c1.3 0 2.3-.4 3.1-1.1" />
    <path d="M14.6 8.1c.8-.7 1.8-1.1 3.1-1.1H21" />
    <path d="M18 4l3 3-3 3" />
    <path d="M18 13.5l3 3-3 3" />
  </>
)
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>
)
export const HomeIcon = icon(
  <>
    <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
  </>
)
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />)
export const LibraryIcon = icon(
  <>
    <path d="M5 4v16M9.5 4v16" />
    <path d="M13.5 5.2l3.4-.9 3.6 14.5-3.4.9z" />
  </>
)
export const CloudIcon = icon(<path d="M7 18.5a4.75 4.75 0 0 1-.6-9.46 6 6 0 0 1 11.5 1A4.25 4.25 0 0 1 17.25 18.5z" />)
export const CloudCheckIcon = icon(
  <>
    <path d="M7 18.5a4.75 4.75 0 0 1-.6-9.46 6 6 0 0 1 11.5 1A4.25 4.25 0 0 1 17.25 18.5z" />
    <path d="M9.5 13.5l2 2 3.5-3.5" />
  </>
)
export const UploadIcon = icon(
  <>
    <path d="M7 18.5a4.75 4.75 0 0 1-.6-9.46 6 6 0 0 1 11.5 1A4.25 4.25 0 0 1 17.25 18.5" />
    <path d="M12 20v-7.5M9 15l3-3 3 3" />
  </>
)
export const DownloadIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v8.5M8.5 12.5L12 16l3.5-3.5" />
  </>
)
export const ImportIcon = icon(
  <>
    <path d="M12 3v11M8 10l4 4 4-4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </>
)
export const AlertIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </>
)
export const CheckIcon = icon(<path d="M5 12.5l4.5 4.5L19 7.5" />)
export const HeartIcon = icon(<path d="M12 20s-7-4.4-9.2-8.9A5 5 0 0 1 12 6.1a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z" />)
export const MusicIcon = icon(
  <>
    <path d="M9 18V5.5l11-2V16" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </>
)
export const VolumeIcon = icon(
  <>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
  </>
)
export const MuteIcon = icon(
  <>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
    <path d="M16 10l4 4M20 10l-4 4" />
  </>
)
export const ListIcon = icon(
  <>
    <path d="M4 6h12M4 11h12M4 16h7" />
    <circle cx="17.5" cy="17" r="2.5" />
    <path d="M20 17V9l2-1" />
  </>
)
export const RadioIcon = icon(
  <>
    <circle cx="12" cy="12" r="2" />
    <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
  </>
)
export const CloseIcon = icon(<path d="M6 6l12 12M18 6L6 18" />)

/** Three bouncing bars: "this song is playing". */
export function Equalizer({ active }: { active: boolean }): React.JSX.Element {
  return (
    <span className={`eq ${active ? '' : 'eq-paused'}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

/** The app logo: the icon's gradient square with a V. */
export function Logo({ className = 'h-8 w-8' }: P): React.JSX.Element {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="vibes-logo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="110" fill="url(#vibes-logo)" />
      <path d="M150 150h70l36 140 36-140h70l-72 220h-68z" fill="#fff" />
    </svg>
  )
}
