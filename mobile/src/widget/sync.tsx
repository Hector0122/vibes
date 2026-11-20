// Keeps the widget showing the song and ▶/⏸ as the player changes.
import { requestWidgetUpdate } from 'react-native-android-widget'
import { engine, type PlayerState } from '../engine'
import { VibesWidget, WIDGET_NAME, type WidgetView } from './VibesWidget'

export const widgetView = (s: PlayerState): WidgetView => ({
  title: s.current?.title ?? null,
  artists: s.current?.artists ?? null,
  playing: s.playing
})

let started = false
let last = ''

export function startWidgetSync(): void {
  if (started) return
  started = true
  engine.subscribe(() => {
    const v = widgetView(engine.state)
    const key = `${v.title}|${v.artists}|${v.playing}`
    if (key === last) return
    last = key
    requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: () => <VibesWidget {...v} />
    }).catch(() => {})
  })
}
