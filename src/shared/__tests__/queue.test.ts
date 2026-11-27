import { describe, expect, it } from 'vitest'
import { isListened, mixIn, pickNext, pickPrev, remember, shuffled } from '../queue'

const Q = ['a', 'b', 'c', 'd', 'e']

/** A rand() that replays the given values, for predictable shuffles. */
const seq = (...v: number[]) => {
  let i = 0
  return () => v[i++ % v.length]
}

describe('pickNext in order', () => {
  it('goes to the next one and wraps at the end', () => {
    expect(pickNext(Q, 'b', false, []).id).toBe('c')
    expect(pickNext(Q, 'e', false, []).id).toBe('a')
  })

  it('starts at the top when nothing is playing (or the song left the list)', () => {
    expect(pickNext(Q, null, false, []).id).toBe('a')
    expect(pickNext(Q, 'zzz', false, []).id).toBe('a')
  })

  it('an empty list plays nothing', () => {
    expect(pickNext([], 'a', true, ['a']).id).toBeNull()
  })
})

describe('pickNext shuffled', () => {
  it('plays every song once before repeating any, never the current one twice in a row', () => {
    for (let run = 0; run < 50; run++) {
      let current: string | null = null
      let bag: string[] = []
      const played: string[] = []
      for (let i = 0; i < Q.length * 3; i++) {
        const n = pickNext(Q, current, true, bag)
        expect(n.id).not.toBe(current)
        played.push(n.id!)
        current = n.id
        bag = n.bag
      }
      // The first round (with no song playing before it) covers the whole list.
      expect(new Set(played.slice(0, Q.length)).size).toBe(Q.length)
    }
  })

  it('draws from the bag with the given randomness', () => {
    expect(pickNext(Q, 'a', true, ['b', 'c', 'd'], seq(0.99))).toEqual({ id: 'd', bag: ['b', 'c'], wrapped: false })
    expect(pickNext(Q, 'a', true, ['b', 'c', 'd'], seq(0))).toEqual({ id: 'b', bag: ['c', 'd'], wrapped: false })
  })

  it('refills the bag when it runs out, leaving out the song that is playing', () => {
    const n = pickNext(Q, 'c', true, [], seq(0))
    expect(n.id).toBe('a')
    expect(n.bag.sort()).toEqual(['b', 'd', 'e'])
  })

  it('ignores bag songs that are no longer in the list (e.g. after a search filter)', () => {
    expect(pickNext(['a', 'b'], 'a', true, ['x', 'y'], seq(0)).id).toBe('b')
  })

  it('with a single song, plays it again instead of stopping', () => {
    expect(pickNext(['a'], 'a', true, []).id).toBe('a')
  })
})

describe('pickPrev', () => {
  it('goes back to what actually played, newest first', () => {
    expect(pickPrev(Q, 'd', ['a', 'e'])).toEqual({ id: 'e', history: ['a'] })
  })

  it('skips history entries that are the current song or left the list', () => {
    expect(pickPrev(Q, 'd', ['b', 'gone', 'd'])).toEqual({ id: 'b', history: [] })
  })

  it('with no history, goes up the list (wrapping)', () => {
    expect(pickPrev(Q, 'c', []).id).toBe('b')
    expect(pickPrev(Q, 'a', []).id).toBe('e')
  })
})

describe('remember', () => {
  it('appends, moves a replayed song to the end, and caps the length', () => {
    expect(remember(['a', 'b'], 'a')).toEqual(['b', 'a'])
    expect(remember(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd'])
  })
})

describe('isListened', () => {
  it('counts at 30 s for normal songs', () => {
    expect(isListened(29.9, 240)).toBe(false)
    expect(isListened(30, 240)).toBe(true)
  })
  it('counts at half for short songs', () => {
    expect(isListened(9, 20)).toBe(false)
    expect(isListened(10, 20)).toBe(true)
  })
  it('never counts before the length is known', () => {
    expect(isListened(100, NaN)).toBe(false)
    expect(isListened(100, 0)).toBe(false)
  })
})

describe('pickNext wrapped (the list ran out: the radio takes over)', () => {
  it('in order: only after the last song', () => {
    expect(pickNext(Q, 'd', false, []).wrapped).toBe(false)
    expect(pickNext(Q, 'e', false, []).wrapped).toBe(true)
    expect(pickNext(Q, null, false, []).wrapped).toBe(false)
    expect(pickNext(Q, 'gone', false, []).wrapped).toBe(false)
  })

  it('shuffled: after a full round, not when starting one', () => {
    expect(pickNext(Q, null, true, []).wrapped).toBe(false)
    expect(pickNext(Q, 'a', true, ['b']).wrapped).toBe(false)
    expect(pickNext(Q, 'b', true, []).wrapped).toBe(true)
    // A song picked by hand before any round started: the player passes the whole list.
    expect(pickNext(Q, 'b', true, Q).wrapped).toBe(false)
    expect(pickNext(Q, 'gone', true, []).wrapped).toBe(false) // a preview from outside the list
  })
})

describe('pickNext keeps the language in shuffle', () => {
  const L: Record<string, 'es' | 'en' | null> = { a: 'es', b: 'en', c: 'es', d: 'en', e: null }
  const langOf = (id: string) => L[id]

  it('after a Spanish song only Spanish ones; after an English one only English', () => {
    for (let run = 0; run < 30; run++) {
      expect(pickNext(Q, 'a', true, Q, Math.random, langOf).id).toBe('c')
      expect(['b', 'd']).toContain(pickNext(Q, 'd', true, ['b'], Math.random, langOf).id)
    }
  })

  it('a full Spanish round, then it starts over in Spanish', () => {
    const n = pickNext(Q, 'c', true, [], Math.random, langOf)
    expect(n).toMatchObject({ id: 'a', wrapped: true })
  })

  it('no restriction: in order, from an unknown song, at the start, or alone in its language', () => {
    expect(pickNext(Q, 'a', false, [], Math.random, langOf).id).toBe('b') // in order: the list as it is
    const fromUnknown = new Set(Array.from({ length: 60 }, () => pickNext(Q, 'e', true, Q, Math.random, langOf).id))
    expect(fromUnknown.size).toBe(4)
    expect(pickNext(Q, null, true, Q, seq(0.99), langOf).id).toBe('e')
    expect(pickNext(['a', 'b', 'd'], 'a', true, ['b', 'd'], seq(0), langOf).id).toBe('b')
  })
})

describe('the tray mix', () => {
  const ids = (l: { id: string }[]): string => l.map((s) => s.id).join(' ')
  const t = (...xs: string[]): { id: string }[] => xs.map((id) => ({ id }))

  it('one recommendation after every 3 of your songs; leftovers at the end', () => {
    expect(ids(mixIn(t('a', 'b', 'c', 'd', 'e', 'f', 'g'), t('X', 'Y', 'Z', 'W')))).toBe('a b c X d e f Y g Z W')
  })

  it('skips recommendations you already have, or repeated ones; none: just yours', () => {
    expect(ids(mixIn(t('a', 'b', 'c'), t('a', 'X', 'X')))).toBe('a b c X')
    expect(ids(mixIn(t('a', 'b'), []))).toBe('a b')
  })

  it('shuffled: same songs, another order, the original untouched', () => {
    const list = t('a', 'b', 'c', 'd')
    let k = 0
    const out = shuffled(list, () => [0.1, 0.9, 0.5][k++ % 3])
    expect(ids(out).split(' ').sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(out)).not.toBe('a b c d')
    expect(ids(list)).toBe('a b c d')
  })
})
