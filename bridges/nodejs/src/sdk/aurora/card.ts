import { type CardProps } from '@leon-ai/aurora'

import { Widget } from '../widget'

export class Card extends Widget<CardProps> {
  constructor(props: CardProps) {
    super(props)
  }
}
