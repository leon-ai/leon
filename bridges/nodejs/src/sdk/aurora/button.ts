// TODO: contains the button API. rendering engine <-> SDK
interface Options {
  text: string
}

export class Button {
  private readonly text: string

  constructor(options: Options) {
    this.text = options.text

    console.log('Button constructor', this.text)
  }
}
