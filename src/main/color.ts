// The accent color of a cover: the average of its colorful pixels, nudged so
// it reads well as a tint on the dark UI (not grey, not too dark or light).
// Pure; index.ts decodes the image with Electron's nativeImage.

export type RGB = [number, number, number]

/** Average of a BGRA bitmap, skipping near-black/near-white/grey pixels when there are colorful ones. */
export function averageColor(bgra: Uint8Array): RGB {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  let ar = 0
  let ag = 0
  let ab = 0
  let an = 0
  for (let i = 0; i + 3 < bgra.length; i += 4) {
    const [B, G, R] = [bgra[i], bgra[i + 1], bgra[i + 2]]
    ar += R
    ag += G
    ab += B
    an++
    const max = Math.max(R, G, B)
    const min = Math.min(R, G, B)
    if (max < 40 || min > 225 || max - min < 25) continue
    r += R
    g += G
    b += B
    n++
  }
  // A black-and-white cover has no colorful pixels: fall back to the plain average.
  if (n < an * 0.05) [r, g, b, n] = [ar, ag, ab, an]
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [139, 92, 246]
}

function toHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h / 6, s, l]
}

function toRgb([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number): number => {
    t = (t + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)]
}

/** Lightness 45–60% and some saturation, so the tint is visible on near-black without glaring. */
export function vivid(rgb: RGB): RGB {
  const [h, s, l] = toHsl(rgb)
  // Greys stay greys (a black-and-white cover gets a neutral tint), just brighter.
  const sat = s < 0.08 ? s : Math.max(s, 0.45)
  return toRgb([h, sat, Math.min(0.6, Math.max(0.45, l))])
}
