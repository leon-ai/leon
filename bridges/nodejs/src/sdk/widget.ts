import { type WidgetWrapperProps } from '@leon-ai/aurora'

interface WidgetOptions {
  wrapperProps: Omit<WidgetWrapperProps, 'children'>
}

export abstract class Widget {
  public abstract wrapperProps: WidgetOptions['wrapperProps']

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  public abstract render()
}
