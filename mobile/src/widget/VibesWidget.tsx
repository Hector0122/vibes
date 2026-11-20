// The home screen widget: what's playing and ⏮ ▶/⏸ ⏭. Drawn by Android from
// this description (react-native-android-widget), so only its own primitives.
import { FlexWidget, TextWidget } from 'react-native-android-widget'

export const WIDGET_NAME = 'Vibes'

export interface WidgetView {
  title: string | null
  artists: string | null
  playing: boolean
}

const Button = ({
  label,
  action,
  big
}: {
  label: string
  action: string
  big?: boolean
}): React.JSX.Element => (
  <FlexWidget
    clickAction={action}
    style={{
      width: big ? 52 : 40,
      height: big ? 52 : 40,
      borderRadius: big ? 26 : 20,
      backgroundColor: big ? '#ec4899' : '#00000000',
      justifyContent: 'center',
      alignItems: 'center'
    }}
  >
    <TextWidget text={label} style={{ fontSize: big ? 22 : 20, color: '#ffffff' }} />
  </FlexWidget>
)

export function VibesWidget({ title, artists, playing }: WidgetView): React.JSX.Element {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        borderRadius: 24,
        backgroundGradient: { from: '#2a1846', to: '#0a0a0a', orientation: 'LEFT_RIGHT' }
      }}
    >
      <FlexWidget
        clickAction="OPEN_APP"
        style={{ flex: 1, flexDirection: 'column', justifyContent: 'center' }}
      >
        <TextWidget
          text={title ?? 'Vibes'}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 15, fontWeight: '700', color: '#f4f4f5' }}
        />
        <TextWidget
          text={artists ?? 'Toca ▶ para escuchar lo descargado'}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}
        />
      </FlexWidget>
      <Button label="⏮" action="PREV" />
      <Button label={playing ? '⏸' : '▶'} action="TOGGLE" big />
      <Button label="⏭" action="NEXT" />
    </FlexWidget>
  )
}
