import { type CardProps } from '@leon-ai/aurora'

import { WidgetComponent } from '../widget-component'

export class Card extends WidgetComponent<CardProps> {
  constructor(props: CardProps) {
    super(props)
  }
}
