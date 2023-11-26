export abstract class Widget<T> {
  public readonly component: string
  public readonly props: T

  protected constructor(props: T) {
    this.component = this.constructor.name
    this.props = props
  }
}
