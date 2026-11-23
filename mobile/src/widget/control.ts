// What the widget's buttons do. With the app open they drive the same player;
// with it closed, the player starts from what's on the phone: only downloaded
// songs (so it works with no internet), picking up last time's song if it is
// one of them, otherwise shuffling them.
import { createCloud } from '../cloud'
import { engine } from '../engine'
import { loadDownloads, loadSnapshot } from '../offline'
import { setPlaysCloud } from '../plays'
import { loadSettings } from '../settings'

export type WidgetAction = 'TOGGLE' | 'NEXT' | 'PREV'

/** The player of a closed app: settings, and the downloaded songs as the list. */
async function bootFromDisk(): Promise<void> {
  if (engine.state.current || engine.getQueue().length) return
  const settings = await loadSettings()
  if (settings) {
    try {
      const cloud = createCloud(settings)
      engine.configure(cloud)
      setPlaysCloud(cloud)
    } catch {
      // no usable cloud: downloads still play
    }
  }
  const [snapshot, downloads] = await Promise.all([loadSnapshot(), loadDownloads()])
  const downloaded = (snapshot?.songs ?? []).filter((s) => downloads[s.id])
  engine.setQueue(downloaded.filter((s) => !s.book)) // music only; a book resumes from its chapters
  await engine.restore(downloaded, { onlyFrom: true })
}

export async function runWidgetAction(action: WidgetAction): Promise<void> {
  await bootFromDisk()
  if (action === 'NEXT') return engine.next()
  if (action === 'PREV') return engine.prev()
  if (!engine.state.current) {
    // Nothing from last time: shuffle what's downloaded.
    if (engine.getQueue().length === 0) return
    engine.setShuffle(true)
  }
  engine.toggle()
}
