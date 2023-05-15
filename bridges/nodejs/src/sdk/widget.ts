export abstract class Widget<T> {
  public readonly type: string
  public readonly options: T

  public constructor(options: T) {
    this.type = this.constructor.name
    this.options = options
  }
}
