// Shared by the lyrics fetcher (main) and the lyrics view (renderer).
import type { LyricLine } from './types'

/** Index of the line being sung at `time` (-1 before the first). */
export function currentLine(lines: LyricLine[], time: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].t <= time) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}
