// YouTube titles → song + artist. Shared: the desktop cleans yt-dlp search hits,
// the Worker cleans YouTube Data API hits for the phone.

// "(Official Video)", "[Lyrics]", "(Video Oficial)", "(Audio)", "(HD)", "(Visualizer)"…
const NOISE =
  /\s*[([](?:official|oficial|video|vídeo|audio|lyrics?|letra|visualizer|hd|hq|4k|mv|music video)(?:[^)\]]*)[)\]]/gi

export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// "A, B", "A & B", "A feat. B", "A ft B", "A x B": a list of artists, not a song name.
const ARTIST_LIST = /,|&|\s(?:feat\.?|ft\.?|x)\s/i

/**
 * "Artist - Song (Official Video)" → { artists: "Artist", title: "Song" }.
 * Many channels write it the other way ("daño - Peso Pluma & Tito Double P"),
 * so the sides swap when the right one has the channel's name, or (no channel
 * to go by) when only the right one looks like a list of artists. With no dash,
 * the channel is the artist.
 */
export function cleanTitle(raw: string, channel: string): { title: string; artists: string } {
  const text = raw.replace(NOISE, '').replace(/\s+/g, ' ').trim() || raw.trim()
  const ch = fold(channel.replace(/\s+-\s+Topic$/i, '').replace(/VEVO$/i, ''))
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(text)
  if (dash) {
    const [left, right] = [dash[1].trim(), dash[2].trim()]
    // Whole words, so a channel named "x" doesn't match "remix".
    const hasChannel = (s: string): boolean => !!ch && ` ${fold(s)} `.includes(` ${ch} `)
    const swap = hasChannel(left)
      ? false
      : hasChannel(right) || (ARTIST_LIST.test(right) && !ARTIST_LIST.test(left))
    return swap ? { artists: right, title: left } : { artists: left, title: right }
  }
  const artists = channel
    .replace(/\s+-\s+Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim()
  return { title: text, artists }
}
