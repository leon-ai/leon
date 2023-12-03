// TODO: "Widget" mother class from SDK
// export default class WidgetPlayground extends Widget {

import { WidgetWrapper, Button, Text } from '@sdk/aurora'

interface PlaygroundTestWidgetProps {
  value1: string
  value2: string
}

export default class PlaygroundTestWidget {
  props: PlaygroundTestWidgetProps

  constructor(props: PlaygroundTestWidgetProps) {
    this.props = props
  }

  render() {
    // TODO: force WidgetWrapper to be the root element (from mother class render method)

    return new WidgetWrapper({
      children: [
        new Button({
          children: this.props.value1 + ' ' + this.props.value2
        }),
        new Button({
          danger: true,
          children: 'Danger button'
        }),
        new Text({
          children: 'hello world'
        })
      ]
    })
  }
}
