import { Widget } from '../widget'

// TODO: contains the button API. rendering engine <-> SDK
interface ButtonProps {
  children: any
  danger?: boolean
}

export class Button extends Widget<ButtonProps> {
  constructor(props: ButtonProps) {
    super(props)
  }
}
