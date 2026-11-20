import { describe, expect, it } from 'vitest'
import { validateRecommendations } from '../../../shared/api'
import { toCloudRecommendations } from '../recommendations'

describe('toCloudRecommendations', () => {
  it('keeps what the phone needs, in a shape the Worker accepts', () => {
    const out = toCloudRecommendations({
      basedOn: ['Stylo'],
      results: [
        { id: 'aaaaaaaaaaa', title: 'Feel Good Inc.', artists: 'Gorillaz', durationSec: 222, coverUrl: 'https://i/1.jpg' },
        { id: 'bbbbbbbbbbb', title: 'x'.repeat(400), artists: 'y', durationSec: null, coverUrl: '' }
      ]
    })
    expect(out.results[0]).toEqual({ id: 'aaaaaaaaaaa', title: 'Feel Good Inc.', artists: 'Gorillaz', durationSec: 222, coverUrl: 'https://i/1.jpg' })
    expect(out.results[1].coverUrl).toBeNull()
    expect(validateRecommendations(out)).toBeNull()
  })
})
