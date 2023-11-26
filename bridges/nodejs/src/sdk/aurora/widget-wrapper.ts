import { Widget } from '../widget'

// TODO: contains the button API. rendering engine <-> SDK
interface WidgetWrapperProps {
  children: any
}

export class WidgetWrapper extends Widget<WidgetWrapperProps> {
  constructor(props: WidgetWrapperProps) {
    super(props)
  }
}
