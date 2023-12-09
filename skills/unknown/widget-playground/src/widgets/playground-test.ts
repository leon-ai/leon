// TODO: "Widget" mother class from SDK
// export default class WidgetPlayground extends Widget {

import { Button, Flexbox } from '@sdk/aurora'
import { Widget } from '@sdk/widget'

interface WidgetOptions {
  wrapperProps: Widget['wrapperProps']
  params: Params
}

interface Params {
  value1: string
  value2: string
}

export default class PlaygroundTestWidget extends Widget {
  public readonly wrapperProps: Widget['wrapperProps']
  private readonly params: Params

  constructor(options: WidgetOptions) {
    super()

    this.wrapperProps = options.wrapperProps
    this.params = options.params
  }

  public render() {
    // TODO: force WidgetWrapper to be the root element (from mother class render method)

    return new Button({
      children: this.params.value1 + ' ' + this.params.value2
    })

    /*return new WidgetWrapper({
      children: [
        new Flexbox({
          gap: 'md',
          children: [
            new Button({
              children: this.params.value1 + ' ' + this.params.value2
            }),
            new Button({
              danger: true,
              children: 'Danger button'
            })
          ]
        })
      ]
    })*/
  }
}
