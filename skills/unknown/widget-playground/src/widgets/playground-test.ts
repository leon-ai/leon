import { Widget, type WidgetOptions } from '@sdk/widget'
import { Button } from '@sdk/aurora'

interface Params {
  value1: string
  value2: string
}

export default class PlaygroundTestWidget extends Widget<Params> {
  constructor(options?: WidgetOptions<Params>) {
    super(options)
  }

  public render(): Button {
    let children = 'Click me'

    if (this.params) {
      children = this.params.value1 + ' ' + this.params.value2
    }

    return new Button({
      children
    })
  }
}
