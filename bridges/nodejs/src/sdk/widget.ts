import type { AuroraComponent } from '@sdk/types'

interface SerializedAuroraComponent {
  type: string
  props: Record<string, unknown>
}

export class Widget {
  private readonly components: SerializedAuroraComponent[]

  constructor(components: AuroraComponent[]) {
    this.components = components.map((component) => {
      return {
        type: component.constructor.name,
        props: {
          ...component
        }
      }
    })

    console.log('Widget constructor', this.components)
  }
}
