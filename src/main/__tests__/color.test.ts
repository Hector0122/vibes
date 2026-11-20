import { describe, expect, it } from 'vitest'
import { averageColor, vivid, type RGB } from '../color'

/** A BGRA bitmap from [rgb, count] runs. */
const bitmap = (...runs: [RGB, number][]): Uint8Array => {
  const px: number[] = []
  for (const [[r, g, b], n] of runs) for (let i = 0; i < n; i++) px.push(b, g, r, 255)
  return Uint8Array.from(px)
}

describe('averageColor', () => {
  it('averages the colorful pixels and ignores black, white and grey', () => {
    const c = averageColor(
      bitmap(
        [[200, 30, 30], 10], // red
        [[0, 0, 0], 50], // black bars
        [[255, 255, 255], 20], // white text
        [[120, 120, 120], 20] // grey
      )
    )
    expect(c).toEqual([200, 30, 30])
  })

  it('a black-and-white cover falls back to the plain average', () => {
    expect(averageColor(bitmap([[0, 0, 0], 1], [[200, 200, 200], 1]))).toEqual([100, 100, 100])
  })

  it('an empty bitmap gives the app’s violet', () => {
    expect(averageColor(new Uint8Array())).toEqual([139, 92, 246])
  })
})

describe('vivid', () => {
  const lightness = ([r, g, b]: RGB): number => (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255

  it('a very dark color is lifted so it shows on the dark UI, keeping its hue', () => {
    const [r, g, b] = vivid([40, 5, 5])
    expect(lightness([r, g, b])).toBeGreaterThanOrEqual(0.44)
    expect(r).toBeGreaterThan(g * 2) // still red
  })

  it('a pale color gets saturation and comes down from white', () => {
    const c = vivid([230, 220, 250])
    expect(lightness(c)).toBeLessThanOrEqual(0.61)
    expect(Math.max(...c) - Math.min(...c)).toBeGreaterThan(80)
  })

  it('grey stays grey', () => {
    const [r, g, b] = vivid([30, 30, 30])
    expect(r).toBe(g)
    expect(g).toBe(b)
  })
})
