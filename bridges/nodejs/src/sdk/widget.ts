import { type WidgetWrapperProps } from '@leon-ai/aurora'

import { WidgetComponent } from '@sdk/widget-component'

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

  public abstract render(): WidgetComponent<unknown>
}
