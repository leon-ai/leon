import { type ImageProps } from '@leon-ai/aurora'

import { WidgetComponent } from '../widget-component'

export class Image extends WidgetComponent<ImageProps> {
  constructor(props: ImageProps) {
    super(props)
  }
}
