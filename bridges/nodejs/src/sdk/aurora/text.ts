import { type TextProps } from '@leon-ai/aurora'

import { WidgetComponent } from '../widget-component'

export class Text extends WidgetComponent<TextProps> {
  constructor(props: TextProps) {
    super(props)
  }
}
