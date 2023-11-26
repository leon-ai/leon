import { Widget } from '../widget'

// TODO: contains the button API. rendering engine <-> SDK
interface CardProps {
  children: any
  fullWidth?: boolean
}

export class Card extends Widget<CardProps> {
  constructor(props: CardProps) {
    super(props)
  }
}
