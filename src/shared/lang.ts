// A song's language (Spanish or English), so shuffle and radio don't mix them.
// Counts common words of each language in its lyrics (or title); words both
// languages use ("no", "me", "a"…) don't count.

export type Lang = 'es' | 'en'

const ES = new Set(
  'el la los las de del que y en un una por para con mi mis tu tus te se lo le les al como pero porque cuando donde quiero quieres eres soy estoy esta está este esto ese eso yo nos ya sin sobre todo nada siempre nunca más mas muy otra otro vez hay amor corazón vida noche'.split(
    ' '
  )
)
const EN = new Set(
  "the of and you your i i'm im it's is are was were be to with for that this what my we they she he his her don't dont can't cant won't just like love baby all night when there here have has from oh you're".split(
    ' '
  )
)

/** 'es' / 'en' when the text clearly leans one way; null when it doesn't say. */
export function guessLang(text: string | null | undefined): Lang | null {
  if (!text) return null
  const words = text.toLowerCase().match(/[a-záéíóúüñ']+/g) ?? []
  let es = 0
  let en = 0
  for (const w of words) {
    if (ES.has(w)) es++
    else if (EN.has(w)) en++
  }
  if (/[ñ¿¡]/i.test(text)) es += 2
  // Short texts (titles) need a lead; lyrics need a clear majority.
  if (es + en < 1) return null
  if (es >= 2 * en && es > en) return 'es'
  if (en >= 2 * es && en > es) return 'en'
  return null
}

/** From its lyrics, else its title (without "(Letra en Español)" and such). */
export const songLang = (lyrics: string | null, title: string): Lang | null =>
  guessLang(lyrics) ?? guessLang(title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' '))

/** The main artist: "A, B" / "A & B" / "A feat. B" → "a". */
const mainArtist = (artists: string): string =>
  (artists.split(/,|&|\s(?:feat\.?|ft\.?|x|y|and)\s/i)[0] ?? '').trim().toLowerCase()

/**
 * Fills in the songs nothing said about with what most songs of the same
 * artist are (an artist almost always sings in one language).
 */
export function fillByArtist<T extends { id: string; artists: string }>(
  songs: T[],
  known: Map<string, Lang>
): Map<string, Lang> {
  const votes = new Map<string, { es: number; en: number }>()
  for (const s of songs) {
    const l = known.get(s.id)
    if (!l) continue
    const a = mainArtist(s.artists)
    const v = votes.get(a) ?? { es: 0, en: 0 }
    v[l]++
    votes.set(a, v)
  }
  const out = new Map(known)
  for (const s of songs) {
    if (out.has(s.id)) continue
    const v = votes.get(mainArtist(s.artists))
    if (v && v.es !== v.en) out.set(s.id, v.es > v.en ? 'es' : 'en')
  }
  return out
}

/**
 * Radio tracks in `want` (or that nothing says otherwise about): by their
 * artist's songs in the library, else by their title.
 */
export function keepLang<T extends { id: string; title: string; artists: string }>(
  tracks: T[],
  library: { id: string; artists: string; lang?: Lang | null }[],
  want: Lang
): T[] {
  const known = new Map<string, Lang>()
  for (const s of library) if (s.lang) known.set(s.id, s.lang)
  const byArtist = fillByArtist([...library, ...tracks], known)
  return tracks.filter((t) => (byArtist.get(t.id) ?? songLang(null, t.title) ?? want) === want)
}
