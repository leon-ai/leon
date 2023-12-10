import { type WidgetWrapperProps } from '@leon-ai/aurora'

export interface WidgetOptions<T> {
  wrapperProps?: Omit<WidgetWrapperProps, 'children'>
  params?: T
}

export abstract class Widget<T> {
  public wrapperProps: WidgetOptions<T>['wrapperProps']
  public params: WidgetOptions<T>['params']

  protected constructor(options?: WidgetOptions<T>) {
    if (options?.wrapperProps) {
      this.wrapperProps = options.wrapperProps
    }

    if (!options?.params) {
      this.params = undefined
    } else {
      this.params = options.params
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  public abstract render()
}
