// Android calls this (as a background task) when the widget is added, updated
// or tapped, also with the app closed.
import type { WidgetTaskHandlerProps } from 'react-native-android-widget'
import { engine } from '../engine'
import { runWidgetAction, type WidgetAction } from './control'
import { startWidgetSync, widgetView } from './sync'
import { VibesWidget } from './VibesWidget'

const ACTIONS: string[] = ['TOGGLE', 'NEXT', 'PREV']

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  startWidgetSync()
  if (props.widgetAction === 'WIDGET_DELETED') return
  if (
    props.widgetAction === 'WIDGET_CLICK' &&
    props.clickAction &&
    ACTIONS.includes(props.clickAction)
  ) {
    await runWidgetAction(props.clickAction as WidgetAction).catch(() => {})
  }
  props.renderWidget(<VibesWidget {...widgetView(engine.state)} />)
}
