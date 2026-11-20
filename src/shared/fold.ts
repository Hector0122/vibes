// Text for matching names across services (Deezer, LRCLIB): no accents, no case,
// no "(feat. X)" / "[Remastered]", only letters and digits separated by spaces.
export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ') // "(feat. X)", "[Remastered]"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
