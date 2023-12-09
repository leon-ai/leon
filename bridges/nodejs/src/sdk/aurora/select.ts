import { type SelectProps } from '@leon-ai/aurora'

import { WidgetComponent } from '../widget-component'

export class Select extends WidgetComponent<SelectProps> {
  constructor(props: SelectProps) {
    super(props)
  }
}
