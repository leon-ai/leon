import { Widget } from '../widget'

// TODO: contains the button API. rendering engine <-> SDK
interface ButtonOptions {
  text: string
}

export class Button extends Widget<ButtonOptions> {
  public constructor(options: ButtonOptions) {
    super(options)
  }
}
