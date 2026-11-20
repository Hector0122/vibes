// Jest stand-in for react-native-android-widget: records widget updates.
export const requestWidgetUpdate = jest.fn(async () => {})
export const registerWidgetTaskHandler = jest.fn()
export const FlexWidget = ({ children }: { children?: React.ReactNode }): React.ReactNode => children ?? null
export const TextWidget = ({ text }: { text: string }): React.ReactNode => text
