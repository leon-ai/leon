export abstract class WidgetComponent<T = unknown> {
  public readonly component: string
  public readonly props: T

  protected constructor(props: T) {
    this.component = this.constructor.name
    this.props = props
  }
}
