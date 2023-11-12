import { Widget } from '../widget'

// TODO: contains the button API. rendering engine <-> SDK
interface CardOptions {
  children: any
  fullWidth?: boolean
}

export class Card extends Widget<CardOptions> {
  constructor(options: CardOptions) {
    super(options)
  }
}
