// Automatic podcast downloads (on Wi-Fi, when the app opens): each show you follow keeps its
// newest episodes you haven't heard on the phone, and nothing piles up (podcasts.ts decides).
import type { Cloud } from './cloud'
import { deleteEpisode, downloadEpisode, loadEpisodePositions, loadSavedEpisodes } from './offline'
import { autoEpisodePlan, isHalfHeard } from './podcasts'

export async function syncAutoEpisodes(
  cloud: Pick<Cloud, 'listPodcastSubscriptions' | 'podcastEpisodes'>,
  now: number = Date.now()
): Promise<{ downloaded: number; removed: number }> {
  const [subs, saved, positions] = await Promise.all([
    cloud.listPodcastSubscriptions(),
    loadSavedEpisodes(),
    loadEpisodePositions()
  ])
  let downloaded = 0
  let removed = 0
  // Shows you stopped following: their automatic episodes go (unless you're halfway through one).
  const following = new Set(subs.map((p) => p.id))
  for (const s of saved) {
    if (s.auto && !following.has(s.show.id) && !isHalfHeard(s.episode, positions)) {
      await deleteEpisode(s.episode.id)
      removed++
    }
  }
  for (const show of subs) {
    let episodes
    try {
      episodes = await cloud.podcastEpisodes(show.id)
    } catch {
      continue // Apple didn't answer: leave this show as it is
    }
    if (episodes.length === 0) continue
    const plan = autoEpisodePlan(episodes, saved.filter((s) => s.show.id === show.id), positions)
    for (const id of plan.remove) {
      await deleteEpisode(id)
      removed++
    }
    for (const ep of plan.download) {
      try {
        await downloadEpisode(ep, show, now, true)
        downloaded++
      } catch {
        // next time
      }
    }
  }
  return { downloaded, removed }
}
