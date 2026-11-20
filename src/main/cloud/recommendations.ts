// "Recomendado para ti" for the phone: the same suggestions as the desktop's
// Home screen, uploaded so the phone can show them and mark songs.
import { MAX_RECOMMENDATIONS, type PutRecommendationsRequest } from '../../shared/api'
import type { Recommendations } from '../../shared/types'

export function toCloudRecommendations(r: Recommendations): PutRecommendationsRequest {
  return {
    basedOn: r.basedOn.slice(0, 20).map((t) => t.slice(0, 300)),
    results: r.results.slice(0, MAX_RECOMMENDATIONS).map((s) => ({
      id: s.id,
      title: s.title.slice(0, 300),
      artists: s.artists.slice(0, 500),
      durationSec: typeof s.durationSec === 'number' && s.durationSec >= 0 ? s.durationSec : null,
      coverUrl: s.coverUrl || null,
      deezerId: s.deezerId ?? null
    }))
  }
}
